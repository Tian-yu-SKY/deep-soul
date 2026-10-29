# affect 情绪内核（P1）—— 让情绪有出处

> 一句话：把「心情 = 模型自评」换成「心情 = 事件 → 化学池 → 衰减 → 行为指令」。
> 借鉴自 yangshangshui/digital-life-core 的内分泌层，只取情绪相关部分（不含能量/器官/意志）。

## 1. 它怎么工作

```
DSH 事件                       化学池                     输出
────────────────────────────  ─────────────────────────  ───────────────────────────
一轮说完  turn-stopping        多巴胺 +5                   systemPrompt 段：行为指令
请求失败  request-error        皮质醇 +20 / 血清素 -5      （平静且无事 → 空串，不占 token）
工具失败  post-execute         皮质醇 +8（800ms 去重）
被夸/被怼  桥接 POST 刺激       多巴胺 +8 / 皮质醇 +10
被点名    桥接 POST 刺激       多巴胺 +3
                            ↓ 惰性衰减（半衰期 45/30/120 分钟）
                            ↓ 慢变量：皮质醇高 → 抽干血清素；平静够久 → 血清素回升
                                              ↓
                                   agent/request：温度 0.35 / 0.55 / 0.9
                                   mood.json → qq-bridge 的【此刻心情】
```

**不报数**：指令里没有数字、没有激素名（有测试断言）。给的是行为，不是读数。

## 1.5 可视化：识海右栏的「SOMA · 体征」卡片

不再单开一页——体征卡片嵌在**识海右栏**（记忆列表上方），和识海同一个侧边栏：


| 区块 | 内容 |
|---|---|
| 心情卡 | 大字心情标签 + 强度条 + 原因 + 语气基调（平静低强度显示「安静」） |
| 化学池 | 多巴胺/皮质醇/血清素三条，带**基线刻度线**（50/20/50），值保留一位小数 |
| 状态芯片 | 温度档位（不覆盖/0.55/0.35/0.9）、最近刺激、上次有人说话、孤独计时（>12h 变红）、四个开关 |
| 脉冲图 | Canvas 2D，三条曲线（橙/红/蓝）+ 0/50/100 网格；数据来自 `affect-history.jsonl`（20 秒/点，最多 1440 点），无历史时用轮询点兜底 |
| 刺激时间线 | 最近 12 次刺激（中文名 + 相对时间） |
| 操作 | 刷新（卡片右上角 ↻）；完整版"哄好"按钮保留在 `/deep-soul/affect` 接口 |

轮询：主快照 3 秒、历史 60 秒；不改任何已有识海代码，样式独立注入（`.dsa-` 前缀）。

新增接口：

- `GET /deep-soul/affect` → 快照（含 `config`）
- `GET /deep-soul/affect/history?n=240` → 历史点
- `POST /deep-soul/affect` → `{kind}` 或 `{reset:true}`

## 2. 文件

| 文件 | 作用 |
|---|---|
| `lib/affect-core.mjs` | 纯函数：基因组/衰减/刺激/慢变量/心情映射/指令/温度 |
| `lib/affect.mjs` | 引擎：状态读写、配置、never throw |
| `lib/index.js` | 接线：1 个 systemPrompt context + 5 个钩子 + `/deep-soul/affect` 路由 |
| `test/affect-core.test.mjs` | 27 个断言（纯函数 + 引擎） |
| `test/affect-integration.test.mjs` | 9 个断言（mock ctx 跑 apply + 模拟事件） |
| `docs/affect-spec.md` | 接口契约（先写契约再实现） |

## 3. 状态与配置

- 状态：`~/.dsh/deep-soul/affect.json`（原子写；坏档改名 `.bad-<ts>` 后回出厂）
- 导出：`~/.dsh/deep-soul/mood.json`（`{label,intensity,reason,tone,updatedAt,source:'affect'}`，给桥接读）
- 配置：`~/.dsh/deep-soul/affect.config.json`（不存在 = 全开）

```json
{ "enabled": true, "directive": true, "temperature": true, "moodFile": true }
```

改配置 5 秒内生效，不用重启。想临时关掉：`{"enabled": false}`。

## 4. 接桥接（P2，补丁已备好）

`<workspace>/_patch/`：
- `mood-source.mjs` — 读 mood.json 的小模块（15 分钟新鲜度，坏档/过期回落旧自评）
- `apply-bridge.md` — 4 处改动 + 应用/验证/回滚步骤
- `bridge-mood.patch` — unified diff（已 dry-run 验证）

应用后：`formatMoodV2` 优先用内核心情，模型不再被要求每轮自评；`[心情]` 保留为兜底。

## 5. 测试与验证

```bash
cd <repo>/dsh-deep-soul
node test/affect-core.test.mjs        # 27/27
node test/affect-integration.test.mjs # 9/9
```

线上验证（重启 dsh-web 后）：

```bash
journalctl -u dsh-web -n 50 | grep affect          # 期望：affect wired
curl -s localhost:3080/deep-soul/affect            # 期望：mood 快照
cat ~/.dsh/deep-soul/mood.json                     # 期望：source=affect
# 打一针应激，看温度是否变化
curl -s -XPOST localhost:3080/deep-soul/affect -H 'content-type: application/json' -d '{"kind":"request_error"}'
```

## 6. 回滚

```bash
cd <repo>/dsh-deep-soul
cp lib/index.js.bak-affect-* lib/index.js   # 只用回滚接线（affect 文件留着无副作用）
sudo systemctl restart dsh-web
```

或更快：`echo '{"enabled":false}' > ~/.dsh/deep-soul/affect.config.json`（5 秒生效，不用重启）。

## 7. 还没做的（P2/P3）

- 桥接侧：`mood.json` 接管 + 收消息时 POST `mentioned`（补丁已备好，未应用）
- mindcore 七维驱力当"基线调节器"：social 长期欠账 → 皮质醇基线抬高
- 情绪记忆锚点：存记忆时记化学快照，检索按当前激素倾斜
- 承诺核对 / 投递前复核（来自 digital-life-core 的意志闸门）
