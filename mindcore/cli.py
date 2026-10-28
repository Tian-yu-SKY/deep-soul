"""命令行入口：init / add / recall / nightly / resolve / report / demo。"""
import os
import sys
import json
import time
import argparse

from .config import Config
from .store import Store
from .embed import HashEmbedder
from .encode import Encoder
from .index import Index
from .recall import Recall
from .drives import Drives
from .consolidate import Consolidator
from .metrics import Metrics


def build(db_path=None, use_embedder=True, cfg=None):
    cfg = cfg or Config()
    db_path = db_path or os.path.join(os.path.dirname(__file__), "data", "mind.db")
    store = Store(db_path)
    cfg = Config.from_dict(store.get_meta("config") or cfg.to_dict())
    store.set_meta("config", cfg.to_dict())
    emb = HashEmbedder() if use_embedder else None
    encoder = Encoder(store, cfg, emb)
    index = Index(store, cfg, emb)
    drives = Drives(store, cfg)
    recall = Recall(store, cfg, index, emb, drives)
    cons = Consolidator(store, cfg, encoder, index, emb)
    met = Metrics(store, cfg, index, emb)
    return {"store": store, "cfg": cfg, "emb": emb, "encoder": encoder,
            "index": index, "drives": drives, "recall": recall,
            "cons": cons, "metrics": met}


def main(argv=None):
    ap = argparse.ArgumentParser(prog="mindcore")
    ap.add_argument("--db", default=None)
    ap.add_argument("--no-embed", action="store_true")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("init")
    p = sub.add_parser("add")
    p.add_argument("text")
    p.add_argument("--source", default="other", choices=["owner", "other"])
    p.add_argument("--audience", default="private", choices=["private", "group", "public"])
    p.add_argument("--region", default=None)
    p.add_argument("--place", default=None)
    p.add_argument("--valence", type=float, default=0.0)
    p.add_argument("--arousal", type=float, default=0.0)

    p = sub.add_parser("recall")
    p.add_argument("query")
    p.add_argument("--place", default=None)
    p.add_argument("--audience", default="private")
    p.add_argument("--k", type=int, default=5)

    sub.add_parser("nightly")
    p = sub.add_parser("resolve")
    p.add_argument("node_id", type=int)
    p.add_argument("--note", default="")
    p = sub.add_parser("report")
    p.add_argument("--day", default=None)
    sub.add_parser("cells")
    p = sub.add_parser("import-qq")
    p.add_argument("--dir", default=None)
    p.add_argument("--cap", type=int, default=3000)
    p.add_argument("--dry-run", action="store_true")
    p = sub.add_parser("brain")
    p.add_argument("--as-of", default=None, dest="as_of")
    p.add_argument("--limit", type=int, default=1600)
    p = sub.add_parser("node")
    p.add_argument("node_id", type=int)
    sub.add_parser("demo")

    args = ap.parse_args(argv)
    P = build(args.db, use_embedder=not args.no_embed)

    if args.cmd == "init":
        print("initialized", P["store"].path); return 0
    if args.cmd == "add":
        r = P["encoder"].write(args.text, source=args.source, audience=args.audience,
                               region=args.region, valence=args.valence, arousal=args.arousal,
                               anchor={"place": args.place} if args.place else None)
        print(json.dumps(r, ensure_ascii=False)); return 0
    if args.cmd == "recall":
        ctx = {"principal": "owner" if args.audience == "private" else "guest",
               "audience": args.audience, "place": args.place}
        hits = P["recall"].retrieve(args.query, ctx, k=args.k)
        for h in hits:
            print(f"{h['score']:.3f}  [{h['region']}/{h['audience']}]  {h['text']}")
        if not hits:
            print("(无命中)"); return 1
        return 0
    if args.cmd == "nightly":
        print(json.dumps(P["cons"].nightly(), ensure_ascii=False, default=list)); return 0
    if args.cmd == "resolve":
        print(json.dumps(P["cons"].resolve_spine(args.node_id, args.note), ensure_ascii=False)); return 0
    if args.cmd == "report":
        row = P["metrics"].daily(args.day)
        print(json.dumps(row, ensure_ascii=False))
        for a in P["metrics"].alarm(row):
            print("ALARM:", a)
        return 0
    if args.cmd == "cells":
        print(json.dumps(P["index"].rebuild_cells(), ensure_ascii=False)); return 0
    if args.cmd == "import-qq":
        from .importer import import_all
        root = args.dir or os.path.join(os.environ.get("DSH_HOME") or os.path.expanduser("~/.dsh"), "sessions")
        r = import_all(P, root, cap=args.cap, dry_run=args.dry_run)
        print(json.dumps(r, ensure_ascii=False)); return 0
    if args.cmd == "brain":
        from . import panel
        data = panel.brain(P["store"], P["cfg"], P["index"], as_of=args.as_of, limit=args.limit)
        print(json.dumps(data, ensure_ascii=False)); return 0
    if args.cmd == "node":
        from . import panel
        d = panel.detail(P["store"], args.node_id)
        print(json.dumps(d, ensure_ascii=False)); return 0 if d else 1
    if args.cmd == "demo":
        return demo(P)
    return 1


def demo(P):
    enc, rc, drv = P["encoder"], P["recall"], P["drives"]
    drv.tick(dt_hours=0)
    data = [
        ("今天在码头看海，风很大", "owner", "private", "episode", "码头"),
        ("码头的水泥台阶有点潮", "owner", "private", "episode", "码头"),
        ("主人说他不喜欢吵的地方", "owner", "private", "relation", None),
        ("我讨厌下雨天", "owner", "private", "preference", None),
        ("菜棚的土该松了", "self", "public", "fact", None),
        ("跟群友约好周五一起打游戏", "other", "group", "relation", None),
        ("他故意不回我消息", "owner", "private", "relation", None),
        ("上次在厨房打翻了盐罐", "owner", "private", "episode", "厨房"),
    ]
    for t, s, a, reg, place in data:
        enc.write(t, source=s, audience=a, region=reg,
                  anchor={"place": place} if place else None,
                  valence=-0.3 if "讨厌" in t else 0.1)
    print("cells:", P["index"].rebuild_cells())
    print("\n--- recall: 码头 风 ---")
    for h in rc.retrieve("码头 风", {"principal": "owner", "audience": "private", "place": "码头"}):
        print(f"{h['score']:.3f} {h['region']:8s} {h['text']}")
    print("\n--- recall: 打游戏 ---")
    for h in rc.retrieve("打游戏", {"principal": "guest", "audience": "group"}):
        print(f"{h['score']:.3f} {h['region']:8s} {h['text']}")
    print("\n--- nightly ---")
    print(json.dumps(P["cons"].nightly(), ensure_ascii=False, default=list))
    return 0


if __name__ == "__main__":
    sys.exit(main())
