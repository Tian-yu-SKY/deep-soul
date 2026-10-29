# 兼容性基线

本文件回答三个问题：在什么环境上验证过、依赖哪些版本、升级时该怎么办。所有数字都来自 docs/VALIDATION.md 记录的实测。

## 1. 已验证的基线（2026-10-29）

| 组件 | 版本 | 说明 |
| --- | --- | --- |
| Deep-Soul | 4.5.0 | 本仓库 |
| DeepSeek Harness | 0.2.1-rc.2 | 宿主，MIT；插件通过 dsh.client / systemPrompt / tools 扩展点接入 |
| Node.js | 24.21.0 | DSH 宿主运行时 |
| Python | 3.10.12 | 记忆内核，仅标准库 |
| SQLite | 3.37.2 | Python 内置 |
| 操作系统 | Ubuntu 22.04.5 LTS / Linux 5.15 | 单机部署 |

## 2. 运行要求

- Node.js 22 及以上（跟随 DSH 宿主要求；22.19+ 与 24+ 在同一条基线代码路上，但只在 24.21.0 实测）。
- Python 3.10 及以上，只用标准库（sqlite3、json、hashlib、re 等），不需要 pip 安装任何包。
- 数据库目录可写：默认 ~/.dsh/deep-soul/（可用 DSH_HOME 改根）。
- 内核目录默认从插件目录向上两级寻找 mindcore/；可用 DEEP_SOUL_ROOT 覆盖。

## 3. 支持矩阵与未验证项

| 项目 | 状态 |
| --- | --- |
| Linux（Ubuntu 22.04） | 已验证 |
| Windows / macOS | 未验证；路径、信号、文件锁行为未测 |
| DSH 0.2.2-alpha.2 及以上 | 未验证；上游涉及工具、提示词与会话接口调整 |
| Node 22.x | 未单独验证（代码未用 24 专属 API） |
| Python 3.11 / 3.12 | 未单独验证（未用 3.10+ 新语法） |
| 多用户 / 多人隔离 | 不支持，设计为单主人 |
| 跨机器同步 | 不支持 |
| 长时间 soak（> 2 天连续运行） | 未验证；当前观察窗口为 2 小时量级 |

> 兼容承诺只覆盖上表「已验证」一行。DSH 小版本升级不保证行为不变，升级前请按第 5 节重跑测试。

## 4. 数据与 schema

- 单文件：~/.dsh/deep-soul/mind.db（WAL 模式），另有 snapshots/、auto-memory-state.json、open-loops.json。
- 主要表：nodes、edges、cells、cell_members、anchors、evidence、spine、self_claims、autobiography、snapshots、events、injection_log、meta。
- 初始化采用幂等 CREATE TABLE IF NOT EXISTS 与补列迁移，可重复执行；当前未设置 PRAGMA user_version（值为 0），schema 版本以代码内迁移逻辑为准。
- 备份：夜间巩固前会自动快照（保留 30 份、总量不超过 512 MB）；也可在停机时直接复制 db + wal + shm。

## 5. 升级与回滚

1. 停 DSH，备份 ~/.dsh/deep-soul/ 整个目录。
2. 更新插件与内核代码。
3. 启动后依次运行：selftest.py、test_self.py、test_v43.py、test_v43_verify.py。
4. 打开识海面板，确认节点数、舱数、最近记忆与 safe_mode、injections_today 正常。
5. 异常时回滚代码并恢复备份目录；数据库不需要降级脚本。

## 6. 复现验证

    python3 mindcore/tests/selftest.py
    python3 mindcore/tests/test_self.py
    python3 mindcore/tests/test_v43.py
    python3 mindcore/tests/test_v43_verify.py

独立套件默认使用运行时刻作为时钟；要复现历史结果可设 DS_VERIFY_NOW 为 Unix 时间戳。
