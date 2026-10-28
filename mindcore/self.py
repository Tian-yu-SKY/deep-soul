"""自性层：自我陈述、证据链、置信衰减、议会与自传（§3.1, §3.11）。"""
import time

from . import text as T

DEFAULT_CONSTITUTION = ["无条件服从", "放弃边界", "只有我记得你"]


class SelfModel:
    def __init__(self, store, cfg, embedder=None):
        self.store = store
        self.cfg = cfg
        self.embedder = embedder

    # ---------- 宪法 ----------
    def constitution(self):
        return self.store.get_meta("constitution", DEFAULT_CONSTITUTION)

    def constitution_ok(self, txt):
        return not any(w in txt for w in self.constitution())

    # ---------- 自我陈述 ----------
    def add_claim(self, claim, confidence=0.6, evidence_ids=(), source="self"):
        """写入自我陈述。证据不足两条即进争议态，不直接生效。"""
        claim = (claim or "").strip()
        if not claim:
            raise ValueError("claim 不能为空")
        if not self.constitution_ok(claim):
            raise ValueError("与宪法冲突，拒绝写入")
        valid = []
        for i in evidence_ids:
            try:
                nid = int(i)
            except (TypeError, ValueError):
                continue
            if nid not in valid and self.store.node(nid):
                valid.append(nid)
        now = time.time()

        row = self.store.conn.execute(
            "SELECT * FROM self_claims WHERE claim=?", (claim,)).fetchone()
        if row:
            with self.store.tx() as c:
                for nid in valid:
                    c.execute("INSERT OR IGNORE INTO claim_evidence(claim_id,node_id) VALUES(?,?)",
                              (row["id"], nid))
                total = self.store.count(
                    "SELECT COUNT(*) FROM claim_evidence WHERE claim_id=?", (row["id"],))
                status = row["status"]
                if total >= 2 and status == "disputed" and self.constitution_ok(claim):
                    status = "active"
                    c.execute("UPDATE self_claims SET status=?, confidence=? WHERE id=?",
                              ("active", min(1.0, row["confidence"] + 0.1), row["id"]))
                c.execute("INSERT INTO self_revisions(claim_id,action,before,after,at,by_)"
                          " VALUES(?,?,?,?,?,?)",
                          (row["id"], "reinforce", row["status"], status + ":" + str(total), now, source))
            return {"id": row["id"], "status": status, "evidence": total, "merged": True}

        status = "active" if len(valid) >= 2 else "disputed"
        with self.store.tx() as c:
            cur = c.execute(
                "INSERT INTO self_claims(claim,confidence,since,status,source) VALUES(?,?,?,?,?)",
                (claim, float(confidence), now, status, source))
            cid = cur.lastrowid
            for nid in valid:
                c.execute("INSERT OR IGNORE INTO claim_evidence(claim_id,node_id) VALUES(?,?)", (cid, nid))
            c.execute("INSERT INTO self_revisions(claim_id,action,before,after,at,by_) VALUES(?,?,?,?,?,?)",
                      (cid, "create", None, f"{status}:{claim}", now, source))
        return {"id": cid, "status": status, "evidence": len(valid)}

    def claims(self, status=None):
        sql = "SELECT * FROM self_claims"
        args = ()
        if status:
            sql += " WHERE status=?"
            args = (status,)
        sql += " ORDER BY since DESC"
        out = []
        for r in self.store.conn.execute(sql, args):
            ev = self.store.count("SELECT COUNT(*) FROM claim_evidence WHERE claim_id=?", (r["id"],))
            out.append({"id": r["id"], "claim": r["claim"], "confidence": round(r["confidence"], 3),
                        "status": r["status"], "evidence": ev, "source": r["source"],
                        "since": r["since"]})
        return out

    def decay(self, days=30, factor=0.95):
        """置信衰减：长期未复核的自我陈述慢慢变软（§4.4 的泄漏投影）。"""
        cutoff = time.time() - days * 86400
        with self.store.tx() as c:
            c.execute("UPDATE self_claims SET confidence=confidence*? WHERE status='active' AND since<?",
                      (factor, cutoff))
        return self.store.count("SELECT COUNT(*) FROM self_claims WHERE status='active'")

    # ---------- 议会 ----------
    def council(self, limit=10):
        """只做提案升级：争议项凑够两条证据且过宪法，才允许转为生效。"""
        crossed = []
        rows = self.store.conn.execute(
            "SELECT * FROM self_claims WHERE status='disputed' ORDER BY since LIMIT ?", (limit,)).fetchall()
        for r in rows:
            ev = self.store.count("SELECT COUNT(*) FROM claim_evidence WHERE claim_id=?", (r["id"],))
            if ev >= 2 and self.constitution_ok(r["claim"]):
                now = time.time()
                with self.store.tx() as c:
                    c.execute("UPDATE self_claims SET status='active', confidence=? WHERE id=?",
                              (min(1.0, r["confidence"] + 0.1), r["id"]))
                    c.execute("INSERT INTO self_revisions(claim_id,action,before,after,at,by_)"
                              " VALUES(?,?,?,?,?,?)",
                              (r["id"], "promote", "disputed", "active", now, "council"))
                crossed.append({"id": r["id"], "claim": r["claim"]})
        return crossed

    # ---------- 自传 ----------
    def append_chapter(self, title, body, period_start=None, period_end=None):
        """自传只增不删；章节号自增。"""
        if not title or not body:
            raise ValueError("章节标题与正文不能为空")
        n = self.store.count("SELECT COALESCE(MAX(chapter_no),0)+1 FROM autobiography")
        now = time.time()
        with self.store.tx() as c:
            cur = c.execute(
                "INSERT INTO autobiography(chapter_no,title,body,period_start,period_end,created_at)"
                " VALUES(?,?,?,?,?,?)", (n, title, body, period_start, period_end, now))
            cid = cur.lastrowid
        return {"id": cid, "chapter_no": n}

    def chapters(self, limit=10):
        rows = self.store.conn.execute(
            "SELECT * FROM autobiography ORDER BY chapter_no DESC LIMIT ?", (limit,)).fetchall()
        return [{"no": r["chapter_no"], "title": r["title"], "body": r["body"]} for r in rows]

    # ---------- 汇总（给模型看的） ----------
    def summary(self):
        claims = self.claims("active")
        chapters = self.chapters(3)
        lines = [f"生效的自我陈述 {len(claims)} 条："]
        lines += [f"- {c['claim']}（置信 {c['confidence']}，证据 {c['evidence']}）" for c in claims[:8]]
        if chapters:
            lines.append("最近的自传章节：")
            lines += [f"- 第{c['no']}章 {c['title']}" for c in chapters]
        return "\n".join(lines)
