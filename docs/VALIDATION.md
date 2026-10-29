# 验证记录

本文件只写“实际跑过什么、结果如何、没跑什么”。验证日期：2026-10-29。环境见 docs/COMPATIBILITY.md。

## 1. 测试套件

| 套件 | 内容 | 结果 |
| --- | --- | --- |
| mindcore/tests/selftest.py | 不变量：权重、分区、冲突、证据、衰减、维护 | 22 / 22 |
| mindcore/tests/test_self.py | 自性层：陈述、证据门槛、争议、衰减、自传 | 11 / 11 |
| mindcore/tests/test_v43.py | 检索、隐私、面板、维护、闸门、写入闸、舱标签 | 58 / 58 |
| mindcore/tests/test_v43_verify.py | 独立对抗套件（另一套断言，覆盖同模块） | 76 / 76 |
| node --test dsh-deep-soul/test/*.test.mjs | 情绪内核：化学池、衰减、指令、mood 导出 | 2 / 2 |

独立套件原先锚定 2026-10-28 12:00 作为时钟，跨日期后「昨天/这周」夹具会漂移；2026-10-29 已改为默认取运行时刻，并修正两处过期夹具（短查询改用有 bigram 交集的例句、recalls 用例改查当前临时库）。这些是测试夹具修正，未降低产品断言。

## 2. 真实环境检查（本机，2026-10-29）

| 项目 | 实测 |
| --- | --- |
| 活动记忆 | 289 条（另 3 条非 active） |
| 舱 | 16 个（vector 模式） |
| 面板接口 | GET /deep-soul/panel 返回 200，聚合约 7 ms |
| 检索延迟（真实库 278 条，2026-10-28） | p50 0.9 ms / p95 1.2 ms |
| 检索延迟（合成 400 条） | p50 7.9 ms / p95 10.7 ms |
| 夜间巩固 | 快照 + 合并/剪枝/维护链跑通 |
| 历史导入 | 276 条唯一消息 → 274 条入库（群 216 / 私聊 62） |
| 长期运行维护 | 事件保留、快照限容、WAL 截断、04:00 后补跑 |
| 主动闸门与写入闸 | 单测覆盖；状态持久化跨实例读取 |

## 3. 未验证 / 不在承诺范围

| 项目 | 状态 |
| --- | --- |
| 全新机器从零安装 | 未验证（当前实例是逐步演进出来的） |
| Windows / macOS | 未验证 |
| DSH 0.2.2-alpha.2 | 未验证 |
| 群与群之间隔离之外的多用户隔离 | 不支持 |
| 连续运行超过 2 天的 soak | 未验证 |
| 模型侧“识海更有灵性”一类主观效果 | 未验证，也不作为工程声明 |
| 浏览器兼容矩阵（Chrome/Edge/Firefox/Safari） | 仅在 Chromium 系验证 |
| 文档 DOCX 在 Word/WPS 的排版一致性 | 仅本机打开检查 |
| 内存/CPU 长期曲线 | 只有 2 小时量级采样（侧车 RSS 约 19 MB） |

## 4. 复现

    python3 mindcore/tests/selftest.py
    python3 mindcore/tests/test_self.py
    python3 mindcore/tests/test_v43.py
    python3 mindcore/tests/test_v43_verify.py

独立套件可加 --perf 跑 400 条合成压测；DS_VERIFY_NOW 可复现固定时钟下的历史结果。
