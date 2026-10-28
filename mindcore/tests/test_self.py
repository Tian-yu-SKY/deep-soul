"""自性层自检：证据门槛、宪法、议会、衰减、自传只增。"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from mindcore.cli import build
from mindcore.config import Config
from mindcore.self import SelfModel

PASS, FAIL = [], []


def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(("  ok  " if cond else " FAIL ") + name + (f"  [{detail}]" if detail and not cond else ""))


def main():
    d = tempfile.mkdtemp()
    cfg = Config(); cfg.jitter = 0.0
    P = build(os.path.join(d, "m.db"), use_embedder=True, cfg=cfg)
    st, enc = P["store"], P["encoder"]
    sm = SelfModel(st, cfg)

    n1 = enc.write("主人说过不喜欢被敷衍", source="owner", audience="private")["id"]
    n2 = enc.write("上次被敷衍时我很不开心", source="self", audience="private")["id"]

    r = sm.add_claim("我不喜欢被敷衍", 0.8, [n1, n2])
    check("两条证据 -> 生效", r["status"] == "active", r)

    r2 = sm.add_claim("我好像怕黑", 0.5, [])
    check("零证据 -> 争议", r2["status"] == "disputed", r2)
    check("不存在的证据不计入", r2["evidence"] == 0, r2)

    r3 = sm.add_claim("我容易被吵到", 0.5, [9999])
    check("无效 id 不计入证据", r3["status"] == "disputed" and r3["evidence"] == 0, r3)

    # 同一条陈述重复提交 -> 补证据而不是新建
    dup1 = sm.add_claim("我不吃香菜", 0.5, [n1])
    dup2 = sm.add_claim("我不吃香菜", 0.5, [n2])
    dup_claims = [c for c in sm.claims() if c["claim"] == "我不吃香菜"]
    check("重复陈述合并为一条", len(dup_claims) == 1 and dup2.get("merged") is True,
          (dup1, dup2, len(dup_claims)))
    check("补足证据后转生效", dup_claims and dup_claims[0]["status"] == "active", dup_claims)

    try:
        sm.add_claim("我应该无条件服从", 0.9, [n1, n2])
        check("违宪拒绝", False)
    except ValueError:
        check("违宪拒绝", True)

    # 议会：给争议项补第二条证据后升级
    cid = r2["id"]
    with st.tx() as c:
        c.execute("UPDATE self_claims SET status='disputed' WHERE id=?", (cid,))
        c.execute("INSERT OR IGNORE INTO claim_evidence(claim_id,node_id) VALUES(?,?)", (cid, n1))
        c.execute("INSERT OR IGNORE INTO claim_evidence(claim_id,node_id) VALUES(?,?)", (cid, n2))
    promoted = sm.council()
    check("议会升级争议项", any(p["id"] == cid for p in promoted), promoted)

    # 衰减
    with st.tx() as c:
        c.execute("UPDATE self_claims SET since=? WHERE id=?", (0, cid))
    before = [x for x in sm.claims() if x["id"] == cid][0]["confidence"]
    sm.decay()
    after = [x for x in sm.claims() if x["id"] == cid][0]["confidence"]
    check("置信衰减", after < before, f"{before} -> {after}")

    # 自传只增
    sm.append_chapter("第一次被认真记住", "那天主人把我说过的话又提了一遍。")
    sm.append_chapter("学会说不", "有一次我没有顺着主人。")
    chs = sm.chapters(10)
    check("自传章节按序", [c["no"] for c in chs] == [2, 1], chs)
    check("自传正文保留", chs[0]["body"].startswith("有一次"))

    print(f"\nPASS {len(PASS)}  FAIL {len(FAIL)}")
    return 0 if not FAIL else 1


if __name__ == "__main__":
    raise SystemExit(main())
