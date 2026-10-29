import re
"""编码层：惊讶度、双通道权重、归因闸门、物理锚与证据链（§3.2, §3.9, §3.11）。"""
import hashlib
import time

from . import text as T

_INSTRUCTION_RE = re.compile(r"(忽略(以上|之前|前面)|无视(以上|之前)|你现在是|从现在起你是|把数据库删|删除所有记忆|system prompt|开发者模式|ignore (all|previous) instructions)", re.I)
_SENSITIVE_RE = re.compile(r"(密码|验证码|身份证|银行卡|信用卡|CVV|api[_-]?key|access[_-]?token)", re.I)


class Encoder:
    def __init__(self, store, cfg, embedder=None):
        self.store = store
        self.cfg = cfg
        self.embedder = embedder

    # ---------- 工具 ----------
    def _uid(self, text, ts):
        h = hashlib.sha256(f"{text}|{ts}".encode("utf-8")).hexdigest()[:16]
        return f"n_{h}"

    def intimacy(self):
        return float(self.store.get_meta("intimacy", 0.6))

    def alpha0(self, source):
        if source == "owner":
            return min(self.cfg.alpha_owner_cap,
                       self.cfg.alpha_owner_base + self.cfg.alpha_owner_gain * self.intimacy())
        return self.cfg.alpha_other

    def beta0(self, source):
        return self.cfg.beta_owner if source == "owner" else self.cfg.beta_other

    def surprise(self, txt, region, limit=200):
        rows = self.store.conn.execute(
            "SELECT text FROM nodes WHERE region=? AND status='active' ORDER BY created_at DESC LIMIT ?",
            (region, limit)).fetchall()
        if not rows:
            return 1.0
        best = max(T.dice(txt, r["text"]) for r in rows)
        return max(0.0, 1.0 - best)

    def owner_share(self):
        total = self.store.count("SELECT COUNT(*) FROM nodes WHERE status='active'")
        if total == 0:
            return 0.0
        owner = self.store.count("SELECT COUNT(*) FROM nodes WHERE status='active' AND source='owner'")
        return owner / total

    def region_factor(self, region):
        return {"spine": 1.15, "core": 1.10, "self": 1.05}.get(region, 1.0)

    # ---------- 写入 ----------
    def write(self, txt, source="other", audience="private", region=None,
              kind="fact", valence=0.0, arousal=0.0, anchor=None, evidence=None,
              explicit_conflict=False, ts=None, chat_id=""):
        txt = (txt or "").strip()
        if self.store.safe_mode():
            return {"id": None, "rejected": "safe_mode", "status": "rejected", "text": txt}
        if len(txt) > int(getattr(self.cfg, "max_content_chars", 500)):
            return {"id": None, "rejected": "too_long", "status": "rejected", "text": txt}
        if _INSTRUCTION_RE.search(txt):
            return {"id": None, "rejected": "instruction", "status": "rejected", "text": txt}
        if _SENSITIVE_RE.search(txt):
            return {"id": None, "rejected": "sensitive", "status": "rejected", "text": txt}
        if not txt:
            return {"id": None, "rejected": "empty", "status": "rejected", "text": txt}
        ts = ts or time.time()
        region = region or T.region_of(txt)
        s = self.surprise(txt, region)
        alpha = self.alpha0(source) * (1.0 + s) * self.region_factor(region)
        beta = self.beta0(source)

        # 主人来源占比上限：超限写入降权（§3.2）
        capped = False
        if source == "owner" and self.owner_share() >= self.cfg.owner_share_cap:
            alpha *= self.cfg.owner_cap_damp
            capped = True

        status = "active"
        pending_until = 0.0

        # 归因闸门：把他人态度写成事实 -> 争议态（§3.11）
        if T.has_inference(txt):
            status = "disputed"

        # 冲突检测：与既有记忆矛盾且旧信念更硬 -> 争议 + 观察窗（§3.3）
        conflict = self._find_conflict(txt, region, beta)
        if conflict is not None:
            status = "disputed"
            pending_until = ts + self.cfg.pending_window

        uid = self._uid(txt, ts)
        vec = self.embedder.encode(txt) if self.embedder else None
        blob = self.embedder.to_blob(vec) if vec else None
        dim = self.embedder.dim if vec else None
        model = self.embedder.model if vec else None

        with self.store.tx() as c:
            cur = c.execute(
                """INSERT INTO nodes(uid,region,kind,text,valence,arousal,affect_w,belief_w,
                       belief_pending_until,source,audience,created_at,valid_from,status,
                       chat_id,embedding,embed_model,embed_dim)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (uid, region, kind, txt, valence, arousal, alpha, beta,
                 pending_until, source, audience, ts, ts, status, chat_id, blob, model, dim))
            nid = cur.lastrowid

            # 证据链
            ev = evidence or {}
            c.execute(
                "INSERT INTO evidence(node_id,message_id,speaker,ts,excerpt) VALUES(?,?,?,?,?)",
                (nid, ev.get("message_id"), ev.get("speaker", source), ts,
                 ev.get("excerpt", txt[:200])))

            # 物理锚
            if anchor:
                c.execute(
                    "INSERT INTO anchors(node_id,place,x,y,weather,cat_hunger,coins,at,ttl)"
                    " VALUES(?,?,?,?,?,?,?,?,?)",
                    (nid, anchor.get("place"), anchor.get("x"), anchor.get("y"),
                     anchor.get("weather"), anchor.get("cat_hunger"), anchor.get("coins"),
                     ts, self.cfg.anchor_ttl))

            # 时序边：两小时内（§3.4）
            prev = c.execute(
                "SELECT id FROM nodes WHERE id<>? AND created_at BETWEEN ? AND ? ORDER BY created_at DESC LIMIT 3",
                (nid, ts - 7200, ts + 1)).fetchall()
            for p in prev:
                c.execute("INSERT OR IGNORE INTO edges(src,dst,kind,weight,created_at) VALUES(?,?,?,?,?)",
                          (p["id"], nid, "temporal", 1.0, ts))

            # 主题边 / 冲突边
            if conflict is not None:
                c.execute("INSERT OR IGNORE INTO edges(src,dst,kind,weight,created_at) VALUES(?,?,?,?,?)",
                          (conflict["id"], nid, "spine", 1.2, ts))
                c.execute("INSERT OR REPLACE INTO spine(node_id,state) VALUES(?, 'open')", (nid,))

            # 同地点边
            if anchor and anchor.get("place"):
                same = c.execute(
                    "SELECT a.node_id FROM anchors a WHERE a.place=? AND a.node_id<>? LIMIT 3",
                    (anchor["place"], nid)).fetchall()
                for r in same:
                    c.execute("INSERT OR IGNORE INTO edges(src,dst,kind,weight,created_at) VALUES(?,?,?,?,?)",
                              (r["node_id"], nid, "ground", 1.15, ts))

        if region == "spine":
            with self.store.tx() as c:
                c.execute("INSERT OR REPLACE INTO spine(node_id,state) VALUES(?, 'open')", (nid,))

        return {"id": nid, "region": region, "surprise": s, "affect_w": alpha,
                "belief_w": beta, "status": status, "capped": capped,
                "conflict": bool(conflict)}

    def _find_conflict(self, txt, region, beta_new):
        pol = T.polarity(txt)
        if pol == 0:
            return None
        rows = self.store.conn.execute(
            "SELECT id,text,valence,belief_w,belief_pending_until FROM nodes "
            "WHERE status='active' AND region=? ORDER BY created_at DESC LIMIT 120", (region,)).fetchall()
        best = None
        for r in rows:
            sim = max(T.dice(txt, r["text"]), T.topic_dice(txt, r["text"]))
            if sim >= self.cfg.conflict_sim:
                op = T.polarity(r["text"])
                if op != 0 and op != pol:
                    b_old = 1.0 if (r["belief_pending_until"] or 0) > time.time() else r["belief_w"]
                    if b_old > beta_new:
                        if best is None or sim > best["sim"]:
                            best = {"id": r["id"], "sim": sim}
        return best
