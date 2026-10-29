# affect 情绪内核 · 接口契约（P1）

> 目标：把「情绪」从模型自评（qq-bridge 的 mood）改成**内生状态**：事件刺激 → 化学池 → 惰性衰减 → 行为指令。
> 落点：dsh-deep-soul 插件内（Node ESM，零外部依赖，只用 node: 内置模块）。

## 0. 文件与职责

| 文件 | 职责 | 不允许 |
|---|---|---|
| `lib/affect-core.mjs` | 纯函数：基因组、衰减、刺激、慢变量规则、快照、心情映射、行为指令、温度 | 任何 IO / Date.now 之外的副作用（时间必须由参数传入） |
| `lib/affect.mjs` | 引擎：读写 `~/.dsh/deep-soul/affect.json` 与 `mood.json`，原子写，损坏自愈，never throw | 挂 DSH 钩子（钩子在 index.js） |
| `lib/index.js` | 接线：systemPrompt.context + agent/pre-step + agent/turn-stopping + agent/request-error + agent/request | 任何可能让 apply 抛异常的写法（整体 try/catch 降级） |

## 1. 基因组（写死默认，不做 UI）

```js
export const DEFAULT_GENOME = {
  version: 1,
  temperament: { sensitivity: 1.0, resilience: 1.0, enthusiasm: 50 },
  chemicals: [
    { id: 'dopamine',  label: '多巴胺', baseline: 50, initial: 50, min: 0, max: 100, halfLifeMinutes: 45 },
    { id: 'cortisol',  label: '皮质醇', baseline: 20, initial: 20, min: 0, max: 100, halfLifeMinutes: 30 },
    { id: 'serotonin', label: '血清素', baseline: 50, initial: 50, min: 0, max: 100, halfLifeMinutes: 120 },
  ],
}
```

- 衰减：`value' = baseline + (value - baseline) * 2^(-minutes * resilience / halfLifeMinutes)`
- `temperament.sensitivity` 只作用于**向上的皮质醇增量**；`enthusiasm` 是多巴胺的回归基线偏移（`baseline = 50 + (enthusiasm-50)*0.4`，实现时可简化但要在注释里写明）。

## 2. 刺激刺激表（P1 只认这几类）

| kind | 默认增量 | 说明 |
|---|---|---|
| `turn_done` | dopamine +5 | 一轮对话正常完成 |
| `request_error` | cortisol +20×sensitivity, serotonin -5 | 模型请求失败/超时 |
| `tool_error` | cortisol +8×sensitivity | 工具执行失败（800ms 内去重） |
| `praised` | dopamine +8 | 被肯定（桥接/外部调用） |
| `scolded` | cortisol +10×sensitivity, serotonin -3 | 被怼 |
| `mentioned` | dopamine +3 | 被 @ / 点名 |
| `custom` | `{ chemical, delta }` | 手工注入（测试与调试） |

## 3. 慢变量规则（按分钟，tick 时补算）

- cortisol ≥ 70：serotonin 每分钟 -1.5（抽干）
- cortisol < 40 且距上次交互 > 30 分钟：serotonin 每分钟 +0.8，上限 85

## 4. 心情映射（13 标签的子集，供 qq-bridge 消费）

优先级从高到低：

| 条件 | label | intensity | tone |
|---|---|---|---|
| cortisol ≥ 75 | 炸毛 | clamp((cortisol-50)/50) | 先“？”“喂”，短促，别讲道理 |
| cortisol ≥ 60 | 烦 | … | 短句、反问，别解释 |
| serotonin ≤ 30 | 委屈 | … | 语气软，省略号，别硬撑 |
| dopamine ≥ 80 | 得意 | … | 有点飘，爱显摆 |
| dopamine ≥ 65 | 开心 | … | 语气上扬，话可以多一点 |
| 深夜(23-05) 且 cortisol<50 | 困 | … | 句子短，反应慢，容易敷衍 |
| 其余 | 平静 | 0.2~0.35 | 正常说话，不用硬找情绪 |

intensity 一律 0..1，保留两位小数；`reason` 由触发源生成（如 `请求失败` / `被夸了`），不超过 20 字。

## 5. 快照与行为指令

```js
snapshot(state, genome, nowMs) -> {
  at,
  chemicals: [{ id, label, value }],   // value 已四舍五入到 1 位小数
  byId: { dopamine: 62.3, ... },
  mood: { label, intensity, reason, tone },
  temperature: number | null,
}
```

`buildDirective(snap, { lastInteractionAt, nowMs }) -> string`

硬约束（测试会断言）：
1. **不得出现任何数字**（`/[0-9]/` 必须为 false），也不得出现激素名（多巴胺/皮质醇/血清素）。
2. 空状态（全在基线、无触发）返回 `''`（不占 token）。
3. 长度 ≤ 120 字。
4. 风格：给行为，不给读数。例：`【此刻状态】有点炸，但别讲道理；句子短一点，先把事说清楚。`
5. 超过 12 小时没说话 → 追加一句孤独提示（一句话，不带数字）。

`pickTemperature(snap) -> number | null`

- cortisol ≥ 75 → 0.35
- cortisol ≥ 60 → 0.55
- dopamine ≥ 80 → 0.9
- 其余 → null（不覆盖宿主设置）

## 6. 落盘格式

`~/.dsh/deep-soul/affect.json`（原子写：临时名 + rename）

```json
{
  "version": 1,
  "updatedAt": 1730000000000,
  "chemicals": { "dopamine": 53.2, "cortisol": 18.4, "serotonin": 51.0 },
  "lastInteractionAt": 1730000000000,
  "lastStimulusAt": 1730000000000,
  "lastStimulusKind": "turn_done",
  "log": [ { "at": 1730000000000, "kind": "turn_done" } ]
}
```

log 上限 50 条。文件损坏/字段非法 → 静默回到出厂值，并把坏文件改名成 `affect.json.bad-<ts>`（只改一次，别覆盖）。
任何磁盘错误都必须吞掉（never throw），插件不能因为情绪写不进去而挂。

`~/.dsh/deep-soul/mood.json`（给 qq-bridge 读，字段与它现有 `mood` 完全一致）

```json
{ "label": "烦", "intensity": 0.55, "reason": "请求失败", "tone": "短句、反问，别解释", "updatedAt": 1730000000000, "source": "affect" }
```

## 7. 配置

`~/.dsh/deep-soul/affect.config.json`（不存在 = 全部默认开启）：

```json
{ "enabled": true, "directive": true, "temperature": true, "moodFile": true }
```

配置每次读取间隔 ≥ 5 秒才重新 stat（别每轮读盘）。

## 8. 引擎 API

```js
export class AffectEngine {
  constructor(opts = {})            // { dir?, genome?, now? }
  enabled: boolean
  tick(nowMs?)                      // 衰减 + 慢变量 + 落盘（惰性，可随时调）
  noteInteraction(nowMs?)           // 记录"有人在跟我说话"
  stim(kind, extra = {})            // 施加刺激；返回 snapshot
  render(nowMs?)                    // 行为指令文本（空串 = 不注入）
  temperature(nowMs?)               // number|null
  snapshot(nowMs?)                  // 见 §5
}
```

引擎所有公开方法 **不得抛异常**；内部错误打在 `console.log('[deep-soul] affect ...')`。

## 9. 测试要求

- `test/affect-core.test.mjs`：纯函数（衰减正确性/上下限/敏感度/慢变量/心情优先级/指令无数字/长度/温度阈值/损坏状态归一化）。
- `test/affect-integration.test.mjs`：用 mock ctx 调 `apply(ctx)`，模拟 pre-step / turn-stopping / request-error / agent/request，断言：section 文本变化、mood.json 落盘、temperature 被覆盖、重启后状态延续、磁盘不可写时不抛。
- 两者都是普通 `node xxx.mjs`，失败退出码非 0，成功打印 `✅`。
