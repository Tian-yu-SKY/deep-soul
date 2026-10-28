// inbox.js —— 从 QQ 的唤醒提示里抠出「本次消息快照」，给预取和群记忆用。
//
// 桥接会在唤醒 prompt 里放一段：
//   【本次消息快照】
//   {"messages":[{"seq":1776,"messageId":"...","sender":"...","text":"...","isSelf":true}, ...],"unreadCount":2,...}
// 以前预取直接拿 prompt 开头 300 字当查询，拿到的其实是「Current runtime context…」，
// 所以 QQ 会话里的预取基本是瞎的。这里把真正的消息解出来，顺便给群记忆自动入库用。

export function extractSnapshot(text) {
  const s = String(text || '')
  const i = s.lastIndexOf('【本次消息快照】')
  if (i < 0) return null
  const start = s.indexOf('{', i)
  if (start < 0) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let k = start; k < s.length; k++) {
    const ch = s[k]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        try { return JSON.parse(s.slice(start, k + 1)) } catch { return null }
      }
    }
  }
  return null
}

const MARKER = /\[(?:图片|表情|动画表情|语音|视频|文件|转发消息)[^\]]*\]/g

export function cleanText(text) {
  return String(text == null ? '' : text)
    .replace(MARKER, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function lastSpeakerText(snapshot) {
  const msgs = snapshot && Array.isArray(snapshot.messages) ? snapshot.messages : []
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]
    if (!m || m.isSelf) continue
    const t = cleanText(m.text)
    if (t) return t
  }
  return ''
}
