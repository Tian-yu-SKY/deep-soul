// affect-core.test.mjs — affect 纯函数 + 状态机数学契约测试
//
// 运行：node test/affect-core.test.mjs
// 约束：零外部依赖 / 不联网 / 全部状态落在 mkdtempSync 临时目录 / 不碰真实 ~/.dsh
//
// 契约来源：docs/affect-spec.md（本文件只按 spec 断言，不读实现源码）
// 覆盖面：基因组默认值、衰减数学、clamp、sensitivity、慢变量规则、心情优先级、
//        行为指令硬约束（无数字/无激素名/≤120/空状态为空串/12h 孤独）、温度阈值、
//        损坏状态归一化、never throw、mood.json 落盘格式、log 上限、config 关闭。
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, chmodSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const LIB = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib')
const ROOT = mkdtempSync(join(tmpdir(), 'affect-core-'))
const NOW = Date.UTC(2026, 0, 15, 12, 0, 0)
let pass = 0
const fails = []
async function t(name, fn) {
  try { await fn(); pass += 1; console.log('ok   ' + name) }
  catch (e) { fails.push(name + ' :: ' + String((e && e.message) || e).split('\n')[0]); console.log('FAIL ' + name) }
}

let core = null
let coreErr = null
try { core = await import(pathToFileURL(join(LIB, 'affect-core.mjs')).href) } catch (e) { coreErr = e }
let engineMod = null
let engineErr = null
try { engineMod = await import(pathToFileURL(join(LIB, 'affect.mjs')).href) } catch (e) { engineErr = e }

const needCore = () => {
  if (!core) throw new Error('lib/affect-core.mjs 不存在或导入失败' + (coreErr ? '（' + coreErr.message + '）' : ''))
  return core
}
const EngineCtor = () => {
  if (!engineMod) throw new Error('lib/affect.mjs 不存在或导入失败' + (engineErr ? '（' + engineErr.message + '）' : ''))
  const C = engineMod.AffectEngine || (engineMod.default && engineMod.default.AffectEngine) || engineMod.default
  if (typeof C !== 'function') throw new Error('lib/affect.mjs 未导出 AffectEngine')
  return C
}

// §6 落盘格式即状态契约；snapshot(state, genome, nowMs) 按它构造。
function mkState(over = {}) {
  const chemicals = { dopamine: 50, cortisol: 20, serotonin: 50, ...(over.chemicals || {}) }
  const at = Number(over.updatedAt) || NOW
  return {
    version: 1,
    updatedAt: at,
    chemicals,
    lastInteractionAt: at,
    lastStimulusAt: at,
    lastStimulusKind: 'turn_done',
    log: [],
    ...over,
    chemicals,
  }
}
// 状态里的 updatedAt/lastInteractionAt 必须与 nowMs 对齐，否则 snapshot 会先补算衰减
const snapOf = (chemicals, nowMs = NOW) => needCore().snapshot(
  mkState({ chemicals, updatedAt: nowMs, lastInteractionAt: nowMs, lastStimulusAt: nowMs }),
  core.DEFAULT_GENOME,
  nowMs,
)
const snapNear = (byId) => ({
  at: NOW,
  byId: { dopamine: 50, cortisol: 20, serotonin: 50, ...byId },
  chemicals: Object.entries({ dopamine: 50, cortisol: 20, serotonin: 50, ...byId })
    .map(([id, value]) => ({ id, value })),
  mood: { label: '平静', intensity: 0.2, reason: '', tone: '' },
  temperature: null,
})

let seq = 0
function mkEngine({ genome = null, file = null, config = null, dir = null } = {}) {
  const C = EngineCtor()
  const d = dir || join(ROOT, 'e' + (++seq))
  mkdirSync(d, { recursive: true })
  if (file !== null) writeFileSync(join(d, 'affect.json'), file)
  if (config !== null) writeFileSync(join(d, 'affect.config.json'), JSON.stringify(config))
  const clock = { t: NOW }
  const opts = { dir: d, now: NOW, log: () => {} }
  if (genome) opts.genome = genome
  const e = new C(opts)
  return { e, clock, dir: d }
}
const num = (x) => (typeof x === 'number' ? x : Number(x))
const close = (a, b, eps, msg) => assert.ok(Math.abs(num(a) - b) <= eps, (msg || '') + ' 预期 ' + b + ' ±' + eps + '，实际 ' + a)

// ═══ 1. 基因组 ═══════════════════════════════════════════════════
await t('基因组：三项激素 id/基线/半衰期与 spec 一致', () => {
  const g = needCore().DEFAULT_GENOME
  assert.equal(g.version, 1, 'version')
  assert.equal(g.temperament.sensitivity, 1.0, 'sensitivity 默认 1.0')
  assert.equal(g.temperament.resilience, 1.0, 'resilience 默认 1.0')
  assert.equal(g.temperament.enthusiasm, 50, 'enthusiasm 默认 50')
  const ids = g.chemicals.map((c) => c.id)
  assert.deepEqual(ids, ['dopamine', 'cortisol', 'serotonin'])
  const by = Object.fromEntries(g.chemicals.map((c) => [c.id, c]))
  assert.equal(by.dopamine.baseline, 50); assert.equal(by.dopamine.halfLifeMinutes, 45)
  assert.equal(by.cortisol.baseline, 20); assert.equal(by.cortisol.halfLifeMinutes, 30)
  assert.equal(by.serotonin.baseline, 50); assert.equal(by.serotonin.halfLifeMinutes, 120)
  for (const c of g.chemicals) {
    assert.equal(c.min, 0); assert.equal(c.max, 100)
    assert.equal(c.initial, c.baseline, 'initial 与 baseline 同值')
    assert.ok(c.label && c.label.length <= 4, 'label 是短中文')
  }
})

// ═══ 2. snapshot 结构 + 四舍五入 ═════════════════════════════════
await t('snapshot：byId/chemicals 保留 1 位小数、mood 在 0..1 且 2 位小数', () => {
  const s = snapOf({ dopamine: 62.34, cortisol: 18.449, serotonin: 51.06 })
  assert.equal(typeof s.at, 'number', 'snapshot.at')
  assert.ok(s.byId && typeof s.byId === 'object', 'byId 存在')
  assert.ok(Array.isArray(s.chemicals), 'chemicals 是数组')
  assert.equal(s.chemicals.length, 3)
  close(s.byId.dopamine, 62.3, 1e-9, 'dopamine 四舍五入到 1 位小数')
  close(s.byId.cortisol, 18.4, 1e-9, 'cortisol 四舍五入到 1 位小数')
  assert.ok(s.mood && typeof s.mood.label === 'string' && s.mood.label.length > 0, 'mood.label')
  assert.ok(num(s.mood.intensity) >= 0 && num(s.mood.intensity) <= 1, 'intensity 0..1')
  assert.ok(Math.abs(num(s.mood.intensity) * 100 - Math.round(num(s.mood.intensity) * 100)) < 1e-6, 'intensity 2 位小数')
  const entry = s.chemicals.find((c) => c.id === 'dopamine')
  close(entry.value, s.byId.dopamine, 1e-9, 'chemicals[].value 与 byId 一致')
  assert.equal(typeof s.temperature, 'object', 'temperature 为 number|null（typeof object 仅当 null）')
})

await t('snapshot：平静态 label=平静、intensity 落在 spec 的 0.2~0.35', () => {
  const s = snapOf({ dopamine: 50, cortisol: 20, serotonin: 50 })
  assert.equal(s.mood.label, '平静')
  const v = num(s.mood.intensity)
  assert.ok(v >= 0.2 - 1e-9 && v <= 0.35 + 1e-9, '平静 intensity 应在 0.2~0.35，实际 ' + v)
})

// ═══ 3. 心情优先级（§4 从上到下） ════════════════════════════════
await t('心情优先级：炸毛 > 烦 > 委屈 > 得意 > 开心 > 困 > 平静', () => {
  const L = (c) => snapOf(c).mood.label
  assert.equal(L({ cortisol: 80 }), '炸毛', 'cortisol 80 → 炸毛')
  assert.equal(L({ cortisol: 65 }), '烦', 'cortisol 65 → 烦')
  assert.equal(L({ cortisol: 60 }), '烦', 'cortisol 60 → 烦（边界含）')
  assert.equal(L({ serotonin: 30 }), '委屈', 'serotonin 30 → 委屈')
  assert.equal(L({ dopamine: 80, serotonin: 50 }), '得意', 'dopamine 80 → 得意')
  assert.equal(L({ dopamine: 65, serotonin: 50 }), '开心', 'dopamine 65 → 开心')
  assert.equal(L({ cortisol: 65, dopamine: 90 }), '烦', '皮质醇优先级高于多巴胺')
  assert.equal(L({ cortisol: 60, serotonin: 20 }), '烦', '皮质醇优先级高于血清素')
  assert.equal(L({ dopamine: 90, serotonin: 30 }), '委屈', '委屈优先级高于得意')
})

await t('心情优先级：深夜(23-05) 且皮质醇<50 → 困；皮质醇高时仍是烦', () => {
  const night = new Date(2026, 0, 15, 23, 30).getTime()
  const s = snapOf({ dopamine: 50, cortisol: 20, serotonin: 50 }, night)
  assert.equal(s.mood.label, '困', '23:30 深夜 → 困')
  const early = new Date(2026, 0, 16, 3, 0).getTime()
  assert.equal(snapOf({ dopamine: 50, cortisol: 20, serotonin: 50 }, early).mood.label, '困', '03:00 → 困')
  assert.equal(snapOf({ dopamine: 50, cortisol: 65, serotonin: 50 }, night).mood.label, '烦', '深夜但皮质醇 65 → 烦（不困）')
  assert.equal(snapOf({ dopamine: 50, cortisol: 20, serotonin: 50 }, new Date(2026, 0, 15, 12, 0).getTime()).mood.label, '平静', '中午 → 平静')
})

await t('炸毛 intensity = clamp((cortisol-50)/50)', () => {
  const s = snapOf({ cortisol: 80 })
  close(s.mood.intensity, 0.6, 0.01, 'cortisol 80')
  const hi = snapOf({ cortisol: 100 })
  assert.ok(num(hi.mood.intensity) <= 1, 'intensity 上限 1')
})

await t('mood.reason 是短句（≤20 字）且 tone 非空', () => {
  const s = snapOf({ cortisol: 80 })
  assert.equal(typeof s.mood.tone, 'string')
  assert.ok(s.mood.tone.length > 0, 'tone 非空')
  assert.equal(typeof s.mood.reason, 'string')
  assert.ok(Array.from(s.mood.reason).length <= 20, 'reason ≤20 字，实际 ' + s.mood.reason)
})

// ═══ 4. buildDirective 硬约束 ════════════════════════════════════
const buildDir = (s, opts) => needCore().buildDirective(s, opts)
const assertDirectiveClean = (text, where) => {
  assert.equal(/[0-9]/.test(text), false, where + '：指令不得含数字，实际：' + text)
  for (const w of ['多巴胺', '皮质醇', '血清素']) {
    assert.equal(text.includes(w), false, where + '：指令不得含激素名「' + w + '」，实际：' + text)
  }
  assert.ok(Array.from(text).length <= 120, where + '：指令 ≤120 字，实际 ' + Array.from(text).length + '：' + text)
}

await t('buildDirective：空状态（全在基线、无触发、最近交互）返回空串', () => {
  const snap = snapOf({ dopamine: 50, cortisol: 20, serotonin: 50 })
  const text = buildDir(snap, { lastInteractionAt: NOW - 60_000, nowMs: NOW })
  assert.equal(text, '', '空状态不占 token，实际：' + JSON.stringify(text))
})

await t('buildDirective：高压/低血清素/高多巴胺都非空，且无数字、无激素名、≤120 字', () => {
  for (const [name, chem] of [
    ['压力', { cortisol: 92 }],
    ['低落', { serotonin: 18 }],
    ['亢奋', { dopamine: 92 }],
    ['烦躁', { cortisol: 66 }],
  ]) {
    const text = buildDir(snapOf(chem), { lastInteractionAt: NOW - 60_000, nowMs: NOW })
    assert.ok(text.length > 0, name + '：应向非空的行为指令')
    assertDirectiveClean(text, name)
  }
})

await t('buildDirective：12 小时未说话追加孤独提示（一句、不带数字）', () => {
  const snap = snapOf({ dopamine: 50, cortisol: 20, serotonin: 50 })
  const text = buildDir(snap, { lastInteractionAt: NOW - 13 * 3600_000, nowMs: NOW })
  assert.ok(text.length > 0, '长时间未交互应有内容')
  assert.ok(/孤独|寂寞|很久|一个人/.test(text), '应含孤独类提示，实际：' + text)
  assertDirectiveClean(text, '孤独提示')
})

// ═══ 5. pickTemperature 阈值 ════════════════════════════════════
await t('温度阈值：75/60/80 分档与优先级（经 snapshot().temperature 验证）', () => {
  const temp = (chemicals) => snapOf(chemicals).temperature
  assert.equal(temp({ cortisol: 75 }), 0.35, 'cortisol 75 → 0.35')
  assert.equal(temp({ cortisol: 90 }), 0.35, 'cortisol 90 → 0.35')
  assert.equal(temp({ cortisol: 60 }), 0.55, 'cortisol 60 → 0.55')
  assert.equal(temp({ cortisol: 74.9 }), 0.55, 'cortisol 74.9 → 0.55')
  assert.equal(temp({ dopamine: 80 }), 0.9, 'dopamine 80 → 0.9')
  assert.equal(temp({ dopamine: 95, cortisol: 62 }), 0.55, '中压优先于兴奋')
  assert.equal(temp({ dopamine: 95, cortisol: 76 }), 0.35, '高压优先于兴奋')
  assert.equal(temp({}), null, '平静 → null（不覆盖宿主）')
})

await t('pickTemperature(snap)：spec §5 的签名是传 snapshot 对象', () => {
  const pick = (byId) => needCore().pickTemperature(snapNear(byId))
  assert.equal(pick({ cortisol: 90 }), 0.35, 'cortisol 90 → 0.35（若失败：实现签名是 pickTemperature(byId)，与 spec §5 不一致）')
  assert.equal(pick({ dopamine: 90 }), 0.9, 'dopamine 90 → 0.9')
  assert.equal(pick({}), null, '平静 → null')
})

// ═══ 6. 引擎：衰减数学 ═══════════════════════════════════════════
await t('衰减：多巴胺升到 90，一个半衰期(45min)回到 70', () => {
  const { e, clock } = mkEngine()
  e.tick(clock.t)
  e.stim('custom', { chemical: 'dopamine', delta: 40, nowMs: clock.t })
  const s0 = e.snapshot(clock.t)
  close(s0.byId.dopamine, 90, 0.6, '刺激后 90')
  clock.t += 45 * 60_000
  e.tick(clock.t)
  const s1 = e.snapshot(clock.t)
  close(s1.byId.dopamine, 70, 1.0, '45 分钟后衰减一半')
})

await t('衰减：低于基线时向上回归 + 极小间隔不产生跳变', () => {
  const { e, clock } = mkEngine()
  e.tick(clock.t)
  e.stim('custom', { chemical: 'serotonin', delta: -30, nowMs: clock.t })
  close(e.snapshot(clock.t).byId.serotonin, 20, 0.6, '降到 20')
  clock.t += 120 * 60_000
  e.noteInteraction(clock.t) // 把"最近交互"推到当前，隔离慢变量的血清素回升
  e.tick(clock.t)
  close(e.snapshot(clock.t).byId.serotonin, 35, 1.0, '一个半衰期回到 35')
  const s = e.snapshot(clock.t)
  assert.ok(s.byId.serotonin >= 0 && s.byId.serotonin <= 100, '始终在 0..100')
})

// ═══ 7. 引擎：clamp ═════════════════════════════════════════════
await t('clamp：单次巨量刺激不超过 100，不跌破 0', () => {
  const { e, clock } = mkEngine()
  e.tick(clock.t)
  e.stim('custom', { chemical: 'dopamine', delta: 1000, nowMs: clock.t })
  assert.equal(e.snapshot(clock.t).byId.dopamine, 100, '上限 100')
  e.stim('custom', { chemical: 'dopamine', delta: -1000, nowMs: clock.t })
  assert.equal(e.snapshot(clock.t).byId.dopamine, 0, '下限 0')
  e.stim('custom', { chemical: 'cortisol', delta: 0, nowMs: clock.t })
  assert.ok(e.snapshot(clock.t).byId.cortisol >= 0, 'cortisol 不低于 0')
})

// ═══ 8. 引擎：sensitivity ═══════════════════════════════════════
await t('sensitivity：request_error = +20×sensitivity 只作用于皮质醇向上增量', () => {
  const g = structuredClone(needCore().DEFAULT_GENOME)
  g.temperament.sensitivity = 2.0
  const { e, clock } = mkEngine({ genome: g })
  e.tick(clock.t)
  e.stim('request_error', { nowMs: clock.t })
  close(e.snapshot(clock.t).byId.cortisol, 60, 1.5, 'sensitivity=2 → 皮质醇 20+40')

  const g1 = structuredClone(needCore().DEFAULT_GENOME)
  g1.temperament.sensitivity = 0.5
  const b = mkEngine({ genome: g1 })
  b.e.tick(b.clock.t)
  b.e.stim('request_error', { nowMs: b.clock.t })
  close(b.e.snapshot(b.clock.t).byId.cortisol, 30, 1.5, 'sensitivity=0.5 → 20+10')

  const d = mkEngine()
  d.e.tick(d.clock.t)
  d.e.stim('turn_done', { nowMs: d.clock.t })
  close(d.e.snapshot(d.clock.t).byId.dopamine, 55, 0.6, 'turn_done 不受 sensitivity 影响：+5')
})

// ═══ 9. 引擎：慢变量规则 ═════════════════════════════════════════
await t('慢变量：cortisol≥70 时每分钟抽干血清素 1.5', () => {
  const { e, clock } = mkEngine()
  e.tick(clock.t)
  e.stim('custom', { chemical: 'cortisol', delta: 60, nowMs: clock.t })
  assert.ok(e.snapshot(clock.t).byId.cortisol >= 70, '先把皮质醇顶到 80')
  clock.t += 60_000
  e.tick(clock.t)
  const s = e.snapshot(clock.t)
  const drop = 50 - num(s.byId.serotonin)
  assert.ok(drop >= 1.2 && drop <= 1.8, '一分钟应掉 ~1.5，实际掉 ' + drop.toFixed(2))
})

await t('慢变量：cortisol<40 且 30 分钟没交互时血清素回升，上限 85', () => {
  const { e, clock } = mkEngine()
  e.tick(clock.t)
  e.noteInteraction(clock.t)
  clock.t += 10 * 3600_000
  e.tick(clock.t)
  const v = num(e.snapshot(clock.t).byId.serotonin)
  assert.ok(v > 50, '长时间独处应回升，实际 ' + v)
  assert.ok(v <= 85.5, '回升上限 85，实际 ' + v)
})

// ═══ 10. 引擎：损坏状态归一化 ═══════════════════════════════════
await t('损坏 JSON：静默回出厂值，坏文件改名 affect.json.bad-<ts>', () => {
  const { e, clock, dir } = mkEngine({ file: '{这不是 JSON' })
  e.tick(clock.t)
  const s = e.snapshot(clock.t)
  for (const id of ['dopamine', 'cortisol', 'serotonin']) {
    assert.ok(num(s.byId[id]) >= 0 && num(s.byId[id]) <= 100, id + ' 归一化到 0..100，实际 ' + s.byId[id])
  }
  const bad = readdirSync(dir).filter((f) => f.startsWith('affect.json.bad-'))
  assert.equal(bad.length, 1, '坏文件应被改名一次，实际 ' + JSON.stringify(readdirSync(dir)))
  assert.ok(existsSync(join(dir, bad[0])), '改名文件存在')
})

await t('非法字段：值超界/NaN/类型错 → 归一化且不抛', () => {
  const file = JSON.stringify({ version: 1, chemicals: { dopamine: 999, cortisol: -50, serotonin: 'abc' }, log: 'oops' })
  const { e, clock } = mkEngine({ file })
  e.tick(clock.t)
  const s = e.snapshot(clock.t)
  assert.ok(num(s.byId.dopamine) <= 100, 'dopamine 越界被 clamp，实际 ' + s.byId.dopamine)
  assert.ok(num(s.byId.cortisol) >= 0, 'cortisol 负值被 clamp，实际 ' + s.byId.cortisol)
  assert.ok(Number.isFinite(num(s.byId.serotonin)), 'serotonin 非法回退为数字，实际 ' + s.byId.serotonin)
  assert.ok(num(s.byId.serotonin) >= 0 && num(s.byId.serotonin) <= 100)
})

// ═══ 11. 引擎：磁盘不可写也 never throw ═════════════════════════
await t('磁盘不可写：目录是普通文件时所有公开方法都不抛', () => {
  const C = EngineCtor()
  const blocker = join(ROOT, 'blocker-file')
  writeFileSync(blocker, 'x')
  const e = new C({ dir: join(blocker, 'deep-soul'), now: () => NOW })
  const call = (fn) => { try { return fn() } catch (err) { throw new Error('公开方法抛异常了：' + err.message) } }
  call(() => e.tick(NOW))
  call(() => e.stim('turn_done'))
  const s = call(() => e.snapshot(NOW))
  assert.ok(s && s.byId && Number.isFinite(num(s.byId.dopamine)), 'snapshot 仍返回可用对象')
  call(() => e.render(NOW))
  call(() => e.temperature(NOW))
  call(() => e.noteInteraction(NOW))
})

// ═══ 12. 引擎：落盘格式 ═════════════════════════════════════════
await t('affect.json：version/updatedAt/chemicals/lastInteractionAt/log 格式正确', () => {
  const { e, clock, dir } = mkEngine()
  e.tick(clock.t)
  e.noteInteraction(clock.t)
  e.stim('turn_done', { nowMs: clock.t })
  e.tick(clock.t)
  const j = JSON.parse(readFileSync(join(dir, 'affect.json'), 'utf8'))
  assert.equal(j.version, 1)
  assert.equal(typeof j.updatedAt, 'number')
  assert.ok(j.chemicals && typeof j.chemicals === 'object')
  for (const id of ['dopamine', 'cortisol', 'serotonin']) assert.ok(Number.isFinite(j.chemicals[id]), id + ' 是数字')
  assert.equal(typeof j.lastInteractionAt, 'number')
  assert.equal(typeof j.lastStimulusAt, 'number')
  assert.equal(j.lastStimulusKind, 'turn_done')
  assert.ok(Array.isArray(j.log))
  assert.ok(j.log.length >= 1, 'log 至少一条')
  assert.equal(typeof j.log[0].at, 'number')
  assert.equal(typeof j.log[0].kind, 'string')
})

await t('log 上限 50 条', () => {
  const { e, clock, dir } = mkEngine()
  e.tick(clock.t)
  for (let i = 0; i < 60; i += 1) e.stim('turn_done', { nowMs: clock.t + i * 1000 })
  e.tick(clock.t + 61_000)
  const j = JSON.parse(readFileSync(join(dir, 'affect.json'), 'utf8'))
  assert.ok(j.log.length <= 50, 'log ≤50，实际 ' + j.log.length)
})

await t('mood.json：字段与 spec §6 一致（source=affect）', () => {
  const { e, clock, dir } = mkEngine()
  e.tick(clock.t)
  e.stim('request_error', { nowMs: clock.t })
  e.tick(clock.t)
  const p = join(dir, 'mood.json')
  assert.ok(existsSync(p), 'mood.json 应落盘')
  const m = JSON.parse(readFileSync(p, 'utf8'))
  assert.equal(typeof m.label, 'string'); assert.ok(m.label.length > 0)
  assert.equal(typeof m.intensity, 'number'); assert.ok(m.intensity >= 0 && m.intensity <= 1)
  assert.equal(typeof m.reason, 'string'); assert.ok(Array.from(m.reason).length <= 20)
  assert.equal(typeof m.tone, 'string')
  assert.equal(typeof m.updatedAt, 'number')
  assert.equal(m.source, 'affect')
})

// ═══ 12.5 引擎：重启延续（同一 dir 两实例）/ 只读目录 ════════════
await t('重启延续：同一 dir 两个引擎实例读到同一状态', () => {
  const { e: e1, clock, dir } = mkEngine()
  e1.tick(clock.t)
  e1.stim('praised', { nowMs: clock.t }) // dopamine +8
  const s1 = e1.snapshot(clock.t)
  const C = EngineCtor()
  const e2 = new C({ dir, now: clock.t, log: () => {} })
  const s2 = e2.snapshot(clock.t)
  close(s2.byId.dopamine, s1.byId.dopamine, 0.6, '第二个实例应读到同一多巴胺值')
  close(s2.byId.dopamine, 58, 1.2, '预置 +8 后约 58')
})

await t('只读目录(chmod 0500)：render/temperature/snapshot/stim 不抛；写失败被吞', () => {
  seq += 1
  const ro = join(ROOT, 'ro-' + seq)
  mkdirSync(ro, { recursive: true })
  const { e, clock } = mkEngine({ dir: ro })
  chmodSync(ro, 0o500)
  try {
    e.tick(clock.t)
    e.stim('request_error', { nowMs: clock.t })
    e.noteInteraction(clock.t)
    const snap = e.snapshot(clock.t)
    assert.ok(snap && snap.byId && Number.isFinite(num(snap.byId.cortisol)), 'snapshot 仍可用')
    const text = e.render(clock.t)
    assert.equal(typeof text, 'string', 'render 必须返回字符串')
    const temp = e.temperature(clock.t)
    assert.ok(temp === null || typeof temp === 'number', 'temperature 必须 number|null')
    // 只读目录下写盘应失败但不抛：affect.json 不应被写出来
    assert.equal(existsSync(join(ro, 'affect.json')), false, '只读目录不应写出 affect.json')
  } finally {
    chmodSync(ro, 0o700)
  }
})

// ═══ 13. 引擎：config 关闭 ══════════════════════════════════════
await t('config enabled=false：enabled 为 false、不注入指令、不改温度', () => {
  const { e, clock } = mkEngine({ config: { enabled: false } })
  e.tick(clock.t)
  e.stim('request_error', { nowMs: clock.t })
  e.tick(clock.t)
  assert.equal(e.enabled, false)
  assert.equal(e.render(clock.t), '')
  assert.equal(e.temperature(clock.t), null)
})

// ═══ 结果 ═══════════════════════════════════════════════════════
console.log('')
if (fails.length) {
  console.log('❌ affect-core: ' + pass + ' 通过 / ' + fails.length + ' 失败')
  for (const f of fails) console.log('  - ' + f)
  process.exitCode = 1
} else {
  console.log('✅ affect-core: ' + pass + ' 通过 / 0 失败')
}
setTimeout(() => process.exit(process.exitCode || 0), 300)
