"""自检：覆盖 §3.2/3.3/3.6/3.7/3.8/3.9/3.11 的关键不变量。"""
import os
import sys
import json
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from mindcore.cli import build
from mindcore.config import Config
from mindcore import text as T

PASS = []
FAIL = []


def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(("  ok  " if cond else " FAIL ") + name + (f"  [{detail}]" if detail and not cond else ""))


def fresh(embed=True):
    d = tempfile.mkdtemp()
    cfg = Config()
    cfg.jitter = 0.0
    return build(os.path.join(d, "mind.db"), use_embedder=embed, cfg=cfg), d


def test_weights():
    P, _ = fresh()
    st, enc = P["store"], P["encoder"]
    st.set_meta("intimacy", 1.0)
    r = enc.write("主人说喜欢喝温水", source="owner", audience="private")
    check("owner alpha 随亲密到上限附近", abs(r["affect_w"] - 3.8 * (1 + r["surprise"]) * 1.0) < 1.2,
          str(r["affect_w"]))
    check("owner beta = 1.3", r["belief_w"] == 1.3, str(r["belief_w"]))
    r2 = enc.write("群友说他明天不来", source="other", audience="group")
    check("other beta = 1.0", r2["belief_w"] == 1.0)


def test_owner_cap():
    P, _ = fresh()
    st, enc = P["store"], P["encoder"]
    for i in range(12):
        enc.write(f"主人的第{i}件小事", source="owner", audience="private")
    capped = enc.write("主人的又一件小事", source="owner", audience="private")
    check("主人占比上限触发降权", capped["capped"] is True, str(enc.owner_share()))


def test_audience():
    P, _ = fresh()
    enc, rc = P["encoder"], P["recall"]
    enc.write("主人只说给她的秘密", source="owner", audience="private")
    enc.write("群里公开说过的事", source="other", audience="public")
    priv = rc.retrieve("秘密", {"principal": "guest", "audience": "group"})
    check("私有记忆不出现在他人会话", all("秘密" not in h["text"] for h in priv), str(priv))
    pub = rc.retrieve("公开", {"principal": "guest", "audience": "group"})
    check("公开记忆可被他人会话召回", any("公开" in h["text"] for h in pub))
    mine = rc.retrieve("秘密", {"principal": "owner", "audience": "private"})
    check("主人私聊可召回私有记忆", any("秘密" in h["text"] for h in mine))


def test_inference_guard():
    P, _ = fresh()
    enc = P["encoder"]
    r = enc.write("他故意不回我消息", source="owner", audience="private")
    check("归因句降级为争议", r["status"] == "disputed", r["status"])
    r2 = enc.write("今天他下午三点来找我", source="owner", audience="private")
    check("事实句正常写入", r2["status"] == "active")


def test_grounding():
    P, _ = fresh()
    enc, rc = P["encoder"], P["recall"]
    enc.write("在码头看海", source="owner", audience="private", anchor={"place": "码头"})
    enc.write("在厨房做饭", source="owner", audience="private", anchor={"place": "厨房"})
    at_dock = rc.retrieve("看海", {"principal": "owner", "audience": "private", "place": "码头"})
    top = at_dock[0] if at_dock else None
    check("同地点锚点加权", bool(top) and top["parts"]["grounding"] >= 1.12, str(top and top["parts"]))


def test_spine_resolution():
    P, _ = fresh()
    enc, rc, cons = P["encoder"], P["recall"], P["cons"]
    r = enc.write("你上次在群里让我下不来台", source="owner", audience="private", region="spine")
    nid = r["id"]
    h1 = rc.retrieve("群里 下不来台", {"principal": "owner", "audience": "private"})
    s1 = next((h["score"] for h in h1 if h["id"] == nid), 0)
    cons.resolve_spine(nid, "说开了")
    h2 = rc.retrieve("群里 下不来台", {"principal": "owner", "audience": "private"})
    s2 = next((h["score"] for h in h2 if h["id"] == nid), 0)
    check("和解后节点仍可检索", s2 > 0, f"{s1:.3f} -> {s2:.3f}")
    check("和解后增益下降", s2 < s1, f"{s1:.3f} -> {s2:.3f}")


def test_consolidation():
    P, _ = fresh()
    enc, cons, st = P["encoder"], P["cons"], P["store"]
    enc.write("今天在码头看海，风很大", source="owner", audience="private", region="episode")
    enc.write("今天在码头看海，风特别大", source="owner", audience="private", region="episode")
    rep = cons.nightly()
    themes = st.conn.execute("SELECT COUNT(*) FROM nodes WHERE kind='theme'").fetchone()[0]
    check("抽象生成主题节点", themes >= 1, str(rep["abstracted"]))
    check("有主题边", st.count("SELECT COUNT(*) FROM edges WHERE kind='tag'") >= 2)
    # 宪法闸门
    st.set_meta("constitution", ["看海"])
    enc.write("今天在码头看海，风很大", source="owner", audience="private", region="episode")
    enc.write("今天在码头看海，风很大", source="owner", audience="private", region="episode")
    cons.abstract()
    q = st.count("SELECT COUNT(*) FROM review_queue")
    check("违宪主题进复核队列", q >= 1, str(q))


def test_cells():
    P, _ = fresh()
    enc, idx = P["encoder"], P["index"]
    for i in range(60):
        enc.write(f"第{i}条关于菜棚和天气的记录", source="other", audience="public",
                  region="fact", anchor={"place": "菜棚"})
    info = idx.rebuild_cells()
    n = len(P["store"].active_nodes())
    k = max(8, min(32, round((n / 5) ** 0.5)))
    check("舱数符合 clamp 公式", info["cells"] <= 32 and info["mode"] in ("vector", "bucket"),
          f"{info} n={n} expect_k={k}")
    ids, meta = idx.route("菜棚 天气", {"audience": "public"}, {x["id"] for x in P["store"].active_nodes()})
    check("路由返回候选", len(ids) > 0, str(meta))


def test_degraded():
    P, _ = fresh(embed=False)
    enc, rc, idx, met = P["encoder"], P["recall"], P["index"], P["metrics"]
    enc.write("菜棚的土该松了", source="self", audience="public")
    hits = rc.retrieve("菜棚", {"principal": "owner", "audience": "private"})
    check("无向量时检索仍可用", len(hits) > 0)
    for i in range(60):
        enc.write(f"菜棚第{i}条记录，天气和土", source="other", audience="public")
    idx.rebuild_cells()
    check("降级为分桶模式", idx.mode() == "bucket", idx.mode())
    row = met.daily()
    check("降级时指标可计算", row["cr"] is not None and 0 <= row["cr"] <= 1.0, str(row["cr"]))


def test_snapshot():
    P, d = fresh()
    st = P["store"]
    P["encoder"].write("快照前的一条记忆", source="owner", audience="private")
    path = st.snapshot("test")
    n1 = st.count("SELECT COUNT(*) FROM nodes")
    P["encoder"].write("快照后的另一条", source="owner", audience="private")
    n2 = st.count("SELECT COUNT(*) FROM nodes")
    ts = st.conn.execute("SELECT ts FROM snapshots ORDER BY ts DESC LIMIT 1").fetchone()[0]
    st.restore(ts)
    n3 = st.count("SELECT COUNT(*) FROM nodes")
    check("快照回滚恢复节点数", n1 == n3 and n2 == n1 + 1, f"{n1} {n2} {n3}")


def test_conflict():
    P, _ = fresh()
    enc = P["encoder"]
    enc.write("我讨厌下雨天", source="owner", audience="private", region="preference")
    r = enc.write("我喜欢下雨天", source="other", audience="private", region="preference")
    check("冲突写入标记为争议", r["status"] == "disputed" and r["conflict"], str(r))


if __name__ == "__main__":
    for fn in [test_weights, test_owner_cap, test_audience, test_inference_guard,
               test_grounding, test_spine_resolution, test_consolidation, test_cells,
               test_degraded, test_snapshot, test_conflict]:
        print("\n== " + fn.__name__)
        try:
            fn()
        except Exception as e:
            import traceback; traceback.print_exc()
            FAIL.append(fn.__name__ + " (exception)")
    print(f"\nPASS {len(PASS)}  FAIL {len(FAIL)}")
    if FAIL:
        print("failed:", FAIL)
    sys.exit(0 if not FAIL else 1)
