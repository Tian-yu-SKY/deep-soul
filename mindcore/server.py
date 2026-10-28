"""sidecar：行分隔 JSON 的本地 RPC，供 DSH 插件调用。

只监听 stdin/stdout，不开放任何网络端口。协议：
  请求  {"id":1,"op":"recall","args":{...}}
  响应  {"id":1,"ok":true,"data":...}  或  {"id":1,"ok":false,"error":"..."}
"""
import sys
import json
import time

from .config import Config
from .store import Store
from .embed import HashEmbedder
from .encode import Encoder
from .index import Index
from .drives import Drives
from .recall import Recall
from .consolidate import Consolidator
from .metrics import Metrics
from .self import SelfModel
from . import panel as P


class Service:
    def __init__(self, db_path, embed=True):
        self.store = Store(db_path)
        cfg = Config.from_dict(self.store.get_meta("config") or Config().to_dict())
        self.store.set_meta("config", cfg.to_dict())
        self.cfg = cfg
        self.emb = HashEmbedder() if embed else None
        self.encoder = Encoder(self.store, cfg, self.emb)
        self.index = Index(self.store, cfg, self.emb)
        self.drives = Drives(self.store, cfg)
        self.recall = Recall(self.store, cfg, self.index, self.emb, self.drives)
        self.cons = Consolidator(self.store, cfg, self.encoder, self.index, self.emb)
        self.metrics = Metrics(self.store, cfg, self.index, self.emb)
        self.selfmodel = SelfModel(self.store, cfg, self.emb)
        self._maybe_import_history()

    def _maybe_import_history(self):
        """第一次启动时，把 QQ 会话里的历史消息补进来（只补一次）。"""
        try:
            if self.store.get_meta("history_import_v1"):
                return
            n = self.store.count("SELECT COUNT(*) FROM nodes WHERE status='active'")
            if n >= 50:
                self.store.set_meta("history_import_v1", {"skipped": True, "nodes": n})
                return
            import os
            root = os.path.join(os.environ.get("DSH_HOME") or os.path.join(os.path.expanduser("~"), ".dsh"),
                                "sessions", "--home-qqbot-qq-bridge-state-agents--")
            if not os.path.isdir(root):
                return
            from .importer import import_all
            r = import_all({"store": self.store, "encoder": self.encoder}, root, cap=3000)
            if r.get("added"):
                self.index.rebuild_cells()
            self.store.set_meta("history_import_v1", {"added": r.get("added"), "collected": r.get("collected")})
            print(f"[mindcore] history import: {r}", flush=True)
        except Exception as e:
            print(f"[mindcore] history import skipped: {e}", flush=True)

    def handle(self, req):
        op = req.get("op")
        a = req.get("args") or {}
        if op == "ping":
            return {"pong": True, "version": 1}
        if op == "recall":
            ctx = a.get("ctx") or {"principal": "owner", "audience": "private"}
            hits = self.recall.retrieve(a.get("query", ""), ctx, k=int(a.get("k", 5)))
            return [{"id": h["id"], "score": round(h["score"], 3), "text": h["text"],
                     "region": h["region"], "audience": h["audience"],
                     "created_at": h.get("created_at"), "cov": h.get("cov"),
                     "private": h.get("private", False),
                     "level": h.get("level"), "source": h.get("source"),
                     "hits": h.get("hits", 0)} for h in hits]
        if op == "remember":
            r = self.encoder.write(
                a.get("text", ""), source=a.get("source", "owner"),
                audience=a.get("audience", "private"), region=a.get("region"),
                valence=float(a.get("valence", 0.0)), arousal=float(a.get("arousal", 0.0)),
                anchor={"place": a["place"]} if a.get("place") else None,
                chat_id=str(a.get("chat_id") or ""),
                evidence={"message_id": a.get("message_id"), "speaker": a.get("speaker")})
            return r
        if op == "recent":
            rows = self.store.conn.execute(
                "SELECT text, region, last_hit, created_at FROM nodes WHERE status='active' "
                "ORDER BY COALESCE(last_hit, created_at) DESC LIMIT ?", (int(a.get("limit", 3)),)).fetchall()
            return [{"text": r["text"], "region": r["region"], "created_at": r["created_at"]} for r in rows]
        if op == "nightly":
            rep = self.cons.nightly(force=bool(a.get("force")))
            # [v4.3.3] 自性层接进夜里：争议项凑够证据就升级，长期没复核的缓慢变软
            try:
                rep["claims_promoted"] = self.selfmodel.council()
                rep["claims_active"] = self.selfmodel.decay()
            except Exception as e:
                rep["self_error"] = f"{type(e).__name__}: {e}"
            return rep
        if op == "panel_brain":
            return P.brain(self.store, self.cfg, self.index,
                           as_of=a.get("as_of"), limit=int(a.get("limit", 1600)))
        if op == "panel_detail":
            return P.detail(self.store, int(a["id"]))
        if op == "panel_touch":
            return P.touch(self.store, int(a["id"]))
        if op == "panel_recalls":
            return P.recent_recalls(self.store, int(a.get("limit", 10)))
        if op == "self_list":
            return {"claims": self.selfmodel.claims(a.get("status")),
                    "chapters": self.selfmodel.chapters(int(a.get("chapters", 3)))}
        if op == "self_claim":
            return self.selfmodel.add_claim(a.get("claim", ""),
                                            float(a.get("confidence", 0.6)),
                                            a.get("evidence") or [],
                                            a.get("source", "self"))
        if op == "self_council":
            return {"promoted": self.selfmodel.council(),
                    "active": self.selfmodel.claims("active")}
        if op == "self_decay":
            self.selfmodel.decay()
            return {"ok": True}
        if op == "auto_append":
            return self.selfmodel.append_chapter(a.get("title", ""), a.get("body", ""),
                                                 a.get("period_start"), a.get("period_end"))
        if op == "auto_list":
            return self.selfmodel.chapters(int(a.get("limit", 10)))
        if op == "resolve":
            return self.cons.resolve_spine(int(a["node_id"]), a.get("note", ""))
        if op == "status":
            n = self.store.count("SELECT COUNT(*) FROM nodes WHERE status='active'")
            return {"nodes": n, "cells": self.store.count("SELECT COUNT(*) FROM cells"),
                    "mode": self.index.mode(), "drives": self.drives.state,
                    "claims": self.store.count("SELECT COUNT(*) FROM self_claims WHERE status='active'"),
                    "chapters": self.store.count("SELECT COUNT(*) FROM autobiography"),
                    "db": self.store.path}
        raise ValueError(f"unknown op: {op}")


def main(argv=None):
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--no-embed", action="store_true")
    args = ap.parse_args(argv)
    svc = Service(args.db, embed=not args.no_embed)

    out = sys.stdout
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            data = svc.handle(req)
            resp = {"id": req.get("id"), "ok": True, "data": data}
        except Exception as e:  # 单条失败不影响进程
            resp = {"id": (req or {}).get("id") if isinstance(req, dict) else None,
                    "ok": False, "error": f"{type(e).__name__}: {e}"}
        out.write(json.dumps(resp, ensure_ascii=False, default=str) + "\n")
        out.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
