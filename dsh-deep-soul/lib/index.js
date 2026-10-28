// Deep-Soul v4.2 — 大肥鱼人格人设的 DSH 接入层（v4.1 + 时间感 / 未完成事项）
//
// 相对 v4.1 的改动（均以 [v4.2] 标注，便于逐段 review）：
//  1. 【现在】：每轮注入本地日期/星期/时段，让"时间"能影响语气（卡 v2 第五节消费）。
//  2. 【还挂着的几件事】：新增 open-loops 存储与 mind_pin / mind_resolve 两个工具，
//     每轮最多注入 3 条未完成的事（约定、答应了没做的、话说一半的）。
//  3. 记忆提示词瘦身，并明确"记什么/不记什么"，与人格卡 v2 第六节对齐。
//  4. 预取与最近记忆带相对时间（"3 天前"），回忆更像人而不是列表。
//
// 设计约束（与 v4.1 相同，安全优先）：
//  1. 不 import 任何宿主包，只依赖 node: 内置模块 —— 插件导入不可能因缺少 peer 依赖而失败。
//  2. apply() 整体 try/catch：任何异常都降级为"不注册"，绝不让 DSH 启动失败。
//  3. 只通过子进程的 stdin/stdout 通信，不开放端口；数据只落 ~/.dsh/deep-soul/。
//  4. 子进程异常退出时自动重启一次，仍失败则工具返回可读错误而不是抛异常。

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractSnapshot, cleanText, lastSpeakerText } from './inbox.js'

export const name = 'deep-soul'
export const inject = ['tools', 'systemPrompt', 'timer', 'agents']

const HOST_TOOLS = process.env.DSH_TOOLS_PATH || '/usr/local/lib/nodejs/node-v24.21.0-linux-x64/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js'
let defineTool = null
try { defineTool = (await import('file://' + HOST_TOOLS)).defineTool } catch (e) { console.log('[deep-soul] defineTool unavailable:', e && e.message) }
const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = process.env.DEEP_SOUL_ROOT || resolve(HERE, '..', '..')
const DATA_DIR = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'deep-soul')
const DB_PATH = join(DATA_DIR, 'mind.db')

function log(...args) {
  try { console.log('[deep-soul]', ...args) } catch {}
}

// ---------------- [v4.2] 未完成事项（open loops） ----------------
// 与 mind.db 分开存：这是"手边的便签"，不是长期记忆，不需要向量/分舱/遗忘曲线。
// 单文件 + 原子写（先写唯一临时名再 rename），进程中断不会写坏原文件。
const LOOPS_PATH = join(DATA_DIR, 'open-loops.json')
const LOOPS_MAX = 12        // 存储上限，超出丢最旧的
const LOOPS_TTL_MS = 14 * 86400000  // 14 天还没了结，自动淡出

function readLoops() {
  try {
    const arr = JSON.parse(readFileSync(LOOPS_PATH, 'utf8'))
    return Array.isArray(arr) ? arr.filter((x) => x && typeof x.text === 'string') : []
  } catch { return [] }
}

function writeLoops(list) {
  mkdirSync(DATA_DIR, { recursive: true })
  const tmp = LOOPS_PATH + '.' + process.pid + '.tmp'
  writeFileSync(tmp, JSON.stringify(list, null, 2))
  renameSync(tmp, LOOPS_PATH)
}

function addLoop(text, due) {
  const list = readLoops().filter((x) => !x.resolvedAt)
  const item = {
    id: 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    text,
    createdAt: Date.now(),
    due: Number.isFinite(due) && due > 0 ? due : null,
  }
  writeLoops([item, ...list].slice(0, LOOPS_MAX))
  return item
}

function resolveLoop(id) {
  const list = readLoops()
  const hit = list.find((x) => x.id === id && !x.resolvedAt)
  if (!hit) return null
  hit.resolvedAt = Date.now()
  writeLoops(list)
  return hit
}

function activeLoops() {
  const now = Date.now()
  return readLoops().filter((x) => !x.resolvedAt && now - x.createdAt < LOOPS_TTL_MS)
}

// 相对时间：只说"今天/昨天/N 天前"，不报绝对日期——人回忆时就是这样。
function ago(ms) {
  if (!ms) return ''
  const d = Math.floor((Date.now() - ms) / 86400000)
  if (d <= 0) return '今天'
  if (d === 1) return '昨天'
  return d + ' 天前'
}

// ---------------- [v4.2] 现在几点 ----------------
// 只给事实（日期/星期/时间/时段），怎么解读交给人格卡；插件保持人设无关。
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
function nowText() {
  const d = new Date()
  const h = d.getHours()
  const phase = h < 5 ? '凌晨' : h < 9 ? '早上' : h < 12 ? '上午' : h < 14 ? '中午'
    : h < 18 ? '下午' : h < 23 ? '晚上' : '深夜'
  const hh = String(h).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `【现在】${d.getMonth() + 1} 月 ${d.getDate()} 日 ${WEEK[d.getDay()]} ${hh}:${mm}（${phase}）`
}

// ---------------- sidecar 客户端 ----------------
class Sidecar {
  constructor({ python = 'python3', root = DEFAULT_ROOT, db = DB_PATH } = {}) {
    this.python = python
    this.root = root
    this.db = db
    this.proc = null
    this.nextId = 1
    this.pending = new Map()
    this.buf = ''
    this.ready = false
    this.failed = false
  }

  start() {
    if (this.proc || this.failed) return
    try {
      mkdirSync(dirname(this.db), { recursive: true })
      const args = ['-u', '-m', 'mindcore.server', '--db', this.db]
      this.proc = spawn(this.python, args, {
        cwd: this.root,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      this.proc.stdout.setEncoding('utf8')
      this.proc.stdout.on('data', (chunk) => this._onData(chunk))
      this.proc.stderr.setEncoding('utf8')
      this.proc.stderr.on('data', (d) => log('sidecar stderr:', String(d).slice(0, 300)))
      this.proc.on('exit', (code, sig) => {
        log('sidecar exited', code, sig)
        this.proc = null
        this.ready = false
        for (const [, p] of this.pending) p.reject(new Error('sidecar exited'))
        this.pending.clear()
      })
      this.proc.on('error', (e) => {
        log('sidecar spawn failed:', e && e.message)
        this.failed = true
        this.proc = null
      })
      this.ready = true
    } catch (e) {
      log('sidecar start exception:', e && e.message)
      this.failed = true
    }
  }

  _onData(chunk) {
    this.buf += chunk
    let idx
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).trim()
      this.buf = this.buf.slice(idx + 1)
      if (!line) continue
      let msg
      try { msg = JSON.parse(line) } catch { continue }
      const p = this.pending.get(msg.id)
      if (!p) continue
      this.pending.delete(msg.id)
      if (msg.ok) p.resolve(msg.data)
      else p.reject(new Error(msg.error || 'sidecar error'))
    }
  }

  request(op, args = {}, timeoutMs = 8000) {
    if (this.failed) return Promise.reject(new Error('Deep-Soul sidecar 不可用'))
    this.start()
    if (!this.proc) return Promise.reject(new Error('Deep-Soul sidecar 未运行'))
    const id = this.nextId++
    const payload = JSON.stringify({ id, op, args }) + '\n'
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('Deep-Soul 超时'))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v) },
        reject: (e) => { clearTimeout(timer); reject(e) },
      })
      try { this.proc.stdin.write(payload) } catch (e) {
        clearTimeout(timer); this.pending.delete(id); reject(e)
      }
    })
  }

  stop() {
    if (this.proc) {
      try { this.proc.stdin.end() } catch {}
      try { this.proc.kill() } catch {}
      this.proc = null
    }
    this.ready = false
  }
}

// ---------------- 工具 ----------------
function textResult(text) {
  return { text }
}

// 把 defineTool 风格的参数映射编译成 JSON Schema；登记时不经过 defineTool 就必须自己转。
function toJsonSchema(spec) {
  if (!spec || typeof spec !== 'object') return { type: 'object', properties: {} }
  if (spec.type === 'object' && spec.properties) return spec
  const properties = {}
  const required = []
  for (const [k, v] of Object.entries(spec)) {
    const p = { ...v }
    if (p.required === true) { required.push(k); delete p.required }
    properties[k] = p
  }
  const out = { type: 'object', properties }
  if (required.length) out.required = required
  return out
}

const TEXT_OUTPUT = {
  schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
  render: (_a, v) => [{ type: 'text', text: v.text }],
}

function makeTools(sidecar, ctxFor = () => ({ audience: 'private', chat: '' })) {
  return [
    {
      name: 'mind_recall',
      description:
        '从长期记忆里回想与当前话题有关的几件事。' +
        '当用户提到过去的事、约定、喜好、或你觉得自己"应该记得但想不起"时调用。' +
        '返回按相关度排序的记忆片段（含分区与受众），可能为空。',
      parameters: {
        query: { type: 'string', required: true, description: '要回想的话题或关键词，用当前这句话即可。' },
        k: { type: 'number', description: '要几条，默认 5，最多 10。' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const query = String(args.query || '').slice(0, 500)
        const k = Math.min(10, Math.max(1, Number(args.k) || 5))
        const c0 = ctxFor(exec)
        const ctx = { principal: 'owner', audience: c0.audience, chat: c0.chat }
        const hits = await sidecar.request('recall', { query, k, ctx })
        if (!hits || !hits.length) return textResult('（没有想起相关的长期记忆）')
        const when = (ts) => {
          if (!ts) return ''
          const d = new Date(ts * 1000)
          const p = (n) => String(n).padStart(2, '0')
          return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
        }
        const lines = hits.map((h, i) => {
          const meta = [when(h.created_at), h.source === 'owner' ? '主人' : ''].filter(Boolean).join(' · ')
          const cov = typeof h.cov === 'number' ? ` · 覆盖 ${h.cov.toFixed(2)}` : ''
          const use = h.hits ? ` · 想起 ${h.hits} 次` : ''
          const priv = h.private ? '（私聊·别报细节）' : ''
          return `${i + 1}. [${h.region}/${h.audience}${meta ? ' · ' + meta : ''}] ${priv}${h.text}（${h.score}${cov}${use}）`
        })
        return textResult('想起来的长期记忆：\n' + lines.join('\n'))
      },
    },
    {
      name: 'mind_remember',
      description:
        '把一件值得长期记住的事写进记忆（以后可能被想起）。' +
        '只记发生的事和她自己的感受，不要记推断出来的他人态度；' +
        '琐事不用逐条记，但具体的小事（一句原话、一个梗、一次撒娇）值得留一句。"我觉得他故意…"这类归因句会被自动降级为争议态。',
      parameters: {
        text: { type: 'string', required: true, description: '一句话说清一件事。' },
        source: { type: 'string', description: 'owner 或 other，默认 owner。' },
        audience: { type: 'string', description: 'private / group / public，默认 private。' },
        place: { type: 'string', description: '当时的地点（可选），用于物理锚。' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const r = await sidecar.request('remember', {
          text: String(args.text || '').slice(0, 2000),
          source: args.source === 'other' ? 'other' : 'owner',
          audience: ['private', 'group', 'public'].includes(args.audience) ? args.audience : ctxFor(exec).audience,
          chat_id: ctxFor(exec).chat,
          place: args.place || null,
        })
        const tag = r.status === 'disputed' ? '（争议态，待验证）' : ''
        return textResult(`记住了 #${r.id} · ${r.region} · α${r.affect_w.toFixed(2)} β${r.belief_w}${tag}`)
      },
    },
    {
      name: 'mind_status',
      description: '查看记忆内核状态：节点数、舱数、语义通道模式、七维驱力读数。',
      parameters: {},
      output: TEXT_OUTPUT,
      async execute() {
        const s = await sidecar.request('status', {})
        const d = Object.entries(s.drives || {}).map(([k, v]) => `${k}=${Number(v).toFixed(2)}`).join(' ')
        return textResult(
          '节点 ' + s.nodes + ' · 舱 ' + s.cells + ' · 模式 ' + s.mode +
          ' · 自我陈述 ' + (s.claims || 0) + ' 条 · 自传 ' + (s.chapters || 0) + ' 章\n' +
          '驱力：' + d + '\n库：' + s.db
        )
      },
    },
    {
      name: 'mind_self',
      description: '查看当前生效的自我陈述与最近的自传章节。想确认“我是谁、我经历过什么”时调用。',
      parameters: {},
      output: TEXT_OUTPUT,
      async execute() {
        const r = await sidecar.request('self_list', { chapters: 3 })
        const claims = r.claims || []
        const chapters = r.chapters || []
        const lines = []
        if (claims.length) {
          lines.push('生效的自我陈述：')
          for (const c of claims) lines.push('- ' + c.claim + '（置信 ' + c.confidence + '，证据 ' + c.evidence + '）')
        } else lines.push('（还没有生效的自我陈述）')
        if (chapters.length) {
          lines.push('最近的自传：')
          for (const ch of chapters) lines.push('- 第' + ch.no + '章 ' + ch.title)
        }
        return textResult(lines.join('\n'))
      },
    },
    {
      name: 'mind_claim',
      description: '提出一条关于自己的陈述（“我不喜欢…”“我在意…”）。证据不足两条会先进争议态，不会直接生效。',
      parameters: {
        claim: { type: 'string', required: true, description: '一句关于自己的陈述。' },
        evidence: { type: 'string', description: '支撑它的记忆节点 id，逗号分隔，可选（如 "1,2"）。' },
      },
      output: TEXT_OUTPUT,
      async execute(args) {
        const r = await sidecar.request('self_claim', {
          claim: String(args.claim || '').slice(0, 300),
          evidence: String(args.evidence || '').split(',').map((x) => Number(x.trim())).filter((x) => Number.isFinite(x)),
          source: 'self',
        })
        const tag = r.status === 'disputed' ? '（争议态，等第二条证据）' : '（已生效）'
        return textResult('自我陈述 #' + r.id + ' ' + tag)
      },
    },
    // ---- [v4.2] 手边没办完的事 ----
    {
      name: 'mind_pin',
      description:
        '把一件“还挂着的事”记到手边：答应过的事、约好的时间、话说一半没说完。' +
        '之后每轮最多 3 条作为【还挂着的几件事】出现在上下文里；办完用 mind_resolve 消掉。' +
        '长期事实用 mind_remember，这里只放“未完成”。',
      parameters: {
        text: { type: 'string', required: true, description: '一句话：答应了什么、约好什么、话说到哪儿。' },
        due: { type: 'number', description: '可选，截止时间（Unix 毫秒）。' },
      },
      output: TEXT_OUTPUT,
      async execute(args) {
        const text = String(args.text || '').slice(0, 200).trim()
        if (!text) return textResult('没写具体的事，先用一句话说清。')
        const item = addLoop(text, Number(args.due))
        return textResult('挂上了 ' + item.id + '：' + item.text)
      },
    },
    {
      name: 'mind_resolve',
      description: '把【还挂着的几件事】里的一条标记为完成/不再需要提起。',
      parameters: {
        id: { type: 'string', required: true, description: 'mind_pin 返回的 id（如 Lxyz1234）。' },
      },
      output: TEXT_OUTPUT,
      async execute(args) {
        const id = String(args.id || '').trim()
        const hit = resolveLoop(id)
        return textResult(hit ? '办完了 ' + id + '：' + hit.text : '没找到这条（可能已经办完或过期）。')
      },
    },
  ]
}

export function apply(ctx) {
  try {
    const sidecar = new Sidecar({})
    sidecar.start()

    // ---- [v4.3] Web 面板路由：同源、只读 + 一个 touch ----
    // 冷启动时 apply 可能早于 webServer 挂载（v4.3 第一次重启就踩了），
    // 所以先试一次，没挂上就每秒再试，直到注册成功；面板数据走 sidecar。
    let routesReady = false
    let routesTimer = null
    const registerPanelRoutes = () => {
      if (routesReady) return true
      let web = null
      try { web = (typeof ctx.get === 'function' ? ctx.get('webServer') : ctx.webServer) || null } catch { web = null }
      if (web && typeof web.register === 'function') {
        const send = (res, code, obj) => {
          res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify(obj))
        }
        const readBody = async (req) => {
          let raw = ''
          for await (const chunk of req) raw += chunk
          try { return JSON.parse(raw || '{}') } catch { return {} }
        }
        const disposers = []
        const route = (path, handler) => {
          disposers.push(web.register({
            kind: 'exact',
            path,
            handler: async (req, res) => {
              try { await handler(req, res) } catch (e) {
                send(res, 500, { ok: false, error: String((e && e.message) || e) })
              }
            },
          }))
        }
        route('/deep-soul/panel', async (req, res) => {
          const u = new URL(req.url, 'http://x')
          const raw = u.searchParams.get('asOf') || ''
          const as_of = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null
          const data = await sidecar.request('panel_brain', { as_of, limit: 1600 }, 15000)
          send(res, 200, { ok: true, data })
        })
        route('/deep-soul/node', async (req, res) => {
          const u = new URL(req.url, 'http://x')
          const id = Number(u.searchParams.get('id'))
          if (!Number.isFinite(id)) return send(res, 400, { ok: false, error: 'id 不合法' })
          const data = await sidecar.request('panel_detail', { id }, 8000)
          send(res, 200, { ok: true, data })
        })
        route('/deep-soul/touch', async (req, res) => {
          if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'POST only' })
          const body = await readBody(req)
          const id = Number(body.id)
          if (!Number.isFinite(id)) return send(res, 400, { ok: false, error: 'id 不合法' })
          const data = await sidecar.request('panel_touch', { id }, 8000)
          send(res, 200, { ok: true, data })
        })
        route('/deep-soul/recalls', async (req, res) => {
          const u = new URL(req.url, 'http://x')
          const limit = Math.min(30, Math.max(1, Number(u.searchParams.get('limit')) || 10))
          const data = await sidecar.request('panel_recalls', { limit }, 8000)
          send(res, 200, { ok: true, data })
        })
        try { ctx.effect(() => () => { for (const d of disposers) { try { d() } catch {} } }) } catch {}
        routesReady = true
        log('panel routes registered')
        return true
      }
      return false
    }
    try {
      if (!registerPanelRoutes()) {
        log('panel routes waiting for webServer')
        routesTimer = setInterval(() => {
          try { if (registerPanelRoutes()) { clearInterval(routesTimer); routesTimer = null } } catch (e) {
            log('panel route retry failed:', e && e.message)
          }
        }, 1000)
        try { ctx.effect(() => () => { if (routesTimer) clearInterval(routesTimer) }) } catch {}
      }
    } catch (e) { log('panel routes failed:', e && e.message) }

    // ---- 预取注入：在用户消息到达时先算好“这次可能想起什么”，
    //      让模型不必每轮再调一次 mind_recall（省一轮模型调用）。----
    const prefetch = new Map()
    // 会话类型（group/private）来自桥接注入的【会话】行：群聊里检索只看 group/public，
    // 私聊才看得到 private。拿不到就按 private 处理（与旧行为一致，不会更开放）。
    const audienceByAgent = new Map()
    const chatByAgent = new Map()
    const ctxFor = (exec) => {
      const sid = String(exec?.sessionId || exec?.agent?.id || exec?.agentId || '')
      return {
        audience: audienceByAgent.get(sid) === 'group' ? 'group' : 'private',
        chat: chatByAgent.get(sid) || '',
      }
    }
    const textOf = (x, depth = 0) => {
      if (!x || depth > 6) return ''
      if (typeof x === 'string') return x
      if (Array.isArray(x)) return x.map((v) => textOf(v, depth + 1)).join('')
      if (typeof x === 'object') {
        if (typeof x.text === 'string') return x.text
        for (const k of ['content', 'message', 'messages', 'data', 'payload', 'inserted']) {
          if (x[k]) { const t = textOf(x[k], depth + 1); if (t) return t }
        }
      }
      return ''
    }
    // ---- [v4.3.1] 群聊自动记忆：不再等她主动 mind_remember ----
    // 只记群里「别人说的、像事实的」短句；每群每天 30 条、每条间隔 20 秒、一次唤醒最多 2 条，
    // 相同的句子 2 小时内不重复记。私聊不自动记（私聊仍由她自己决定）。
    const AUTO_DAILY = 30
    const AUTO_GLOBAL_DAILY = 200
    const AUTO_PER_WAKE = 2
    const AUTO_MIN_GAP = 20000
    const AUTO_SEEN_TTL = 2 * 3600 * 1000
    const autoGroup = new Map()
    let autoGlobal = { day: '', count: 0 }
    const isFactish = (t) => {
      if (t.length < 8 || t.length > 200) return false
      if (/^[\/!.#@]/.test(t)) return false
      if (!/[\u4e00-\u9fffA-Za-z]/.test(t)) return false
      if (/^(哈+|嗯+|哦+|啊+|草+|6+|？+|。+|…+)$/.test(t)) return false
      return true
    }
    const autoRememberGroup = (sid, msgs, chatKey) => {
      try {
        const now = Date.now()
        const day = new Date().toDateString()
        if (autoGlobal.day !== day) autoGlobal = { day, count: 0 }
        if (autoGlobal.count >= AUTO_GLOBAL_DAILY) return
        let st = autoGroup.get(sid)
        if (!st || st.day !== day) {
          st = { day, count: 0, lastAt: 0, seen: new Map() }
          autoGroup.set(sid, st)
        }
        if (st.count >= AUTO_DAILY) return
        let wrote = 0
        for (const m of msgs) {
          if (!m || m.isSelf) continue
          const text = cleanText(m.text)
          if (!isFactish(text)) continue
          const key = text.slice(0, 80)
          const seenAt = st.seen.get(key)
          if (seenAt && now - seenAt < AUTO_SEEN_TTL) continue
          if (now - st.lastAt < AUTO_MIN_GAP) break
          const sender = String(m.sender || '').slice(0, 24)
          const body = ((sender ? sender + '：' : '') + text).slice(0, 200)
          st.seen.set(key, now)
          st.lastAt = now
          st.count += 1
          autoGlobal.count += 1
          wrote += 1
          sidecar.request('remember', {
            text: body,
            source: 'other',
            audience: 'group',
            chat_id: String(chatKey || ''),
            speaker: sender,
            message_id: String(m.messageId || m.seq || ''),
          }, 6000).then(() => log('auto-remember', sid, body.slice(0, 30))).catch(() => {})
          if (wrote >= AUTO_PER_WAKE || st.count >= AUTO_DAILY || autoGlobal.count >= AUTO_GLOBAL_DAILY) break
        }
        if (st.seen.size > 800) {
          for (const [k, v] of st.seen) if (now - v > AUTO_SEEN_TTL) st.seen.delete(k)
        }
      } catch (e) { log('auto-remember failed:', e && e.message) }
    }

    const mountAgent = (agent) => {
      const sid = String(agent && (agent.id || agent.sessionId) || '')
      if (!sid || prefetch.has(sid)) return
      const state = { text: '', at: 0 }
      prefetch.set(sid, state)
      try {
        agent.ctx.on('agent/inbox/inserted', (payload) => {
          const full = textOf(payload)
          const kind = /【会话】(group|private):(\S+)/.exec(full)
          if (kind) {
            audienceByAgent.set(sid, kind[1])
            chatByAgent.set(sid, kind[2])
          }
          // 以前拿 prompt 开头当查询，拿到的是运行上下文；现在优先用消息快照里的最后一句
          const snap = extractSnapshot(full)
          const msgs = snap && Array.isArray(snap.messages) ? snap.messages : []
          const lastText = lastSpeakerText(snap)
          if (kind && kind[1] === 'group' && msgs.length) autoRememberGroup(sid, msgs, kind[2])
          const q = (lastText || full.slice(0, 300)).trim()
          if (!q) return
          sidecar.request('recall', { query: q, k: 3, ctx: { principal: 'owner', audience: audienceByAgent.get(sid) === 'group' ? 'group' : 'private', chat: chatByAgent.get(sid) || '' } }, 4000)
            .then((hits) => {
              if (!Array.isArray(hits) || !hits.length) return
              // [v4.2] 带相对时间：像回忆，不像检索结果
              state.text = '【这次可能想得起来的】\n' + hits.map((h) => {
                const d = h.created_at ? Math.floor((Date.now() / 1000 - h.created_at) / 86400) : 0
                const tag = d >= 1 ? (d === 1 ? '昨天 · ' : d + ' 天前 · ') : ''
                return '- ' + (h.private ? '（私聊·别报细节）' : '') + tag + h.text
              }).join('\n')
              state.at = Date.now()
              log('prefetch hit', sid, hits.length)
            })
            .catch(() => {})
        })
      } catch (e) { log('prefetch listen failed:', e && e.message) }
      log('prefetch mounted', sid)
    }
    // 全局只注册一次：按当前 agent 的 id 取它自己的预取结果。
    try {
      ctx.systemPrompt.context({
        name: 'deep-soul-prefetch',
        order: 901,
        text: (c) => {
          try {
            const sid = String(c && c.agent && c.agent.id || '')
            const st = prefetch.get(sid)
            return st && st.text && Date.now() - st.at < 600000 ? st.text : ''
          } catch { return '' }
        },
      })
    } catch (e) { log('prefetch context failed:', e && e.message) }

    try {
      ctx.effect(() => ctx.interval(() => {
        try {
          for (const a of ctx.agents.list()) mountAgent(a)
        } catch (e) { log('agent scan failed:', e && e.message) }
      }, 5000))
      try { for (const a of ctx.agents.list()) mountAgent(a) } catch {}
    } catch (e) { log('prefetch setup failed:', e && e.message) }

    // ---- [v4.2] 现在几点 + 还挂着的事：都是每轮实时生成的短块 ----
    try {
      ctx.systemPrompt.context({ name: 'deep-soul-now', order: 899, text: () => nowText() })
    } catch (e) { log('now context failed:', e && e.message) }

    try {
      ctx.systemPrompt.context({
        name: 'deep-soul-loops',
        order: 902,
        text: () => {
          const items = activeLoops().slice(0, 3)
          if (!items.length) return ''
          return '【还挂着的几件事】\n' + items.map((i) => '- ' + ago(i.createdAt) + '：' + i.text).join('\n')
        },
      })
    } catch (e) { log('loops context failed:', e && e.message) }

    for (const spec of makeTools(sidecar, ctxFor)) {
      try {
        const tool = defineTool
          ? defineTool({
              name: spec.name,
              description: spec.description,
              parameters: spec.parameters,
              output: { schema: spec.output.schema, render: spec.output.render },
              execute: spec.execute,
            })
          : Object.assign({}, spec, { parameters: toJsonSchema(spec.parameters) })
        ctx.tools.register(tool)
      } catch (e) { log('tool register failed:', spec.name, e && e.message) }
    }

    // [v4.2] 与人格卡 v2 第六节对齐：记什么、不记什么、怎么用。
    try {
      ctx.systemPrompt.section({
        name: 'deep-soul-hint',
        order: 89990,
        text: () =>
          '【记忆】你有长期记忆：约定、偏好、被戳到的事值得记，具体的小事（一句原话、一个梗、一次撒娇）也留一句；客套和流水账不必记；' +
          '要回想过去用 mind_recall，答应了还没做的用 mind_pin。' +
          '只记发生的事和你的感受，不替别人下结论。',
      })
    } catch (e) { log('section failed:', e && e.message) }

    // 最近记忆：由定时器异步刷新，注入函数保持同步（不能 await）。
    let recentText = ''
    const refresh = async () => {
      try {
        const rows = await sidecar.request('recent', { limit: 3 }, 4000)
        recentText = Array.isArray(rows) && rows.length
          ? '【最近在你心里的几件事】\n' + rows.map((r) => {
              const d = r.created_at ? Math.floor((Date.now() / 1000 - r.created_at) / 86400) : 0
              const tag = d >= 1 ? (d === 1 ? '昨天：' : d + ' 天前：') : ''
              return '- ' + tag + r.text
            }).join('\n')
          : ''
      } catch { recentText = '' }
    }
    refresh()

    try {
      ctx.systemPrompt.context({
        name: 'deep-soul-recent',
        order: 900,
        text: () => recentText,
      })
    } catch (e) { log('context failed:', e && e.message) }

    // 每分钟刷新最近记忆；每天 04:10 之后跑一次夜间巩固。
    let lastNightly = ''
    try {
      ctx.effect(() => ctx.interval(async () => {
        await refresh()
        const now = new Date()
        const p2 = (n) => String(n).padStart(2, '0')
        const day = now.getFullYear() + '-' + p2(now.getMonth() + 1) + '-' + p2(now.getDate())
        // 04:00 之后任意时刻补跑一次；内核里还有 last_nightly_day 去重，重启不会重复
        if (now.getHours() >= 4 && lastNightly !== day) {
          lastNightly = day
          try { await sidecar.request('nightly', {}, 120000) } catch (e) { log('nightly failed:', e && e.message) }
        }
      }, 60000))
    } catch (e) { log('interval failed:', e && e.message) }

    try {
      ctx.effect(() => () => sidecar.stop())
    } catch {}

    log('loaded; db =', DB_PATH, '; root =', existsSync(DEFAULT_ROOT))
  } catch (e) {
    log('apply failed, plugin disabled:', e && e.message)
  }
}
