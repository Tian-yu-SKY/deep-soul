// 通过正在运行的 DSH Web API 跑探针（借用 qq-bridge 的客户端与鉴权）。
import { readFileSync, appendFileSync } from 'node:fs'
import { NodeApiClient, unwrap, createTurnCollector } from '/home/qqbot/qq-bridge/src/dsh-client.js'

const argv = new Map()
for (let i = 2; i < process.argv.length; i += 2) argv.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1])
const out = argv.get('out') || '/tmp/deep-soul-probes.jsonl'
const limit = Number(argv.get('limit') || 0)
const start = Number(argv.get('start') || 0)
const askTimeout = Number(argv.get('timeout') || 60000)
const preset = argv.get('preset') || 'qq-chat'
const base = argv.get('base') || 'http://127.0.0.1:3080'

const probes = JSON.parse(readFileSync('/home/qqbot/安装/mindcore/probes.json', 'utf8'))
const list = (limit ? probes.slice(0, limit) : probes).slice(start)
console.log('[bench] probes', list.length, 'preset', preset)

const api = new NodeApiClient(base, 120000, {})
const withTimeout = (p, ms, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(label + ' timeout')), ms))])

const ws = unwrap(await withTimeout(api.workspace.create({ path: '/home/qqbot/安装' }), 30000, 'workspace.create'), 'workspace.create')
console.log('[bench] workspace', ws.workspace.workspaceId)

let sid
try {
  sid = unwrap(await withTimeout(api.sessions.create({ workspaceId: ws.workspace.workspaceId, agentPreset: preset }), 30000, 'session.create'), 'session.create').sessionId
} catch (e) {
  console.log('[bench] preset failed:', e.message)
  sid = unwrap(await withTimeout(api.sessions.create({ workspaceId: ws.workspace.workspaceId }), 30000, 'session.create'), 'session.create').sessionId
}
console.log('[bench] session', sid)
api.events.follow(sid)

let collector = null
let settle = null
let usageBuf = []
void (async () => {
  try {
    for await (const env of api.events.mux({})) {
      const f = env?.payload
      if (!f || f.type !== 'session/event' || f.sessionId !== sid) continue
      const ev = f.event
      if (ev?.data?.usage) {
        const u = ev.data.usage
        if (!globalThis.__usageLogged) { globalThis.__usageLogged = true; console.error('[usage sample]', JSON.stringify(u)) }
        usageBuf.push(u)
      }
      const ended = collector ? collector.push(ev) : null
      if (ended && settle) { const fn = settle; settle = null; fn(ended) }
    }
  } catch (e) { console.log('[bench] mux ended:', e.message) }
})()

function ask(text, timeoutMs = 180000) {
  return new Promise((resolve) => {
    collector = {
      text: '',
      push(e) {
        if (e?.type === 'assistant/message') {
          for (const b of e.data?.message?.content ?? []) if (b?.type === 'text') this.text += b.text
          return null
        }
        if (e?.type === 'turn/end') return { text: this.text, reason: e.data?.reason }
        return null
      },
    }
    settle = (ended) => resolve({ text: ended.text, reason: ended.reason })
    const timer = setTimeout(() => { settle = null; collector = null; resolve({ text: '', reason: 'timeout' }) }, timeoutMs)
    api.sessions.prompt({ sessionId: sid, mode: 'queue', content: [{ type: 'text', text }] })
      .then((resp) => { if (!resp?.result?.ok) { clearTimeout(timer); settle = null; collector = null; resolve({ text: '', reason: 'prompt-failed:' + JSON.stringify(resp?.result?.error) }) } })
      .catch((e) => { clearTimeout(timer); settle = null; collector = null; resolve({ text: '', reason: 'prompt-error:' + e.message }) })
  })
}

for (const p of list) {
  const t0 = Date.now()
  usageBuf = []
  const r = await ask(p.text, askTimeout)
  const sum = (k) => usageBuf.reduce((a, u) => a + (Number(u[k]) || 0), 0)
  const usage = { calls: usageBuf.length, input: sum('inputTokens'), output: sum('outputTokens'), cacheRead: sum('cacheReadTokens'), cacheMiss: sum('cacheMissTokens') }
  appendFileSync(out, JSON.stringify({ id: p.id, category: p.category, prompt: p.text, response: r.text, reason: r.reason, usage, sec: ((Date.now() - t0) / 1000).toFixed(1) }) + '\n')
  console.log(p.id, r.text.length, '字', ((Date.now() - t0) / 1000).toFixed(1) + 's', r.reason)
}
console.log('done ->', out)
process.exit(0)
