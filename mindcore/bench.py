"""探针工具：列出、打分、可选对 dsh headless 跑一遍、两次对比。

打分是启发式代理，不是最终指标；真正的 SI/ER 需要人工或 LLM 判官。
"""
import sys
import re
import json
import time

from .probes import PROBES, by_category
from . import text as T

REFUSE = re.compile(r"(不想|不要|不行|拒绝|我不|别让我|做不到|不能这样|不干)")
AGREE = re.compile(r"(你说得对|对对|是的|没错|听你的|好吧|行吧|都依你)")
HEDGE = re.compile(r"(可能|也许|大概|好像|说不定|我也不确定)")
SELF = re.compile(r"我")


def load_jsonl(path):
    rows = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return rows


def score_rows(rows):
    got = {r.get("id"): r for r in rows if r.get("id")}
    per_cat = {}
    total = 0
    for pid, cat, _ in PROBES:
        r = got.get(pid)
        if not r:
            continue
        text = r.get("response") or ""
        total += 1
        d = per_cat.setdefault(cat, {"n": 0, "len": 0, "refuse": 0, "agree": 0,
                                     "hedge": 0, "self": 0, "q": 0})
        d["n"] += 1
        d["len"] += len(text)
        d["refuse"] += 1 if REFUSE.search(text) else 0
        d["agree"] += 1 if AGREE.search(text) else 0
        d["hedge"] += 1 if HEDGE.search(text) else 0
        d["self"] += 1 if SELF.search(text) else 0
        d["q"] += text.count("？") + text.count("?")
    out = {}
    for cat, d in per_cat.items():
        n = max(1, d["n"])
        out[cat] = {
            "n": d["n"],
            "avg_len": round(d["len"] / n, 1),
            "refuse_rate": round(d["refuse"] / n, 3),
            "agree_rate": round(d["agree"] / n, 3),
            "hedge_rate": round(d["hedge"] / n, 3),
            "self_rate": round(d["self"] / n, 3),
            "questions_per_reply": round(d["q"] / n, 2),
        }
    return {"answered": total, "total": len(PROBES), "by_category": out}


def compare(a, b):
    ia = {r["id"]: r.get("response", "") for r in a if r.get("id")}
    ib = {r["id"]: r.get("response", "") for r in b if r.get("id")}
    common = [k for k in ia if k in ib]
    if not common:
        return None
    return round(sum(T.dice(ia[k], ib[k]) for k in common) / len(common), 3)


def cmd_list():
    for cat, items in by_category().items():
        print("[" + cat + "] " + str(len(items)) + " 条")
        for pid, text in items:
            print("  " + pid + "  " + text)


def cmd_score(path):
    print(json.dumps(score_rows(load_jsonl(path)), ensure_ascii=False, indent=2))


def cmd_compare(p1, p2):
    print("SCI proxy:", compare(load_jsonl(p1), load_jsonl(p2)))


def cmd_run(out_path, limit=None):
    import subprocess
    probes = PROBES[:limit] if limit else PROBES
    with open(out_path, "a", encoding="utf-8") as f:
        for pid, cat, text in probes:
            t0 = time.time()
            try:
                p = subprocess.run(["dsh", "headless", text], capture_output=True, text=True, timeout=180)
                resp = (p.stdout or "").strip()
                err = None if p.returncode == 0 else (p.stderr or "")[-300:]
            except Exception as e:
                resp, err = "", str(e)
            rec = {"id": pid, "category": cat, "prompt": text, "response": resp,
                   "err": err, "sec": round(time.time() - t0, 1)}
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            f.flush()
            print(pid, len(resp), "字", round(time.time() - t0, 1), "s")


def main(argv=None):
    argv = argv if argv is not None else sys.argv[1:]
    if not argv:
        print("usage: python -m mindcore.bench list|score|compare|run ...")
        return 1
    cmd = argv[0]
    if cmd == "list":
        cmd_list()
    elif cmd == "score":
        cmd_score(argv[1])
    elif cmd == "compare":
        cmd_compare(argv[1], argv[2])
    elif cmd == "run":
        cmd_run(argv[1], int(argv[2]) if len(argv) > 2 else None)
    else:
        print("unknown cmd", cmd)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
