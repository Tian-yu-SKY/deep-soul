"""检索层：受众过滤 -> 分舱路由 -> 两路查询打分 -> 四道闸 -> 覆盖度重排 -> 多样性。

相对 v4.2 的变化（v4.3）：
  1. 不再用绝对分数门限剪枝，改成「先取候选池 -> 回声/近重复 -> 覆盖度重排」；
  2. 时间词（昨天/前天/上周…）解析成时间窗，命中优先落在窗内；
  3. 核心查询（剥掉时间/疑问/人称）再算一路覆盖度，短问句也能对上；
  4. 同分区最多 2 条，避免一次推 5 条都在说同一件事；
  5. level（命中晋升出来的 important/core）参与加权。
"""
import random
import time

from .embed import cosine
from . import text as T
from . import gates
from . import timequery as TQ
from .rerank import Reranker

LEVEL_BOOST = {"core": 1.15, "important": 1.06, "normal": 1.0}


class Recall:
    def __init__(self, store, cfg, index, embedder=None, drives=None):
        self.store = store
        self.cfg = cfg
        self.index = index
        self.embedder = embedder
        self.drives = drives
        self.reranker = Reranker()

    # ---------- 可见性（§3.7） ----------
    def visible(self, node, ctx):
        aud = node["audience"]
        if aud == "public":
            return True
        if aud == "group":
            where = ctx.get("audience")
            if where == "private":
                return True  # 群记忆可以带进私聊
            if where in ("group", "public"):
                # 群里只认「这个群」的记忆，别的群的不要串进来
                node_chat = str(node.get("chat_id") or "")
                here = str(ctx.get("chat") or "")
                if node_chat and here and node_chat != here:
                    return False
                return True
            return False
        if aud == "private":
            if ctx.get("principal") != "owner":
                return False
            if ctx.get("audience") == "private":
                return True
            # 群聊里也能想起私聊的事，但只给主人，且注入时标明“别报细节”
            return bool(getattr(self.cfg, "share_private", True))
        return False

    def _region_boost(self, node):
        reg = node["region"]
        if reg == "spine":
            row = self.store.conn.execute("SELECT state FROM spine WHERE node_id=?", (node["id"],)).fetchone()
            return 1.0 if (row and row["state"] == "resolved") else 1.5
        if reg == "flash":
            return 1.3 if (node["arousal"] or 0) >= 0.6 else 1.0
        if reg == "texture":
            return 1.1
        return 1.0

    def _grounding(self, node, query, ctx):
        row = self.store.conn.execute(
            "SELECT place, at, ttl FROM anchors WHERE node_id=?", (node["id"],)).fetchone()
        if not row:
            return 1.0
        expired = (row["at"] + row["ttl"]) < time.time()
        q_place = T.place_of(query)
        if q_place and row["place"] and q_place == row["place"]:
            return self.cfg.grounding_place_word
        if not expired and ctx.get("place") and row["place"] == ctx.get("place"):
            return self.cfg.grounding_same_place
        return 1.0

    # ---------- 打分 ----------
    def _score(self, query, cand, ctx, route_info):
        """对候选集用 query 打分；返回按 score 降序的列表（不做绝对门限）。"""
        vector_mode = self.index.mode() == "vector" and self.embedder is not None
        qv = self.embedder.encode(query) if (vector_mode and self.embedder) else None
        lex = {n["id"]: T.dice(query, n["text"]) for n in cand}
        cos = {n["id"]: (cosine(qv, self.embedder.from_blob(n["embedding"]))
                         if (qv and n.get("embedding")) else 0.0) for n in cand}

        seeds = sorted(cand, key=lambda n: -(cos[n["id"]] + lex[n["id"]]))[:5]
        ppr = self.index.typed_ppr([n["id"] for n in seeds], {n["id"] for n in cand})

        if vector_mode:
            wcos, wlex, wppr = self.cfg.w_cos, self.cfg.w_lex, self.cfg.w_ppr
        else:
            wcos, wlex, wppr = 0.0, self.cfg.w_lex_degraded, self.cfg.w_ppr_degraded

        rng = random.Random(hash((query, int(time.time() // 60))))
        hits = []
        for n in cand:
            base = wcos * cos[n["id"]] + wlex * lex[n["id"]] + wppr * ppr.get(n["id"], 0.0)
            drive_bias = self.drives.bias(n["region"]) if self.drives else 1.0
            grounding = self._grounding(n, query, ctx)
            jitter = 1.0 + self.cfg.jitter * rng.uniform(-1, 1)
            level_boost = LEVEL_BOOST.get(n.get("level") or "normal", 1.0)
            score = (base * n["affect_w"] * drive_bias * level_boost
                     * self._region_boost(n) * grounding * jitter)
            if score <= 0.01:
                continue
            hits.append({"id": n["id"], "score": score, "text": n["text"],
                         "region": n["region"], "audience": n["audience"],
                         "private": n["audience"] == "private",
                         "created_at": n["created_at"], "source": n.get("source"),
                         "level": n.get("level") or "normal", "hits": n.get("hits", 0),
                         "parts": {"cos": cos[n["id"]], "lex": lex[n["id"]],
                                   "ppr": ppr.get(n["id"], 0.0),
                                   "affect": n["affect_w"], "grounding": grounding,
                                   "level": level_boost},
                         "route": route_info})
        hits.sort(key=lambda h: (-h["score"], h["id"]))
        return hits

    # ---------- 主流程 ----------
    def retrieve(self, query, ctx, k=5):
        ctx = dict(ctx or {})
        all_nodes = self.store.active_nodes()
        visible = [n for n in all_nodes if self.visible(n, ctx)]
        if not visible:
            return []
        vids = {n["id"] for n in visible}
        by_id = {n["id"]: n for n in visible}

        cand_ids, route_info = self.index.route(query, ctx, vids)
        cand = [by_id[i] for i in cand_ids if i in by_id]
        if not cand:
            return []

        scored = self._score(query, cand, ctx, route_info)
        if not scored:
            return []

        # ① 时间窗：先过滤全量分数表再截池，否则窗里的正确答案可能因为名次靠后
        #    被截掉，然后回退逻辑把「昨天」当成没命中。
        win = TQ.resolve_window(query)
        if win:
            in_win = [h for h in scored if TQ.within(h.get("created_at"), win)]
            if in_win:
                scored = in_win

        # 候选池：多留一些给重排，避免绝对门限先剪掉正确答案
        pool = scored[: max(16, k * int(getattr(self.cfg, "pool_mult", 6)))]

        # ② 回声（这条消息自己 / 几乎一样的一句）
        pool, echo_n = gates.echo_filter(pool, query)
        # ③ 命中彼此近重复
        pool, dup_n = gates.dedupe(pool, float(getattr(self.cfg, "recall_dedupe_sim", 0.85)))

        # ④ 覆盖度重排：原句 + 核心查询各算一路，取高的
        core = TQ.core_query(query)
        queries = [query] + ([core] if core and core != query else [])
        docs = [(n["id"], n["text"]) for n in all_nodes]
        ranked, cov_n = self.reranker.coverage_rank(
            pool, docs, queries, cov_min=float(getattr(self.cfg, "cov_min", 0.18)))

        if not ranked and len(gates.norm(query)) <= 3:
            # 短查询的覆盖度没意义，退回分数序；但至少要和查询共享一个 bigram，
            # 否则「菜棚」会把完全无关的句子推上来
            qg = T.bigrams(query)
            ranked = [h for h in pool
                      if any(g in T.bigrams(h.get("text", "")) for g in qg)]

        # ⑤ 多样性 + 截断
        hits = gates.diversify(ranked, k, max_per_region=int(getattr(self.cfg, "max_per_region", 2)))

        # ⑥ 群里带私聊记忆要克制：最多 N 条、覆盖度要求更高（隐私边界）
        if ctx.get("audience") != "private":
            lim = max(0, int(getattr(self.cfg, "share_private_max", 1)))
            cap = float(getattr(self.cfg, "cov_min", 0.18)) * 1.2
            kept, used = [], 0
            for h in hits:
                if h.get("audience") == "private":
                    if used >= lim:
                        continue
                    if float(h.get("cov") or 0) < cap:
                        continue
                    used += 1
                kept.append(h)
            hits = kept

        if hits:
            with self.store.tx() as c:
                for h in hits:
                    c.execute("UPDATE nodes SET hits=hits+1, last_hit=? WHERE id=?",
                              (time.time(), h["id"]))
                c.execute("INSERT INTO events(ts,kind,initiator,evidence,note) VALUES(?,?,?,?,?)",
                          (time.time(), "recall", ctx.get("principal", "system"),
                           hits[0]["id"], query[:120]))
            for h in hits:
                h["gates"] = {"echo": echo_n, "dup": dup_n, "cov": cov_n}
        return hits
