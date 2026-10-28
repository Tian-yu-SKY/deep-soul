"""巩固层：五算子闸门、和解、情绪回归、证据保留（§3.4, §3.6, §3.9）。"""
import os
import time

from . import text as T

DEFAULT_CONSTITUTION = ["无条件服从", "放弃边界", "只有我记得你"]


class Consolidator:
    def __init__(self, store, cfg, encoder=None, index=None, embedder=None):
        self.store = store
        self.cfg = cfg
        self.encoder = encoder
        self.index = index
        self.embedder = embedder

    def constitution(self):
        return self.store.get_meta("constitution", DEFAULT_CONSTITUTION)

    def constitution_ok(self, txt):
        return not any(w in txt for w in self.constitution())

    # ---------- 五算子 ----------
    def merge(self):
        rows = self.store.conn.execute(
            "SELECT * FROM nodes WHERE status='active' ORDER BY affect_w DESC").fetchall()
        merged = []
        seen = set()
        for i, a in enumerate(rows):
            if a["id"] in seen:
                continue
            for b in rows[i + 1:]:
                if b["id"] in seen:
                    continue
                if a["region"] != b["region"] or a["audience"] != b["audience"]:
                    continue
                if a["region"] in ("spine", "flash"):
                    continue
                if T.dice(a["text"], b["text"]) >= self.cfg.merge_sim:
                    with self.store.tx() as c:
                        c.execute("UPDATE nodes SET affect_w=?, hits=hits+? WHERE id=?",
                                  (a["affect_w"] * 1.02, b["hits"], a["id"]))
                        c.execute("UPDATE nodes SET status='merged', valid_to=? WHERE id=?",
                                  (time.time(), b["id"]))
                        c.execute("INSERT OR IGNORE INTO edges(src,dst,kind,weight,created_at)"
                                  " VALUES(?,?,?,?,?)", (a["id"], b["id"], "co", 1.0, time.time()))
                    seen.add(b["id"])
                    merged.append((a["id"], b["id"]))
        return merged

    def abstract(self):
        """情景 -> 主题：必须有 >=2 条证据，且过宪法闸门（§3.4）。"""
        rows = self.store.conn.execute(
            "SELECT * FROM nodes WHERE status='active' AND region='episode' ORDER BY created_at").fetchall()
        groups = []
        used = set()
        for i, a in enumerate(rows):
            if a["id"] in used:
                continue
            group = [a]
            for b in rows[i + 1:]:
                if b["id"] in used:
                    continue
                if abs(a["created_at"] - b["created_at"]) <= 7 * 86400 and T.dice(a["text"], b["text"]) >= 0.45:
                    group.append(b)
            if len(group) >= 2:
                groups.append(group)
                used.update(n["id"] for n in group)

        made = []
        for g in groups[: self.cfg.abstract_max]:
            title = "、".join(sorted({t for n in g for t in T.top_terms(n["text"], 2)})[:3])
            body = f"关于{title}的经历：" + "；".join(n["text"] for n in g[:3])
            if not self.constitution_ok(body):
                self.store.conn.execute(
                    "INSERT INTO review_queue(kind,payload,created_at) VALUES(?,?,?)",
                    ("abstract", body, time.time()))
                continue
            if self.index and self.embedder:
                vec = self.embedder.encode(body)
                blob, model, dim = self.embedder.to_blob(vec), self.embedder.model, self.embedder.dim
            else:
                blob = model = dim = None
            with self.store.tx() as c:
                cur = c.execute(
                    "INSERT INTO nodes(uid,region,kind,text,valence,arousal,affect_w,belief_w,"
                    "source,audience,created_at,valid_from,status,embedding,embed_model,embed_dim)"
                    " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (f"theme_{int(time.time())}_{g[0]['id']}", "fact", "theme", body,
                     0.0, 0.0, 2.0, 1.0, "self", g[0]["audience"], time.time(), time.time(),
                     "active", blob, model, dim))
                tid = cur.lastrowid
                for n in g:
                    c.execute("INSERT OR IGNORE INTO edges(src,dst,kind,weight,created_at)"
                              " VALUES(?,?,?,?,?)", (n["id"], tid, "tag", 1.25, time.time()))
            made.append((tid, [n["id"] for n in g]))
        return made

    def prune(self):
        now = time.time()
        total = self.store.count("SELECT COUNT(*) FROM nodes WHERE status='active'") or 1
        rows = self.store.conn.execute(
            "SELECT * FROM nodes WHERE status='active' AND region='trivia'").fetchall()
        cand = [n for n in rows if n["hits"] == 0 and (now - n["created_at"]) > self.cfg.tau_trivia * 86400]
        cand = cand[: self.cfg.prune_max]
        limit = int(total * self.cfg.prune_max_ratio)
        cand = cand[:limit]
        with self.store.tx() as c:
            for n in cand:
                c.execute("UPDATE nodes SET status='pruned', valid_to=? WHERE id=?", (now, n["id"]))
        return [n["id"] for n in cand]

    def regress_emotion(self):
        """情绪回归：只衰减强度，不删节点、不动 boost（§3.6 与 v4 的合成）。"""
        factors = {r: 1.0 - self.cfg.emotion_regress for r in ("flash", "spine", "texture")}
        for region, f in factors.items():
            self.store.conn.execute(
                "UPDATE nodes SET valence=valence*?, arousal=arousal*? WHERE region=? AND status='active'",
                (f, f, region))

    def retention(self):
        """证据保留：过期私聊证据转摘要并软删（§3.9）。"""
        cutoff = time.time() - self.cfg.evidence_retention
        rows = self.store.conn.execute(
            "SELECT e.id, e.excerpt FROM evidence e JOIN nodes n ON n.id=e.node_id"
            " WHERE e.deleted_at IS NULL AND e.ts < ? AND n.audience='private'", (cutoff,)).fetchall()
        with self.store.tx() as c:
            for r in rows:
                c.execute("UPDATE evidence SET excerpt=?, deleted_at=? WHERE id=?",
                          ((r["excerpt"] or "")[:40] + "…", time.time(), r["id"]))
        return len(rows)


    # ---------- [v4.3] 命中晋升 ----------
    def reinforce(self):
        """越用越牢：命中 >=4 升 important，>=12 升 core，顺手把 α 抬一点。

        只改 level / affect_w，不搬分区 —— 分区是语义，等级是强度（借鉴鱼脑的
        hits -> important/core，但保留我们自己的 α 体系）。
        """
        imp = int(getattr(self.cfg, "promote_important_hits", 4))
        core = int(getattr(self.cfg, "promote_core_hits", 12))
        rows = self.store.conn.execute(
            "SELECT id, hits, level, region, created_at, last_hit FROM nodes WHERE status='active'").fetchall()
        promoted = 0
        with self.store.tx() as c:
            for r in rows:
                hits = int(r["hits"] or 0)
                level = r["level"] or "normal"
                if level == "core":
                    continue
                span = (float(r["last_hit"] or 0) - float(r["created_at"] or 0))
                # 预取每来一条消息就 recall 一次，光看次数会几天内全升 core；
                # 要求「跨过一段时间还在被想起」才算真的牢。
                if hits >= core and span >= 5 * 86400:
                    new_level = "core"
                elif hits >= imp and span >= 86400 and level == "normal":
                    new_level = "important"
                else:
                    continue
                c.execute(
                    "UPDATE nodes SET level=?, affect_w=MIN(6.0, affect_w*1.10) WHERE id=?",
                    (new_level, r["id"]))
                promoted += 1
        return {"promoted": promoted}

    # ---------- 和解 ----------
    def resolve_spine(self, node_id, note=""):
        now = time.time()
        with self.store.tx() as c:
            c.execute("UPDATE spine SET state='resolved', resolved_at=?, note=? WHERE node_id=?",
                      (now, note, node_id))
        return {"node_id": node_id, "state": "resolved"}

    # ---------- 每夜 ----------
    def nightly(self, force=False):
        day = time.strftime("%Y-%m-%d")
        if not force and self.store.get_meta("last_nightly_day") == day:
            return {"skipped": True, "day": day}
        snap = self.store.snapshot("pre-consolidate", keep=30)
        report = {}
        report["merged"] = self.merge()
        report["abstracted"] = self.abstract()
        report["pruned"] = self.prune()
        report["reinforced"] = self.reinforce()
        self.regress_emotion()
        report["retention"] = self.retention()
        if self.index:
            report["cells"] = self.index.rebuild_cells()
        report["self_snapshot"] = self.snapshot_self()
        report["maintenance"] = self.maintenance()
        self.store.set_meta("last_nightly_day", day)
        return report

    # ---------- [v4.3.4] 长期运行维护 ----------
    def maintenance(self, event_days=90, event_keep=20000, snapshot_max_bytes=512 * 1024 * 1024):
        """事件保留、快照体积上限、WAL 截断。只删事件与旧快照，不动记忆正文。"""
        out = {}
        now = time.time()
        cutoff = now - event_days * 86400
        with self.store.tx() as c:
            cur = c.execute("DELETE FROM events WHERE ts < ? AND id NOT IN "
                            "(SELECT id FROM events ORDER BY ts DESC LIMIT ?)", (cutoff, event_keep))
            out["events_deleted"] = cur.rowcount if cur.rowcount is not None else 0
        # 快照按总大小裁剪，至少保留 7 份
        rows = self.store.conn.execute("SELECT ts, path FROM snapshots ORDER BY ts DESC").fetchall()
        total = 0
        kept = 0
        for r in rows:
            try:
                size = os.path.getsize(r["path"])
            except OSError:
                size = 0
            total += size
            kept += 1
            if kept > 7 and total > snapshot_max_bytes:
                try:
                    os.remove(r["path"])
                except OSError:
                    pass
                self.store.conn.execute("DELETE FROM snapshots WHERE ts=?", (r["ts"],))
                total -= size
        out["snapshots_kept"] = kept
        out["snapshots_bytes"] = total
        try:
            self.store.conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        except Exception:
            pass
        return out

    def snapshot_self(self):
        rows = self.store.conn.execute("SELECT claim FROM self_claims WHERE status='active'").fetchall()
        claims = "；".join(r["claim"] for r in rows) or "（尚无自我陈述）"
        day = time.strftime("%Y-%m-%d")
        vec = self.embedder.encode(claims) if self.embedder else None
        blob = self.embedder.to_blob(vec) if vec else None
        self.store.conn.execute(
            "INSERT OR REPLACE INTO self_snapshots(day,text,vec) VALUES(?,?,?)", (day, claims, blob))
        return day
