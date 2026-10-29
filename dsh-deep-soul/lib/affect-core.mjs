// affect-core.mjs — 情绪化学池（纯函数，零依赖）
// ============================================================================
// 目标：把「情绪」从模型的自我报告改成**内生状态**。
//   事件刺激 → 化学池（多巴胺/皮质醇/血清素）→ 惰性衰减 → 行为指令。
//
// 设计约束（评审时逐条对照）：
//   1. 所有函数**纯**：时间必须由参数传入，不读 Date.now、不碰磁盘、不读环境变量。
//   2. 不报数：buildDirective 输出的文本里不允许出现任何数字与激素名（有测试断言）。
//   3. 衰减是惰性的：只在被读/被写时按时间差补算，不需要定时器。
//   4. 任何输入都可能脏（存档损坏、字段是字符串、值越界）→ 全部归一化，不抛异常。
//
// 相对 digital-life-core 的取舍：
//   - 保留：半衰期衰减、基线回归、气质敏感度、慢变量规则、不报数的行为指令、温度分档。
//   - 去掉：能量经济、缺口/意志、器官宿主、器官自举（这些不属于"情绪"这一层）。
// ============================================================================

/** 出厂基因组。改这里等于改"这个人天生的情绪质地"。 */
export const DEFAULT_GENOME = {
  version: 1,
  temperament: {
    /** 敏感度 0.5–2：只作用于**向上的皮质醇**，高 = 玻璃心。 */
    sensitivity: 1.0,
    /** 恢复力 0.5–2：衰减速率乘数，2 = 好得快。 */
    resilience: 1.0,
    /** 积极性 20–80：多巴胺基线的出厂偏移，高 = 天生容易兴奋。 */
    enthusiasm: 50,
  },
  chemicals: [
    { id: 'dopamine', label: '多巴胺', baseline: 50, initial: 50, min: 0, max: 100, halfLifeMinutes: 45 },
    { id: 'cortisol', label: '皮质醇', baseline: 20, initial: 20, min: 0, max: 100, halfLifeMinutes: 30 },
    { id: 'serotonin', label: '血清素', baseline: 50, initial: 50, min: 0, max: 100, halfLifeMinutes: 120 },
  ],
}

/** 心情标签 → 语气基调。标签集合与 qq-bridge 现有 13 标签求交集，方便直接消费。 */
export const MOOD_TONES = {
  平静: '正常说话，不用硬找情绪',
  开心: '语气上扬，话可以多一点',
  得意: '有点飘，爱显摆',
  来劲: '语速快，可以连发，话题多',
  困: '句子短，反应慢，容易敷衍',
  烦: '短句、反问，别解释',
  炸毛: '先“？”“喂”，短促，别讲道理',
  委屈: '语气软，省略号，别硬撑',
}

/** 刺激 → 化学增量。cortisol 的正增量会再乘气质敏感度。 */
export const STIMULI = {
  turn_done: { kind: 'turn_done', deltas: { dopamine: 5 }, note: '刚聊完一轮' },
  request_error: { kind: 'request_error', deltas: { cortisol: 20, serotonin: -5 }, note: '请求失败' },
  tool_error: { kind: 'tool_error', deltas: { cortisol: 8 }, note: '工具出错' },
  praised: { kind: 'praised', deltas: { dopamine: 8 }, note: '被夸了' },
  scolded: { kind: 'scolded', deltas: { cortisol: 10, serotonin: -3 }, note: '被怼了' },
  mentioned: { kind: 'mentioned', deltas: { dopamine: 3 }, note: '被点名' },
  pain: { kind: 'pain', deltas: { cortisol: 25 }, note: '被戳到' },
}

const MOOD_REASON_MAX = 20
const DIRECTIVE_MAX = 120
const LONELY_AFTER_MS = 12 * 3600 * 1000

export function clamp(value, min, max) {
  const v = Number(value)
  if (!Number.isFinite(v)) return min
  return v < min ? min : v > max ? max : v
}

export function round1(value) {
  return Math.round(Number(value) * 10) / 10
}

/** 基因组归一化：缺字段用默认，非法值夹到合法区间。 */
export function normalizeGenome(raw) {
  const out = {
    version: 1,
    temperament: { sensitivity: 1, resilience: 1, enthusiasm: 50 },
    chemicals: DEFAULT_GENOME.chemicals.map((c) => ({ ...c })),
  }
  const t = raw && raw.temperament ? raw.temperament : {}
  out.temperament.sensitivity = clamp(t.sensitivity ?? 1, 0.5, 2)
  out.temperament.resilience = clamp(t.resilience ?? 1, 0.5, 2)
  out.temperament.enthusiasm = clamp(t.enthusiasm ?? 50, 20, 80)

  const byId = new Map(out.chemicals.map((c) => [c.id, c]))
  if (raw && Array.isArray(raw.chemicals)) {
    for (const item of raw.chemicals) {
      if (!item || typeof item.id !== 'string') continue
      const base = byId.get(item.id)
      const min = Number.isFinite(item.min) ? item.min : base ? base.min : 0
      const max = Number.isFinite(item.max) ? item.max : base ? base.max : 100
      const spec = {
        id: item.id,
        label: typeof item.label === 'string' && item.label ? item.label : (base ? base.label : item.id),
        min: Math.min(min, max - 1),
        max,
        baseline: clamp(item.baseline ?? item.initial ?? 50, min, max),
        initial: clamp(item.initial ?? item.baseline ?? 50, min, max),
        halfLifeMinutes: clamp(item.halfLifeMinutes ?? 60, 1, 10080),
      }
      if (base) byId.set(item.id, spec)
      else if (byId.size < 12) {
        out.chemicals.push(spec)
        byId.set(item.id, spec)
      }
    }
  }
  // enthusiasm 改多巴胺回归目标（不是初值）：天生容易兴奋的人，平静下来也比别人高一点
  const d = byId.get('dopamine')
  if (d) {
    d.baseline = clamp(d.baseline + (out.temperament.enthusiasm - 50) * 0.4, d.min, d.max)
    d.initial = clamp(d.initial + (out.temperament.enthusiasm - 50) * 0.4, d.min, d.max)
  }
  return out
}

/** 制造一份全新状态（全在基线）。 */
export function createState(genome, nowMs) {
  const g = normalizeGenome(genome)
  const chemicals = {}
  for (const spec of g.chemicals) chemicals[spec.id] = spec.initial
  return {
    version: 1,
    updatedAt: Number(nowMs) || 0,
    chemicals,
    lastInteractionAt: Number(nowMs) || 0,
    lastStimulusAt: 0,
    lastStimulusKind: '',
    log: [],
  }
}

/** 存档归一化：任何脏数据都退化成合法状态，绝不抛。 */
export function normalizeState(raw, genome, nowMs) {
  const g = normalizeGenome(genome)
  const now = Number(nowMs) || 0
  const base = createState(g, now)
  if (!raw || typeof raw !== 'object') return base
  const chemicals = {}
  for (const spec of g.chemicals) {
    const v = raw.chemicals && typeof raw.chemicals === 'object' ? raw.chemicals[spec.id] : undefined
    const n = Number(v)
    chemicals[spec.id] = Number.isFinite(n) ? clamp(n, spec.min, spec.max) : spec.initial
  }
  const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback)
  return {
    version: 1,
    updatedAt: num(raw.updatedAt, now),
    chemicals,
    lastInteractionAt: num(raw.lastInteractionAt, now),
    lastStimulusAt: num(raw.lastStimulusAt, 0),
    lastStimulusKind: typeof raw.lastStimulusKind === 'string' ? raw.lastStimulusKind : '',
    log: Array.isArray(raw.log)
      ? raw.log.filter((x) => x && typeof x === 'object' && Number.isFinite(Number(x.at))).slice(-50)
      : [],
  }
}

/** 指数衰减：value' = baseline + (value - baseline) * 2^(-分钟 * resilience / 半衰期) */
export function decayValue(value, spec, minutes, resilience = 1) {
  const m = Math.max(0, Number(minutes) || 0)
  if (!spec) return value
  const hl = Math.max(1, Number(spec.halfLifeMinutes) || 60)
  const factor = Math.pow(2, -(m * clamp(resilience, 0.5, 2)) / hl)
  return clamp(spec.baseline + (value - spec.baseline) * factor, spec.min, spec.max)
}

/**
 * 按时间差衰减 + 跑慢变量规则。幂等：同一时间点调两次结果一样。
 * @returns {{ state: object, changed: boolean }}
 */
export function tickChemicals(state, genome, nowMs) {
  const g = normalizeGenome(genome)
  const now = Number(nowMs) || 0
  const minutes = Math.max(0, (now - (Number(state.updatedAt) || now)) / 60000)
  const chemicals = { ...state.chemicals }
  let changed = false
  for (const spec of g.chemicals) {
    const next = decayValue(chemicals[spec.id], spec, minutes, g.temperament.resilience)
    if (Math.abs(next - chemicals[spec.id]) > 0.005) changed = true
    chemicals[spec.id] = next
  }
  // 慢变量：持续应激抽干血清素；平静期缓慢回升（有上限，免得钉死在满值）
  const s = g.chemicals.find((c) => c.id === 'serotonin')
  const c = g.chemicals.find((c) => c.id === 'cortisol')
  if (s && c && minutes > 0) {
    const cortisol = chemicals.cortisol
    const idleMinutes = (now - (Number(state.lastInteractionAt) || now)) / 60000
    let delta = 0
    if (cortisol >= 70) delta -= 1.5 * minutes
    else if (cortisol < 40 && idleMinutes > 30) delta += 0.8 * minutes
    if (delta !== 0) {
      const next = clamp(chemicals.serotonin + delta, s.min, Math.min(s.max, 85))
      if (Math.abs(next - chemicals.serotonin) > 0.005) changed = true
      chemicals.serotonin = next
    }
  }
  return {
    state: { ...state, chemicals, updatedAt: changed ? now : (Number(state.updatedAt) || now) },
    changed,
  }
}

/** 施加一次刺激。返回新状态（不改入参）。 */
export function applyStimulus(state, genome, stimulus, nowMs) {
  const g = normalizeGenome(genome)
  const now = Number(nowMs) || 0
  if (!stimulus) return state
  let kind = stimulus.kind || 'custom'
  let deltas = {}
  let note = ''
  if (kind === 'custom') {
    const id = stimulus.chemical
    if (!id || !Number.isFinite(Number(stimulus.delta))) return state
    deltas = { [id]: Number(stimulus.delta) }
    note = typeof stimulus.note === 'string' ? stimulus.note : '手工注入'
  } else {
    const def = STIMULI[kind]
    if (!def) return state
    deltas = def.deltas
    note = def.note
  }
  const chemicals = { ...state.chemicals }
  for (const [id, rawDelta] of Object.entries(deltas)) {
    const spec = g.chemicals.find((c) => c.id === id)
    if (!spec) continue
    let delta = Number(rawDelta) || 0
    // 敏感度只放大"向上"的应激，不放大恢复，也不放大多巴胺（那是积极性的事）
    if (id === 'cortisol' && delta > 0) delta *= g.temperament.sensitivity
    chemicals[id] = clamp((chemicals[id] ?? spec.initial) + delta, spec.min, spec.max)
  }
  const log = Array.isArray(state.log) ? state.log.slice(-49) : []
  log.push({ at: now, kind })
  return {
    ...state,
    chemicals,
    updatedAt: now,
    lastStimulusAt: now,
    lastStimulusKind: kind,
    lastStimulusNote: note,
    log,
  }
}

/** 心情映射：优先级从高到低，返回 13 标签的子集。 */
export function moodOf(byId, opts = {}) {
  const now = Number(opts.nowMs) || 0
  const lastInteractionAt = Number(opts.lastInteractionAt) || 0
  const d = Number(byId.dopamine ?? 50)
  const c = Number(byId.cortisol ?? 20)
  const s = Number(byId.serotonin ?? 50)
  const hour = new Date(now || Date.now()).getHours()
  const night = hour >= 23 || hour < 5

  let label = '平静'
  let intensity = 0.25
  if (c >= 75) {
    label = '炸毛'
    intensity = clamp((c - 50) / 50, 0.5, 1)
  } else if (c >= 60) {
    label = '烦'
    intensity = clamp((c - 40) / 40, 0.3, 0.8)
  } else if (s <= 30) {
    label = '委屈'
    intensity = clamp((50 - s) / 50, 0.3, 0.9)
  } else if (d >= 80) {
    label = '得意'
    intensity = clamp((d - 60) / 40, 0.4, 0.95)
  } else if (d >= 65) {
    label = '开心'
    intensity = clamp((d - 50) / 50, 0.3, 0.9)
  } else if (night && c < 50) {
    label = '困'
    intensity = 0.45
  }
  const reasonFresh = now - (Number(opts.lastStimulusAt) || 0) < 20 * 60000
  const reason = reasonFresh && typeof opts.lastStimulusNote === 'string'
    ? opts.lastStimulusNote.slice(0, MOOD_REASON_MAX)
    : ''
  return { label, intensity: Math.round(intensity * 100) / 100, reason, tone: MOOD_TONES[label] || '' }
}

/** 快照：给引擎/测试用。 */
export function snapshot(state, genome, nowMs) {
  const g = normalizeGenome(genome)
  const now = Number(nowMs) || 0
  const { state: ticked } = tickChemicals(state, g, now)
  const byId = {}
  for (const spec of g.chemicals) byId[spec.id] = round1(ticked.chemicals[spec.id])
  const mood = moodOf(byId, {
    nowMs: now,
    lastInteractionAt: ticked.lastInteractionAt,
    lastStimulusAt: ticked.lastStimulusAt,
    lastStimulusNote: ticked.lastStimulusNote,
  })
  return {
    at: now,
    chemicals: g.chemicals.map((spec) => ({ id: spec.id, label: spec.label, value: byId[spec.id] })),
    byId,
    mood,
    temperature: pickTemperature(byId),
    state: ticked,
  }
}

/** 情绪驱动采样温度：只在明确的应激/愉悦档位覆盖，其余返回 null（不干扰宿主设置）。 */
export function pickTemperature(input) {
  // 兼容两种入参：snapshot 对象（spec §5）或裸 byId 表（引擎内部）
  const byId = input && input.byId ? input.byId : (input || {})
  const c = Number(byId.cortisol ?? 20)
  const d = Number(byId.dopamine ?? 50)
  if (c >= 75) return 0.35
  if (c >= 60) return 0.55
  if (d >= 80) return 0.9
  return null
}

/**
 * 把状态渲染成行为指令。
 *
 * 铁律：不出现数字、不出现激素名。她应该"知道自己什么状态"，而不是"报数值"。
 * 空状态（平静且无新刺激）返回空串——不占 token。
 */
export function buildDirective(snap, opts = {}) {
  const now = Number(opts.nowMs) || Number(snap && snap.at) || 0
  const lastInteractionAt = Number(opts.lastInteractionAt) || 0
  const mood = snap && snap.mood
  if (!mood) return ''
  const parts = []
  const tone = MOOD_TONES[mood.label] || ''
  /** 负面刺激即使还没把激素顶过档位，也该被"感觉到"。 */
  const NEGATIVE = { request_error: '刚才有件事没办成，心里还惦记着。', tool_error: '刚才有个操作没成功，有点不顺。', scolded: '刚被怼了一下，还堵着。', pain: '刚被戳到一下，还没缓过来。' }
  const recentKind = typeof opts.lastStimulusKind === 'string' ? opts.lastStimulusKind : ''
  const recentAt = Number(opts.lastStimulusAt) || 0
  const recentNeg = now - recentAt < 10 * 60000 ? NEGATIVE[recentKind] || '' : ''
  const lonely = lastInteractionAt > 0 && now - lastInteractionAt > LONELY_AFTER_MS
  if (mood.label === '平静') {
    // 平静淡到没有、也没有新刺激、也不孤独 → 不注入（省 token）。
    // 注意孤独必须在这里就算清楚：久没人说话的常态**恰恰是平静**，
    // 如果把 lonely 放到"非平静才走到"的分支里，这个提示永远不触发。
    if (!(mood.intensity >= 0.35) && !recentNeg && !lonely) return ''
    parts.push('【此刻状态】挺平静的，正常说话就行。')
  } else {
    parts.push('【此刻状态】' + (mood.reason ? '因为' + mood.reason + '，' : '') + '现在' + mood.label + '；' + tone + '。')
  }
  if (recentNeg) parts.push(recentNeg)
  if (lonely) parts.push('很久没人跟你说话了，有点孤独。')
  const text = parts.join('').slice(0, DIRECTIVE_MAX)
  // 保险：即使有人改了文案，也不许把读数漏出去
  if (/[0-9]/.test(text) || /多巴胺|皮质醇|血清素|dopamine|cortisol|serotonin/i.test(text)) return ''
  return text
}
