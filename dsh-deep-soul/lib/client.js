// DSH Deep-Soul v4.3 · 网页半边：左侧栏「识海」· 分舱记忆图（HUD 科技感）
//
// 手写的客户端 bundle（无构建步骤）：window.__ModuleLoader__.load({ id, factory })。
// 只 require('react')，只用 React.createElement；没有 import、没有 JSX。
//
// 视觉：浅色 #f8fbff 画布 + 24px 极淡网格 + 中心径向淡蓝光；三环做成 HUD 环
//      （细虚线 + 每 15° 小刻度 + 右上角 CORE/MID/EDGE 等宽小字）；
//      团是淡青柔光 + 虚线边界 + 「关系 · 3」浅底标签；节点是冷色发光点；
//      四角 HUD 角标 + 顶部/底部扫描线渐变；顶栏、右栏卡片都是浅色 HUD 控件。
//
// 交互：悬停高亮 + 跟手浮层、点击看详情、想起来一次（POST touch）、最近想起、
//      时间旅行（现在/+30d/+90d/+200d）、重算、空库/错误提示；驱力没数据时显示「驱力还没启动」。
//
// 数据只读宿主注册的 /deep-soul/* 路由（同源 fetch），返回 { ok:true, data }。

window.__ModuleLoader__.load({
  id: 'dsh-deep-soul',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const h = React.createElement
    const useRef = React.useRef
    const useState = React.useState
    const useEffect = React.useEffect
    const useMemo = React.useMemo
    const inject = ['slots']

    const API = '/deep-soul'
    const NODE_LIMIT = 1600
    const MAX_CLUSTERS = 12
    const STYLE_ID = 'deep-soul-style'
    const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
    const SANS = 'ui-sans-serif, system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'

    // ---------- 分区配色（冷色系发光点）/ 标签 ----------
    const REGION_COLOR = {
      relation: '#2f6fd0',
      episode: '#6c5bd6',
      fact: '#1f8f8a',
      preference: '#1f8f9a',
      spine: '#d8443f',
      self: '#4a6fa8',
      core: '#b08a3e',
      habit: '#3f86c8',
      flash: '#b45a8a',
      texture: '#8a8fa8',
      trivia: '#6f7f92',
      theme: '#5f7fb0',
      other: '#7d8aa0',
    }
    const REGION_LABEL = {
      relation: '关系', episode: '情景', fact: '事实', preference: '偏好',
      spine: '刺', self: '自我', core: '核心', habit: '习惯', flash: '闪回',
      texture: '质感', trivia: '琐事', theme: '主题', other: '其他',
    }
    const REGION_ORDER = ['relation', 'episode', 'fact', 'preference', 'spine', 'self', 'flash', 'texture', 'habit', 'trivia', 'theme', 'core', 'other']

    const DRIVES = [
      { key: 'social', label: '社交' },
      { key: 'curiosity', label: '好奇' },
      { key: 'play', label: '玩耍' },
      { key: 'rest', label: '休息' },
      { key: 'recognition', label: '认可' },
      { key: 'achievement', label: '成就' },
      { key: 'autonomy', label: '自主' },
    ]

    // ---------- 样式：浅色 HUD ----------
    const CSS = `
.ds-panel{display:flex;flex-direction:column;width:100%;height:100%;min-height:520px;box-sizing:border-box;background:linear-gradient(180deg,#f7fbff 0%,#f2f7fd 100%);color:#1c3348;font-size:13px;line-height:1.6;overflow:hidden}
.ds-top{display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap;padding:14px 20px 8px;flex:none}
.ds-headings{min-width:0;flex:1 1 240px}
.ds-title{margin:0;font-size:20px;line-height:1.25;font-weight:600;letter-spacing:.06em;color:#143a5c}
.ds-title em{font-style:normal;font-size:10px;letter-spacing:.18em;color:#3f86c8;margin-left:8px;vertical-align:2px;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace}
.ds-sub{margin-top:3px;font-size:11px;line-height:1.6;color:#6a8cad;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace}
.ds-actions{display:flex;gap:6px;flex:none;flex-wrap:wrap;align-items:center;padding-top:2px}
.ds-btn{border:1px solid rgba(40,120,190,.32);border-radius:5px;background:rgba(255,255,255,.82);color:#2f6f9f;padding:5px 11px;font:inherit;font-size:11.5px;line-height:1.4;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;cursor:pointer;transition:background .12s,border-color .12s,color .12s,box-shadow .12s;box-shadow:0 1px 2px rgba(40,110,180,.06)}
.ds-btn:hover{background:#f0f7ff;border-color:rgba(40,130,200,.6);color:#1f6fa8;box-shadow:0 0 10px rgba(70,150,220,.18)}
.ds-btn:focus-visible{outline:2px solid rgba(40,140,210,.6);outline-offset:1px}
.ds-btn:disabled{opacity:.5;cursor:default}
.ds-btn-on,.ds-btn-on:hover{border-color:#2f86c8;background:rgba(70,150,220,.14);color:#145a8c;box-shadow:inset 0 0 10px rgba(70,150,220,.12),0 0 10px rgba(70,150,220,.14)}
.ds-status{display:flex;align-items:center;gap:2px;flex-wrap:wrap;padding:4px 20px 9px;font-size:11px;color:#527a99;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;flex:none}
.ds-status-sys{color:#2f86c8;letter-spacing:.12em;font-weight:600;padding:0 6px;border:1px solid rgba(40,130,200,.35);border-radius:3px;margin-right:8px;background:rgba(70,150,220,.07)}
.ds-status b{color:#1f5f8f;font-weight:600;margin-left:3px;font-variant-numeric:tabular-nums}
.ds-status i{opacity:.4;font-style:normal;margin:0 5px}
.ds-view{margin-left:auto;color:#7c9ab3;font-size:10.5px;padding-left:12px}
.ds-view-travel{color:#1f7fc4;text-shadow:0 0 8px rgba(70,150,220,.3)}
.ds-fail{margin:6px 20px 0;padding:8px 12px;border-radius:6px;border:1px solid rgba(200,70,70,.35);background:rgba(220,90,90,.07);color:#a63a3a;font-size:12px;line-height:1.7;flex:none;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace}
.ds-dim{color:#7c9ab3;font-size:11px;margin-top:2px}
.ds-body{flex:1 1 auto;min-height:0;display:flex;gap:14px;padding:4px 20px 0;overflow:hidden}
.ds-main{flex:1 1 auto;min-width:0;min-height:0;display:flex;flex-direction:column;gap:6px}
.ds-stage{position:relative;flex:1 1 auto;min-height:260px;border:1px solid rgba(40,120,190,.25);border-radius:10px;background:#f8fbff;overflow:hidden;box-shadow:inset 0 0 40px rgba(90,160,220,.10),0 4px 18px rgba(60,120,180,.08)}
.ds-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;cursor:crosshair}
.ds-tip{position:absolute;z-index:4;pointer-events:none;max-width:260px;padding:7px 10px;border-radius:6px;border:1px solid rgba(40,130,200,.4);background:rgba(255,255,255,.97);box-shadow:0 6px 20px rgba(40,90,140,.18),0 0 0 1px rgba(90,170,230,.06);color:#1c3348;font-size:11.5px;line-height:1.55;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace}
.ds-tip-title{font-weight:600;font-size:10.5px;color:#1f6fa8;margin-bottom:2px;letter-spacing:.03em}
.ds-tip-time{font-size:10px;color:#7c9ab3;margin-bottom:2px}
.ds-tip-text{color:#2b4155;word-break:break-word}
.ds-empty{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);max-width:320px;text-align:center;font-size:12px;line-height:1.8;color:#5f86a5;background:rgba(255,255,255,.9);border:1px dashed rgba(40,130,200,.4);border-radius:8px;padding:10px 14px;pointer-events:none;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace}
.ds-standin{flex:1 1 auto;min-height:260px;border:1px dashed rgba(40,130,200,.35);border-radius:10px;background:#f8fbff;display:flex;align-items:center;justify-content:center;padding:20px;text-align:center;font-size:12px;line-height:1.8;color:#6a8cad;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace}
.ds-legend{flex:none;display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:1px 4px;font-size:10.5px;color:#6a8cad;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace}
.ds-leg{display:inline-flex;align-items:center;gap:5px}
.ds-leg i{width:7px;height:7px;border-radius:50%;display:inline-block;flex:none;box-shadow:0 0 5px currentColor}
.ds-leg-keys{margin-left:auto;font-size:10px;color:#8aa6bd}
.ds-side{width:334px;flex:none;display:flex;flex-direction:column;gap:12px;min-height:0;overflow:auto;padding-bottom:10px}
.ds-card{border:1px solid rgba(40,120,190,.22);border-radius:10px;background:rgba(255,255,255,.86);padding:11px 13px;flex:none;box-shadow:0 3px 14px rgba(60,120,180,.08),inset 0 0 22px rgba(120,180,230,.05)}
.ds-card-h{font-size:11px;font-weight:600;letter-spacing:.1em;margin:0 0 8px;color:#1f6fa8;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace}
.ds-recall{display:block;width:100%;text-align:left;border:1px solid transparent;border-radius:7px;background:transparent;padding:8px 9px;cursor:pointer;font:inherit;color:inherit;margin-bottom:2px;box-sizing:border-box;transition:background .12s,border-color .12s}
.ds-recall:hover{background:rgba(70,150,220,.07)}
.ds-recall-on,.ds-recall-on:hover{border-color:rgba(40,130,200,.4);background:rgba(70,150,220,.10)}
.ds-recall-top{display:flex;align-items:center;gap:8px;margin-bottom:3px;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace}
.ds-chip{font-size:10px;line-height:1.5;padding:0 6px;border-radius:3px;border:1px solid currentColor;opacity:.9;letter-spacing:.02em}
.ds-recall-text{font-size:12.5px;line-height:1.55;color:#2b4155;word-break:break-word}
.ds-recall-q{font-size:10px;color:#7c9ab3;margin-top:2px;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace}
.ds-detail-text{font-size:12.5px;line-height:1.75;white-space:pre-wrap;word-break:break-word;margin-bottom:8px;color:#22384c}
.ds-kv{display:flex;gap:8px;font-size:11px;line-height:1.9;align-items:baseline;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace}
.ds-kv-k{flex:none;min-width:52px;color:#7c9ab3}
.ds-kv b{color:#1f4f74;font-weight:500;min-width:0;word-break:break-word}
.ds-ev{margin-top:8px;border-top:1px dashed rgba(40,120,190,.22);padding-top:7px}
.ds-ev-h{font-size:10px;color:#7c9ab3;margin-bottom:2px;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;letter-spacing:.06em}
.ds-ev-item{font-size:11.5px;line-height:1.65;padding:4px 0;color:#527a99;border-bottom:1px solid rgba(40,120,190,.08)}
.ds-ev-item:last-child{border-bottom:0}
.ds-ev-meta{font-size:10px;color:#7c9ab3;margin-bottom:1px;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace}
.ds-ev-text{color:#2b4155;word-break:break-word}
.ds-btn-row{display:flex;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap}
.ds-msg{font-size:11px;color:#1f7fc4;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace}
.ds-msg-bad{color:#a63a3a}
.ds-bottom{flex:none;display:flex;align-items:center;gap:20px;flex-wrap:wrap;padding:8px 20px 11px;border-top:1px solid rgba(40,120,190,.16);font-size:10.5px;color:#6a8cad;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;background:rgba(255,255,255,.55)}
.ds-stats{display:flex;gap:16px;flex-wrap:wrap;align-items:baseline}
.ds-stat b{color:#1f5f8f;font-weight:600;font-variant-numeric:tabular-nums;margin-left:3px}
.ds-drives{display:flex;gap:10px;margin-left:auto;align-items:flex-end;flex-wrap:wrap}
.ds-drive{width:44px}
.ds-drive-l{font-size:9.5px;line-height:1.4;color:#7c9ab3;display:flex;justify-content:space-between;gap:2px}
.ds-drive-v{font-variant-numeric:tabular-nums;opacity:.85}
.ds-drive-track{height:3px;border-radius:2px;background:rgba(70,140,200,.16);overflow:hidden;margin-top:3px}
.ds-drive-fill{height:100%;border-radius:2px;background:linear-gradient(90deg,#5fb2e8,#1f7fc4);box-shadow:0 0 6px rgba(70,160,230,.4)}
.ds-drives-empty{color:#7c9ab3;font-size:10.5px;letter-spacing:.06em}
@media (max-width: 980px){.ds-body{flex-direction:column;overflow:auto}.ds-main{min-height:440px;flex:none}.ds-side{width:auto;overflow:visible}}
@media (max-width: 640px){.ds-body{padding:4px 12px 0}.ds-top{padding:12px 12px 8px}.ds-status{padding-left:12px;padding-right:12px}.ds-bottom{padding:8px 12px 10px}.ds-fail{margin-left:12px;margin-right:12px}}
`

    function ensureStyle() {
      if (typeof document === 'undefined' || !document || !document.head) return
      if (document.getElementById(STYLE_ID)) return
      var el = document.createElement('style')
      el.id = STYLE_ID
      el.textContent = CSS
      document.head.appendChild(el)
    }

    // ---------- 小工具 ----------
    function clamp(v, a, b) { return v < a ? a : (v > b ? b : v) }
    function num(v, d) {
      var n = Number(v)
      return typeof v !== 'boolean' && isFinite(n) ? n : (d == null ? 0 : d)
    }
    function numText(v) {
      var n = Number(v)
      return isFinite(n) ? (Math.round(n * 100) / 100).toFixed(2) : '—'
    }
    function errText(e) {
      return String((e && (e.message || e.error)) || e || '未知错误')
    }
    function rgba(hex, a) {
      var s = String(hex || '#ffffff').replace('#', '')
      if (s.length === 3) s = s.charAt(0) + s.charAt(0) + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2)
      var n = parseInt(s, 16)
      if (!isFinite(n)) return 'rgba(80,140,190,' + a + ')'
      return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'
    }
    function regionColor(r) { return REGION_COLOR[r] || '#7d8aa0' }
    function regionLabel(r) {
      if (!r) return '记忆'
      return REGION_LABEL[r] || String(r)
    }
    // 确定性伪随机：同一个种子每次得到同一个 [0,1) 数
    function hash01(seed) {
      var s = String(seed)
      var x = 2166136261 >>> 0
      for (var i = 0; i < s.length; i++) {
        x ^= s.charCodeAt(i)
        x = Math.imul(x, 16777619) >>> 0
      }
      x ^= x >>> 13
      x = Math.imul(x, 0x5bd1e995) >>> 0
      x ^= x >>> 15
      return (x >>> 0) / 4294967296
    }
    function pad2(n) { return n < 10 ? '0' + n : '' + n }
    function todayStr() {
      var d = new Date()
      return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
    }
    function addDays(day, n) {
      var p = String(day).split('-')
      var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]))
      d.setDate(d.getDate() + n)
      return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
    }
    function fmtDateTime(ts) {
      var n = Number(ts)
      if (!n || !isFinite(n)) return '—'
      var d = new Date(n * 1000)
      return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes())
    }
    function fmtAgo(ts) {
      var n = Number(ts)
      if (!n || !isFinite(n)) return '—'
      var diff = Date.now() / 1000 - n
      if (diff < 0) diff = 0
      if (diff < 60) return '刚刚'
      if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前'
      if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前'
      if (diff < 86400 * 30) return Math.floor(diff / 86400) + ' 天前'
      if (diff < 86400 * 365) return Math.floor(diff / 86400 / 30) + ' 个月前'
      return Math.floor(diff / 86400 / 365) + ' 年前'
    }
    function clip(text, n) {
      var s = String(text == null ? '' : text).trim()
      if (s.length > n) return s.slice(0, n) + '…'
      return s
    }

    // ---------- 数据接口 ----------
    function readJSON(res) {
      return res.json().then(function (body) {
        if (!res.ok || !body || body.ok === false) {
          var msg = body && (body.error || body.message)
          throw new Error(msg || ('HTTP ' + res.status))
        }
        return body.data
      }, function () {
        throw new Error('返回的不是 JSON（HTTP ' + res.status + '）')
      })
    }
    function getJSON(url) {
      return fetch(url, { cache: 'no-store', credentials: 'same-origin' }).then(readJSON)
    }
    function postJSON(url, payload) {
      return fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload || {}),
        cache: 'no-store',
        credentials: 'same-origin',
      }).then(readJSON)
    }

    // ---------- 布局：中心自我 + 四周分舱（团） ----------
    function buildLayout(data, W, H) {
      if (!data || !W || !H || W < 80 || H < 80) return null
      var allNodes = Array.isArray(data.nodes) ? data.nodes.slice(0, NODE_LIMIT) : []
      var stats = data.stats || {}
      var cx = W * 0.5
      var cy = H * 0.5
      var minDim = Math.min(W, H)
      var R = minDim * 0.455
      var coreR = clamp(minDim * 0.095, 24, 62)

      // 舱的元数据
      var clById = {}
      var rawClusters = Array.isArray(data.clusters) ? data.clusters : []
      for (var i = 0; i < rawClusters.length; i++) {
        var rc = rawClusters[i]
        if (rc && rc.id != null) clById[String(rc.id)] = rc
      }

      // 1) 按舱分组（没有舱就按 受众:分区 分）
      var groups = {}
      var groupOrder = []
      for (var k = 0; k < allNodes.length; k++) {
        var raw = allNodes[k]
        var key = String(raw.cluster != null ? raw.cluster : ((raw.audience || '?') + ':' + (raw.region || '?')))
        var g = groups[key]
        if (!g) {
          var meta = clById[key]
          g = groups[key] = {
            id: key,
            label: (meta && meta.label) || regionLabel(meta ? meta.region : raw.region),
            region: (meta && meta.region) || raw.region || 'other',
            audience: (meta && meta.audience) || raw.audience || '',
            nodes: [],
            x: 0, y: 0, r: 0,
          }
          groupOrder.push(key)
        }
        g.nodes.push(raw)
      }

      // 2) 团太多：只留最大的 MAX_CLUSTERS 个，其余并进「其他」
      var list = []
      for (var gi = 0; gi < groupOrder.length; gi++) list.push(groups[groupOrder[gi]])
      list.sort(function (a, b) {
        if (b.nodes.length !== a.nodes.length) return b.nodes.length - a.nodes.length
        return String(a.id) < String(b.id) ? -1 : 1
      })
      if (list.length > MAX_CLUSTERS) {
        var other = { id: '__other', label: '其他', region: 'other', audience: '', nodes: [], x: 0, y: 0, r: 0 }
        for (var oi = MAX_CLUSTERS; oi < list.length; oi++) {
          var og = list[oi]
          for (var on = 0; on < og.nodes.length; on++) other.nodes.push(og.nodes[on])
        }
        list = list.slice(0, MAX_CLUSTERS)
        list.push(other)
      }

      // 3) 团大小 + 团心（黄金角摆开，再分离）
      var sizeMax = 1
      for (var si = 0; si < list.length; si++) if (list[si].nodes.length > sizeMax) sizeMax = list[si].nodes.length
      var baseR = clamp(minDim * 0.032, 16, 40)
      var maxR = minDim * 0.16
      var nCl = Math.max(1, list.length)
      for (var ci = 0; ci < list.length; ci++) {
        var c = list[ci]
        c.r = clamp(baseR * (0.8 + 2.6 * Math.sqrt(c.nodes.length / sizeMax)), baseR * 0.55, maxR)
        c.count = c.nodes.length
        c.nodeScale = clamp(1.1 / Math.sqrt(1 + c.count / 24), 0.5, 1.02)
        var ang = -Math.PI / 2 + ci * 2.399963229728653
        var frac = 0.34 + 0.5 * Math.sqrt((ci + 0.55) / (nCl + 0.6))
        var dist = R * frac
        c.x = cx + Math.cos(ang) * dist
        c.y = cy + Math.sin(ang) * dist
      }

      // 4) 简单分离：团别互相压、别压住中心的自核
      var pad = clamp(minDim * 0.008, 4, 9)
      for (var it = 0; it < 60; it++) {
        var moved = false
        for (var a = 0; a < list.length; a++) {
          for (var b = a + 1; b < list.length; b++) {
            var ca = list[a]
            var cb = list[b]
            var dx = cb.x - ca.x
            var dy = cb.y - ca.y
            var d = Math.hypot(dx, dy)
            var need = ca.r + cb.r + pad
            if (d < need) {
              if (d < 0.001) { dx = 1; dy = 0; d = 1 }
              var push = (need - d) / 2
              ca.x -= dx / d * push
              ca.y -= dy / d * push
              cb.x += dx / d * push
              cb.y += dy / d * push
              moved = true
            }
          }
        }
        for (var mi = 0; mi < list.length; mi++) {
          var mg = list[mi]
          var mdx = mg.x - cx
          var mdy = mg.y - cy
          var md = Math.hypot(mdx, mdy)
          if (md < 0.001) { mdx = 1; mdy = 0; md = 1 }
          var minD = coreR + mg.r + pad
          if (md < minD) {
            mg.x = cx + mdx / md * minD
            mg.y = cy + mdy / md * minD
          }
          mg.x = clamp(mg.x, mg.r + 8, W - mg.r - 8)
          mg.y = clamp(mg.y, mg.r + 8, H - mg.r - 26)
        }
        if (!moved) break
      }

      // 5) 节点撒进团里（确定性：同一个 id 永远同一个位置）
      var nodes = []
      var nodeMap = new Map()
      for (var li = 0; li < list.length; li++) {
        var cl = list[li]
        for (var ni = 0; ni < cl.nodes.length; ni++) {
          var nd = cl.nodes[ni]
          var na = hash01('a|' + nd.id) * Math.PI * 2
          var nr = cl.r * (0.1 + 0.86 * Math.sqrt(hash01('r|' + nd.id)))
          var fade = clamp(num(nd.fade, 1), 0.06, 1)
          var affect = clamp(num(nd.affect, 1), 0.2, 12)
          var text = String(nd.text == null ? '' : nd.text).trim()
          var node = {
            id: nd.id,
            raw: nd,
            x: cl.x + Math.cos(na) * nr,
            y: cl.y + Math.sin(na) * nr,
            r: clamp(1.4 + affect * 0.32, 1.4, 5.8),
            color: regionColor(nd.region),
            alpha: 0.34 + 0.66 * fade,
            fade: fade,
            spike: !!nd.spike,
            fadeChar: fade < 0.18 ? (text.charAt(0) || '·') : null,
            cluster: cl,
            breathPeriod: 4 + hash01('per|' + nd.id) * 3,
            breathPhase: hash01('pha|' + nd.id) * Math.PI * 2,
          }
          if (node.fadeChar) node.r = 0
          nodes.push(node)
          nodeMap.set(String(nd.id), node)
        }
      }

      // 6) 边（只画两端都在图上的）
      var edges = []
      var rawEdges = Array.isArray(data.edges) ? data.edges : []
      for (var ei = 0; ei < rawEdges.length && edges.length < 500; ei++) {
        var e = rawEdges[ei]
        if (!e || e.length < 2) continue
        var ea = nodeMap.get(String(e[0]))
        var eb = nodeMap.get(String(e[1]))
        if (ea && eb) edges.push({ a: ea, b: eb })
      }

      // 7) 各分区计数（图例用）
      var regionCount = {}
      for (var ri = 0; ri < nodes.length; ri++) {
        var rr = nodes[ri].raw.region || 'other'
        regionCount[rr] = (regionCount[rr] || 0) + 1
      }

      return {
        w: W, h: H, cx: cx, cy: cy, R: R, coreR: coreR,
        clusters: list, nodes: nodes, nodeMap: nodeMap, edges: edges,
        regionCount: regionCount,
        claims: num(stats.claims, 0),
        total: num(stats.nodes, nodes.length),
        shown: nodes.length,
        cells: num(stats.cells, list.length),
        coreLevel: num(stats.core_level, 0),
        importantLevel: num(stats.important_level, 0),
        selfCount: num(stats.self, 0),
        relationCount: num(stats.relation, 0),
      }
    }

    // ---------- 静态背景：网格 / HUD 三环刻度 / 团 / 角标（缓存到离屏 canvas，动画不重画） ----------
    function paintStatic(g, L) {
      var W = L.w, H = L.h, cx = L.cx, cy = L.cy, R = L.R
      g.save()

      // 底 + 极淡网格
      g.fillStyle = '#f8fbff'
      g.fillRect(0, 0, W, H)
      g.strokeStyle = 'rgba(50,110,190,0.055)'
      g.lineWidth = 0.5
      g.beginPath()
      var gx
      for (gx = 12; gx < W; gx += 24) { g.moveTo(gx + 0.5, 0); g.lineTo(gx + 0.5, H) }
      var gy
      for (gy = 12; gy < H; gy += 24) { g.moveTo(0, gy + 0.5); g.lineTo(W, gy + 0.5) }
      g.stroke()

      // 中心径向淡蓝光
      var glow = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.62)
      glow.addColorStop(0, 'rgba(95,165,235,0.18)')
      glow.addColorStop(0.5, 'rgba(120,180,240,0.07)')
      glow.addColorStop(1, 'rgba(150,200,250,0)')
      g.fillStyle = glow
      g.fillRect(0, 0, W, H)

      // HUD 三环：细虚线 + 每 15° 小刻度 + 右上角等宽标签
      var rings = [0.44, 0.72, 0.97]
      var ringNames = ['CORE', 'MID', 'EDGE']
      for (var ri = 0; ri < rings.length; ri++) {
        var rr = R * rings[ri]
        g.strokeStyle = 'rgba(45,120,190,0.24)'
        g.lineWidth = 0.8
        if (g.setLineDash) g.setLineDash([3, 5])
        g.beginPath()
        g.arc(cx, cy, rr, 0, Math.PI * 2)
        g.stroke()
        if (g.setLineDash) g.setLineDash([])
        // 小刻度（每 15°）
        g.strokeStyle = 'rgba(45,120,190,0.3)'
        g.lineWidth = 0.8
        g.beginPath()
        for (var t = 0; t < 24; t++) {
          var ta = t * Math.PI / 12
          g.moveTo(cx + Math.cos(ta) * (rr - 3), cy + Math.sin(ta) * (rr - 3))
          g.lineTo(cx + Math.cos(ta) * (rr + 3), cy + Math.sin(ta) * (rr + 3))
        }
        g.stroke()
      }

      // 团：柔光 + 虚线边界
      for (var ci = 0; ci < L.clusters.length; ci++) {
        var c = L.clusters[ci]
        var halo = g.createRadialGradient(c.x, c.y, c.r * 0.1, c.x, c.y, c.r * 1.35)
        halo.addColorStop(0, 'rgba(80,170,220,0.10)')
        halo.addColorStop(0.6, 'rgba(90,180,230,0.05)')
        halo.addColorStop(1, 'rgba(120,200,240,0)')
        g.fillStyle = halo
        g.beginPath()
        g.arc(c.x, c.y, c.r * 1.35, 0, Math.PI * 2)
        g.fill()
        if (g.setLineDash) g.setLineDash([4, 4])
        g.strokeStyle = 'rgba(45,140,190,0.45)'
        g.lineWidth = 1
        g.beginPath()
        g.arc(c.x, c.y, c.r, 0, Math.PI * 2)
        g.stroke()
        if (g.setLineDash) g.setLineDash([])
        g.strokeStyle = 'rgba(45,140,190,0.12)'
        g.lineWidth = 0.7
        g.beginPath()
        g.arc(c.x, c.y, c.r * 0.92, 0, Math.PI * 2)
        g.stroke()
      }

      // 团外短毛 + 团内尘埃（确定性伪随机）
      for (var hi = 0; hi < L.clusters.length; hi++) {
        var hc = L.clusters[hi]
        var hcount = clamp(Math.round(hc.r * 0.85), 60, 150)
        g.lineWidth = 0.5
        for (var hj = 0; hj < hcount; hj++) {
          var ha = hash01(hc.id + '|ha' + hj) * Math.PI * 2
          var hr0 = hc.r * (0.97 + 0.12 * hash01(hc.id + '|hr' + hj))
          var hlen = 3 + 15 * hash01(hc.id + '|hl' + hj)
          g.strokeStyle = 'rgba(80,140,190,' + (0.05 + 0.1 * hash01(hc.id + '|ho' + hj)).toFixed(3) + ')'
          g.beginPath()
          g.moveTo(hc.x + Math.cos(ha) * hr0, hc.y + Math.sin(ha) * hr0)
          g.lineTo(hc.x + Math.cos(ha) * (hr0 + hlen), hc.y + Math.sin(ha) * (hr0 + hlen))
          g.stroke()
        }
        var dcount = clamp(Math.round(26 + hc.nodes.length * 1.1), 26, 96)
        for (var dj = 0; dj < dcount; dj++) {
          var da = hash01(hc.id + '|da' + dj) * Math.PI * 2
          var dr = hc.r * 1.06 * Math.sqrt(hash01(hc.id + '|dr' + dj))
          var ds = 0.5 + 1.1 * hash01(hc.id + '|ds' + dj)
          g.fillStyle = 'rgba(70,135,190,' + (0.1 + 0.17 * hash01(hc.id + '|do' + dj)).toFixed(3) + ')'
          g.beginPath()
          g.arc(hc.x + Math.cos(da) * dr, hc.y + Math.sin(da) * dr, ds, 0, Math.PI * 2)
          g.fill()
        }
      }

      // 节点之间的淡线
      if (L.edges.length) {
        g.strokeStyle = 'rgba(70,125,180,0.10)'
        g.lineWidth = 0.5
        g.beginPath()
        for (var ei = 0; ei < L.edges.length; ei++) {
          g.moveTo(L.edges[ei].a.x, L.edges[ei].a.y)
          g.lineTo(L.edges[ei].b.x, L.edges[ei].b.y)
        }
        g.stroke()
      }

      // 团标签「关系 · 3」浅底
      for (var li = 0; li < L.clusters.length; li++) {
        var cl = L.clusters[li]
        var text = (cl.id === '__other' ? '其他' : cl.label) + ' · ' + cl.count
        drawChip(g, text, cl.x, Math.min(H - 14, cl.y + cl.r + 11), regionColor(cl.region))
      }

      // HUD 环标签（画在团之上，保证可读）
      for (var rl = 0; rl < rings.length; rl++) {
        var rlr = R * rings[rl]
        var lx = cx + rlr * 0.7071 + 6
        var ly = cy - rlr * 0.7071
        var lw = g.measureText ? g.measureText(ringNames[rl]).width : 28
        g.font = '9px ' + MONO
        g.textAlign = 'left'
        g.textBaseline = 'middle'
        g.fillStyle = 'rgba(255,255,255,0.85)'
        g.fillRect(lx - 3, ly - 7, lw + 6, 14)
        g.fillStyle = 'rgba(40,110,170,0.62)'
        g.fillText(ringNames[rl], lx, ly)
      }

      // 顶部 / 底部扫描线渐变
      var topScan = g.createLinearGradient(0, 0, 0, 46)
      topScan.addColorStop(0, 'rgba(95,170,235,0.12)')
      topScan.addColorStop(1, 'rgba(95,170,235,0)')
      g.fillStyle = topScan
      g.fillRect(0, 0, W, 46)
      var botScan = g.createLinearGradient(0, H - 40, 0, H)
      botScan.addColorStop(0, 'rgba(95,170,235,0)')
      botScan.addColorStop(1, 'rgba(95,170,235,0.10)')
      g.fillStyle = botScan
      g.fillRect(0, H - 40, W, 40)

      // 四角 HUD 角标
      var m = 12, len = 18
      g.strokeStyle = 'rgba(35,110,180,0.4)'
      g.lineWidth = 1.3
      g.beginPath()
      g.moveTo(m, m + len); g.lineTo(m, m); g.lineTo(m + len, m)
      g.moveTo(W - m - len, m); g.lineTo(W - m, m); g.lineTo(W - m, m + len)
      g.moveTo(m, H - m - len); g.lineTo(m, H - m); g.lineTo(m + len, H - m)
      g.moveTo(W - m - len, H - m); g.lineTo(W - m, H - m); g.lineTo(W - m, H - m - len)
      g.stroke()

      // 角上的等宽小字
      g.fillStyle = 'rgba(40,110,170,0.4)'
      g.font = '8.5px ' + MONO
      g.textAlign = 'left'
      g.textBaseline = 'top'
      g.fillText('DS // MEMORY MAP', m + 6, m + 4)
      g.textAlign = 'right'
      g.textBaseline = 'bottom'
      g.fillText('GRID 24 · NODES ' + L.shown + ' · CELLS ' + L.cells, W - m - 6, H - m - 4)
      g.restore()
    }

    function drawChip(g, text, x, y, color) {
      g.font = '10.5px ' + MONO
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      var m = g.measureText ? g.measureText(text) : null
      var tw = m && typeof m.width === 'number' ? m.width : text.length * 6.5
      var w = tw + 14
      var h = 18
      var bx = x - w / 2
      var by = y - h / 2
      g.beginPath()
      if (typeof g.roundRect === 'function') g.roundRect(bx, by, w, h, 3)
      else g.rect(bx, by, w, h)
      g.fillStyle = 'rgba(255,255,255,0.88)'
      g.fill()
      g.strokeStyle = rgba(color, 0.4)
      g.lineWidth = 0.8
      g.stroke()
      g.fillStyle = '#1f5f8f'
      g.fillText(text, x, y + 0.5)
    }

    function paintCore(g, L, coreScale, glowScale) {
      var cx = L.cx, cy = L.cy
      var cs = coreScale == null ? 1 : coreScale
      var gs = glowScale == null ? 1 : glowScale
      var R = L.coreR * cs
      var halo = g.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 3.0)
      halo.addColorStop(0, 'rgba(90,165,235,' + (0.34 * gs).toFixed(3) + ')')
      halo.addColorStop(0.45, 'rgba(110,180,240,' + (0.14 * gs).toFixed(3) + ')')
      halo.addColorStop(1, 'rgba(140,200,250,0)')
      g.fillStyle = halo
      g.beginPath()
      g.arc(cx, cy, R * 3.0, 0, Math.PI * 2)
      g.fill()

      g.strokeStyle = 'rgba(40,130,200,0.3)'
      g.lineWidth = 1
      if (g.setLineDash) g.setLineDash([2, 4])
      g.beginPath()
      g.arc(cx, cy, R * 1.55, 0, Math.PI * 2)
      g.stroke()
      if (g.setLineDash) g.setLineDash([])
      // 小刻度
      g.strokeStyle = 'rgba(40,130,200,0.4)'
      g.lineWidth = 0.9
      g.beginPath()
      for (var t = 0; t < 12; t++) {
        var ta = t * Math.PI / 6
        g.moveTo(cx + Math.cos(ta) * (R * 1.55 - 3), cy + Math.sin(ta) * (R * 1.55 - 3))
        g.lineTo(cx + Math.cos(ta) * (R * 1.55 + 3), cy + Math.sin(ta) * (R * 1.55 + 3))
      }
      g.stroke()

      var disc = g.createRadialGradient(cx - R * 0.3, cy - R * 0.4, R * 0.1, cx, cy, R)
      disc.addColorStop(0, '#ffffff')
      disc.addColorStop(0.55, '#eef6ff')
      disc.addColorStop(1, '#d3e5f8')
      g.fillStyle = disc
      g.beginPath()
      g.arc(cx, cy, R, 0, Math.PI * 2)
      g.fill()
      g.strokeStyle = 'rgba(40,130,200,0.45)'
      g.lineWidth = 1
      g.stroke()

      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillStyle = '#2f5a8c'
      g.font = '600 ' + clamp(R * 0.32, 11, 18) + 'px ' + SANS
      g.fillText('自我', cx, cy - R * 0.14)
      g.fillStyle = 'rgba(70,110,150,0.8)'
      g.font = clamp(R * 0.16, 8.5, 11) + 'px ' + MONO
      g.fillText('自我陈述 ' + L.claims + ' 条', cx, cy + R * 0.34)
    }

    // ---------- 画节点：冷色发光点 + 呼吸 / 淡入 / recalls 闪光 ----------
    function paintNodes(g, L, hoverId, selectedId, sprites, st) {
      var nodes = L.nodes
      var i, n
      var anim = !!(st && st.animate)
      var now = st ? st.now : 0
      var fade = anim ? clamp((now - st.fadeAt) / 250, 0, 1) : 1
      var flashT = anim ? clamp(1 - (now - st.flashAt) / 1500, 0, 1) : 0
      var flashIds = (st && st.flashIds) || {}
      var hoverLevel = st ? st.hoverLevel : (hoverId != null ? 1 : 0)
      g.save()
      // 1) 外圈 glow（每个节点按 id 的相位慢呼吸，周期 4~7s，幅度 ±6%）
      for (i = 0; i < nodes.length; i++) {
        n = nodes[i]
        var breath = anim ? Math.sin((now / 1000) * (Math.PI * 2) / n.breathPeriod + n.breathPhase) : 0
        var sizeF = 1 + 0.06 * breath
        var alphaF = 1 + 0.06 * breath
        var isHovered = hoverId != null && String(n.id) === String(hoverId)
        var hoverMul = isHovered ? 1 + 0.45 * hoverLevel : 1
        var spr = sprites && (n.spike ? sprites.spine : (sprites[n.color] || sprites.white))
        var halo = (n.r * sizeF + 2.4) * 5.2 * ((n.cluster && n.cluster.nodeScale) || 1) * hoverMul
        var flash = flashT > 0 && flashIds[String(n.id)] ? flashT : 0
        var alpha = clamp(n.alpha * alphaF * fade + flash * 0.35, 0, 1)
        g.globalAlpha = alpha
        if (spr) {
          g.drawImage(spr, n.x - halo / 2, n.y - halo / 2, halo, halo)
        } else {
          g.fillStyle = rgba(n.color, 0.22)
          g.beginPath()
          g.arc(n.x, n.y, n.r * sizeF * 2, 0, Math.PI * 2)
          g.fill()
        }
        if (flash > 0 && sprites && sprites.white) {
          var fz = (n.r + 4) * 9 * (1 + 0.6 * flash)
          g.globalAlpha = clamp(flash * 0.55, 0, 1)
          g.drawImage(sprites.white, n.x - fz / 2, n.y - fz / 2, fz, fz)
        }
      }
      // 2) 芯点 / 尖刺 / 快忘掉的单字
      for (i = 0; i < nodes.length; i++) {
        n = nodes[i]
        var breath2 = anim ? Math.sin((now / 1000) * (Math.PI * 2) / n.breathPeriod + n.breathPhase) : 0
        var sizeF2 = 1 + 0.06 * breath2
        var alpha2 = clamp(n.alpha * (1 + 0.06 * breath2) * fade, 0, 1)
        var flash2 = flashT > 0 && flashIds[String(n.id)] ? flashT : 0
        if (n.fadeChar) {
          g.globalAlpha = clamp(0.35 + alpha2 * 0.25 + flash2 * 0.4, 0.35, 0.7)
          g.fillStyle = n.color
          g.font = '9px ' + SANS
          g.textAlign = 'center'
          g.textBaseline = 'middle'
          g.fillText(n.fadeChar, n.x, n.y)
          continue
        }
        g.globalAlpha = Math.min(1, alpha2 + 0.15 + flash2 * 0.3)
        g.fillStyle = n.color
        g.beginPath()
        g.arc(n.x, n.y, Math.max(0.8, n.r * sizeF2 * 0.62), 0, Math.PI * 2)
        g.fill()
        if (n.spike) {
          g.globalAlpha = 0.95
          g.strokeStyle = '#d8443f'
          g.lineWidth = 1
          g.beginPath()
          var base = hash01('sp|' + n.id) * Math.PI
          for (var k = 0; k < 6; k++) {
            var sa = base + (k / 6) * Math.PI * 2
            var sl = n.r * sizeF2 + 4 + 3 * hash01('spl|' + n.id + '|' + k)
            g.moveTo(n.x + Math.cos(sa) * (n.r * sizeF2 + 0.8), n.y + Math.sin(sa) * (n.r * sizeF2 + 0.8))
            g.lineTo(n.x + Math.cos(sa) * sl, n.y + Math.sin(sa) * sl)
          }
          g.stroke()
        }
      }
      g.globalAlpha = 1
      var hi = hoverId != null ? L.nodeMap.get(String(hoverId)) : null
      var si = selectedId != null ? L.nodeMap.get(String(selectedId)) : null
      if (hi) {
        var hs = sprites && sprites.white
        if (hs) {
          var hz = (hi.r + 4) * 9 * (1 + 0.5 * hoverLevel)
          g.globalAlpha = clamp(0.35 + 0.35 * hoverLevel, 0, 1)
          g.drawImage(hs, hi.x - hz / 2, hi.y - hz / 2, hz, hz)
          g.globalAlpha = 1
        }
        g.strokeStyle = 'rgba(31,127,196,' + (0.55 + 0.35 * hoverLevel).toFixed(3) + ')'
        g.lineWidth = 1.2
        g.beginPath()
        g.arc(hi.x, hi.y, (hi.r || 2) + 5 + 2 * hoverLevel, 0, Math.PI * 2)
        g.stroke()
      }
      if (si) {
        var pulse = anim ? (0.5 + 0.5 * Math.sin((now / 1000) * (Math.PI * 2) / 1.2)) : 0.5
        g.strokeStyle = 'rgba(224,142,46,' + (0.55 + 0.35 * pulse).toFixed(3) + ')'
        g.lineWidth = 1.2
        g.beginPath()
        g.arc(si.x, si.y, (si.r || 2) + 7 + 2 * pulse, 0, Math.PI * 2)
        g.stroke()
      }
      g.restore()
    }

    // ---------- 动态层：光核脉动 / HUD 扫掠亮弧 / 扫描线（每帧只画这些 + 节点） ----------
    function paintDynamic(g, L, sprites, hoverId, selectedId, st) {
      if (st.animate) {
        var target = hoverId != null ? 1 : 0
        st.hoverLevel += (target - st.hoverLevel) * 0.2
        if (Math.abs(target - st.hoverLevel) < 0.01) st.hoverLevel = target
      } else {
        st.hoverLevel = hoverId != null ? 1 : 0
      }
      var t = st.now / 1000
      var corePulse = st.animate ? 1 + 0.015 * Math.sin(t * (Math.PI * 2) / 4.2) : 1
      var glowPulse = st.animate ? 1 + 0.08 * Math.sin(t * (Math.PI * 2) / 4.2 + 0.6) : 1
      paintCore(g, L, corePulse, glowPulse)
      paintNodes(g, L, hoverId, selectedId, sprites, st)
      if (!st.animate) return
      // HUD 环上一条很淡的亮弧，3.5 圈/分钟
      var ang = t * (Math.PI * 2 * 3.5 / 60)
      g.save()
      g.lineCap = 'round'
      g.strokeStyle = 'rgba(45,140,210,0.10)'
      g.lineWidth = 3
      g.beginPath()
      g.arc(L.cx, L.cy, L.R * 0.97, ang - 0.42, ang)
      g.stroke()
      g.strokeStyle = 'rgba(45,140,210,0.28)'
      g.lineWidth = 2
      g.beginPath()
      g.arc(L.cx, L.cy, L.R * 0.97, ang, ang + 0.5)
      g.stroke()
      // 扫描线：12s 一轮，1px，alpha ≤ 0.05
      var sy = ((st.now % 12000) / 12000) * L.h
      g.strokeStyle = 'rgba(70,150,220,0.05)'
      g.lineWidth = 1
      g.beginPath()
      g.moveTo(0, sy + 0.5)
      g.lineTo(L.w, sy + 0.5)
      g.stroke()
      g.restore()
    }

    function hitTest(L, x, y) {
      var best = null
      var bestD = Infinity
      for (var i = 0; i < L.nodes.length; i++) {
        var n = L.nodes[i]
        var pad = (n.r || 2) + 6
        var dx = x - n.x
        var dy = y - n.y
        var d2 = dx * dx + dy * dy
        if (d2 <= pad * pad && d2 < bestD) {
          best = n
          bestD = d2
        }
      }
      return best
    }

    function positionTip(tip, p, size) {
      if (!tip) return
      var gap = 14
      var tw = tip.offsetWidth || 200
      var th = tip.offsetHeight || 64
      var left = p.x + gap
      var top = p.y + gap
      if (left + tw + 8 > size.w) left = p.x - tw - gap
      if (top + th + 8 > size.h) top = p.y - th - gap
      if (left < 6) left = 6
      if (top < 6) top = 6
      tip.style.left = left + 'px'
      tip.style.top = top + 'px'
    }

    // ---------- 画布组件 ----------
    function nowMs() {
      return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()
    }

    function CanvasStage(props) {
      var data = props.data
      var selectedId = props.selected
      var onSelect = props.onSelect
      var stageRef = useRef(null)
      var canvasRef = useRef(null)
      var tipRef = useRef(null)
      var cacheRef = useRef(null)
      var spriteRef = useRef(null)
      var mouseRef = useRef({ x: 0, y: 0 })
      var hoverRef = useRef(null)
      var selectedRef = useRef(null)
      var reducedRef = useRef(false)
      var visibleRef = useRef(true)
      var animRef = useRef(null)
      var fadeRef = useRef({ at: 0 })
      var flashRef = useRef({ at: 0, ids: {} })
      var hoverLevelRef = useRef(0)
      var sizeState = useState({ w: 0, h: 0 })
      var size = sizeState[0]
      var setSize = sizeState[1]
      var hoverState = useState(null)
      var hover = hoverState[0]
      var setHover = hoverState[1]

      var layout = useMemo(function () {
        return buildLayout(data, size.w, size.h)
      }, [data, size.w, size.h])

      useEffect(function () {
        var el = stageRef.current
        if (!el) return
        function measure() {
          var rect = el.getBoundingClientRect()
          var w = Math.max(0, Math.round(rect.width))
          var h = Math.max(0, Math.round(rect.height))
          setSize(function (prev) {
            return prev.w === w && prev.h === h ? prev : { w: w, h: h }
          })
        }
        measure()
        var ro = null
        if (typeof ResizeObserver !== 'undefined') {
          ro = new ResizeObserver(measure)
          ro.observe(el)
        } else if (typeof window !== 'undefined') {
          window.addEventListener('resize', measure)
        }
        return function () {
          if (ro) ro.disconnect()
          else if (typeof window !== 'undefined') window.removeEventListener('resize', measure)
        }
      }, [])

      useEffect(function () {
        setHover(null)
      }, [data, size.w, size.h])

      useEffect(function () {
        hoverRef.current = hover ? hover.id : null
      }, [hover])

      useEffect(function () {
        selectedRef.current = selectedId
      }, [selectedId])

      // 换数据：节点 250ms 淡入 + 最近想起过的那几条闪一下（1.5s 内衰减）
      useEffect(function () {
        var at = nowMs()
        fadeRef.current.at = at
        var ids = {}
        var rec = data && Array.isArray(data.recalls) ? data.recalls : []
        for (var i = 0; i < rec.length; i++) {
          if (rec[i] && rec[i].id != null) ids[String(rec[i].id)] = 1
        }
        flashRef.current.at = at
        flashRef.current.ids = ids
      }, [data])

      // reduced-motion 时只画静态帧，但悬停/选中变化要立刻反映
      useEffect(function () {
        var a = animRef.current
        if (a && reducedRef.current) a.draw()
      }, [hover, selectedId])

      function ensureSprites() {
        if (spriteRef.current) return spriteRef.current
        var map = {}
        var colors = {}
        colors.white = '#8fc9ff'
        colors.spine = '#d8443f'
        for (var rk in REGION_COLOR) if (Object.prototype.hasOwnProperty.call(REGION_COLOR, rk)) colors[REGION_COLOR[rk]] = REGION_COLOR[rk]
        for (var key in colors) {
          if (!Object.prototype.hasOwnProperty.call(colors, key)) continue
          var color = colors[key]
          var sizePx = 64
          var cv = document.createElement('canvas')
          cv.width = sizePx
          cv.height = sizePx
          var cg = cv.getContext('2d')
          if (!cg) continue
          var grad = cg.createRadialGradient(sizePx / 2, sizePx / 2, 0, sizePx / 2, sizePx / 2, sizePx / 2)
          grad.addColorStop(0, rgba(color, 0.85))
          grad.addColorStop(0.22, rgba(color, 0.42))
          grad.addColorStop(0.55, rgba(color, 0.12))
          grad.addColorStop(1, rgba(color, 0))
          cg.fillStyle = grad
          cg.beginPath()
          cg.arc(sizePx / 2, sizePx / 2, sizePx / 2, 0, Math.PI * 2)
          cg.fill()
          map[key === 'white' || key === 'spine' ? key : color] = cv
        }
        spriteRef.current = map
        return map
      }

      useEffect(function () {
        if (!layout) return
        var canvas = canvasRef.current
        if (!canvas) return
        var dpr = clamp((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 1, 3)
        var cw = Math.max(1, Math.round(layout.w * dpr))
        var ch = Math.max(1, Math.round(layout.h * dpr))
        if (canvas.width !== cw || canvas.height !== ch) {
          canvas.width = cw
          canvas.height = ch
        }
        var g = canvas.getContext('2d')
        if (!g) return
        g.setTransform(dpr, 0, 0, dpr, 0, 0)
        // 静态背景只算一次：网格 / HUD 环刻度 / 团晕 / 标签 / 角标 / 扫描线底
        var off = document.createElement('canvas')
        off.width = cw
        off.height = ch
        var og = off.getContext('2d')
        if (!og) return
        og.setTransform(dpr, 0, 0, dpr, 0, 0)
        paintStatic(og, layout)
        cacheRef.current = { layout: layout, canvas: off }
        var sprites = ensureSprites()
        var interval = layout.nodes.length > 1200 ? 50 : 33

        var alive = true
        var raf = 0
        var last = -1e9

        function shouldRun() {
          if (reducedRef.current) return false
          if (typeof document !== 'undefined' && document.hidden) return false
          return visibleRef.current
        }

        function drawFrame(ts, animate) {
          if (!g) return
          g.clearRect(0, 0, layout.w, layout.h)
          g.drawImage(off, 0, 0, layout.w, layout.h)
          var st = {
            now: ts,
            animate: animate,
            hoverLevel: hoverLevelRef.current,
            fadeAt: fadeRef.current.at,
            flashAt: flashRef.current.at,
            flashIds: flashRef.current.ids,
          }
          paintDynamic(g, layout, sprites, hoverRef.current, selectedRef.current, st)
          hoverLevelRef.current = st.hoverLevel
        }

        function loop(ts) {
          raf = 0
          if (!alive) return
          if (ts - last >= interval) {
            last = ts
            drawFrame(ts, true)
          }
          raf = requestAnimationFrame(loop)
        }

        function start() {
          if (!alive || raf || !shouldRun()) return
          last = -1e9
          raf = requestAnimationFrame(loop)
        }

        function stop() {
          if (raf) {
            cancelAnimationFrame(raf)
            raf = 0
          }
        }

        // prefers-reduced-motion：完全不跑动画，只画静态帧
        var mq = (typeof window !== 'undefined' && window.matchMedia) ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
        function applyReduced() { reducedRef.current = !!(mq && mq.matches) }
        function onReducedChange() {
          applyReduced()
          if (reducedRef.current) {
            stop()
            drawFrame(nowMs(), false)
          } else {
            start()
          }
        }
        applyReduced()
        if (mq && mq.addEventListener) mq.addEventListener('change', onReducedChange)

        // 页面隐藏：暂停 rAF
        function onVisibility() {
          if (typeof document !== 'undefined' && document.hidden) stop()
          else start()
        }
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)

        // 画布不在视口：暂停 rAF
        var io = null
        if (typeof IntersectionObserver !== 'undefined' && stageRef.current) {
          io = new IntersectionObserver(function (entries) {
            var entry = entries && entries[0]
            visibleRef.current = !!(entry && entry.isIntersecting)
            if (visibleRef.current) start()
            else stop()
          })
          io.observe(stageRef.current)
        }

        animRef.current = { draw: function () { drawFrame(nowMs(), false) } }
        drawFrame(nowMs(), !reducedRef.current)
        if (reducedRef.current) stop()
        else start()

        return function () {
          alive = false
          stop()
          animRef.current = null
          if (mq && mq.removeEventListener) mq.removeEventListener('change', onReducedChange)
          if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
          if (io) io.disconnect()
        }
      }, [layout])

      useEffect(function () {
        if (!hover) return
        positionTip(tipRef.current, mouseRef.current, size)
      }, [hover, size])

      function pointOf(e) {
        var canvas = canvasRef.current
        if (!canvas) return { x: 0, y: 0 }
        var rect = canvas.getBoundingClientRect()
        return { x: e.clientX - rect.left, y: e.clientY - rect.top }
      }

      function onMove(e) {
        if (!layout) return
        var p = pointOf(e)
        mouseRef.current = p
        var hit = hitTest(layout, p.x, p.y)
        var curId = hover ? String(hover.id) : null
        var nextId = hit ? String(hit.id) : null
        if (curId !== nextId) {
          setHover(hit ? { id: hit.id, raw: hit.raw } : null)
        }
        positionTip(tipRef.current, p, size)
      }

      function onLeave() {
        setHover(null)
      }

      function onClick(e) {
        if (!layout) return
        var p = pointOf(e)
        var hit = hitTest(layout, p.x, p.y)
        onSelect(hit ? hit.id : null)
      }

      var tip = hover
        ? h('div', { ref: tipRef, className: 'ds-tip' },
            h('div', { className: 'ds-tip-title' }, regionLabel(hover.raw.region) + (hover.raw.audience ? ' / ' + hover.raw.audience : '')),
            h('div', { className: 'ds-tip-time' }, fmtDateTime(hover.raw.created_at)),
            h('div', { className: 'ds-tip-text' }, clip(hover.raw.text, 60) || '（没有正文）')
          )
        : h('div', { ref: tipRef, className: 'ds-tip', style: { display: 'none' } })

      return h('div', {
        ref: stageRef,
        className: 'ds-stage',
        onMouseMove: onMove,
        onMouseLeave: onLeave,
        onClick: onClick,
        role: 'img',
        'aria-label': '分舱记忆图：中心是自我，四周是各舱记忆节点',
      },
        h('canvas', { ref: canvasRef, className: 'ds-canvas' }),
        props.emptyText ? h('div', { className: 'ds-empty' }, props.emptyText) : null,
        tip
      )
    }

    // ---------- 主面板 ----------
    function BrainPanel() {
      ensureStyle()
      var asOfState = useState('')
      var asOf = asOfState[0]
      var setAsOf = asOfState[1]
      var tickState = useState(0)
      var tick = tickState[0]
      var setTick = tickState[1]
      var dataState = useState(null)
      var data = dataState[0]
      var setData = dataState[1]
      var loadingState = useState(true)
      var loading = loadingState[0]
      var setLoading = loadingState[1]
      var errState = useState('')
      var err = errState[0]
      var setErr = errState[1]
      var recallsState = useState([])
      var recalls = recallsState[0]
      var setRecalls = recallsState[1]
      var selState = useState(null)
      var selected = selState[0]
      var setSelected = selState[1]
      var detailState = useState(null)
      var detail = detailState[0]
      var setDetail = detailState[1]
      var detailErrState = useState('')
      var detailErr = detailErrState[0]
      var setDetailErr = detailErrState[1]
      var touchMsgState = useState('')
      var touchMsg = touchMsgState[0]
      var setTouchMsg = touchMsgState[1]
      var touchBadState = useState(false)
      var touchBad = touchBadState[0]
      var setTouchBad = touchBadState[1]
      var touchingState = useState(false)
      var touching = touchingState[0]
      var setTouching = touchingState[1]

      // 拉面板数据（asOf 变 / 手动重算时重拉）
      useEffect(function () {
        var alive = true
        var q = asOf ? ('?asOf=' + encodeURIComponent(asOf)) : ''
        setLoading(true)
        setErr('')
        setRecalls([])
        getJSON(API + '/panel' + q).then(function (d) {
          if (!alive) return
          setData(d)
          setLoading(false)
        }).catch(function (e) {
          if (!alive) return
          setErr(errText(e))
          setLoading(false)
        })
        getJSON(API + '/recalls?limit=10').then(function (list) {
          if (alive && list && list.length) setRecalls(list)
        }).catch(function () {})
        return function () { alive = false }
      }, [asOf, tick])

      // 拉选中那一条的详情
      useEffect(function () {
        if (selected == null) {
          setDetail(null)
          setDetailErr('')
          return
        }
        var alive = true
        setDetailErr('')
        getJSON(API + '/node?id=' + encodeURIComponent(String(selected))).then(function (d) {
          if (!alive) return
          setDetail(d)
        }).catch(function (e) {
          if (!alive) return
          setDetailErr(errText(e))
        })
        return function () { alive = false }
      }, [selected, tick])

      function travel(n) {
        setAsOf(n === 0 ? '' : addDays(todayStr(), n))
      }
      function refresh() {
        setTick(function (t) { return t + 1 })
      }
      function rememberOnce() {
        if (selected == null || touching) return
        setTouching(true)
        setTouchMsg('')
        setTouchBad(false)
        postJSON(API + '/touch', { id: selected }).then(function (r) {
          setTouchMsg('已记下：这条现在被想起 ' + num(r && r.hits, 0) + ' 次')
          setTouchBad(false)
          setTick(function (t) { return t + 1 })
        }).catch(function (e) {
          setTouchMsg('没记上：' + errText(e))
          setTouchBad(true)
        }).then(function () {
          setTouching(false)
        })
      }

      var stats = (data && data.stats) || {}
      var nodes = data && Array.isArray(data.nodes) ? data.nodes : []
      var clusters = data && Array.isArray(data.clusters) ? data.clusters : []
      var drives = (data && data.drives) || {}
      var driveKeys = []
      for (var dk in drives) if (Object.prototype.hasOwnProperty.call(drives, dk)) driveKeys.push(dk)
      var hasDrives = driveKeys.length > 0
      var recallList = recalls.length ? recalls : ((data && data.recalls) || [])
      var today = todayStr()
      var asOfLabel = asOf || today
      var d30 = addDays(today, 30)
      var d90 = addDays(today, 90)
      var d200 = addDays(today, 200)
      var selBasic = null
      if (selected != null) {
        for (var sn = 0; sn < nodes.length; sn++) {
          if (String(nodes[sn].id) === String(selected)) { selBasic = nodes[sn]; break }
        }
      }

      var totalNodes = num(stats.nodes, nodes.length)
      var cells = num(stats.cells, clusters.length)
      var coreLevel = num(stats.core_level, 0)
      var importantLevel = num(stats.important_level, 0)
      var edgeLevel = Math.max(0, totalNodes - coreLevel - importantLevel)
      var statusItems = [
        ['记忆', totalNodes],
        ['舱', cells],
        ['核心', coreLevel],
        ['中圈', importantLevel],
        ['边缘', edgeLevel],
        ['自我', num(stats.self, 0)],
        ['关系', num(stats.relation, 0)],
      ]

      var subtitle = data
        ? ('DEEP-SOUL // ' + totalNodes + ' NODES · ' + cells + ' CELLS · ' + (stats.mode ? String(stats.mode) : '—'))
        : (err ? 'DEEP-SOUL // OFFLINE' : 'DEEP-SOUL // LOADING …')

      var top = h('div', { className: 'ds-top' },
        h('div', { className: 'ds-headings' },
          h('h1', { className: 'ds-title' }, '识海', h('em', null, 'HUD')),
          h('div', { className: 'ds-sub' }, subtitle)
        ),
        h('div', { className: 'ds-actions' },
          h('button', {
            type: 'button',
            className: 'ds-btn' + (asOf === '' ? ' ds-btn-on' : ''),
            onClick: function () { travel(0) },
          }, '现在'),
          h('button', {
            type: 'button',
            className: 'ds-btn' + (asOf === d30 ? ' ds-btn-on' : ''),
            onClick: function () { travel(30) },
            title: '看 30 天后这些记忆衰减成什么样',
          }, '+30d'),
          h('button', {
            type: 'button',
            className: 'ds-btn' + (asOf === d90 ? ' ds-btn-on' : ''),
            onClick: function () { travel(90) },
            title: '看 90 天后这些记忆衰减成什么样',
          }, '+90d'),
          h('button', {
            type: 'button',
            className: 'ds-btn' + (asOf === d200 ? ' ds-btn-on' : ''),
            onClick: function () { travel(200) },
            title: '看 200 天后这些记忆衰减成什么样',
          }, '+200d'),
          h('button', {
            type: 'button',
            className: 'ds-btn',
            onClick: refresh,
            disabled: loading,
          }, loading ? '读取中…' : '重算')
        )
      )

      var statusLine = h('div', { className: 'ds-status' },
        h('span', { className: 'ds-status-sys' }, 'SYS'),
        statusItems.map(function (it, i) {
          var parts = []
          if (i > 0) parts.push(h('i', { key: 'sep' + i }, '·'))
          parts.push(h('span', { key: it[0] }, it[0], h('b', null, String(it[1]))))
          return parts
        }),
        h('span', { className: 'ds-view' + (asOf ? ' ds-view-travel' : '') },
          (asOf ? '时间旅行 ' + asOf : '视角 ' + asOfLabel) + ' · 刚想起 ' + recallList.length + ' 条')
      )

      var fail = err
        ? h('div', { className: 'ds-fail' },
            h('b', null, '读不到记忆'),
            '：' + err,
            h('div', { className: 'ds-dim' }, '通常是宿主侧的 /deep-soul/* 路由或 sidecar 没起来。修好之后点「重算」。')
          )
        : null

      function renderDetail() {
        if (selected == null) {
          return h('div', { className: 'ds-dim' }, '点图上任意一个光点，这里会展开它的全文、权重和证据。')
        }
        var d = detail || selBasic
        if (!d) {
          if (detailErr) return h('div', { className: 'ds-msg ds-msg-bad' }, '读不到这条：' + detailErr)
          return h('div', { className: 'ds-dim' }, '正在读取 #' + selected + ' …')
        }
        var evidence = Array.isArray(d.evidence) ? d.evidence : []
        var spine = d.spine || null
        var rows = []
        rows.push(h('div', { key: 'region', className: 'ds-kv' },
          h('span', { className: 'ds-kv-k' }, '分区'),
          h('b', null, regionLabel(d.region) + (d.audience ? '（' + d.audience + '）' : ''))
        ))
        rows.push(h('div', { key: 'ab', className: 'ds-kv' },
          h('span', { className: 'ds-kv-k' }, 'α / β'),
          h('b', null, 'α ' + numText(d.affect) + '　β ' + numText(d.belief))
        ))
        rows.push(h('div', { key: 'hits', className: 'ds-kv' },
          h('span', { className: 'ds-kv-k' }, '被想起'),
          h('b', null, num(d.hits, 0) + ' 次' + (d.last_hit ? ' · 最近 ' + fmtAgo(d.last_hit) : ''))
        ))
        rows.push(h('div', { key: 'created', className: 'ds-kv' },
          h('span', { className: 'ds-kv-k' }, '创建'),
          h('b', null, fmtDateTime(d.created_at))
        ))
        if (d.source) {
          rows.push(h('div', { key: 'source', className: 'ds-kv' },
            h('span', { className: 'ds-kv-k' }, '来源'),
            h('b', null, String(d.source))
          ))
        }
        rows.push(h('div', { key: 'db', className: 'ds-kv' },
          h('span', { className: 'ds-kv-k' }, '出处'),
          h('b', null, 'mind.db #' + d.id)
        ))
        if (spine) {
          rows.push(h('div', { key: 'spine', className: 'ds-kv' },
            h('span', { className: 'ds-kv-k' }, '刺'),
            h('b', { style: { color: spine.state === 'resolved' ? '#1f8f8a' : '#d8443f' } },
              (spine.state === 'resolved' ? '已和解' : '未和解') + (spine.note ? ' · ' + spine.note : ''))
          ))
        }
        return h('div', null,
          h('div', { className: 'ds-detail-text' }, d.text || '（正文是空的）'),
          rows,
          evidence.length
            ? h('div', { className: 'ds-ev' },
                h('div', { className: 'ds-ev-h' }, 'EVIDENCE · 证据摘录 ' + evidence.length + ' 条'),
                evidence.map(function (ev, i) {
                  return h('div', { key: i, className: 'ds-ev-item' },
                    h('div', { className: 'ds-ev-meta' },
                      fmtDateTime(ev.ts) + (ev.speaker ? ' · ' + ev.speaker : '') + (ev.message_id ? ' · msg ' + ev.message_id : '')),
                    h('div', { className: 'ds-ev-text' }, clip(ev.excerpt, 220))
                  )
                })
              )
            : null,
          h('div', { className: 'ds-btn-row' },
            h('button', {
              type: 'button',
              className: 'ds-btn' + (touching ? '' : ' ds-btn-on'),
              onClick: rememberOnce,
              disabled: touching,
            }, touching ? '记下中…' : '想起来一次'),
            h('span', { className: 'ds-dim' }, '命中 +1，也会进检索事件流水')
          ),
          touchMsg ? h('div', { className: 'ds-msg' + (touchBad ? ' ds-msg-bad' : '') }, touchMsg) : null
        )
      }

      var recallsCard = h('div', { className: 'ds-card' },
        h('div', { className: 'ds-card-h' }, 'RECALLS · 刚想起来的 ' + recallList.length + ' 条'),
        recallList.length === 0
          ? h('div', { className: 'ds-dim' }, '还没有检索记录。和她说几句话，这里就会长出「刚想起来」的东西。')
          : recallList.map(function (r, i) {
              var rid = r.id
              var on = selected != null && String(selected) === String(rid)
              return h('button', {
                key: i,
                type: 'button',
                className: 'ds-recall' + (on ? ' ds-recall-on' : ''),
                onClick: function () { setSelected(rid) },
                title: '在右边展开这条记忆',
              },
                h('div', { className: 'ds-recall-top' },
                  h('span', { className: 'ds-chip', style: { color: regionColor(r.region) } }, regionLabel(r.region)),
                  h('span', { className: 'ds-dim' }, fmtAgo(r.ts))
                ),
                h('div', { className: 'ds-recall-text' }, clip(r.text, 90) || '（原文已不在库里）'),
                r.query ? h('div', { className: 'ds-recall-q' }, '因「' + clip(r.query, 24) + '」想起') : null
              )
            })
      )

      var detailCard = h('div', { className: 'ds-card' },
        h('div', { className: 'ds-card-h' }, 'NODE · 选中的一条'),
        renderDetail()
      )

      var stage = data
        ? h(CanvasStage, {
            data: data,
            selected: selected,
            onSelect: setSelected,
            emptyText: nodes.length === 0 ? '库还是空的：先和她说几句话，记忆会在这里长出来。' : null,
          })
        : h('div', { className: 'ds-standin' }, err ? 'NO DATA // 见上面的错误提示' : 'LOADING // 正在读取 mind.db …')

      var legend = useMemo(function () {
        var counts = {}
        var keys = []
        for (var i = 0; i < nodes.length; i++) {
          var r = nodes[i].region || 'other'
          if (counts[r] == null) {
            counts[r] = 0
            keys.push(r)
          }
          counts[r] += 1
        }
        var ordered = REGION_ORDER.filter(function (k) { return counts[k] != null })
        for (var j = 0; j < keys.length; j++) {
          if (ordered.indexOf(keys[j]) < 0) ordered.push(keys[j])
        }
        return ordered.map(function (k) {
          return { key: k, label: regionLabel(k), color: regionColor(k) }
        })
      }, [data])

      var body = h('div', { className: 'ds-body' },
        h('div', { className: 'ds-main' },
          stage,
          h('div', { className: 'ds-legend' },
            legend.map(function (item) {
              return h('span', { key: item.key, className: 'ds-leg' },
                h('i', { style: { background: item.color, color: item.color } }),
                item.label
              )
            }),
            h('span', { className: 'ds-leg-keys' }, '光点 = 一条记忆　大小 = α　亮度 = 衰减　红刺 = 未和解的刺')
          )
        ),
        h('aside', { className: 'ds-side' }, recallsCard, detailCard)
      )

      var statBits = [
        { key: 'mode', label: '模式', value: stats.mode ? String(stats.mode) : '—' },
        { key: 'shown', label: '显示', value: num(stats.shown, nodes.length) + (num(stats.shown, nodes.length) < totalNodes ? ' / ' + totalNodes : '') },
        { key: 'spine', label: '未和解的刺', value: num(stats.spine_open, 0) },
        { key: 'claims', label: '自我陈述', value: num(stats.claims, 0) },
      ]

      var drivesEl = hasDrives
        ? h('div', { className: 'ds-drives' },
            DRIVES.map(function (d) {
              var v = clamp(num(drives[d.key], 0), 0, 1)
              return h('div', { key: d.key, className: 'ds-drive', title: d.label + ' ' + v.toFixed(2) },
                h('div', { className: 'ds-drive-l' },
                  h('span', null, d.label),
                  h('span', { className: 'ds-drive-v' }, v.toFixed(2))
                ),
                h('div', { className: 'ds-drive-track' },
                  h('div', { className: 'ds-drive-fill', style: { width: (v * 100).toFixed(1) + '%' } })
                )
              )
            })
          )
        : h('div', { className: 'ds-drives' }, h('span', { className: 'ds-drives-empty' }, 'DRIVES // 驱力还没启动'))

      var bottom = h('div', { className: 'ds-bottom' },
        h('div', { className: 'ds-stats' },
          statBits.map(function (s) {
            return h('span', { key: s.key, className: 'ds-stat' }, s.label, h('b', null, s.value))
          })
        ),
        drivesEl
      )

      return h('div', { className: 'ds-panel' }, top, statusLine, fail, body, bottom)
    }

    // 左侧栏图标：一条简笔鲸鱼（20x20，跟着 currentColor）
    function Icon() {
      return h('svg', {
        width: 20,
        height: 20,
        viewBox: '0 0 20 20',
        fill: 'none',
        'aria-hidden': 'true',
        focusable: 'false',
      },
        h('path', {
          d: 'M3.2 11.4c.5-2.9 3.3-5 6.7-5 2.6 0 4.9 1.3 6 3.3',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
        }),
        h('path', {
          d: 'M3.2 11.4c.9 1.9 3.4 3.2 6.7 3.2 1.7 0 3.3-.4 4.5-1.1',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M15.6 11.3l2.3-1.6v3.4l-2.3-1.6z',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M7.9 6c-.3-1.2.2-2.1 1.2-2.6',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinecap: 'round',
        }),
        h('circle', { cx: 6.5, cy: 9.3, r: 0.8, fill: 'currentColor' })
      )
    }

    function apply(ctx) {
      try { ensureStyle() } catch (e) {}
      if (!ctx || typeof ctx.get !== 'function') return
      var slots = ctx.get('slots')
      if (!slots) return
      slots.inject('sidebar.panellist', function () {
        return slots.register({ name: 'sidebar.panellist', id: 'deep-soul', order: 40, label: '识海' }, Icon)
      })
      slots.inject('main', function () {
        return slots.register({ name: 'main', key: 'deep-soul' }, BrainPanel)
      })
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
