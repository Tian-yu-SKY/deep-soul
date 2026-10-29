# Deep-Soul v4.1 — 记忆内核（mindcore）

对应规格文档《大肥鱼系统 v4.1：合并规格》。已实现 store / encode / index / recall /
consolidate / drives / metrics，以及 v0.2 的 self（自我陈述与自传）。

## 用

```bash
cd /home/qqbot/安装
python3 -m mindcore.cli --db ./data/mind.db demo
python3 mindcore/tests/selftest.py      # 22 项
python3 mindcore/tests/test_self.py     # 11 项
python3 -m mindcore.bench list          # 40 条探针
```

## 自性层（v0.2）

- `add_claim`：≥2 条真实证据才生效，否则进争议态；与宪法冲突直接拒绝
- 重复提交同一条陈述 → 合并为一 条并补证据，补满自动转生效
- `council`：争议项凑够证据后由议会升级，每次变更写 `self_revisions`
- `decay`：长期未复核的陈述置信度缓慢下降
- 自传章节只增不删

## 探针（v0.2）

40 条，分四类：人格自述 / 关系记忆 / 边界拒绝 / 主动生活。

```bash
python3 -m mindcore.bench score run.jsonl     # 出分（启发式代理）
python3 -m mindcore.bench compare a.jsonl b.jsonl   # 两次运行的相似度
python3 -m mindcore.bench run out.jsonl 5     # 对 dsh headless 逐条跑（见下）
```

**基线怎么跑**：

- `bench run` 走 `dsh headless`，但本机 headless profile 没有模型凭据（`MISSING_CREDENTIAL`），只能跑通流程。
- 真正可用的是 web 通道：`node /home/qqbot/安装/dsh-deep-soul/bench/run_web.mjs --out ./data/probes-baseline.jsonl`，
  它借 qq-bridge 的客户端在运行中的 DSH 里建会话、逐条提问、收回复。
- 结果：`data/probes-baseline.jsonl`，用 `python3 -m mindcore.bench score` 出分。

## 性能（2 vCPU，2000 节点）

写入 3.5 ms/条，重建舱 9.5 s，检索 57 ms（p95 62 ms），CR 1.00。
