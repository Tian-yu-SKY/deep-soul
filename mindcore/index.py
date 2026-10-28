"""索引层：分舱聚类与路由、类型化邻接、个性化 PageRank（§3.8, §3.10, §5.5）。"""
import math
import struct
import random
import time

from .embed import cosine, mean_vec
from . import text as T

EDGE_W = {"co": 1.0, "temporal": 1.0, "tag": 1.25, "ground": 1.15, "spine": 1.2}


def k_for(n, cfg):
    k = round(math.sqrt(max(n, 1) / 5.0))
    return max(cfg.cell_min, min(cfg.cell_max, k))


def _blob(vec):
    return struct.pack("<%df" % len(vec), *vec)


def _unblob(b):
    if b is None:
        return None
    return list(struct.unpack("<%df" % (len(b) // 4), b))


class Index:
    def __init__(self, store, cfg, embedder=None):
        self.store = store
        self.cfg = cfg
        self.embedder = embedder

    # ---------- 分舱 ----------
    def mode(self):
        """vector：有向量，真聚类；bucket：无向量，按 (受众, 分区) 粗分桶。"""
        n = self.store.count("SELECT COUNT(*) FROM nodes WHERE status='active'")
        if n == 0:
            return "bucket"
        withvec = self.store.count("SELECT COUNT(*) FROM nodes WHERE status='active' AND embedding IS NOT NULL")
        return "vector" if withvec >= max(3, n * 0.5) else "bucket"

    def rebuild_cells(self):
        mode = self.mode()
        with self.store.tx() as c:
            c.execute("DELETE FROM cells")
            c.execute("DELETE FROM cell_members")
        if mode == "bucket":
            rows = self.store.conn.execute(
                "SELECT id, audience, region FROM nodes WHERE status='active'").fetchall()
            groups = {}
            for r in rows:
                groups.setdefault((r["audience"], r["region"]), []).append(r["id"])
            with self.store.tx() as c:
                for (aud, reg), ids in groups.items():
                    cid = f"{aud}:{reg}"
                    c.execute("INSERT INTO cells(cell_id,audience,region,centroid,summary,size,updated_at)"
                              " VALUES(?,?,?,?,?,?,?)", (cid, aud, reg, None, reg, len(ids), time.time()))
                    c.executemany("INSERT INTO cell_members(cell_id,node_id) VALUES(?,?)",
                                  [(cid, i) for i in ids])
            return {"mode": "bucket", "cells": len(groups)}

        rows = self.store.conn.execute(
            "SELECT id, audience, embedding FROM nodes WHERE status='active' AND embedding IS NOT NULL").fetchall()
        by_aud = {}
        for r in rows:
            by_aud.setdefault(r["audience"], []).append((r["id"], _unblob(r["embedding"])))
        total, built = len(rows), 0
        with self.store.tx() as c:
            for aud, items in by_aud.items():
                k = max(2, min(k_for(total, self.cfg), max(1, len(items) // 3)))
                cents = self._kmeans([v for _, v in items], k)
                assign = {}
                for (nid, v), label in zip(items, self._assign([v for _, v in items], cents)):
                    assign.setdefault(label, []).append(nid)
                for label, ids in assign.items():
                    cid = f"c{label}:{aud}"
                    centroid = mean_vec([v for (i2, v), l in zip(items, self._assign([v for _, v in items], cents)) if l == label])
                    summary = ids
                    c.execute("INSERT INTO cells(cell_id,audience,region,centroid,summary,size,updated_at)"
                              " VALUES(?,?,?,?,?,?,?)",
                              (cid, aud, "", _blob(centroid) if centroid else None,
                               f"{len(ids)} 条", len(ids), time.time()))
                    c.executemany("INSERT INTO cell_members(cell_id,node_id) VALUES(?,?)",
                                  [(cid, i) for i in ids])
                    built += 1
        return {"mode": "vector", "cells": built}

    def _kmeans(self, vecs, k, iters=12, seed=7):
        rng = random.Random(seed)
        cents = [list(vecs[rng.randrange(len(vecs))]) for _ in range(k)]
        for _ in range(iters):
            labels = self._assign(vecs, cents)
            new = []
            for i in range(k):
                group = [v for v, l in zip(vecs, labels) if l == i]
                new.append(mean_vec(group) if group else cents[i])
            if new == cents:
                break
            cents = new
        return cents

    def _assign(self, vecs, cents):
        out = []
        for v in vecs:
            sims = [cosine(v, c) for c in cents]
            out.append(max(range(len(sims)), key=lambda i: sims[i]))
        return out

    def route(self, query, ctx, visible_ids):
        """返回候选 id 集合；候选不足则回退全库。"""
        cells = self.store.conn.execute("SELECT * FROM cells").fetchall()
        if not cells:
            return set(visible_ids), {"mode": "none", "cells": 0}
        aud_cells = [c for c in cells if self._aud_ok(c["audience"], ctx)]
        if not aud_cells:
            return set(visible_ids), {"mode": "fallback", "cells": 0}

        # 候选下限：至少覆盖 8% 或 40 条，避免小舱把召回吃掉（P8 的可检验推论）
        floor = min(len(visible_ids), max(40, int(0.08 * len(visible_ids))))
        picked = []
        if self.mode() == "vector" and self.embedder:
            qv = self.embedder.encode(query)
            scored = []
            for c in aud_cells:
                cent = _unblob(c["centroid"])
                if cent:
                    scored.append((cosine(qv, cent), c))
            scored.sort(key=lambda x: -x[0])
            picked = [c for _, c in scored[: self.cfg.cell_route_top]]
            mode = "vector"
        else:
            reg = T.region_of(query)
            exact = [c for c in aud_cells if c["region"] == reg]
            picked = exact[: self.cfg.cell_route_top] or aud_cells[: self.cfg.cell_route_top]
            mode = "bucket"

        # 写入不会更新 cells，新节点可能不在任何舱里；不补进来就永远召不到
        assigned = {r["node_id"] for r in self.store.conn.execute("SELECT node_id FROM cell_members")}
        ids = set()
        for c in picked:
            rows = self.store.conn.execute(
                "SELECT node_id FROM cell_members WHERE cell_id=?", (c["cell_id"],)).fetchall()
            ids.update(r["node_id"] for r in rows)
        # 候选不足时按路由顺序补舱，直到达到下限或补完（仍不是全库）
        if len(ids) < floor:
            for c in (locals().get("scored") and [x[1] for x in scored] or aud_cells):
                if c["cell_id"] in [p["cell_id"] for p in picked]:
                    continue
                picked.append(c)
                rows = self.store.conn.execute(
                    "SELECT node_id FROM cell_members WHERE cell_id=?", (c["cell_id"],)).fetchall()
                ids.update(r["node_id"] for r in rows)
                if len(ids) >= floor:
                    break
        ids |= (set(visible_ids) - assigned)
        ids &= set(visible_ids)
        if len(ids) < self.cfg.cell_min_hits:
            return set(visible_ids), {"mode": "fallback", "cells": len(picked)}
        return ids, {"mode": mode, "cells": len(picked)}

    @staticmethod
    def _aud_ok(cell_aud, ctx):
        if cell_aud == "public":
            return True
        return ctx.get("audience") == cell_aud

    # ---------- 类型化 PPR ----------
    def typed_ppr(self, seeds, cand_ids, hops=2):
        cand = set(cand_ids)
        rows = self.store.conn.execute("SELECT src,dst,kind,weight FROM edges").fetchall()
        adj = {}
        for r in rows:
            w = r["weight"] * EDGE_W.get(r["kind"], 1.0)
            if r["src"] in cand or r["dst"] in cand:
                adj.setdefault(r["src"], []).append((r["dst"], w))
                adj.setdefault(r["dst"], []).append((r["src"], w))
        if not adj:
            return {i: 0.0 for i in cand}
        p = {i: 0.0 for i in cand}
        for s in seeds:
            if s in p:
                p[s] = 1.0 / max(1, len(seeds))
        d = self.cfg.ppr_damping
        for _ in range(self.cfg.ppr_iters):
            nxt = {i: 0.0 for i in cand}
            for i, mass in p.items():
                if mass == 0:
                    continue
                if i in seeds:
                    nxt[i] += (1 - d) * mass
                out = adj.get(i, [])
                tot = sum(w for _, w in out) or 1.0
                for j, w in out:
                    if j in nxt:
                        nxt[j] += d * mass * w / tot
            p = nxt
            s = sum(p.values()) or 1.0
            p = {k2: v / s for k2, v in p.items()}
        mx = max(p.values()) or 1.0
        return {k2: v / mx for k2, v in p.items()}

    # ---------- 舱召回率测量 ----------
    def cell_recall(self, queries, ctx, scorer, topk=5):
        """CR：分舱候选相对全量打分的 Top-k 重合率。"""
        hit, total = 0, 0
        for q in queries:
            visible = [n["id"] for n in self.store.active_nodes()
                       if n["audience"] == "public" or n["audience"] == ctx.get("audience")]
            if not visible:
                continue
            full = sorted(visible, key=lambda i: (-scorer(q, self.store.node(i)), i))[:topk]
            cand, _ = self.route(q, ctx, visible)
            part = sorted(cand, key=lambda i: (-scorer(q, self.store.node(i)), i))[:topk]
            hit += len(set(full) & set(part))
            total += len(full)
        return (hit / total) if total else 1.0
