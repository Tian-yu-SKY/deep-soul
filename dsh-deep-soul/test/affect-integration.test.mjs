// affect-integration.test.mjs — 用 mock ctx 调 apply(ctx)，验证钩子接线与落盘
//
// 运行：node test/affect-integration.test.mjs
// 约束：零外部依赖 / 不联网 / DSH_HOME 指向 mkdtemp 临时目录 / 不碰真实 ~/.dsh
//
// 契约来源：docs/affect-spec.md §0（index.js 接线）与 §6（affect.json / mood.json）
// 覆盖：agent/pre-step、agent/turn-stopping、agent/request-error、agent/request、
//       systemPrompt section 文本变化、mood.json、temperature、重启延续、磁盘不可写不抛。
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const HOME = mkdtempSync(join(tmpdir(), 'affect-it-home-'))
const DS_DIR = join(HOME, 'deep-soul')
// 必须在 import index.js 之前设置：index.js 的 DATA_DIR 在模块顶层求值
process.env.DSH_HOME = HOME

let pass = 0
const fails = []
async function t(name, fn) {
  try { await fn(); pass += 1; console.log('ok   ' + name) }
  catch (e) { fails.push(name + ' :: ' + String((e && e.message) || e).split('\n')[0]); console.log('FAIL ' + name) }
}

let apply = null
let importErr = null
try { apply = (await import(new URL('../lib/index.js', import.meta.url).href)).apply } catch (e) { importErr = e }
const needApply = () => {
  if (typeof apply !== 'function') throw new Error('../lib/index.js 无法导入或未导出 apply' + (importErr ? '（' + importErr.message + '）' : ''))
  return apply
}

// ── mock ctx：只实现 index.js 用到的宿主面，不真的起 Node 定时器 ──
function makeCtx() {
  const tools = new Map()
  const handlers = new Map()
  const sections = new Map()
  const effects = []
  const timers = []
  const ctx = {
    tools: {
      register: (tool) => { tools.set(tool.name, tool); return () => tools.delete(tool.name) },
    },
    on: (event, handler) => {
      if (!handlers.has(event)) handlers.set(event, [])
      handlers.get(event).push(handler)
    },
    effect: (fn) => {
      try {
        const d = fn()
        if (typeof d === 'function') effects.push(d)
        return d
      } catch { return undefined }
    },
    interval: (cb, ms) => { timers.push({ cb, ms }); return () => {} },
    get: (key) => {
      if (key === 'systemPrompt') return ctx.systemPrompt
      if (key === 'agents') return ctx.agents
      if (key === 'timer') return { interval: ctx.interval }
      if (key === 'tools') return ctx.tools
      return undefined // webServer 故意不给：走「等待挂载」分支，但 effect 能清理定时器
    },
    systemPrompt: {
      section: (def) => { sections.set('section:' + def.name, def); return () => sections.delete('section:' + def.name) },
      context: (def) => { sections.set('context:' + def.name, def); return () => sections.delete('context:' + def.name) },
    },
    agents: { list: () => [] },
  }
  const api = {
    ctx, tools, handlers, sections, effects, timers,
    async fire(event, ...args) {
      const hs = handlers.get(event) || []
      let out
      for (const h of hs) out = await h(...args)
      return out
    },
    /** 收集当前所有 systemPrompt 段落文本（名字 → 文本），text 可带 component 参数。 */
    texts() {
      const out = {}
      for (const [key, def] of sections) {
        try {
          const raw = typeof def.text === 'function' ? def.text({}) : def.text
          out[key] = raw == null ? '' : String(raw)
        } catch { out[key] = '' }
      }
      return out
    },
    dispose() {
      for (const d of effects.splice(0)) { try { d() } catch {} }
    },
  }
  return api
}

const firePreStep = (m) => m.fire('agent/pre-step', { turn: 1, step: 1, messages: [{ role: 'user' }] }, async () => ({ kind: 'enter' }))
const fireTurnEnd = (m) => m.fire('agent/turn-stopping', { turn: 1, step: 1 })
const fireError = (m) => m.fire('agent/request-error', {
  turn: 1, step: 1,
  error: new Error('request failed'),
  failure: { kind: 'provider', message: 'request failed' },
}, async () => undefined)
const fireToolError = (m) => m.fire('tools/post-execute', { name: 'bash', arguments: {} }, { isError: true, content: [] }, async () => ({ kind: 'accept' }))
const fireRequest = async (m) => {
  const input = { provider: 'p', model: 'm', temperature: 1 }
  let seen = null
  // 宿主语义：next() 不带参数、返回本次请求；中间件返回改写后的请求。
  const out = await m.fire('agent/request', input, async () => { seen = true; return { ...input } })
  return (out && typeof out === 'object' ? out : { ...input }) || {}
}
// 指令段落：lead 约定的名字是 deep-soul-affect；找不到就退回"名字里含 affect"的那一段
const findAffectKey = (m) => {
  const keys = [...m.sections.keys()]
  return keys.find((k) => k.endsWith('deep-soul-affect')) || keys.find((k) => k.toLowerCase().includes('affect')) || null
}

// 找出「被 affect 改变的」systemPrompt 段落：对比两次快照里文本不同的项。
function changedTexts(before, after) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const rows = []
  for (const k of keys) {
    const b = before[k] || ''
    const a = after[k] || ''
    if (a !== b) rows.push({ key: k, text: a, before: b })
  }
  return rows
}

const readMood = () => {
  const p = join(DS_DIR, 'mood.json')
  assert.ok(existsSync(p), 'mood.json 不存在：' + p + '（现有：' + (existsSync(DS_DIR) ? readdirSafe(DS_DIR) : '目录不存在') + '）')
  return JSON.parse(readFileSync(p, 'utf8'))
}
const readState = () => {
  const p = join(DS_DIR, 'affect.json')
  assert.ok(existsSync(p), 'affect.json 不存在：' + p)
  return JSON.parse(readFileSync(p, 'utf8'))
}
const readdirSafe = (d) => { try { return readdirSync(d).join(',') } catch { return '?' } }

const cleanups = []
async function withPlugin(fn) {
  const m = makeCtx()
  cleanups.push(() => m.dispose())
  needApply()(m.ctx)
  return await fn(m)
}

// ═══ 1. 接线：apply 不抛，钩子/段落注册齐全 ═══════════════════════
let baselineTexts = null
let baselineTools = null
await t('apply(ctx)：不抛异常，注册 agent 钩子与 systemPrompt 段落', async () => {
  await withPlugin(async (m) => {
    assert.ok((m.handlers.get('agent/pre-step') || []).length > 0, '应监听 agent/pre-step')
    assert.ok((m.handlers.get('agent/turn-stopping') || []).length > 0, '应监听 agent/turn-stopping')
    assert.ok((m.handlers.get('agent/request-error') || []).length > 0, '应监听 agent/request-error')
    assert.ok((m.handlers.get('agent/request') || []).length > 0, '应监听 agent/request')
    assert.ok(m.sections.size > 0, '应注册 systemPrompt.section/context')
    assert.ok(m.tools.size > 0, '原有工具仍应注册（apply 未提前 abort）')
    baselineTools = [...m.tools.keys()]
    await firePreStep(m)
    baselineTexts = m.texts()
  })
})

// ═══ 2. 平静态：无 affect 行为指令，温度不覆盖 ═══════════════════
await t('平静态：affect 指令为空串，agent/request 温度保持宿主值', async () => {
  await withPlugin(async (m) => {
    await firePreStep(m)
    const key = findAffectKey(m)
    assert.ok(key, '未注册 affect 指令段落（systemPrompt.context 名字应含 deep-soul-affect）')
    assert.equal(m.texts()[key], '', '平静态 affect 段落应为空串（不占 token），实际：' + JSON.stringify(m.texts()[key]))
    const req = await fireRequest(m)
    assert.equal(req.temperature, 1, '平静态不应改温度，实际 ' + req.temperature)
  })
})

// ═══ 2.5 工具失败：tools/post-execute(isError) → 皮质醇 +8 ═══════
await t('tools/post-execute：result.isError=true → affect.json 皮质醇 +8 左右', async () => {
  await withPlugin(async (m) => {
    await firePreStep(m)
    const before = readState()
    await fireToolError(m)
    await firePreStep(m)
    const after = readState()
    const delta = after.chemicals.cortisol - before.chemicals.cortisol
    assert.ok(delta > 4 && delta < 12, 'tool_error 应 +8 左右，实际 +' + delta.toFixed(2))
    assert.equal(after.lastStimulusKind, 'tool_error', '应记下 tool_error')
  })
})

// ═══ 3. 压力态：request-error ×4 → 指令出现、mood.json 落盘、温度 0.35 ══
let stressedMood = null
await t('压力态：连续请求失败 → 注入行为指令（无数字/无激素名/≤120）', async () => {
  await withPlugin(async (m) => {
    await firePreStep(m)
    const before = m.texts()
    for (let i = 0; i < 4; i += 1) await fireError(m)
    await firePreStep(m)
    const after = m.texts()
    const key = findAffectKey(m)
    assert.ok(key, '未注册 affect 指令段落')
    assert.ok(after[key] && after[key].trim() !== '', '压力态 affect 段落应非空，实际：' + JSON.stringify(after[key]))
    const changed = changedTexts(before, after).filter((r) => r.text.trim() !== '')
    const clean = changed.filter((r) => !/[0-9]/.test(r.text) && !/多巴胺|皮质醇|血清素/.test(r.text))
    assert.ok(clean.length > 0, '应有一段符合行为指令硬约束，实际变化：' + JSON.stringify(changed.map((r) => r.key + '=' + r.text)))
    for (const r of clean) {
      assert.ok(Array.from(r.text).length <= 120, r.key + ' 指令 ≤120 字，实际 ' + Array.from(r.text).length)
    }
  })
})

await t('压力态：mood.json 落盘（label 炸毛 / source=affect / 字段齐全）', async () => {
  await withPlugin(async (m) => {
    for (let i = 0; i < 4; i += 1) await fireError(m)
    await firePreStep(m)
    stressedMood = readMood()
    assert.equal(stressedMood.label, '炸毛', '连续请求失败 → 炸毛，实际 ' + stressedMood.label)
    assert.equal(stressedMood.source, 'affect')
    assert.equal(typeof stressedMood.intensity, 'number')
    assert.ok(stressedMood.intensity >= 0 && stressedMood.intensity <= 1)
    assert.equal(typeof stressedMood.reason, 'string')
    assert.ok(Array.from(stressedMood.reason).length <= 20, 'reason ≤20 字，实际 ' + stressedMood.reason)
    assert.equal(typeof stressedMood.tone, 'string')
    assert.ok(stressedMood.tone.length > 0)
    assert.equal(typeof stressedMood.updatedAt, 'number')
  })
})

await t('压力态：agent/request 把 temperature 覆盖成 0.35', async () => {
  await withPlugin(async (m) => {
    for (let i = 0; i < 4; i += 1) await fireError(m)
    await firePreStep(m)
    const req = await fireRequest(m)
    assert.equal(req.temperature, 0.35, '高压应覆盖为 0.35，实际 ' + req.temperature)
    assert.equal(req.model, 'm', '其余字段应保留')
  })
})

// ═══ 4. turn-stopping：一轮完成 → 多巴胺 +5 落盘 ═════════════════
await t('turn-stopping：正常完成一轮 → affect.json 多巴胺 +5 左右', async () => {
  await withPlugin(async (m) => {
    await firePreStep(m)
    const before = readState()
    await fireTurnEnd(m)
    await firePreStep(m)
    const after = readState()
    const delta = after.chemicals.dopamine - before.chemicals.dopamine
    assert.ok(delta > 2.5 && delta < 7.5, 'dopamine 应 +5 左右，实际 +' + delta.toFixed(2))
    assert.equal(after.lastStimulusKind, 'turn_done', '应记下 turn_done')
  })
})

// ═══ 5. 重启延续：手写 affect.json → 新 apply 读到并生效 ═════════
await t('重启延续：预置高多巴胺状态 → 新实例 temperature=0.9、mood=得意', async () => {
  mkdirSync(DS_DIR, { recursive: true })
  const t0 = Date.now()
  writeFileSync(join(DS_DIR, 'affect.json'), JSON.stringify({
    version: 1,
    updatedAt: t0,
    chemicals: { dopamine: 88, cortisol: 25, serotonin: 50 },
    lastInteractionAt: t0,
    lastStimulusAt: t0,
    lastStimulusKind: 'praised',
    log: [{ at: t0, kind: 'praised' }],
  }, null, 2))
  await withPlugin(async (m) => {
    await firePreStep(m)
    const req = await fireRequest(m)
    assert.equal(req.temperature, 0.9, '多巴胺 88 → 0.9，实际 ' + req.temperature)
    const mood = readMood()
    assert.equal(mood.label, '得意', 'mood.json 应被重启后的引擎刷新为得意，实际 ' + mood.label)
  })
})

// ═══ 6. 磁盘不可写：apply 与所有钩子都不抛 ═══════════════════════
await t('磁盘不可写：deep-soul 目录被普通文件占位时 apply/钩子都不抛', async () => {
  const backup = DS_DIR + '.bak'
  try {
    if (existsSync(DS_DIR)) renameSync(DS_DIR, backup)
    writeFileSync(DS_DIR, 'not a directory') // 让 mkdir/写入全部失败
    let applyThrew = null
    const m = makeCtx()
    cleanups.push(() => m.dispose())
    try { needApply()(m.ctx) } catch (e) { applyThrew = e }
    assert.equal(applyThrew, null, 'apply 不应抛：' + (applyThrew && applyThrew.message))
    await firePreStep(m)
    await fireError(m)
    await fireTurnEnd(m)
    await fireRequest(m)
    assert.ok(true)
  } finally {
    if (existsSync(DS_DIR)) rmSync(DS_DIR, { force: true })
    if (existsSync(backup)) renameSync(backup, DS_DIR)
  }
})

// ── 收尾 ───────────────────────────────────────────────────────
for (const d of cleanups) { try { d() } catch {} }
try { rmSync(HOME, { recursive: true, force: true }) } catch {}

console.log('')
if (fails.length) {
  console.log('❌ affect-integration: ' + pass + ' 通过 / ' + fails.length + ' 失败')
  for (const f of fails) console.log('  - ' + f)
  process.exitCode = 1
} else {
  console.log('✅ affect-integration: ' + pass + ' 通过 / 0 失败')
}
// 保险：即使 sidecar 子进程/宿主的真实 setInterval 没被清掉，也不挂住测试进程
setTimeout(() => process.exit(process.exitCode || 0), 800)
