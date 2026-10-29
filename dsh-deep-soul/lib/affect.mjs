// affect.mjs — 情绪引擎（IO + 生命周期）
// ============================================================================
// 职责：把 affect-core 的纯函数接到磁盘与进程上。
//   - 状态：<DSH_HOME>/deep-soul/affect.json（原子写，损坏自愈）
//   - 导出：<DSH_HOME>/deep-soul/mood.json（给 qq-bridge 读，字段与它的 mood 一致）
//   - 配置：<DSH_HOME>/deep-soul/affect.config.json（不存在 = 全开）
//
// 硬约束：所有公开方法 never throw。情绪写不进去最多是"没有情绪"，
// 绝不能因此让 DSH 起不来或让一轮对话挂掉。
// ============================================================================

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  DEFAULT_GENOME,
  buildDirective,
  createState,
  normalizeGenome,
  normalizeState,
  pickTemperature,
  applyStimulus,
  snapshot as coreSnapshot,
  tickChemicals,
} from './affect-core.mjs'

const CONFIG_TTL_MS = 5000
const PERSIST_MIN_MS = 2000

function dataRoot() {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'deep-soul')
}

function num(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

export class AffectEngine {
  /**
   * @param {{ dir?: string, genome?: object, now?: number, log?: (msg: string) => void }} opts
   */
  constructor(opts = {}) {
    this.dir = opts.dir || dataRoot()
    this.statePath = join(this.dir, 'affect.json')
    this.moodPath = join(this.dir, 'mood.json')
    this.historyPath = join(this.dir, 'affect-history.jsonl')
    this._lastHistoryAt = 0
    this.configPath = join(this.dir, 'affect.config.json')
    this.genome = normalizeGenome(opts.genome || DEFAULT_GENOME)
    this._log = typeof opts.log === 'function' ? opts.log : null
    this._configCache = null
    this._configAt = 0
    this._lastPersist = 0
    this.enabled = true
    const now = num(opts.now, Date.now())
    this.state = this._load(now)
    this._log && this._log('affect ready; state = ' + this.statePath)
  }

  _warn(msg) {
    try { this._log ? this._log('affect ' + msg) : console.log('[deep-soul] affect ' + msg) } catch {}
  }

  // ── 配置 ────────────────────────────────────────────────────────
  config() {
    const now = Date.now()
    if (this._configCache && now - this._configAt < CONFIG_TTL_MS) return this._configCache
    const out = { enabled: true, directive: true, temperature: true, moodFile: true }
    try {
      const raw = JSON.parse(readFileSync(this.configPath, 'utf8'))
      if (raw && typeof raw === 'object') {
        for (const key of Object.keys(out)) {
          if (typeof raw[key] === 'boolean') out[key] = raw[key]
        }
      }
    } catch { /* 不存在/坏掉 → 默认全开 */ }
    this._configCache = out
    this._configAt = now
    this.enabled = out.enabled !== false
    return out
  }

  // ── 状态读写 ────────────────────────────────────────────────────
  _load(now) {
    let raw = null
    let corrupt = false
    try {
      raw = JSON.parse(readFileSync(this.statePath, 'utf8'))
      if (!raw || typeof raw !== 'object') corrupt = true
    } catch (e) {
      const code = e && e.code
      if (code === 'ENOENT') {
        raw = null
      } else {
        // 坏档（JSON 语法错 / 读不出）：改名留证 + 回到出厂，不留一个会被下一次 tick 覆盖的现场
        corrupt = true
        this._warn('state unreadable (' + (code || 'parse') + '), reset to defaults')
      }
    }
    if (corrupt) {
      try { renameSync(this.statePath, this.statePath + '.bad-' + Date.now()) } catch {}
      raw = null
    }
    if (!raw) return createState(this.genome, now)
    try {
      return normalizeState(raw, this.genome, now)
    } catch {
      return createState(this.genome, now)
    }
  }

  _persist(force = false) {
    const now = Date.now()
    if (!force && now - this._lastPersist < PERSIST_MIN_MS) return
    this._lastPersist = now
    try {
      mkdirSync(this.dir, { recursive: true })
      const tmp = this.statePath + '.' + process.pid + '.tmp'
      writeFileSync(tmp, JSON.stringify(this.state, null, 2))
      renameSync(tmp, this.statePath)
    } catch (e) {
      this._warn('persist failed: ' + String((e && e.message) || e))
    }
  }

  /**
   * 历史采样：每分钟最多一行，落 affect-history.jsonl（给面板画曲线用）。
   * 只是展示数据，写不进去就跳过——不能因为"画图的日志"影响情绪本身。
   */
  _appendHistory(snap) {
    try {
      const now = Number(snap.at) || Date.now()
      if (now - this._lastHistoryAt < 20000) return
      this._lastHistoryAt = now
      mkdirSync(this.dir, { recursive: true })
      const point = {
        at: now,
        dopamine: Math.round((snap.byId.dopamine ?? 0) * 10) / 10,
        cortisol: Math.round((snap.byId.cortisol ?? 0) * 10) / 10,
        serotonin: Math.round((snap.byId.serotonin ?? 0) * 10) / 10,
        mood: snap.mood?.label || '',
        temp: snap.temperature ?? null,
      }
      let lines = []
      try {
        const raw = readFileSync(this.historyPath, 'utf8')
        lines = raw.split('\n').filter(Boolean)
      } catch { lines = [] }
      lines.push(JSON.stringify(point))
      // 12 小时 × 1 行/分钟 = 720；超过 1440 行就重写成最后 720 行，文件不会无限长
      if (lines.length > 1440) lines = lines.slice(-720)
      const tmp = this.historyPath + '.' + process.pid + '.tmp'
      writeFileSync(tmp, lines.join('\n') + '\n')
      renameSync(tmp, this.historyPath)
    } catch (e) {
      this._warn('history append failed: ' + String((e && e.message) || e))
    }
  }

  /** 读最近 n 个历史点（按时间正序）。坏行直接跳过。 */
  history(n = 240) {
    const limit = Math.max(1, Math.min(1440, Number(n) || 240))
    try {
      const raw = readFileSync(this.historyPath, 'utf8')
      const points = []
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue
        try {
          const p = JSON.parse(line)
          if (p && Number.isFinite(Number(p.at))) points.push(p)
        } catch { /* 跳过坏行 */ }
      }
      return points.slice(-limit)
    } catch {
      return []
    }
  }

  _writeMood(snap) {
    if (!this.config().moodFile) return
    try {
      mkdirSync(this.dir, { recursive: true })
      const payload = {
        label: snap.mood.label,
        intensity: snap.mood.intensity,
        reason: snap.mood.reason,
        tone: snap.mood.tone,
        updatedAt: snap.at || Date.now(),
        source: 'affect',
      }
      const tmp = this.moodPath + '.' + process.pid + '.tmp'
      writeFileSync(tmp, JSON.stringify(payload))
      renameSync(tmp, this.moodPath)
    } catch (e) {
      this._warn('mood write failed: ' + String((e && e.message) || e))
    }
  }

  // ── 生命周期 ────────────────────────────────────────────────────
  /** 衰减 + 慢变量 + 触发时的落盘。可随时调；同一时刻重复调是幂等的。 */
  tick(nowMs) {
    try {
      const now = num(nowMs, Date.now())
      if (!this.config().enabled) return this.snapshot(now)
      const { state, changed } = tickChemicals(this.state, this.genome, now)
      this.state = state
      if (changed) this._persist()
      const snap = coreSnapshot(this.state, this.genome, now)
      this.state = snap.state
      this._writeMood(snap)
      this._appendHistory(snap)
      return snap
    } catch (e) {
      this._warn('tick failed: ' + String((e && e.message) || e))
      return this._safeSnapshot()
    }
  }

  /** 有人跟我说话：刷新交互时间（孤独计时的锚）。 */
  noteInteraction(nowMs) {
    try {
      const now = num(nowMs, Date.now())
      this.state = { ...this.state, lastInteractionAt: now }
      this._persist()
    } catch (e) {
      this._warn('noteInteraction failed: ' + String((e && e.message) || e))
    }
  }

  /**
   * 归位到出厂基线（"哄好了"/测试收尾）。
   * 只允许主人或外部显式调用，不挂任何自动触发——
   * 情绪如果能自己清零，"难受"就没有意义了。
   */
  reset(nowMs) {
    try {
      const now = num(nowMs, Date.now())
      this.state = createState(this.genome, now)
      this._persist(true)
      const snap = coreSnapshot(this.state, this.genome, now)
      this.state = snap.state
      this._writeMood(snap)
      return snap
    } catch (e) {
      this._warn('reset failed: ' + String((e && e.message) || e))
      return this._safeSnapshot()
    }
  }

  /** 施加一次刺激；返回快照。 */
  stim(kind, extra = {}) {
    try {
      const now = num(extra.nowMs, Date.now())
      // 同一次失败会被多层钩子看到（工具层 + 请求层）：800ms 内的重复上报合并成一次。
      if (kind === 'tool_error') {
        if (now - (this._lastToolErrorAt || 0) < 800) return this.snapshot(now)
        this._lastToolErrorAt = now
      }
      if (!this.config().enabled) return this.snapshot(now)
      this.state = applyStimulus(this.state, this.genome, { ...extra, kind }, now)
      this.state = tickChemicals(this.state, this.genome, now).state
      this._persist(true)
      const snap = coreSnapshot(this.state, this.genome, now)
      this.state = snap.state
      this._writeMood(snap)
      this._appendHistory(snap)
      return snap
    } catch (e) {
      this._warn('stim failed: ' + String((e && e.message) || e))
      return this._safeSnapshot()
    }
  }

  /** 行为指令文本；空串 = 不注入。 */
  render(nowMs) {
    try {
      const cfg = this.config()
      if (!cfg.enabled || !cfg.directive) return ''
      const snap = this.tick(nowMs)
      return buildDirective(snap, {
        nowMs: snap.at,
        lastInteractionAt: this.state.lastInteractionAt,
        lastStimulusKind: this.state.lastStimulusKind,
        lastStimulusAt: this.state.lastStimulusAt,
      })
    } catch {
      return ''
    }
  }

  /** 采样温度；null = 不覆盖。 */
  temperature(nowMs) {
    try {
      const cfg = this.config()
      if (!cfg.enabled || !cfg.temperature) return null
      const snap = this.tick(nowMs)
      return pickTemperature(snap.byId)
    } catch {
      return null
    }
  }

  snapshot(nowMs) {
    try {
      const now = num(nowMs, Date.now())
      const snap = coreSnapshot(this.state, this.genome, now)
      this.state = snap.state
      return snap
    } catch {
      return this._safeSnapshot()
    }
  }

  _safeSnapshot() {
    const now = Date.now()
    return {
      at: now,
      chemicals: this.genome.chemicals.map((c) => ({ id: c.id, label: c.label, value: c.baseline })),
      byId: Object.fromEntries(this.genome.chemicals.map((c) => [c.id, c.baseline])),
      mood: { label: '平静', intensity: 0.25, reason: '', tone: '' },
      temperature: null,
      state: this.state,
    }
  }
}

export default AffectEngine
