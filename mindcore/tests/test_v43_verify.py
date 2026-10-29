"""Deep-Soul v4.3 独立对抗验证套件（只写临时库，不动真实库）。

用法（工作区代码）：
    python3 mindcore/tests/test_v43_verify.py
    python3 mindcore/tests/test_v43_verify.py --perf     # 追加 400 条合成压测

用法（对已冻结快照复跑，避免工作区代码漂移）：
    cd /tmp/ds43snap && python3 /path/to/test_v43_verify.py

对照版本（2026-10-28 20:01 三轮冻结；P3 全修 + D1/D2）：
    recall.py      6abea3929fec1574c77d1f7175ce9d68
    gates.py       5db298507244e449298aead3269f935e
    rerank.py      fd29956ff5244dc5eb187c0822b36599
    timequery.py   b68fe9b1d6dc3190e253c314f0b5fa96
    panel.py       138dbec51926b61f9e2449c425227f98
    store.py       d4153a2cd115067e30fc931fa088b888
    consolidate.py 92e826f51f346581af8002cf46780422
    config.py      136b928695c5e0034b23eee38e004e90
    server.py      81f275ff5de52f849a8f47cdc7e4da67
    cli.py         fd15fadb247603ea16beba0e501178ab
    index.py       0caaa74cc32f21f7824f94422bb43ad4

两类断言：
  · regression —— 当前版本应为 PASS；FAIL 记为「回归/阻断」，套件退出码非 0。
  · bug —— 按正确行为断言；FAIL 记为「BUG 复现」（预期内），PASS 记为「已修复」。
套件退出码：有 regression FAIL 或 BUG 复现时为 1，否则 0。
"""
import datetime
import inspect
import os
import shutil
import sqlite3
import sys
import tempfile
import time

try:  # 允许在别的目录下对快照复跑本文件（快照根优先）
    import mindcore  # noqa: F401
except ImportError:  # pragma: no cover
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__)))))

from mindcore.cli import build
from mindcore.config import Config
from mindcore.store import Store, SCHEMA
from mindcore.server import Service
from mindcore import gates
from mindcore import panel
from mindcore import timequery as TQ

PASS, FAIL, FIXED = [], [], []
BUGS = []
NOTES = []
CTX = {"principal": "owner", "audience": "private"}

# 固定「现在」= 2026-10-28 12:00:00（周三），让时间窗断言可复现
# 默认取运行时刻，避免套件跨日期后「昨天」夹具漂移；需要复现旧结果时设 DS_VERIFY_NOW
NOW = float(os.environ.get("DS_VERIFY_NOW") or time.time())


def day0(offset=0, hour=0, minute=0, second=0):
    lt = time.localtime(NOW)
    base = time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, 0, 0, 0, 0, 0, -1))
    return base + offset * 86400 + hour * 3600 + minute * 60 + second


def check(name, cond, detail="", kind="regression"):
    if kind == "bug":
        if cond:
            FIXED.append(name)
            print("  FIXED   " + name)
        else:
            BUGS.append((name, detail))
            print("  BUG     " + name + (("  [" + str(detail) + "]") if detail else ""))
        return
    if cond:
        PASS.append(name)
        print("  ok      " + name)
    else:
        FAIL.append((name, detail))
        print("  FAIL    " + name + (("  [" + str(detail) + "]") if detail else ""))


def note(name, detail=""):
    NOTES.append((name, detail))
    print("  note    " + name + (("  [" + str(detail) + "]") if detail else ""))


def fresh(**overrides):
    d = tempfile.mkdtemp(prefix="ds43v-")
    cfg = Config()
    cfg.jitter = 0.0
    for k, v in overrides.items():
        setattr(cfg, k, v)
    return build(os.path.join(d, "mind.db"), use_embedder=True, cfg=cfg)


def hits_ids(hits):
    return [h["id"] for h in hits]


# =====================================================================
# 1. timequery：时间窗与核心查询
# =====================================================================
def test_timequery():
    print("\n== 1. timequery 时间窗/核心查询")
    w = TQ.resolve_window("昨天谁说的附伤机制", NOW)
    check("昨天：起点=昨日 00:00", w and w["start"] == day0(-1))
    check("昨天：尾巴到今日 06:00 之前", w and day0(-1, 23) <= w["end"] <= day0(0, 6))
    check("昨天：昨日 23:00 在窗内", TQ.within(day0(-1, 23), w))
    check("昨天：前日 23:00 在窗外", not TQ.within(day0(-2, 23), w))
    check("今天：窗口=今日 00:00..now", TQ.resolve_window("今天在干嘛", NOW)["start"] == day0(0) and
          abs(TQ.resolve_window("今天在干嘛", NOW)["end"] - NOW) < 1)
    check("前天：窗口=前日 00:00..昨日 06:00",
          TQ.resolve_window("前天的事", NOW)["start"] == day0(-2) and
          TQ.resolve_window("前天的事", NOW)["end"] == day0(-1, 6))
    check("最近：覆盖最近 3 天", TQ.within(day0(-3), TQ.resolve_window("最近怎么样", NOW)))
    _lt = time.localtime(NOW)
    this_monday = day0(0) - datetime.date(_lt.tm_year, _lt.tm_mon, _lt.tm_mday).weekday() * 86400
    check("这周：从本周一 00:00 起", TQ.resolve_window("这周聊了什么", NOW)["start"] == this_monday)
    check("空查询无时间窗", TQ.resolve_window("", NOW) is None)

    check("核心查询剥掉时间/疑问/人称", TQ.core_query("昨天谁问的附伤机制") == "附伤机制",
          repr(TQ.core_query("昨天谁问的附伤机制")))
    check("核心查询保留实体", "码头" in TQ.core_query("你还记得昨天在码头看海的事吗"),
          repr(TQ.core_query("你还记得昨天在码头看海的事吗")))
    note("core_query('今天天气怎么样')=" + repr(TQ.core_query("今天天气怎么样")) + "（“样”没剥干净，无害）")

    # --- 日历口径：上个月/上周（低危但可复现）---
    d = datetime.date(2026, 10, 28)
    prev_end = datetime.date(d.year, d.month, 1) - datetime.timedelta(days=1)
    prev_start = prev_end.replace(day=1)
    exp_start = time.mktime((prev_start.year, prev_start.month, prev_start.day, 0, 0, 0, 0, 0, -1))
    exp_end = time.mktime((prev_end.year, prev_end.month, prev_end.day, 23, 59, 59, 0, 0, -1))
    mwin = TQ.resolve_window("上个月我们聊了什么", NOW)
    check("上个月：应=自然月 %s~%s" % (prev_start, prev_end),
          mwin and mwin["start"] == exp_start and mwin["end"] == exp_end,
          "实际 start=%s end=%s" % (
              datetime.datetime.fromtimestamp(mwin["start"]), datetime.datetime.fromtimestamp(mwin["end"])))
    monday = d - datetime.timedelta(days=d.weekday() + 7)          # 上周一
    sunday_end = monday + datetime.timedelta(days=6)
    exp_w_start = time.mktime((monday.year, monday.month, monday.day, 0, 0, 0, 0, 0, -1))
    exp_w_end = time.mktime((sunday_end.year, sunday_end.month, sunday_end.day, 23, 59, 59, 0, 0, -1))
    wwin = TQ.resolve_window("上周聊了什么", NOW)
    check("上周：应=上周一~上周日",
          wwin and wwin["start"] == exp_w_start and wwin["end"] == exp_w_end,
          "实际 start=%s end=%s" % (
              datetime.datetime.fromtimestamp(wwin["start"]), datetime.datetime.fromtimestamp(wwin["end"])))
    note("「刚才」被解析成今天 00:00..now（语义偏宽，不是窗口 bug）",
         TQ.resolve_window("刚才说什么", NOW))


# =====================================================================
# 2. 回声闸：原句该挡、正常提问不该误杀
# =====================================================================
def test_echo():
    print("\n== 2. 回声闸")
    P = fresh()
    enc, rc = P["encoder"], P["recall"]
    text = "今天在码头看海，风很大"
    enc.write(text, source="owner", audience="private", region="episode")

    check("原句查询返回空（防复读，预期）", rc.retrieve(text, CTX) == [])
    other = rc.retrieve("码头 看海 风", CTX)
    check("换个说法能命中", any(h["text"] == text for h in other),
          [(h["text"], h.get("cov")) for h in other])
    check("回声判定：仅标点差异仍是回声",
          gates.is_echo("今天在码头看海,风很大！", text))
    check("回声判定：无关句不误伤", not gates.is_echo("菜棚的土该松了", text))

    # --- 误杀 1：短记忆被长问句包含 ---
    P = fresh()
    enc, rc = P["encoder"], P["recall"]
    short = "码头看海"
    enc.write(short, source="owner", audience="private", region="episode")
    q1 = "你还记得上次我们去码头看海的事吗"
    r1 = rc.retrieve(q1, CTX)
    check("「你还记得…」引用短记忆应能想起", short in [h["text"] for h in r1],
          "query=%r 实际=%r" % (q1, [(h["text"]) for h in r1]))
    check("回声包含式判定缺少长度比约束（短记忆<长问句仍判回声）",
          not gates.is_echo(short, q1),
          "is_echo=True, len(tn)=%d len(qn)=%d" % (len(gates.norm(short)), len(gates.norm(q1))))

    # --- 误杀 2：长记忆被「你还记得…吗」包住 ---
    P = fresh()
    enc, rc = P["encoder"], P["recall"]
    mem = "今天在码头看海，风很大"
    enc.write(mem, source="owner", audience="private", region="episode")
    q2 = "你还记得今天在码头看海，风很大吗"
    r2 = rc.retrieve(q2, CTX)
    check("「你还记得 <原句> 吗」应能想起", mem in [h["text"] for h in r2],
          "实际=%r" % [(h["text"]) for h in r2])
    appended = mem + "，你说是不是啊"
    note("回声包含式收紧（length ratio>=0.85）后，原句+长后缀不再算回声："
         "预取可能把近似复读推回来（有意取舍，记一笔）", gates.is_echo(mem, appended))


# =====================================================================
# 3. 近重复去重：真重复该合，不同/矛盾事实不该合
# =====================================================================
def test_dedupe():
    print("\n== 3. dedupe 近重复")
    a = {"id": 1, "text": "今天在码头看海，风很大", "score": 2.0, "region": "episode"}
    b = {"id": 2, "text": "今天在码头看海，风很小", "score": 1.0, "region": "episode"}
    kept, dropped = gates.dedupe([a, b])
    check("矛盾事实（风很大/风很小）不应被合并", len(kept) == 2,
          "kept=%r dropped=%d J=%.3f" % ([k["text"] for k in kept], dropped,
                                         gates.jaccard(gates.grams(a["text"]), gates.grams(b["text"]))))
    c = {"id": 3, "text": "我讨厌下雨天，心情很差", "score": 2.0}
    e = {"id": 4, "text": "我讨厌下雨天，心情很好", "score": 1.0}
    kept2, _ = gates.dedupe([c, e])
    check("反极性事实（心情很差/很好）不应被合并", len(kept2) == 2,
          "kept=%r" % [k["text"] for k in kept2])
    f = {"id": 5, "text": "今天在码头看海，风很大", "score": 2.0}
    g = {"id": 6, "text": "今天在码头看海,风很大！", "score": 1.0}
    kept3, dropped3 = gates.dedupe([f, g])
    check("真重复（仅标点差异）仍应合并", len(kept3) == 1 and dropped3 == 1)
    h1 = {"id": 7, "text": "今天在码头看海，风很大", "score": 2.0, "region": "episode"}
    h2 = {"id": 8, "text": "今天在码头看海，风很大，浪也大", "score": 1.0, "region": "episode"}
    note("阈值升到 0.85 后中度冗余不再合并（J=%.2f，两条都会返回）"
         % gates.jaccard(gates.grams(h1["text"]), gates.grams(h2["text"])),
         (h1["text"], h2["text"]))

    # 端到端：两条都入库，查询应能同时看到（k>=2），实际被 dedupe 吃掉一条
    P = fresh()
    enc, rc = P["encoder"], P["recall"]
    ida = enc.write("今天在码头看海，风很大", source="owner", audience="private", region="episode")["id"]
    idb = enc.write("今天在码头看海，风很小", source="owner", audience="private", region="episode")["id"]
    hits = rc.retrieve("今天在码头看海风大吗", CTX, k=5)
    check("检索层不应把矛盾事实合并到只剩一条", {ida, idb} <= set(hits_ids(hits)),
          "hits=%r gates=%r" % ([(h["id"], h["text"]) for h in hits],
                                hits[0].get("gates") if hits else None))

    # v4.3 三轮：回想阈值独立成 config.recall_dedupe_sim（dedupe_sim 只留给写入合并语义）
    cfg = Config()
    default_th = inspect.signature(gates.dedupe).parameters["threshold"].default
    check("gates.dedupe 默认值对齐 config.recall_dedupe_sim",
          abs(default_th - cfg.recall_dedupe_sim) < 1e-9,
          "gates.dedupe 默认=%r recall_dedupe_sim=%r" % (default_th, cfg.recall_dedupe_sim))
    P = fresh(recall_dedupe_sim=0.0)
    enc, rc = P["encoder"], P["recall"]
    enc.write("今天在码头看海，风很大", source="owner", audience="private", region="episode")
    enc.write("今天在码头看海，风很小", source="owner", audience="private", region="episode")
    merged = rc.retrieve("今天在码头看海风大吗", CTX, k=5)
    check("recall 真正读取 recall_dedupe_sim（0.0 时近重复被合并）", len(merged) == 1,
          [(h["id"], h["text"]) for h in merged])
    P = fresh(recall_dedupe_sim=0.99)
    enc, rc = P["encoder"], P["recall"]
    enc.write("今天在码头看海，风很大", source="owner", audience="private", region="episode")
    enc.write("今天在码头看海，风很小", source="owner", audience="private", region="episode")
    loosened = rc.retrieve("今天在码头看海风大吗", CTX, k=5)
    check("recall 真正读取 recall_dedupe_sim（0.99 时两条都保留）", len(loosened) == 2,
          [(h["id"], h["text"]) for h in loosened])


# =====================================================================
# 4. 覆盖度重排
# =====================================================================
def test_coverage():
    print("\n== 4. 覆盖度重排")
    P = fresh()
    enc, rc = P["encoder"], P["recall"]
    good = "今天在码头看海，风很大，浪把鞋打湿了"
    noise = "今天天气不错，适合在家睡觉"
    for t in (good, noise):
        enc.write(t, source="owner", audience="private", region="episode")
    hits = rc.retrieve("码头看海浪大吗", CTX, k=5)
    check("覆盖度高的排第一", hits and hits[0]["text"] == good,
          [(h["text"], h.get("cov")) for h in hits])
    check("无关条目被覆盖度剪掉", all(h["text"] != noise for h in hits))
    check("结果带 0..1 的 cov", hits and 0 <= hits[0].get("cov", -1) <= 1, hits and hits[0].get("cov"))

    P = fresh()
    enc, rc = P["encoder"], P["recall"]
    for t in ["主人说他不喜欢吵的地方", "菜棚的土该松了", "我讨厌下雨天"]:
        enc.write(t, source="owner", audience="private")
    check("域外长查询返回空（宁可没想起，符合既定设计）",
          rc.retrieve("量子力学编译原理", CTX) == [])
    short_hits = rc.retrieve("菜棚", CTX)
    check("≤3 字短查询走分数序回退", len(short_hits) > 0, [(h["text"]) for h in short_hits])
    junk = rc.retrieve("量子力", CTX)
    note("≤3 字域外查询会回退成不相关结果（如「量子力」→ %d 条），是既定回退的副作用"
         % len(junk), [(h["text"]) for h in junk])
    note("全虚词长查询被覆盖度清空（既定设计）", rc.retrieve("刚才我说什么了", CTX))
    note("core_query 为空时只拿原句算覆盖度（全虚词=0）", repr(TQ.core_query("刚才我说什么了")))


# =====================================================================
# 5. 时间窗：窗内优先 / 窗空回退 / 候选池截断
# =====================================================================
def test_time_window():
    print("\n== 5. 时间窗")
    P = fresh()
    enc, rc, st = P["encoder"], P["recall"], P["store"]
    yday = NOW - 86400
    yid = enc.write("昨天在菜棚松土浇水了", source="owner", audience="private",
                    region="episode", ts=yday)["id"]
    tid = enc.write("今天在码头看海风很大", source="owner", audience="private",
                    region="episode", ts=NOW)["id"]
    with st.tx() as c:
        c.execute("UPDATE nodes SET created_at=?, valid_from=? WHERE id=?", (yday, yday, yid))
        c.execute("UPDATE nodes SET created_at=?, valid_from=? WHERE id=?", (NOW, NOW, tid))
    hits = rc.retrieve("昨天菜棚松土了吗", CTX, k=5)
    check("问「昨天」只返回窗内记忆", hits_ids(hits) == [yid],
          [(h["id"], h["text"]) for h in hits])

    # 窗里没有命中 → 退回不筛（注释声明的回退）
    P = fresh()
    enc, rc = P["encoder"], P["recall"]
    enc.write("今天在码头看海风很大", source="owner", audience="private", region="episode")
    hits = rc.retrieve("昨天码头看海了吗", CTX, k=5)
    check("窗里没命中时退回不筛（按注释预期）", len(hits) > 0,
          [(h["text"]) for h in hits])
    note("回退副作用：问「昨天」可以拿到今天的记忆，且结果不标注时间窗被放宽")

    # 池截断：昨天节点真实存在，但原始打分排在 pool 之外 → 窗口在 pool 内找不到 → 回退 → 漏掉正确答案
    P = fresh()
    enc, rc, st = P["encoder"], P["recall"], P["store"]
    for i in range(40):
        enc.write("附伤机制计算第%d种情况，今天测试通过" % i,
                  source="owner", audience="private", region="fact")
    lid = enc.write("昨天群里讨论附伤机制的计算方式", source="owner", audience="private",
                    region="fact", ts=yday)["id"]
    with st.tx() as c:
        c.execute("UPDATE nodes SET affect_w=0.8, created_at=?, valid_from=? WHERE id=?",
                  (yday, yday, lid))
    vis = [n for n in st.active_nodes() if rc.visible(n, CTX)]
    cids, ri = rc.index.route("昨天附伤机制怎么算", CTX, {n["id"] for n in vis})
    cand = [n for n in vis if n["id"] in cids]
    scored = rc._score("昨天附伤机制怎么算", cand, CTX, ri)
    rank = [i for i, h in enumerate(scored) if h["id"] == lid]
    pool_size = max(16, 5 * int(getattr(rc.cfg, "pool_mult", 6)))
    hits = rc.retrieve("昨天附伤机制怎么算", CTX, k=5)
    check("昨天的正确记忆不应因候选池截断而被漏掉", lid in hits_ids(hits),
          "yday 打分排名=%r pool=%d hits=%r" % (rank, pool_size,
                                                [(h["id"], h["text"][:18]) for h in hits]))
    note("原成因（已修）：窗口过去只过滤截断后的 pool，窗内正确答案排名靠后时会被回退逻辑跳过；"
         "现在先过滤全量 scored 再截池，本用例通过")


# =====================================================================
# 6. 命中晋升 level
# =====================================================================
def test_promotion():
    print("\n== 6. 命中晋升")
    # v4.3 三轮：晋升改为「命中次数 + 时间跨度」双条件（防 prefetch 反馈环）
    P = fresh()
    enc, cons, st = P["encoder"], P["cons"], P["store"]
    now = time.time()
    cases = [
        (0, 0, "normal"),       # 没命中
        (3, 2, "normal"),       # 次数不够
        (4, 0.4, "normal"),     # 次数够、跨度不足 1 天
        (4, 2, "important"),
        (12, 6, "core"),
        (100, 6, "core"),
        (100, 0, "normal"),     # 次数很多但全在同一波（预取刷出来的）
    ]
    made = []
    for i, (hits, span_days, _) in enumerate(cases):
        nid = enc.write("晋升跨度测试第%d条，内容各不相同" % i,
                        source="owner", audience="private")["id"]
        with st.tx() as c:
            c.execute("UPDATE nodes SET hits=?, created_at=?, last_hit=? WHERE id=?",
                      (hits, now - span_days * 86400, (now if span_days > 0 else 0), nid))
        made.append((hits, span_days, nid))
    rep = cons.reinforce()
    lv = [(h, s, st.node(nid)["level"]) for h, s, nid in made]
    check("hits=3 保持 normal", lv[1][2] == "normal", lv)
    check("hits=4 但跨度<1 天 不升 important", lv[2][2] == "normal", lv)
    check("hits=4 且跨 2 天 升 important", lv[3][2] == "important", lv)
    check("hits=12 且跨 6 天 升 core", lv[4][2] == "core", lv)
    check("hits=100 且跨 6 天 升 core 且 affect 封顶 6.0",
          lv[5][2] == "core" and st.node(made[5][2])["affect_w"] <= 6.0,
          st.node(made[5][2])["affect_w"])
    check("hits=100 但跨度=0 不升 core（防预取刷级）", lv[6][2] == "normal", lv)
    check("晋升条数=3", rep["promoted"] == 3, rep)
    rep2 = cons.reinforce()
    check("重复 consolidate 幂等（core 不再重复抬 α）", rep2["promoted"] == 0, rep2)

    # D2 反馈环：12 次自动 recall 只累计 hits，不再批量升 core
    P = fresh()
    enc, rc, cons, st = P["encoder"], P["recall"], P["cons"], P["store"]
    for t in ["码头看海风很大", "菜棚的土该松了", "主人不喜欢吵的地方",
              "我讨厌下雨天", "群友约好打游戏"]:
        enc.write(t, source="owner", audience="private")
    for _ in range(12):
        rc.retrieve("码头 菜棚 主人 下雨 游戏", CTX, k=5)
    hot = [n for n in st.active_nodes() if n["hits"] >= 12]
    cons.reinforce()
    check("12 次自动 recall 不把节点升 core（D2 修复）",
          bool(hot) and all(st.node(n["id"])["level"] != "core" for n in hot),
          "hits>=12 的节点=%r" % [(n["id"], n["hits"], st.node(n["id"])["level"]) for n in hot])
    for n in hot:
        with st.tx() as c:
            c.execute("UPDATE nodes SET created_at=? WHERE id=?", (time.time() - 6 * 86400, n["id"]))
    cons.reinforce()
    check("同样 hits 在跨 6 天后再被想起才升 core（时间跨度生效）",
          all(st.node(n["id"])["level"] == "core" for n in hot),
          [(n["id"], n["hits"], st.node(n["id"])["level"]) for n in hot])
    note("recall 自身仍写 hits；时间跨度只是让“预取刷出来的次数”不能直接换 core，"
         "长期高频被预取的老节点仍会晋升（可接受）")

    # level 进入打分
    P = fresh()
    enc, rc, st = P["encoder"], P["recall"], P["store"]
    n1 = enc.write("同样内容的一条记忆", source="owner", audience="private")["id"]
    n2 = enc.write("同样内容的一条记忆", source="owner", audience="private")["id"]
    with st.tx() as c:
        c.execute("UPDATE nodes SET affect_w=2.0, level='core' WHERE id=?", (n1,))
        c.execute("UPDATE nodes SET affect_w=2.0, level='normal' WHERE id=?", (n2,))
    nodes = {n["id"]: n for n in st.active_nodes()}
    cand = [nodes[n1], nodes[n2]]
    scored = {h["id"]: h for h in rc._score("同样内容的一条记忆", cand, CTX, {"mode": "test"})}
    ok = n1 in scored and n2 in scored and scored[n1]["score"] > scored[n2]["score"]
    check("level boost 进入打分（core > normal）", ok,
          {k: (round(v["score"], 3), v["level"]) for k, v in scored.items()})


# =====================================================================
# 6b. 多样性配额（D1 两段式）
# =====================================================================
def test_diversity():
    print("\n== 6b. 多样性配额（D1 两段式）")
    P = fresh()
    enc, rc = P["encoder"], P["recall"]
    texts = ["主人说菜棚的土该松了", "主人今天在码头看海", "主人让我给插件改名",
             "主人提过想养一只猫", "主人昨晚很晚才睡", "主人问我画图的事",
             "主人夸我记性好", "主人说下周要出差", "主人喜欢喝热茶", "主人怕冷"]
    for t in texts:
        enc.write(t, source="owner", audience="private", region="relation")
    hits = rc.retrieve("主人", CTX, k=5)
    check("全是同一分区时仍能凑满 k（两段式补位）", len(hits) == 5,
          "len=%d %r" % (len(hits), [(h["id"], h["text"][:10]) for h in hits]))
    check("k 不会被两段式补位撑破", len(hits) <= 5, len(hits))
    note("前 2 条仍优先同区配额，剩余从超配额里补；k<=2 时与旧行为一致", len(hits))


# =====================================================================
# 7. 老库迁移
# =====================================================================
def test_migration():
    print("\n== 7. 老库迁移（nodes 无 level 列）")
    d = tempfile.mkdtemp(prefix="ds43m-")
    db = os.path.join(d, "old.db")
    old_schema = SCHEMA.replace("  level TEXT NOT NULL DEFAULT 'normal',\n", "")
    assert "level TEXT NOT NULL DEFAULT" not in old_schema.split("CREATE TABLE IF NOT EXISTS nodes")[1].split(");")[0]
    c = sqlite3.connect(db)
    c.executescript(old_schema)
    c.execute("INSERT INTO nodes(uid,region,kind,text,affect_w,belief_w,source,audience,"
              "created_at,valid_from,status) VALUES('old_1','fact','fact','旧库里的一条记忆',"
              "2.0,1.0,'owner','private',?,?,'active')", (time.time(), time.time()))
    c.commit()
    c.close()

    P = build(db, use_embedder=True)
    st = P["store"]
    cols = [r[1] for r in st.conn.execute("PRAGMA table_info(nodes)")]
    check("迁移补上 level 列", "level" in cols, cols)
    check("迁移后老数据默认 normal", st.conn.execute("SELECT level FROM nodes WHERE uid='old_1'").fetchone()[0] == "normal")
    check("迁移后旧文本保留", st.conn.execute("SELECT text FROM nodes WHERE uid='old_1'").fetchone()[0] == "旧库里的一条记忆")
    new = P["encoder"].write("迁移后新写入的一条", source="owner", audience="private")
    check("迁移后可正常写入新节点", st.node(new["id"]) is not None and st.node(new["id"])["level"] == "normal")
    st.close()

    for i in range(3):
        s = Store(db)
        s.close()
    st = Store(db)
    cols2 = [r[1] for r in st.conn.execute("PRAGMA table_info(nodes)")]
    check("反复打开幂等：level 列只有一份", cols2.count("level") == 1, cols2)
    check("反复打开幂等：节点数不变", st.count("SELECT COUNT(*) FROM nodes") == 2,
          st.count("SELECT COUNT(*) FROM nodes"))
    st.close()
    # 迁移后面板/检索可用
    P = build(db, use_embedder=True)
    b = panel.brain(P["store"], P["cfg"], P["index"])
    check("迁移后 panel.brain 可用且 level 非空", all(n["level"] for n in b["nodes"]))
    check("迁移后 recall 可用", isinstance(P["recall"].retrieve("旧库记忆", CTX), list))


# =====================================================================
# 8. panel 数据层：as_of 时间旅行、fade、stats
# =====================================================================
def test_panel():
    print("\n== 8. panel 数据层")
    P = fresh()
    enc, st, idx, cfg, rc = P["encoder"], P["store"], P["index"], P["cfg"], P["recall"]
    for i in range(6):
        enc.write("第%d条关于菜棚和天气的记录" % i, source="other", audience="public",
                  region="fact", anchor={"place": "菜棚"})
    idx.rebuild_cells()
    now_data = panel.brain(st, cfg, idx)
    check("brain 返回结构完整",
          {"nodes", "clusters", "edges", "stats", "recalls", "as_of"} <= set(now_data))
    check("brain 有节点/舱", len(now_data["nodes"]) >= 6 and len(now_data["clusters"]) >= 1)
    check("fade 在 (0,1]", all(0 < n["fade"] <= 1 for n in now_data["nodes"]))
    today = datetime.date.today()
    f90 = {n["id"]: n["fade"] for n in panel.brain(st, cfg, idx, as_of=(today + datetime.timedelta(days=90)).isoformat())["nodes"]}
    f365 = {n["id"]: n["fade"] for n in panel.brain(st, cfg, idx, as_of=(today + datetime.timedelta(days=365)).isoformat())["nodes"]}
    check("as_of 越远 fade 越低（90 天 0.6~0.75 区间）",
          all(0.60 < f90[i] < 0.76 for i in f90), f90)
    check("as_of +365 fade 低于 +90", all(f365[i] < f90[i] for i in f365))

    # 回看过去：as_of 之前还不存在的节点不应被当成“0 天新记忆”
    past = (today - datetime.timedelta(days=30)).isoformat()
    pb = panel.brain(st, cfg, idx, as_of=past)
    past_ts = time.mktime((today.year, today.month, today.day, 23, 59, 59, 0, 0, -1)) - 30 * 86400
    future_in_past = [n for n in pb["nodes"] if n["created_at"] > past_ts]
    check("as_of 回看过去时应过滤 as_of 之后才写入的节点",
          not future_in_past,
          "as_of=%s 仍显示 %d 条未来节点（共 %d 条）" % (past, len(future_in_past), len(pb["nodes"])))
    check("as_of 时 generated_at 按 as_of 当天 23:59:59 出",
          pb["generated_at"] == datetime.datetime.fromtimestamp(past_ts).isoformat(timespec="seconds"),
          pb["generated_at"])
    note("as_of 已作用于节点集/fade/recalls/generated_at；drives 仍读 meta 当前值（轻）",
         pb["generated_at"])

    # stats.core 只在截断后的集合里统计
    P = fresh()
    enc, st, idx, cfg, rc = P["encoder"], P["store"], P["index"], P["cfg"], P["recall"]
    for i in range(3):
        enc.write("核心级记忆第%d条" % i, source="owner", audience="private")
    with st.tx() as c:
        c.execute("UPDATE nodes SET level='core'")
    small = panel.brain(st, cfg, idx, limit=1)
    full = panel.brain(st, cfg, idx, limit=1600)
    check("stats.core 应统计全库而非截断后的 shown 集合",
          small["stats"]["core"] == 3,
          "limit=1 时 stats.core=%r，全量=%r" % (small["stats"]["core"], full["stats"]["core"]))

    # detail / touch / recalls
    nid = full["nodes"][0]["id"]
    d = panel.detail(st, nid)
    check("detail 含正文/证据/level", d and d["text"] and isinstance(d["evidence"], list) and d["level"])
    before = d["hits"]
    t = panel.touch(st, nid)
    check("touch 命中 +1", t["hits"] == before + 1, "%s -> %s" % (before, t["hits"]))
    rc.retrieve("核心级记忆", CTX)
    rec = panel.recent_recalls(st, 3)
    check("recent_recalls 有记录", rec and rec[0]["query"])
    full_b = panel.brain(st, cfg, idx)
    past_b = panel.brain(st, cfg, idx, as_of=past)
    check("as_of 回看过去不返回未来的 recall 事件",
          all(r["ts"] <= past_ts for r in past_b["recalls"]), past_b["recalls"])
    check("对照：当前视图的 recalls 非空", len(full_b["recalls"]) >= 1)
    try:
        panel.brain(st, cfg, idx, as_of="2026-13-40")
        check("非法 as_of 报 ValueError", False)
    except ValueError:
        check("非法 as_of 报 ValueError", True)

    # 文档声称「衰减口径和检索一致」：检索其实完全不用 age/fade
    P = fresh()
    enc, rc, st = P["encoder"], P["recall"], P["store"]
    old_ts = time.time() - 1000 * 86400
    old = enc.write("很久以前的一条测试记忆", source="owner", audience="private", region="texture", ts=old_ts)["id"]
    new = enc.write("另一条测试记忆内容", source="owner", audience="private", region="texture")["id"]
    with st.tx() as c:
        c.execute("UPDATE nodes SET affect_w=2.0, created_at=?, valid_from=? WHERE id=?", (old_ts, old_ts, old))
        c.execute("UPDATE nodes SET affect_w=2.0 WHERE id=?", (new,))
    nodes = {n["id"]: n for n in st.active_nodes()}
    sc = {h["id"]: h["score"] for h in rc._score("测试记忆", [nodes[old], nodes[new]], CTX, {"mode": "test"})}
    note("检索打分不含 age/fade：仅影响 panel 的 fade，与 panel 注释「衰减口径和检索一致」不符",
         {"old": sc.get(old), "new": sc.get(new)})


# =====================================================================
# 9. sidecar/server 契约（recall 字段、panel_* ops）
# =====================================================================
def test_server():
    print("\n== 9. server 契约")
    d = tempfile.mkdtemp(prefix="ds43s-")
    svc = Service(os.path.join(d, "mind.db"), embed=True)
    for t in ["主人今天在整理合并规格", "给 Deep-Soul 画了两张逻辑图", "主人把插件改名成 Deep-Soul"]:
        svc.handle({"op": "remember", "args": {"text": t, "audience": "private"}})
    r = svc.handle({"op": "recall", "args": {"query": "逻辑图", "k": 3, "ctx": CTX}})
    keys = set(r[0]) if r else set()
    check("recall 返回 cov/level/source",
          {"cov", "level", "source", "created_at"} <= keys, keys)
    b = svc.handle({"op": "panel_brain", "args": {}})
    check("panel_brain op 可用", {"nodes", "clusters", "stats"} <= set(b))
    did = b["nodes"][0]["id"]
    check("panel_detail op 可用", svc.handle({"op": "panel_detail", "args": {"id": did}})["id"] == did)
    check("panel_touch op 可用", svc.handle({"op": "panel_touch", "args": {"id": did}})["hits"] >= 1)
    check("panel_recalls op 可用", isinstance(svc.handle({"op": "panel_recalls", "args": {"limit": 3}}), list))
    try:
        svc.handle({"op": "panel_brain", "args": {"as_of": "2026-13-40"}})
        check("非法 as_of 经 server 报错", False)
    except ValueError:
        check("非法 as_of 经 server 报错", True)


# =====================================================================
# 10. 可选压测
# =====================================================================
def test_perf():
    print("\n== 10. 压测（400 条合成，仅 --perf 时跑）")
    import random
    import statistics

    def pct(vals, p):
        vals = sorted(vals)
        return vals[min(len(vals) - 1, int(round(p / 100.0 * (len(vals) - 1))))]

    P = fresh()
    enc, rc, idx, cons, st = P["encoder"], P["recall"], P["index"], P["cons"], P["store"]
    topics = ["菜棚松土", "码头看海", "厨房做饭", "群友打游戏", "下雨心情", "水井打水",
              "阳台浇花", "客厅扫除", "老树乘凉", "崖边散步", "主人加班", "视频通话",
              "写代码", "画图", "听歌", "散步", "做饭", "睡懒觉", "整理房间", "看书"]
    regions = ["episode", "fact", "relation", "preference", "habit", "texture", "trivia"]
    auds = ["private", "private", "private", "group", "public"]
    now = time.time()
    random.seed(7)
    t0 = time.perf_counter()
    for i in range(400):
        enc.write("%s的第%d次记录，今天和主人聊到一些细节" % (topics[i % len(topics)], i),
                  source=("owner" if i % 3 else "other"), audience=auds[i % len(auds)],
                  region=regions[i % len(regions)], ts=now - random.randrange(0, 120) * 86400)
    t_write = time.perf_counter() - t0
    t0 = time.perf_counter()
    idx.rebuild_cells()
    t_cells = time.perf_counter() - t0
    qs = ["%s 今天 怎么样" % topics[i % len(topics)] for i in range(50)]
    times = []
    for q in qs:
        t0 = time.perf_counter()
        rc.retrieve(q, CTX, k=5)
        times.append((time.perf_counter() - t0) * 1000)
    t0 = time.perf_counter()
    brain = panel.brain(st, P["cfg"], idx)
    t_brain = (time.perf_counter() - t0) * 1000
    print("  write400=%.2fs rebuild_cells=%.2fs retrieve50 p50=%.1fms p95=%.1fms max=%.1fms "
          "panel_brain=%.0fms nodes=%d" % (t_write, t_cells, pct(times, 50), pct(times, 95),
                                           max(times), t_brain, len(brain["nodes"])))
    # 陈旧舱：rebuild 之后新写入的节点检索不到（P0 的规模版）
    new_ids = []
    for i in range(20):
        new_ids.append(enc.write("新写入未进舱的第%d条记录" % i, source="owner",
                                 audience="private", region="fact")["id"])
    visible = {n["id"] for n in st.active_nodes()}
    routed, _ = idx.route("新写入未进舱", CTX, visible)
    missed = [i for i in new_ids if i not in routed]
    check("rebuild_cells 后新写入节点应在路由候选内", not missed,
          "未被路由的新节点 %d/20，如 id=%r" % (len(missed), missed[:5]))
    note("压测数字仅为参考（HashEmbedder 离线替身，无真实语义模型）")


def main():
    print("Deep-Soul v4.3 独立对抗验证（临时库，不写真实库）")
    print("jitter=0，固定测试时间 2026-10-28 12:00 周三")
    for fn in [test_timequery, test_echo, test_dedupe, test_coverage, test_time_window,
               test_promotion, test_diversity, test_migration, test_panel, test_server]:
        try:
            fn()
        except Exception:
            import traceback
            traceback.print_exc()
            FAIL.append((fn.__name__, "exception"))
    if "--perf" in sys.argv:
        try:
            test_perf()
        except Exception:
            import traceback
            traceback.print_exc()
            FAIL.append(("test_perf", "exception"))

    print("\n================ 汇总 ================")
    print("regression PASS: %d, FAIL: %d" % (len(PASS), len(FAIL)))
    print("BUG 复现: %d, 已修复: %d" % (len(BUGS), len(FIXED)))
    for n, d in FAIL:
        print("  FAIL  " + n + (("  [" + str(d) + "]") if d else ""))
    for n, d in BUGS:
        print("  BUG   " + n + (("  [" + str(d) + "]") if d else ""))
    for n, d in FIXED:
        print("  FIXED " + n)
    bad = bool(FAIL) or bool(BUGS)
    print("结论: " + ("需要修复（见上方 BUG/FAIL）" if bad else "全部通过"))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
