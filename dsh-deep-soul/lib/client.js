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
.ds-panel{display:flex;flex-direction:column;width:100%;height:100%;min-height:520px;box-sizing:border-box;background:#f7f9fc;color:#1b2a3a;font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow:hidden}
.ds-panel *{box-sizing:border-box}
.ds-top{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:14px 16px 8px;flex:none}
.ds-headings{min-width:0;flex:1 1 260px;display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
.ds-title{margin:0;font-size:16px;line-height:1.3;font-weight:600;letter-spacing:.18em;color:#16283a}
.ds-sub{font-size:10px;line-height:1.6;letter-spacing:.14em;color:#7b8ea4;white-space:nowrap}
.ds-actions{display:flex;gap:8px;flex:none;align-items:center}
.ds-seg{display:flex;border:1px solid rgba(143,184,232,.55);border-radius:3px;overflow:hidden;background:rgba(255,255,255,.6)}
.ds-seg-btn{border:0;border-right:1px solid rgba(143,184,232,.4);background:transparent;color:#5a7590;padding:3px 9px;font:inherit;font-size:10.5px;line-height:1.5;cursor:pointer;letter-spacing:.04em;transition:background .12s,color .12s}
.ds-seg-btn:last-child{border-right:0}
.ds-seg-btn:hover{background:rgba(143,184,232,.16);color:#315a80}
.ds-seg-btn:focus-visible{outline:1px solid #8fb8e8;outline-offset:-1px}
.ds-seg-on,.ds-seg-on:hover{background:rgba(232,217,189,.55);color:#5b4a34}
.ds-icon-btn{border:1px solid rgba(143,184,232,.55);border-radius:3px;background:rgba(255,255,255,.6);color:#4f6f8d;width:24px;height:23px;line-height:1;font:inherit;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0;transition:border-color .12s,color .12s,background .12s}
.ds-icon-btn:hover{border-color:#8fb8e8;color:#315a80;background:rgba(143,184,232,.14)}
.ds-icon-btn:disabled{opacity:.45;cursor:default}
.ds-fail{margin:2px 16px 0;padding:6px 10px;border-radius:3px;border:1px solid rgba(180,90,80,.35);background:rgba(190,100,90,.06);color:#8a4a42;font-size:11px;line-height:1.7;flex:none}
.ds-dim{color:#8a9cae;font-size:10.5px;margin-top:2px}
.ds-body{flex:1 1 auto;min-height:0;display:flex;gap:12px;padding:2px 16px 14px;overflow:hidden}
.ds-main{flex:1 1 auto;min-width:0;min-height:0;display:flex;flex-direction:column;gap:4px}
.ds-stage{position:relative;flex:1 1 auto;min-height:280px;border:1px solid rgba(143,184,232,.32);border-radius:2px;background:#02040a;overflow:hidden;box-shadow:inset 0 0 60px rgba(10,25,60,.32),0 2px 14px rgba(20,50,110,.10)}
.ds-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;cursor:crosshair}
.ds-tip{position:absolute;z-index:4;pointer-events:none;max-width:250px;padding:6px 9px;border-radius:2px;border:1px solid rgba(143,184,232,.5);background:rgba(6,12,22,.94);box-shadow:0 6px 18px rgba(0,0,0,.35);color:#dbe6f2;font:11px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.ds-tip-title{font-weight:600;font-size:10px;color:#e8d9bd;margin-bottom:2px;letter-spacing:.06em}
.ds-tip-time{font-size:9.5px;color:#8fb8e8;margin-bottom:2px}
.ds-tip-text{color:#c6d3e2;word-break:break-word;white-space:pre-line}
.ds-tip-sun{color:#dcc9a6;letter-spacing:.02em}
.ds-empty{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);max-width:300px;text-align:center;font-size:11px;line-height:1.8;color:#8fa6bd;background:rgba(3,8,16,.84);border:1px dashed rgba(143,184,232,.4);border-radius:2px;padding:8px 12px;pointer-events:none}
.ds-standin{flex:1 1 auto;min-height:280px;border:1px dashed rgba(143,184,232,.35);border-radius:2px;background:#02040a;display:flex;align-items:center;justify-content:center;padding:20px;text-align:center;font-size:11px;line-height:1.8;color:#7f96ac}
.ds-legend{flex:none;padding:0 2px;font-size:9px;line-height:1.7;letter-spacing:.08em;color:rgba(90,115,140,.62);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ds-side{width:318px;flex:none;display:flex;flex-direction:column;gap:10px;min-height:0;overflow:auto;padding-bottom:2px}
.ds-card{border:1px solid rgba(143,184,232,.3);border-radius:3px;background:rgba(255,255,255,.66);padding:11px 13px;flex:none}
.ds-card-h{font-size:10px;font-weight:600;letter-spacing:.22em;margin:0 0 8px;color:#6f8aa6;text-transform:uppercase}
.ds-detail-text{font-size:11.5px;line-height:1.75;white-space:pre-wrap;word-break:break-word;margin-bottom:8px;color:#22384c}
.ds-kv{display:flex;gap:8px;font-size:10.5px;line-height:1.9;align-items:baseline}
.ds-kv-k{flex:none;min-width:52px;color:#8a9cae}
.ds-kv b{color:#2b4a66;font-weight:500;min-width:0;word-break:break-word}
.ds-ev{margin-top:8px;border-top:1px solid rgba(143,184,232,.25);padding-top:7px}
.ds-ev-h{font-size:9.5px;color:#8a9cae;margin-bottom:2px;letter-spacing:.12em}
.ds-ev-item{font-size:10.5px;line-height:1.65;padding:4px 0;color:#5a7590;border-bottom:1px solid rgba(143,184,232,.18)}
.ds-ev-item:last-child{border-bottom:0}
.ds-ev-meta{font-size:9.5px;color:#8a9cae;margin-bottom:1px}
.ds-ev-text{color:#2b4155;word-break:break-word}
.ds-btn-row{display:flex;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap}
.ds-msg{font-size:10.5px;color:#3f6f9f}
.ds-msg-bad{color:#8a4a42}
.ds-btn{border:1px solid rgba(143,184,232,.55);border-radius:3px;background:rgba(255,255,255,.6);color:#4f6f8d;padding:3px 9px;font:inherit;font-size:10.5px;line-height:1.5;cursor:pointer;transition:border-color .12s,color .12s,background .12s}
.ds-btn:hover{border-color:#8fb8e8;color:#315a80;background:rgba(143,184,232,.14)}
.ds-btn:disabled{opacity:.45;cursor:default}
@media (max-width: 980px){.ds-body{flex-direction:column;overflow:auto}.ds-main{min-height:420px;flex:none}.ds-side{width:auto;overflow:visible;flex-direction:row;flex-wrap:wrap}.ds-side .ds-card{flex:1 1 300px}}
@media (max-width: 640px){.ds-top{padding:10px 12px 6px}.ds-body{padding:2px 12px 10px}.ds-fail{margin-left:12px;margin-right:12px}}
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

    // ---------- 布局：记忆星图（中心自我核 / 团 = 簇的星座 / 真实关联细线） ----------
    const STAR_BG = '#02040a'
    const STAR_BG_TOP = '#050a14'
    const STAR_BG_BOTTOM = '#0a1220'
    const STAR_NOISE_ALPHA = 0.04
    const STAR_LABEL_ALWAYS = 0 // v7：常驻团名全部撤掉，只有 hover/选中才显示
    const STAR_LABEL_FONT = 12.5
    const STAR_MAX_CLUSTERS = 20
    const STAR_EDGE_TEMPORAL = 'rgba(146,168,212,'
    const STAR_EDGE_GROUND = 'rgba(235,221,192,'
    let STAR_NOISE_TILE = null

    function isSelfNode(nd) {
      return String((nd && nd.region) || '') === 'self'
    }
    function levelRank(nd) {
      var lv = String((nd && nd.level) || '')
      if (lv === 'core') return 3
      if (lv === 'important') return 2
      if (lv === 'normal') return 1
      return 0
    }
    // 簇名常重复（数据里大多是「事实」），补一个受众后缀好区分
    function audienceShort(a) {
      var s = String(a || '')
      if (s === 'group') return '群'
      if (s === 'private') return '私'
      if (s === 'owner') return '己'
      return s
    }
    function sortKids(a, b) {
      var d = num(b.score, 0) - num(a.score, 0)
      if (d) return d
      d = num(b.hits, 0) - num(a.hits, 0)
      if (d) return d
      return String(a.id) < String(b.id) ? -1 : 1
    }
    function summarizeCluster(gc) {
      gc.count = gc.nodes.length
      var scoreSum = 0
      var fadeSum = 0
      var levelMax = 0
      var spineN = 0
      var regCount = {}
      for (var i = 0; i < gc.nodes.length; i++) {
        var nd = gc.nodes[i]
        scoreSum += num(nd.score, 0)
        fadeSum += clamp(num(nd.fade, 1), 0, 1)
        var lr = levelRank(nd)
        if (lr > levelMax) levelMax = lr
        if (nd.spike) spineN++
        var rg = nd.region || 'other'
        regCount[rg] = (regCount[rg] || 0) + 1
      }
      var n = Math.max(1, gc.count)
      gc.avgScore = scoreSum / n
      gc.avgFade = fadeSum / n
      gc.maxLevel = levelMax
      gc.spineN = spineN
      var bestReg = gc.region || 'other'
      var bestN = -1
      for (var rk in regCount) {
        if (Object.prototype.hasOwnProperty.call(regCount, rk) && regCount[rk] > bestN) {
          bestN = regCount[rk]
          bestReg = rk
        }
      }
      gc.region = bestReg || 'other'
      gc.color = regionColor(gc.region)
      var kids = gc.nodes.slice().sort(sortKids)
      gc.pickId = kids.length ? kids[0].id : null
      return gc
    }
    // 颜色工具：把分区色往白/暖方向提亮，用于发光标签
    function mixHex(a, b, t) {
      var ca = String(a || '#7d8aa0').replace('#', '')
      if (ca.length === 3) ca = ca.charAt(0) + ca.charAt(0) + ca.charAt(1) + ca.charAt(1) + ca.charAt(2) + ca.charAt(2)
      var cb = String(b || '#ffffff').replace('#', '')
      if (cb.length === 3) cb = cb.charAt(0) + cb.charAt(0) + cb.charAt(1) + cb.charAt(1) + cb.charAt(2) + cb.charAt(2)
      var na = parseInt(ca, 16)
      var nb = parseInt(cb, 16)
      if (!isFinite(na) || !isFinite(nb)) return a || '#7d8aa0'
      var r = Math.round(((na >> 16) & 255) * (1 - t) + ((nb >> 16) & 255) * t)
      var gch = Math.round(((na >> 8) & 255) * (1 - t) + ((nb >> 8) & 255) * t)
      var bl = Math.round((na & 255) * (1 - t) + (nb & 255) * t)
      return 'rgb(' + r + ',' + gch + ',' + bl + ')'
    }
    function rgbaHex(rgbText, alpha) {
      return 'rgba(' + String(rgbText).replace('rgb(', '').replace(')', '') + ',' + alpha + ')'
    }

    function buildLayout(data, W, H, selfData) {
      if (!data || !W || !H || W < 80 || H < 80) return null
      var allNodes = Array.isArray(data.nodes) ? data.nodes.slice(0, NODE_LIMIT) : []
      var stats = data.stats || {}
      var cx = W * 0.5
      var cy = H * 0.5
      var minDim = Math.min(W, H)
      var i

      // 1) 中心核 = mindcore 的 self_claims（自省生成），不再聚合 region==='self' 的记忆节点；
      //    那些节点（很多其实是群聊事实）回原簇当普通星点，绝不把任何 nodes.text 塞进核的 tooltip。
      var claimList = (selfData && Array.isArray(selfData.claims)) ? selfData.claims : []
      var activeClaims = []
      for (i = 0; i < claimList.length && activeClaims.length < 3; i++) {
        var cl0 = claimList[i]
        if (!cl0 || !cl0.claim) continue
        var st0 = String(cl0.status == null ? 'active' : cl0.status)
        if (st0 === 'active') activeClaims.push(String(cl0.claim))
      }
      var chapterCount = (selfData && Array.isArray(selfData.chapters)) ? selfData.chapters.length : 0
      var claimTotal = claimList.length
      var coreR = clamp(minDim * 0.024 + Math.sqrt(Math.max(0, claimTotal)) * minDim * 0.0026, 6, 18)
      var sun = {
        x: cx,
        y: cy,
        r: coreR,
        claims: { active: activeClaims, total: claimTotal, chapters: chapterCount },
      }

      // 2) 按簇分组（沿用：簇名若只是分区名，用簇内最高分记忆前 9 个字）
      var clById = {}
      var rawClusters = Array.isArray(data.clusters) ? data.clusters : []
      for (i = 0; i < rawClusters.length; i++) {
        var rc = rawClusters[i]
        if (rc && rc.id != null) clById[String(rc.id)] = rc
      }
      var groups = {}
      var groupOrder = []
      for (i = 0; i < allNodes.length; i++) {
        var raw = allNodes[i]
        if (!raw) continue
        var key = String(raw.cluster != null ? raw.cluster : ((raw.audience || '?') + ':' + (raw.region || '?')))
        var g = groups[key]
        if (!g) {
          var meta = clById[key]
          g = groups[key] = {
            id: key,
            label: (meta && meta.label) || regionLabel(meta ? meta.region : raw.region),
            region: (meta && meta.region) || raw.region || 'other',
            audience: (meta && meta.audience) || raw.audience || '',
            x: 0, y: 0, bx: 0, by: 0, r: 0,
            nodes: [],
          }
          groupOrder.push(key)
        }
        g.nodes.push(raw)
      }
      var list = []
      for (i = 0; i < groupOrder.length; i++) list.push(groups[groupOrder[i]])
      for (i = 0; i < list.length; i++) summarizeCluster(list[i])

      // 3) 重要性排序：level → 簇内平均 score → 条数
      list.sort(function (a, b) {
        if (b.maxLevel !== a.maxLevel) return b.maxLevel - a.maxLevel
        if (b.avgScore !== a.avgScore) return b.avgScore - a.avgScore
        if (b.count !== a.count) return b.count - a.count
        return String(a.id) < String(b.id) ? -1 : 1
      })
      if (list.length > STAR_MAX_CLUSTERS) {
        var other = { id: '__other', label: '其他', region: 'other', audience: '', x: 0, y: 0, bx: 0, by: 0, r: 0, nodes: [] }
        for (var oi = STAR_MAX_CLUSTERS; oi < list.length; oi++) {
          var og = list[oi]
          for (var on = 0; on < og.nodes.length; on++) other.nodes.push(og.nodes[on])
        }
        list = list.slice(0, STAR_MAX_CLUSTERS)
        summarizeCluster(other)
        list.push(other)
      }

      // 4) 团半径 + 团名（分区名 → 簇内最高分记忆前 9 字 + 受众后缀）
      for (i = 0; i < list.length; i++) {
        var cp = list[i]
        cp.rank = i
        cp.r = clamp(minDim * 0.024 + Math.sqrt(cp.count) * minDim * 0.0042, 9, minDim * 0.11)
        cp.label = cp.id === '__other' ? '其他' : (cp.label || regionLabel(cp.region))
        if (cp.id !== '__other' && cp.nodes && cp.nodes.length) {
          var REGION_NAMES = {}
          for (var rk2 in REGION_LABEL) { if (Object.prototype.hasOwnProperty.call(REGION_LABEL, rk2)) REGION_NAMES[REGION_LABEL[rk2]] = 1 }
          var head = String(cp.label).split('·')[0]
          if (REGION_NAMES[head] || head === '其他') {
            var rep = null
            var repScore = -Infinity
            for (var q = 0; q < cp.nodes.length; q++) {
              var qs = Number(cp.nodes[q] && cp.nodes[q].score)
              var qv = isFinite(qs) ? qs : 0
              if (qv > repScore) { repScore = qv; rep = cp.nodes[q] }
            }
            var snip = rep && rep.text ? String(rep.text).replace(/\s+/g, ' ').trim() : ''
            var sep = snip.indexOf('：')
            if (sep > 0 && sep <= 16) snip = snip.slice(sep + 1).trim()
            var sep2 = snip.indexOf(':')
            if (sep2 > 0 && sep2 <= 16) snip = snip.slice(sep2 + 1).trim()
            if (snip) cp.label = snip.slice(0, 9) + (snip.length > 9 ? '…' : '')
          }
        }
        // 受众后缀放在最后，保证「换过的团名·群/·私」仍能区分
        // 受众后缀（·群/·私）不在大标签上显示，避免满屏「·私」；hover tooltip 里仍能看到
        cp.color = cp.color || regionColor(cp.region)
        cp.phase = hash01('cp|' + cp.id) * Math.PI * 2
        cp.phase2 = hash01('cq|' + cp.id) * Math.PI * 2
      }

      // 5) 黄金角放射布局：重要团离中心更近；再做分离，团与团不重叠
      var maxCR = 1
      for (i = 0; i < list.length; i++) if (list[i].r > maxCR) maxCR = list[i].r
      var minDist = coreR + maxCR + minDim * 0.055
      var maxDist = minDim * 0.40
      var nCl = list.length
      for (i = 0; i < nCl; i++) {
        var c0 = list[i]
        var frac = nCl > 1 ? Math.pow(i / (nCl - 1), 0.85) : 0
        var dist = minDist + (maxDist - minDist) * frac
        var ang = -Math.PI / 2 + i * 2.399963229728653 + (hash01('ang|' + c0.id) - 0.5) * 0.6
        c0.bx = cx + Math.cos(ang) * dist
        c0.by = cy + Math.sin(ang) * dist
        c0.x = c0.bx
        c0.y = c0.by
      }
      var labelGap = 34
      for (var it = 0; it < 90; it++) {
        var moved = false
        for (var a = 0; a < nCl; a++) {
          for (var b = a + 1; b < nCl; b++) {
            var ca = list[a]
            var cb = list[b]
            var dx = cb.bx - ca.bx
            var dy = cb.by - ca.by
            var d = Math.hypot(dx, dy)
            var need = ca.r + cb.r + labelGap
            if (d < need) {
              if (d < 0.001) { dx = 1; dy = 0; d = 1 }
              var push = (need - d) / 2
              ca.bx -= dx / d * push
              ca.by -= dy / d * push
              cb.bx += dx / d * push
              cb.by += dy / d * push
              moved = true
            }
          }
        }
        for (var mi = 0; mi < nCl; mi++) {
          var mg = list[mi]
          var mdx = mg.bx - cx
          var mdy = mg.by - cy
          var md = Math.hypot(mdx, mdy)
          if (md < 0.001) { mdx = 1; mdy = 0; md = 1 }
          var keep = coreR + mg.r + minDim * 0.05
          if (md < keep) {
            mg.bx = cx + mdx / md * keep
            mg.by = cy + mdy / md * keep
          }
          var padX = mg.r + 16
          var padY = mg.r + 26
          mg.bx = clamp(mg.bx, padX, W - padX)
          mg.by = clamp(mg.by, padY, H - padY)
        }
        if (!moved) break
      }
      for (i = 0; i < nCl; i++) list[i].x = list[i].bx
      for (i = 0; i < nCl; i++) list[i].y = list[i].by
      // 5b) 公转参数：整团绕中心慢转，内圈快、外圈慢（0.01~0.03 rad/s，统一顺时针）
      var maxBaseDist = 1
      for (i = 0; i < nCl; i++) list[i].baseDist = Math.hypot(list[i].bx - cx, list[i].by - cy)
      for (i = 0; i < nCl; i++) if (list[i].baseDist > maxBaseDist) maxBaseDist = list[i].baseDist
      for (i = 0; i < nCl; i++) {
        var co = list[i]
        co.baseAngle = Math.atan2(co.by - cy, co.bx - cx)
        var outerFrac = clamp(co.baseDist / Math.max(1, maxBaseDist), 0, 1)
        co.orbitOmega = -(0.010 + 0.020 * (1 - outerFrac)) // rad/s，负号=顺时针
      }

      // 6) 团内小点：绕团心螺旋分布（半径 ∝ sqrt(size)）
      var planets = []
      var satellites = []
      var satById = new Map()
      for (i = 0; i < nCl; i++) {
        var p = list[i]
        var kids = p.nodes.slice().sort(sortKids)
        p.sats = []
        for (var k = 0; k < kids.length; k++) {
          var nd = kids[k]
          var frac2 = (k + 0.5) / Math.max(1, kids.length)
          var fade = clamp(num(nd.fade, 1), 0.06, 1)
          var affect = clamp(num(nd.affect, 1), 0.2, 12)
          var sat = {
            id: nd.id,
            raw: nd,
            planet: p,
            clusterId: p.id,
            rad: p.r * (0.34 + 0.62 * Math.sqrt(frac2)),
            baseAngle: frac2 * Math.PI * 2 * 2.2 + hash01('na|' + nd.id) * Math.PI * 2,
            omega: (hash01('nw|' + nd.id) - 0.5) * 0.00005,
            r: clamp(0.9 + affect * 0.16, 1, 3),
            color: regionColor(nd.region),
            fade: fade,
            alpha: clamp(0.28 + 0.72 * fade, 0.14, 1),
            spike: !!nd.spike,
            phase: hash01('np|' + nd.id) * Math.PI * 2,
            breathPeriod: 4 + hash01('nb|' + nd.id) * 3,
            x: 0, y: 0, angle: 0,
          }
          p.sats.push(sat)
          satellites.push(sat)
          satById.set(String(sat.id), sat)
        }
        planets.push(p)
      }
      // 8) 真实关联边（data.edges：[src, dst, kind]）
      var edges = []
      var rawEdges = Array.isArray(data.edges) ? data.edges : []
      for (i = 0; i < rawEdges.length; i++) {
        var e = rawEdges[i]
        if (!e || e.length < 2) continue
        var ea = satById.get(String(e[0]))
        var eb = satById.get(String(e[1]))
        if (ea && eb && ea !== eb) edges.push({ a: ea, b: eb, kind: String(e[2] || 'temporal') === 'ground' ? 'ground' : 'temporal' })
      }

      var regionCount = {}
      for (i = 0; i < allNodes.length; i++) {
        var rr = allNodes[i].region || 'other'
        regionCount[rr] = (regionCount[rr] || 0) + 1
      }

      var L = {
        w: W,
        h: H,
        cx: cx,
        cy: cy,
        R: Math.min(maxDist, Math.min(W, H) * 0.45),
        sun: sun,
        coreR: coreR,
        planets: planets,
        satellites: satellites,
        satById: satById,
        edges: edges,
        edgeCount: num(stats.edges, rawEdges.length),
        regionCount: regionCount,
        total: num(stats.nodes, allNodes.length),
        shown: allNodes.length,
        cells: list.length,
        claims: claimTotal,
        spineOpen: num(stats.spine_open, 0),
      }
      placeGraph(L, 0)
      return L
    }

    // 动态布局：整团绕中心顺时针慢公转（内快外慢）+ 极慢整体漂移 + 团内点绕团心
    // 注意：hitTest / hover / pick 必须读这里写回的当前帧坐标，不能再用 buildLayout 的静态坐标
    function placeGraph(L, t) {
      var ms = Number(t) || 0
      var sec = ms / 1000
      // 整图极慢漂移（幅度 ≤2px）
      var driftX = Math.cos(sec * 0.06) * 1.6
      var driftY = Math.sin(sec * 0.047) * 1.4
      var i, k, a, b
      // 1) 整团公转 + 轻微径向呼吸
      for (i = 0; i < L.planets.length; i++) {
        var p = L.planets[i]
        var ang = p.baseAngle + p.orbitOmega * sec
        var rad = p.baseDist + Math.sin(sec * 0.35 + p.phase) * 1.2
        p.x = L.cx + Math.cos(ang) * rad + driftX
        p.y = L.cy + Math.sin(ang) * rad + driftY
        p.orbitAngle = ang
      }
      // 2) 动态软分离（2 轮）：不同角速度的团也不会叠在一起
      for (var it = 0; it < 2; it++) {
        for (a = 0; a < L.planets.length; a++) {
          for (b = a + 1; b < L.planets.length; b++) {
            var ca = L.planets[a]
            var cb = L.planets[b]
            var dx = cb.x - ca.x
            var dy = cb.y - ca.y
            var d = Math.hypot(dx, dy)
            var need = ca.r + cb.r + 8
            if (d < need) {
              if (d < 0.001) { dx = 1; dy = 0; d = 1 }
              var push = (need - d) / 2
              ca.x -= dx / d * push
              ca.y -= dy / d * push
              cb.x += dx / d * push
              cb.y += dy / d * push
            }
          }
        }
      }
      // 3) 团内点跟着团心走（各自慢自转）
      for (i = 0; i < L.planets.length; i++) {
        var pp = L.planets[i]
        for (k = 0; k < pp.sats.length; k++) {
          var s = pp.sats[k]
          s.angle = s.baseAngle + s.omega * ms
          s.x = pp.x + Math.cos(s.angle) * s.rad
          s.y = pp.y + Math.sin(s.angle) * s.rad
        }
      }
    }

    // 全屏细颗粒噪点：128×128 固定种子贴图，只生成一次
    function noiseTile() {
      if (STAR_NOISE_TILE) return STAR_NOISE_TILE
      if (typeof document === 'undefined' || !document || typeof document.createElement !== 'function') return null
      var cv = document.createElement('canvas')
      if (!cv || typeof cv.getContext !== 'function') return null
      var size = 128
      cv.width = size
      cv.height = size
      var cg = cv.getContext('2d')
      if (!cg || typeof cg.createImageData !== 'function' || typeof cg.putImageData !== 'function') return null
      var img = cg.createImageData(size, size)
      if (!img || !img.data) return null
      var d = img.data
      var seed = 0x1a2b3c4d
      for (var i = 0; i < size * size; i++) {
        seed ^= seed << 13
        seed >>>= 0
        seed ^= seed >>> 17
        seed ^= seed << 5
        seed >>>= 0
        var v = seed / 4294967296
        var wm = (seed >>> 9) / 8388608
        d[i * 4] = 205 + Math.round(wm * 50)
        d[i * 4 + 1] = 208 + Math.round(wm * 38)
        d[i * 4 + 2] = 214 + Math.round((1 - wm) * 32)
        d[i * 4 + 3] = Math.round(v * 210)
      }
      cg.putImageData(img, 0, 0)
      STAR_NOISE_TILE = cv
      return cv
    }

    // ---------- 静态背景：深蓝黑 / 星尘 / 星云 / 暗角 / 颗粒 / 极简 HUD ----------
    function paintStatic(g, L, dpr) {
      var W = L.w
      var H = L.h
      var cx = L.cx
      var cy = L.cy
      var minDim = Math.min(W, H)
      var i
      g.save()

      // 1) 深蓝黑垂直渐变
      var sky = g.createLinearGradient(0, 0, 0, H)
      sky.addColorStop(0, STAR_BG_TOP)
      sky.addColorStop(0.55, '#070d18')
      sky.addColorStop(1, STAR_BG_BOTTOM)
      g.fillStyle = sky
      g.fillRect(0, 0, W, H)

      // 2) 两团极淡星云（冷蓝 + 一点暖白）
      var neb = g.createRadialGradient(cx - W * 0.18, cy - H * 0.24, 0, cx - W * 0.18, cy - H * 0.24, Math.max(W, H) * 0.62)
      neb.addColorStop(0, 'rgba(70,108,196,0.075)')
      neb.addColorStop(0.42, 'rgba(58,84,164,0.035)')
      neb.addColorStop(1, 'rgba(30,44,96,0)')
      g.fillStyle = neb
      var nebR = Math.max(W, H) * 0.62
      g.fillRect(cx - W * 0.18 - nebR, cy - H * 0.24 - nebR, nebR * 2, nebR * 2)
      var neb2 = g.createRadialGradient(cx + W * 0.24, cy + H * 0.26, 0, cx + W * 0.24, cy + H * 0.26, Math.max(W, H) * 0.5)
      neb2.addColorStop(0, 'rgba(226,212,186,0.032)')
      neb2.addColorStop(0.5, 'rgba(170,160,150,0.014)')
      neb2.addColorStop(1, 'rgba(120,110,90,0)')
      g.fillStyle = neb2
      var neb2R = Math.max(W, H) * 0.5
      g.fillRect(cx + W * 0.24 - neb2R, cy + H * 0.26 - neb2R, neb2R * 2, neb2R * 2)

      // 3) 微尘星点（固定种子）
      var area = W * H
      var tinyN = clamp(Math.round(area / 4200), 80, 300)
      for (i = 0; i < tinyN; i++) {
        var sx = hash01('tx' + i) * W
        var sy = hash01('ty' + i) * H
        var sr = 0.25 + hash01('tr' + i) * 0.6
        var sa = 0.1 + hash01('ta' + i) * 0.3
        g.fillStyle = 'rgba(196,214,240,' + sa.toFixed(3) + ')'
        g.beginPath()
        g.arc(sx, sy, sr, 0, Math.PI * 2)
        g.fill()
      }
      var midN = clamp(Math.round(area / 30000), 8, 34)
      for (i = 0; i < midN; i++) {
        var mx = hash01('mx' + i) * W
        var my = hash01('my' + i) * H
        var mr = 0.55 + hash01('mr' + i) * 0.8
        var ma = 0.18 + hash01('ma' + i) * 0.34
        g.fillStyle = 'rgba(210,226,248,' + ma.toFixed(3) + ')'
        g.beginPath()
        g.arc(mx, my, mr, 0, Math.PI * 2)
        g.fill()
      }

      // 4) 暗角
      var vig = g.createRadialGradient(cx, cy, minDim * 0.2, cx, cy, Math.max(W, H) * 0.75)
      vig.addColorStop(0, 'rgba(0,0,0,0)')
      vig.addColorStop(0.62, 'rgba(0,0,0,0.12)')
      vig.addColorStop(1, 'rgba(0,0,0,0.5)')
      g.fillStyle = vig
      g.fillRect(0, 0, W, H)
      var corners = [[0, 0], [W, 0], [0, H], [W, H]]
      for (i = 0; i < corners.length; i++) {
        var cr = minDim * 0.5
        var cvig = g.createRadialGradient(corners[i][0], corners[i][1], 0, corners[i][0], corners[i][1], cr)
        cvig.addColorStop(0, 'rgba(0,0,0,0.3)')
        cvig.addColorStop(0.55, 'rgba(0,0,0,0.08)')
        cvig.addColorStop(1, 'rgba(0,0,0,0)')
        g.fillStyle = cvig
        g.fillRect(corners[i][0] === 0 ? 0 : W - cr, corners[i][1] === 0 ? 0 : H - cr, cr, cr)
      }

      // 5) 细颗粒
      var tile = noiseTile()
      if (tile && typeof g.createPattern === 'function') {
        var pat = g.createPattern(tile, 'repeat')
        if (pat) {
          g.globalAlpha = STAR_NOISE_ALPHA
          g.fillStyle = pat
          g.fillRect(0, 0, W, H)
          g.globalAlpha = 1
        }
      }

      // 6) 只留四角短线 + 左上/右下角标
      var m = 12
      var len = 10
      g.strokeStyle = 'rgba(160,190,225,0.20)'
      g.lineWidth = 1
      g.beginPath()
      g.moveTo(m, m + len)
      g.lineTo(m, m)
      g.lineTo(m + len, m)
      g.moveTo(W - m - len, m)
      g.lineTo(W - m, m)
      g.lineTo(W - m, m + len)
      g.moveTo(m, H - m - len)
      g.lineTo(m, H - m)
      g.lineTo(m + len, H - m)
      g.moveTo(W - m - len, H - m)
      g.lineTo(W - m, H - m)
      g.lineTo(W - m, H - m - len)
      g.stroke()
      g.fillStyle = 'rgba(168,192,224,0.36)'
      g.font = '8px ' + MONO
      g.textAlign = 'left'
      g.textBaseline = 'top'
      g.fillText('MEMORY MAP', m + 6, m + 4)
      g.textAlign = 'right'
      g.textBaseline = 'bottom'
      g.fillText('EDGES ' + L.edgeCount + ' · NODES ' + L.shown + ' · CELLS ' + L.cells, W - m - 6, H - m - 4)
      g.restore()
    }

    function sceneFade(st) {
      if (!st || !st.animate) return 1
      return clamp((st.now - (st.fadeAt || 0)) / 250, 0, 1)
    }

    // ---------- 动态层：细线（跨团真实边）/ 放射线 / 团内连线 / 光点 / 发光标签 ----------
    function paintEdges(g, L, st) {
      var scene = sceneFade(st)
      var anim = !!(st && st.animate)
      var tsec = anim ? st.now / 1000 : 0
      // 边线 alpha 呼吸（±30%，像数据在流动）
      var breath = anim ? (0.85 + 0.15 * Math.sin(tsec * 1.15)) : 1
      var temporal = []
      var ground = []
      for (var i = 0; i < L.edges.length; i++) {
        var e = L.edges[i]
        if (e.kind === 'ground') ground.push(e)
        else temporal.push(e)
      }
      var groups = [
        { arr: temporal, style: STAR_EDGE_TEMPORAL + (0.055 * scene * breath).toFixed(3) + ')', w: 0.55 },
        { arr: ground, style: STAR_EDGE_GROUND + (0.13 * scene * (2 - breath)).toFixed(3) + ')', w: 0.7 },
      ]
      for (var gi = 0; gi < groups.length; gi++) {
        var grp = groups[gi]
        if (!grp.arr.length) continue
        g.strokeStyle = grp.style
        g.lineWidth = grp.w
        g.beginPath()
        for (var k = 0; k < grp.arr.length; k++) {
          g.moveTo(grp.arr[k].a.x, grp.arr[k].a.y)
          g.lineTo(grp.arr[k].b.x, grp.arr[k].b.y)
        }
        g.stroke()
      }
      // 少量流动光点：每 12 条边取一条，最多 40 条，沿边缓慢移动（周期 3~6s）
      if (!anim) return
      var flowN = 0
      g.fillStyle = 'rgba(196,222,255,0.9)'
      g.beginPath()
      for (var fi = 0; fi < L.edges.length && flowN < 40; fi++) {
        if (fi % 12 !== 0) continue
        var fe = L.edges[fi]
        var period = 3.2 + hash01('fp' + fi) * 2.6
        var frac = ((tsec / period) + hash01('fo' + fi)) % 1
        var fx = fe.a.x + (fe.b.x - fe.a.x) * frac
        var fy = fe.a.y + (fe.b.y - fe.a.y) * frac
        var fsize = 0.9 + 0.5 * hash01('fs' + fi)
        g.moveTo(fx + fsize, fy)
        g.arc(fx, fy, fsize, 0, Math.PI * 2)
        flowN++
      }
      g.globalAlpha = clamp(0.65 * scene, 0, 1)
      g.fill()
      g.globalAlpha = 1
    }

    // 中心核 → 最重要几个团的放射细线（参考图 2 的放射感）
    function paintRadials(g, L, st) {
      var scene = sceneFade(st)
      var n = Math.min(8, L.planets.length)
      if (!n) return
      g.strokeStyle = 'rgba(150,180,228,' + (0.1 * scene).toFixed(3) + ')'
      g.lineWidth = 0.6
      g.beginPath()
      for (var i = 0; i < n; i++) {
        var p = L.planets[i]
        var dx = p.x - L.cx
        var dy = p.y - L.cy
        var d = Math.hypot(dx, dy) || 1
        g.moveTo(L.cx + dx / d * (L.coreR + 3), L.cy + dy / d * (L.coreR + 3))
        g.lineTo(p.x, p.y)
      }
      g.stroke()
    }

    // 团内小点与团心的细线（按颜色/透明度分桶批量画）
    function paintConstellationLines(g, L, st) {
      var scene = sceneFade(st)
      var buckets = {}
      for (var i = 0; i < L.planets.length; i++) {
        var p = L.planets[i]
        for (var k = 0; k < p.sats.length; k++) {
          var s = p.sats[k]
          var tier = s.alpha > 0.66 ? 2 : (s.alpha > 0.38 ? 1 : 0)
          var key = s.color + '|' + tier
          var b = buckets[key]
          if (!b) b = buckets[key] = { color: s.color, tier: tier, segs: [] }
          b.segs.push(p.x, p.y, s.x, s.y)
        }
      }
      for (var bk in buckets) {
        if (!Object.prototype.hasOwnProperty.call(buckets, bk)) continue
        var bb = buckets[bk]
        g.strokeStyle = rgba(bb.color, (0.06 + bb.tier * 0.05) * scene)
        g.lineWidth = 0.5
        g.beginPath()
        for (var q = 0; q < bb.segs.length; q += 4) {
          g.moveTo(bb.segs[q], bb.segs[q + 1])
          g.lineTo(bb.segs[q + 2], bb.segs[q + 3])
        }
        g.stroke()
      }
    }

    function paintDots(g, L, sprites, hover, selectedId, st) {
      var scene = sceneFade(st)
      var anim = !!(st && st.animate)
      var tsec = anim ? st.now / 1000 : 0
      var flashT = anim ? clamp(1 - (st.now - (st.flashAt || 0)) / 1500, 0, 1) : 0
      var flashIds = (st && st.flashIds) || {}
      var hoverKind = hover ? hover.kind : null
      var hoverId = hover ? String(hover.id) : null
      var hoverCluster = hover && hover.clusterId != null ? String(hover.clusterId) : null
      var selId = selectedId != null ? String(selectedId) : null
      var selSat = selId != null ? L.satById.get(selId) : null
      var selCluster = selSat ? String(selSat.clusterId) : null

      // 团心光点
      for (var i = 0; i < L.planets.length; i++) {
        var p = L.planets[i]
        var isHover = hoverKind === 'planet' && hoverId === String(p.id)
        var inCluster = (hoverCluster != null && hoverCluster === String(p.id)) || (selCluster != null && selCluster === String(p.id))
        var spr = sprites && sprites['star:' + p.color]
        var pulse = anim ? (1 + 0.06 * Math.sin(tsec * 1.7 + p.phase)) : 1
        var glowR = p.r * (isHover || inCluster ? 1.9 : 1.55) * pulse
        g.globalAlpha = clamp(scene * (0.55 + 0.25 * (1 - p.rank / Math.max(1, L.planets.length))) * pulse, 0, 1)
        if (spr) {
          g.drawImage(spr, p.x - glowR, p.y - glowR, glowR * 2, glowR * 2)
        } else {
          var hg = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR)
          hg.addColorStop(0, rgba(p.color, 0.5))
          hg.addColorStop(0.4, rgba(p.color, 0.16))
          hg.addColorStop(1, rgba(p.color, 0))
          g.fillStyle = hg
          g.beginPath()
          g.arc(p.x, p.y, glowR, 0, Math.PI * 2)
          g.fill()
        }
        g.globalAlpha = clamp(scene * 0.95, 0, 1)
        g.fillStyle = mixHex(p.color, '#ffffff', 0.62)
        g.beginPath()
        g.arc(p.x, p.y, clamp(2 + Math.sqrt(p.count) * 0.55, 2.4, 5.6) * pulse, 0, Math.PI * 2)
        g.fill()
        g.globalAlpha = 1
        // 选中 / hover 环
        if (isHover || inCluster) {
          g.strokeStyle = isHover ? 'rgba(232,217,189,0.9)' : 'rgba(232,217,189,0.42)'
          g.lineWidth = isHover ? 1.2 : 0.9
          g.beginPath()
          g.arc(p.x, p.y, p.r + 4, 0, Math.PI * 2)
          g.stroke()
        }
      }

      // 团内记忆点
      for (var j = 0; j < L.satellites.length; j++) {
        var s = L.satellites[j]
        var isNodeHover = hoverKind === 'satellite' && hoverId === String(s.id)
        var isSel = selId != null && selId === String(s.id)
        var isInHoverCluster = hoverCluster != null && hoverCluster === String(s.clusterId)
        var twinkle = anim ? (0.875 + 0.125 * Math.sin(tsec * (Math.PI * 2) / s.breathPeriod + s.phase)) : 1
        var flare = flashIds[String(s.id)] ? flashT : 0
        var alpha = clamp((s.alpha * twinkle + flare * 0.35) * scene, 0.12, 1)
        if (isInHoverCluster && !isNodeHover) alpha = clamp(alpha * 1.5, 0, 1)
        var rad = Math.max(0.6, s.r * (0.95 + 0.05 * twinkle))
        var dspr = sprites && (s.spike ? sprites.spine : (sprites[s.color] || sprites.white))
        g.globalAlpha = alpha * 0.75
        if (dspr) {
          var hz = (rad + 0.9) * 2.6 * (isNodeHover ? 1.9 : 1)
          g.drawImage(dspr, s.x - hz / 2, s.y - hz / 2, hz, hz)
        } else {
          g.fillStyle = rgba(s.color, 0.24)
          g.beginPath()
          g.arc(s.x, s.y, rad * 2.1, 0, Math.PI * 2)
          g.fill()
        }
        g.globalAlpha = Math.min(1, alpha * 0.85 + 0.14)
        g.fillStyle = mixHex(s.color, '#ffffff', 0.35)
        g.beginPath()
        g.arc(s.x, s.y, rad * 0.62, 0, Math.PI * 2)
        g.fill()
        if (s.spike) {
          g.globalAlpha = 0.9
          g.strokeStyle = '#ff6a5e'
          g.lineWidth = 1
          g.beginPath()
          var base = hash01('spike|' + s.id) * Math.PI
          for (var kk = 0; kk < 6; kk++) {
            var sa = base + (kk / 6) * Math.PI * 2
            var sl = rad + 2.4 + 2 * hash01('spikel|' + s.id + '|' + kk)
            g.moveTo(s.x + Math.cos(sa) * (rad + 0.5), s.y + Math.sin(sa) * (rad + 0.5))
            g.lineTo(s.x + Math.cos(sa) * sl, s.y + Math.sin(sa) * sl)
          }
          g.stroke()
        }
        if (flare > 0.02 && sprites && sprites.white) {
          var fz = (rad + 3.5) * 7 * (1 + 0.6 * flare)
          g.globalAlpha = clamp(flare * 0.5, 0, 1)
          g.drawImage(sprites.white, s.x - fz / 2, s.y - fz / 2, fz, fz)
        }
        if (isSel || isNodeHover) {
          g.globalAlpha = 1
          g.strokeStyle = isSel ? 'rgba(232,217,189,0.95)' : 'rgba(190,225,255,0.9)'
          g.lineWidth = isSel ? 1.3 : 1
          g.beginPath()
          g.arc(s.x, s.y, rad + 4, 0, Math.PI * 2)
          g.stroke()
        }
      }

      // 中心亮核（±4% 呼吸）
      var R = L.coreR * (anim ? (1 + 0.04 * Math.sin(tsec * 1.25)) : 1)
      var coreGlow = g.createRadialGradient(L.cx, L.cy, R * 0.2, L.cx, L.cy, R * 6.5)
      coreGlow.addColorStop(0, 'rgba(255,248,230,0.55)')
      coreGlow.addColorStop(0.18, 'rgba(246,232,204,0.3)')
      coreGlow.addColorStop(0.5, 'rgba(196,164,116,0.09)')
      coreGlow.addColorStop(1, 'rgba(80,120,190,0)')
      g.fillStyle = coreGlow
      g.beginPath()
      g.arc(L.cx, L.cy, R * 6.5, 0, Math.PI * 2)
      g.fill()
      var disc = g.createRadialGradient(L.cx - R * 0.2, L.cy - R * 0.24, R * 0.05, L.cx, L.cy, R)
      disc.addColorStop(0, 'rgba(255,253,246,0.98)')
      disc.addColorStop(0.5, 'rgba(246,235,212,0.95)')
      disc.addColorStop(1, 'rgba(214,188,148,0.7)')
      g.fillStyle = disc
      g.beginPath()
      g.arc(L.cx, L.cy, R, 0, Math.PI * 2)
      g.fill()
      g.strokeStyle = 'rgba(255,244,220,0.5)'
      g.lineWidth = 1
      g.beginPath()
      g.arc(L.cx, L.cy, R, 0, Math.PI * 2)
      g.stroke()
      // 核外短半径 bloom，让人一眼看到中心
      var hot = g.createRadialGradient(L.cx, L.cy, R * 0.1, L.cx, L.cy, R * 2.6)
      hot.addColorStop(0, 'rgba(255,250,238,0.32)')
      hot.addColorStop(0.45, 'rgba(248,236,210,0.1)')
      hot.addColorStop(1, 'rgba(240,225,195,0)')
      g.fillStyle = hot
      g.beginPath()
      g.arc(L.cx, L.cy, R * 2.6, 0, Math.PI * 2)
      g.fill()
      if (hoverKind === 'sun') {
        g.strokeStyle = 'rgba(232,217,189,0.9)'
        g.lineWidth = 1.4
        g.beginPath()
        g.arc(L.cx, L.cy, R + 6, 0, Math.PI * 2)
        g.stroke()
      }
      g.globalAlpha = 1
    }

    function paintLabels(g, L, hover, selectedId, st) {
      var scene = sceneFade(st)
      var labelBoxes = []
      function labelFree(bx, by, bw, bh) {
        for (var q = 0; q < labelBoxes.length; q++) {
          var ob = labelBoxes[q]
          if (bx < ob.x + ob.w + 3 && bx + bw + 3 > ob.x && by < ob.y + ob.h + 2 && by + bh + 2 > ob.y) return false
        }
        return true
      }
      var hoverId = hover ? String(hover.id) : null
      var hoverCluster = hover && hover.clusterId != null ? String(hover.clusterId) : (hover && hover.kind === 'planet' ? hoverId : null)
      var selSat = selectedId != null ? L.satById.get(String(selectedId)) : null
      var selCluster = selSat ? String(selSat.clusterId) : null
      for (var i = 0; i < L.planets.length; i++) {
        var p = L.planets[i]
        var isHover = hoverCluster != null && hoverCluster === String(p.id)
        // v7：默认一个团名都不画，只有 hover 团/点、或选中点所在的团才显示
        var show = isHover || (selCluster != null && selCluster === String(p.id))
        if (!show) continue
        var label = p.label
        g.save()
        // 标签字号有层级：最大的团最大声，越外围越小一点（参考图那种主次感）
        var labelSize = STAR_LABEL_FONT - 1
        if (p.rank === 0) labelSize = STAR_LABEL_FONT + 2
        else if (p.rank < 3) labelSize = STAR_LABEL_FONT + 0.5
        else if (p.rank < STAR_LABEL_ALWAYS) labelSize = STAR_LABEL_FONT - 0.5
        g.font = '600 ' + labelSize + 'px ' + MONO
        g.textAlign = 'center'
        g.textBaseline = 'middle'
        var tw = 0
        if (g.measureText) {
          var mt = g.measureText(label)
          tw = mt && typeof mt.width === 'number' ? mt.width : 0
        }
        if (!tw) tw = label.length * 8
        // 标签沿「团心 → 画布外」的径向放，避免都堆在中心
        var ux = p.x - L.cx
        var uy = p.y - L.cy
        var ul = Math.hypot(ux, uy) || 1
        ux /= ul
        uy /= ul
        var lx = clamp(p.x + ux * (p.r + 14), tw / 2 + 8, L.w - tw / 2 - 8)
        var ly = clamp(p.y + uy * (p.r + 16), 14, L.h - 12)
        var bw2 = tw + 4
        var bh2 = 16
        if (!labelFree(lx - bw2 / 2, ly - bh2 / 2, bw2, bh2)) {
          var cands = [ly - 16, ly + 16, ly - 28, ly + 28, ly - 40]
          for (var ci = 0; ci < cands.length; ci++) {
            var cy2 = cands[ci]
            if (cy2 < 14 || cy2 > L.h - 12) continue
            if (labelFree(lx - bw2 / 2, cy2 - bh2 / 2, bw2, bh2)) { ly = cy2; break }
          }
        }
        labelBoxes.push({ x: lx - bw2 / 2, y: ly - bh2 / 2, w: bw2, h: bh2 })
        g.shadowColor = rgba(p.color, 0.9)
        g.shadowBlur = isHover ? 14 : 10
        g.fillStyle = mixHex(p.color, '#ffffff', isHover ? 0.55 : 0.32)
        g.globalAlpha = clamp(scene * (isHover ? 1 : 0.9), 0, 1)
        g.fillText(label, lx, ly)
        g.restore()
      }
      // v7：中心「自我」也只在 hover 中心核时显示
      if (hover && hover.kind === 'sun') {
        g.save()
        g.font = '600 11px ' + MONO
        g.textAlign = 'center'
        g.textBaseline = 'middle'
        g.shadowColor = 'rgba(232,217,189,0.9)'
        g.shadowBlur = 10
        g.fillStyle = 'rgba(240,228,205,' + (scene * 0.95).toFixed(3) + ')'
        g.fillText('自我', L.cx, L.cy + L.coreR + 16)
        g.restore()
      }
    }

    function paintDynamic(g, L, sprites, hover, selectedId, st) {
      if (st.animate) {
        var target = hover ? 1 : 0
        st.hoverLevel += (target - st.hoverLevel) * 0.2
        if (Math.abs(target - st.hoverLevel) < 0.01) st.hoverLevel = target
      } else {
        st.hoverLevel = hover ? 1 : 0
      }
      placeGraph(L, st.animate ? st.now : 0)
      paintEdges(g, L, st)
      paintRadials(g, L, st)
      paintConstellationLines(g, L, st)
      paintDots(g, L, sprites, hover, selectedId, st)
      paintLabels(g, L, hover, selectedId, st)
    }

    // 中心核 tooltip：只来自 mindcore 的 self_claims（自省生成），绝不拼任何 nodes.text
    function sunHit(L) {
      var sun = L.sun
      var info = (sun && sun.claims) || { active: [], total: 0, chapters: 0 }
      var lines = []
      var active = Array.isArray(info.active) ? info.active : []
      for (var i = 0; i < active.length && i < 3; i++) lines.push('· ' + clip(String(active[i]), 60))
      var sub
      if (info.total > 0) sub = '共 ' + info.total + ' 条自我陈述 · ' + num(info.chapters, 0) + ' 段自传'
      else sub = '还没有成形的自我陈述'
      return {
        kind: 'sun',
        id: '__sun',
        selectId: null,
        title: '自我',
        sub: sub,
        text: lines.length ? lines.join('\n') : '',
      }
    }
    function planetHit(p) {
      var lvl = p.maxLevel >= 3 ? '核心' : (p.maxLevel === 2 ? '重要' : (p.maxLevel === 1 ? '普通' : '边缘'))
      return {
        kind: 'planet',
        id: p.id,
        clusterId: p.id,
        selectId: p.pickId,
        title: p.label + ' · ' + p.count + ' 条',
        sub: '平均重要性 ' + (Math.round(p.avgScore * 100) / 100) + ' · ' + lvl + ' · 平均衰减 ' + (Math.round(p.avgFade * 100) / 100),
        text: '点一下：跳到这一簇里最重要的一条记忆',
      }
    }
    function satelliteHit(s) {
      var raw = s.raw || {}
      return {
        kind: 'satellite',
        id: s.id,
        clusterId: s.clusterId,
        selectId: s.id,
        title: regionLabel(raw.region) + (raw.audience ? ' / ' + raw.audience : ''),
        sub: fmtDateTime(raw.created_at),
        text: clip(raw.text, 40) || '（没有正文）',
      }
    }

    // 命中检测：L.planets/L.satellites 的 x/y 是 placeGraph 每帧写回的
    // 当前帧坐标（paintDynamic 每帧先 placeGraph 再画），因此整团旋转时 hover/点击不会错位。
    function hitTest(L, x, y) {
      if (!L) return null
      var i
      var best = null
      var bestD = Infinity
      for (i = 0; i < L.satellites.length; i++) {
        var s = L.satellites[i]
        var pad = Math.max(4.5, s.r + 4.5)
        var dx = x - s.x
        var dy = y - s.y
        var d2 = dx * dx + dy * dy
        if (d2 <= pad * pad && d2 < bestD) {
          best = satelliteHit(s)
          bestD = d2
        }
      }
      for (i = 0; i < L.planets.length; i++) {
        var p = L.planets[i]
        var pad2 = Math.max(8, p.r * 0.92)
        var dx2 = x - p.x
        var dy2 = y - p.y
        var d2p = dx2 * dx2 + dy2 * dy2
        if (d2p <= pad2 * pad2 && d2p < bestD) {
          best = planetHit(p)
          bestD = d2p
        }
      }
      var sdx = x - L.cx
      var sdy = y - L.cy
      if (sdx * sdx + sdy * sdy <= (L.coreR + 8) * (L.coreR + 8)) return sunHit(L)
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

    // ---------- 离屏精灵：光点晕 / 行星圆面（每个颜色一张，绘制时缩放） ----------
    function ensureSprites(spriteRef) {
      if (spriteRef && spriteRef.current) return spriteRef.current
      var map = {}
      var colors = { white: '#a8d4ff', spine: '#ff6a5e', sun: '#ffd9a6' }
      for (var rk in REGION_COLOR) {
        if (Object.prototype.hasOwnProperty.call(REGION_COLOR, rk)) colors[REGION_COLOR[rk]] = REGION_COLOR[rk]
      }
      // 光点晕
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
        grad.addColorStop(0, rgba(color, 0.9))
        grad.addColorStop(0.24, rgba(color, 0.44))
        grad.addColorStop(0.58, rgba(color, 0.12))
        grad.addColorStop(1, rgba(color, 0))
        cg.fillStyle = grad
        cg.beginPath()
        cg.arc(sizePx / 2, sizePx / 2, sizePx / 2, 0, Math.PI * 2)
        cg.fill()
        map[key === 'white' || key === 'spine' || key === 'sun' ? key : color] = cv
      }
      // 星点光斑（每个分区色一张 96px 柔和 halo，动画层只 drawImage）
      for (var sk in REGION_COLOR) {
        if (!Object.prototype.hasOwnProperty.call(REGION_COLOR, sk)) continue
        var sc = mixHex(REGION_COLOR[sk], '#a9ccff', 0.4) // 冷色化：星点统一偏冷，只保留一点分区色倾向
        var ssz = 96
        var scv = document.createElement('canvas')
        scv.width = ssz
        scv.height = ssz
        var sg2 = scv.getContext('2d')
        if (!sg2) continue
        var sgr = sg2.createRadialGradient(ssz / 2, ssz / 2, 0, ssz / 2, ssz / 2, ssz / 2)
        sgr.addColorStop(0, 'rgba(255,255,255,0.96)')
        sgr.addColorStop(0.1, rgba(sc, 0.86))
        sgr.addColorStop(0.3, rgba(sc, 0.42))
        sgr.addColorStop(0.62, rgba(sc, 0.12))
        sgr.addColorStop(1, rgba(sc, 0))
        sg2.fillStyle = sgr
        sg2.beginPath()
        sg2.arc(ssz / 2, ssz / 2, ssz / 2, 0, Math.PI * 2)
        sg2.fill()
        map['star:' + sc] = scv
      }
      // 白热核光斑（所有星点共用）
      var corecv = document.createElement('canvas')
      corecv.width = 64
      corecv.height = 64
      var coreg = corecv.getContext('2d')
      if (coreg) {
        var cgr = coreg.createRadialGradient(32, 32, 0, 32, 32, 32)
        cgr.addColorStop(0, 'rgba(255,255,255,1)')
        cgr.addColorStop(0.18, 'rgba(255,250,235,0.85)')
        cgr.addColorStop(0.45, 'rgba(238,236,232,0.24)')
        cgr.addColorStop(1, 'rgba(220,228,255,0)')
        coreg.fillStyle = cgr
        coreg.beginPath()
        coreg.arc(32, 32, 32, 0, Math.PI * 2)
        coreg.fill()
        map.core = corecv
      }
      if (spriteRef) spriteRef.current = map
      return map
    }

    // ---------- 画布组件 ----------
    function nowMs() {
      return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()
    }

    function CanvasStage(props) {
      var data = props.data
      var selfData = props.claims || null
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
        return buildLayout(data, size.w, size.h, selfData)
      }, [data, size.w, size.h, selfData])

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
        hoverRef.current = hover || null
      }, [hover])

      useEffect(function () {
        selectedRef.current = selectedId
      }, [selectedId])

      // 换数据：250ms 淡入 + 最近想起过的那几条闪一下（1.5s 内衰减）
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
        // 静态背景只算一次：深空 / 星尘 / 星云 / 角标
        var off = document.createElement('canvas')
        off.width = cw
        off.height = ch
        var og = off.getContext('2d')
        if (!og) return
        og.setTransform(dpr, 0, 0, dpr, 0, 0)
        paintStatic(og, layout, dpr)
        cacheRef.current = { layout: layout, canvas: off }
        var sprites = ensureSprites(spriteRef)
        var interval = layout.shown > 900 ? 50 : 33

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
        var curId = hover ? (hover.kind + '|' + hover.id) : null
        var nextId = hit ? (hit.kind + '|' + hit.id) : null
        if (curId !== nextId) setHover(hit)
        positionTip(tipRef.current, p, size)
      }

      function onLeave() {
        setHover(null)
      }

      function onClick(e) {
        if (!layout) return
        var p = pointOf(e)
        var hit = hitTest(layout, p.x, p.y)
        onSelect(hit && hit.selectId != null ? hit.selectId : null)
      }

      var tip = hover
        ? h('div', { ref: tipRef, className: 'ds-tip' },
            h('div', { className: 'ds-tip-title' }, hover.title),
            hover.sub ? h('div', { className: 'ds-tip-time' }, hover.sub) : null,
            h('div', { className: 'ds-tip-text' + (hover.kind === 'sun' ? ' ds-tip-sun' : '') }, hover.text)
          )
        : h('div', { ref: tipRef, className: 'ds-tip', style: { display: 'none' } })

      return h('div', {
        ref: stageRef,
        className: 'ds-stage',
        style: {
          background: STAR_BG,
          borderRadius: '2px',
          borderColor: 'rgba(143,184,232,0.32)',
          boxShadow: 'inset 0 0 60px rgba(10,25,60,0.32), 0 2px 14px rgba(20,50,110,0.10)',
        },
        onMouseMove: onMove,
        onMouseLeave: onLeave,
        onClick: onClick,
        role: 'img',
        'aria-label': '记忆星图：中心是自我陈述，光点是一条记忆，成团的是一簇记忆',
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
      var selfState = useState(null)
      var selfData = selfState[0]
      var setSelfData = selfState[1]

      // 拉自我陈述（mindcore self_claims；失败就空，不影响主流程）
      useEffect(function () {
        var alive = true
        getJSON(API + '/self').then(function (d) {
          if (alive) setSelfData(d || null)
        }).catch(function () {
          if (alive) setSelfData(null)
        })
        return function () { alive = false }
      }, [tick])

      // 拉面板数据（asOf 变 / 手动重算时重拉）
      useEffect(function () {
        var alive = true
        var q = asOf ? ('?asOf=' + encodeURIComponent(asOf)) : ''
        setLoading(true)
        setErr('')
        getJSON(API + '/panel' + q).then(function (d) {
          if (!alive) return
          setData(d)
          setLoading(false)
        }).catch(function (e) {
          if (!alive) return
          setErr(errText(e))
          setLoading(false)
        })
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
      var today = todayStr()
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
      var spineOpen = num(stats.spine_open, 0)

      // 顶部只有一行：识海 + MEMORY MAP 小字；右边 segmented 时间 + ↻
      var subtitle = data
        ? ('MEMORY MAP · ' + totalNodes + ' NODES · ' + cells + ' CELLS · ' + spineOpen + ' 未和解')
        : (err ? 'MEMORY MAP · OFFLINE' : 'MEMORY MAP · LOADING …')

      function segBtn(label, on, day, title) {
        return h('button', {
          type: 'button',
          className: 'ds-seg-btn' + (on ? ' ds-seg-on' : ''),
          onClick: function () { travel(day) },
          title: title,
        }, label)
      }

      var top = h('div', { className: 'ds-top' },
        h('div', { className: 'ds-headings' },
          h('h1', { className: 'ds-title' }, '识海'),
          h('span', { className: 'ds-sub' }, subtitle)
        ),
        h('div', { className: 'ds-actions' },
          h('div', { className: 'ds-seg' },
            segBtn('现在', asOf === '', 0, '看现在的记忆'),
            segBtn('+30d', asOf === d30, 30, '看 30 天后记忆衰减成什么样'),
            segBtn('+90d', asOf === d90, 90, '看 90 天后记忆衰减成什么样'),
            segBtn('+200d', asOf === d200, 200, '看 200 天后记忆衰减成什么样')
          ),
          h('button', {
            type: 'button',
            className: 'ds-icon-btn',
            onClick: refresh,
            disabled: loading,
            title: '重算',
            'aria-label': '重算',
          }, '↻')
        )
      )

      var fail = err
        ? h('div', { className: 'ds-fail' }, '读不到记忆：' + err)
        : null

      function renderDetail() {
        if (selected == null) {
          return h('div', { className: 'ds-dim' }, '点画布上的光点或太阳，这里会展开全文、权重和证据。')
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
            h('b', { style: { color: spine.state === 'resolved' ? '#2f6f68' : '#a85a4a' } },
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
              className: 'ds-btn',
              onClick: rememberOnce,
              disabled: touching,
            }, touching ? '记下中…' : '想起来一次'),
            h('span', { className: 'ds-dim' }, '命中 +1')
          ),
          touchMsg ? h('div', { className: 'ds-msg' + (touchBad ? ' ds-msg-bad' : '') }, touchMsg) : null
        )
      }

      var detailCard = h('div', { className: 'ds-card' },
        h('div', { className: 'ds-card-h' }, 'NODE · 选中的一条'),
        renderDetail()
      )

      var stage = data
        ? h(CanvasStage, {
            data: data,
            claims: selfData,
            selected: selected,
            onSelect: setSelected,
            emptyText: nodes.length === 0 ? '库还是空的：先和她说几句话，记忆会在这里长出来。' : null,
          })
        : h('div', { className: 'ds-standin' }, err ? 'NO DATA // 见上面的错误提示' : 'LOADING // 正在读取 mind.db …')

      var legend = h('div', { className: 'ds-legend' },
        '中心 = 自我陈述 · 光点 = 一条记忆 · 细线 = 关联')

      var body = h('div', { className: 'ds-body' },
        h('div', { className: 'ds-main' }, stage, legend),
        h('aside', { className: 'ds-side' }, h(AffectCard, null), detailCard)
      )

      return h('div', { className: 'ds-panel' }, top, fail, body)
    }

    // ══════════════════════════════════════════════════════════════
    // 「体征」页：情绪内核可视化（化学池 / 心情 / 脉冲曲线 / 刺激时间线）
    // 数据只读 /deep-soul/affect 与 /deep-soul/affect/history；归位走 POST {reset:true}
    // 样式独立注入（id=deep-soul-affect-style），类名一律 .dsa- 前缀，不动上面的 .ds- 常量
    // ══════════════════════════════════════════════════════════════

    const AFFECT_STYLE_ID = 'deep-soul-affect-style'

    const AFFECT_CSS = `
.dsa-panel{display:flex;flex-direction:column;width:100%;height:100%;min-height:520px;box-sizing:border-box;background:linear-gradient(180deg,#f7fbff 0%,#f2f7fd 100%);color:#1c3348;font-size:13px;line-height:1.6;overflow:hidden}
.dsa-panel,.dsa-panel *{box-sizing:border-box}
.dsa-top{display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap;padding:14px 20px 8px;flex:none}
.dsa-headings{min-width:0;flex:1 1 240px}
.dsa-title{margin:0;font-size:20px;line-height:1.25;font-weight:600;letter-spacing:.06em;color:#143a5c}
.dsa-title em{font-style:normal;font-size:10px;letter-spacing:.18em;color:#3f86c8;margin-left:8px;vertical-align:2px;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace}
.dsa-sub{margin-top:3px;font-size:11px;line-height:1.6;color:#6a8cad;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace}
.dsa-actions{display:flex;gap:6px;flex:none;flex-wrap:wrap;align-items:center;padding-top:2px}
.dsa-btn{border:1px solid rgba(40,120,190,.32);border-radius:5px;background:rgba(255,255,255,.82);color:#2f6f9f;padding:5px 11px;font:inherit;font-size:11.5px;line-height:1.4;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;cursor:pointer;transition:background .12s,border-color .12s,color .12s,box-shadow .12s;box-shadow:0 1px 2px rgba(40,110,180,.06)}
.dsa-btn:hover{background:#f0f7ff;border-color:rgba(40,130,200,.6);color:#1f6fa8;box-shadow:0 0 10px rgba(70,150,220,.18)}
.dsa-btn:focus-visible{outline:2px solid rgba(40,140,210,.6);outline-offset:1px}
.dsa-btn:disabled{opacity:.5;cursor:default}
.dsa-btn-on,.dsa-btn-on:hover{border-color:#2f86c8;background:rgba(70,150,220,.14);color:#145a8c;box-shadow:inset 0 0 10px rgba(70,150,220,.12),0 0 10px rgba(70,150,220,.14)}
.dsa-fail{margin:6px 20px 0;padding:8px 12px;border-radius:6px;border:1px solid rgba(200,70,70,.35);background:rgba(220,90,90,.07);color:#a63a3a;font-size:12px;line-height:1.7;flex:none;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace}
.dsa-msg{padding:0 20px 2px;font-size:11px;color:#1f7fc4;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;flex:none}
.dsa-msg-bad{color:#a63a3a}
.dsa-dim{color:#7c9ab3;font-size:11px;margin-top:2px}
.dsa-body{flex:1 1 auto;min-height:0;display:flex;gap:14px;padding:4px 20px 12px;overflow:hidden}
.dsa-main{flex:1 1 auto;min-width:0;min-height:0;display:flex;flex-direction:column;gap:12px}
.dsa-side{width:334px;flex:none;display:flex;flex-direction:column;gap:12px;min-height:0;overflow:auto;padding-bottom:2px}
.dsa-card{border:1px solid rgba(40,120,190,.22);border-radius:10px;background:rgba(255,255,255,.86);padding:11px 13px;flex:none;box-shadow:0 3px 14px rgba(60,120,180,.08),inset 0 0 22px rgba(120,180,230,.05)}
.dsa-card-h{font-size:11px;font-weight:600;letter-spacing:.1em;margin:0 0 8px;color:#1f6fa8;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace}
.dsa-mood{flex:none}
.dsa-mood-main{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.dsa-mood-label{font-size:30px;line-height:1.15;font-weight:600;letter-spacing:.04em;color:#143a5c}
.dsa-mood-pct{margin-left:auto;font-size:20px;font-weight:600;font-variant-numeric:tabular-nums;color:#2f6fd0;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace}
.dsa-mood-track{height:7px;border-radius:4px;background:rgba(70,140,200,.14);overflow:hidden;margin:9px 0 7px}
.dsa-mood-fill{height:100%;border-radius:4px;background:linear-gradient(90deg,#7fc0ee,#2f86c8);box-shadow:0 0 8px rgba(70,160,230,.35);transition:width .4s ease}
.dsa-mood-fill-warn{background:linear-gradient(90deg,#f0b489,#d8443f);box-shadow:0 0 8px rgba(216,68,63,.35)}
.dsa-mood-meta{display:flex;gap:14px;flex-wrap:wrap;font-size:10.5px;color:#6a8cad;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace}
.dsa-mood-reason{margin-top:7px;font-size:12px;line-height:1.65;color:#2b4155;padding:6px 9px;border-left:2px solid rgba(40,130,200,.4);background:rgba(70,150,220,.06);border-radius:0 5px 5px 0}
.dsa-mood-tone{margin-top:5px;font-size:11px;color:#7c9ab3;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace}
.dsa-pulse-card{flex:1 1 auto;min-height:190px;display:flex;flex-direction:column}
.dsa-pulse-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:6px}
.dsa-pulse-head .dsa-card-h{margin:0}
.dsa-pulse-legend{display:flex;gap:10px;flex-wrap:wrap;margin-left:auto;font-size:10px;color:#6a8cad;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace}
.dsa-leg{display:inline-flex;align-items:center;gap:4px}
.dsa-leg i{width:7px;height:7px;border-radius:50%;display:inline-block;flex:none;box-shadow:0 0 5px currentColor}
.dsa-pulse-wrap{position:relative;flex:1 1 auto;min-height:150px;border:1px solid rgba(40,120,190,.16);border-radius:8px;background:linear-gradient(180deg,rgba(248,252,255,.9),rgba(238,246,253,.75));overflow:hidden}
.dsa-pulse-canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.dsa-pulse-empty{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);max-width:240px;text-align:center;font-size:11px;line-height:1.6;color:#7c9ab3;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;background:rgba(255,255,255,.82);padding:4px 9px;border-radius:5px;border:1px dashed rgba(40,130,200,.3);pointer-events:none}
.dsa-chem{margin-bottom:10px}
.dsa-chem:last-child{margin-bottom:2px}
.dsa-chem-head{display:flex;align-items:baseline;gap:8px;font-size:11px;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace}
.dsa-chem-name{color:#527a99}
.dsa-chem-val{margin-left:auto;font-weight:600;font-variant-numeric:tabular-nums;font-size:12px}
.dsa-chem-track{position:relative;height:6px;border-radius:3px;background:rgba(70,140,200,.14);margin-top:5px}
.dsa-chem-fill{position:absolute;left:0;top:0;bottom:0;border-radius:3px;transition:width .4s ease;box-shadow:0 0 6px rgba(70,160,230,.3)}
.dsa-chem-base{position:absolute;top:-3px;bottom:-3px;width:1px;background:rgba(28,51,72,.42);transform:translateX(-.5px);z-index:2}
.dsa-signals{display:flex;flex-direction:column;gap:8px}
.dsa-chips{display:flex;flex-wrap:wrap;gap:6px}
.dsa-chip{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;line-height:1.6;padding:1px 7px;border-radius:4px;border:1px solid rgba(40,120,190,.24);background:rgba(255,255,255,.7);color:#527a99;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace}
.dsa-chip i{font-style:normal;color:#7c9ab3}
.dsa-chip b{font-weight:600;color:#1f5f8f;font-variant-numeric:tabular-nums}
.dsa-chip-warn{border-color:rgba(200,70,70,.45);background:rgba(220,90,90,.08)}
.dsa-chip-warn b{color:#a63a3a}
.dsa-switches{display:flex;flex-wrap:wrap;gap:6px;padding-top:7px;border-top:1px dashed rgba(40,120,190,.18)}
.dsa-switch{font-size:10px;line-height:1.6;padding:1px 7px;border-radius:4px;border:1px solid rgba(40,120,190,.2);color:#7c9ab3;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;letter-spacing:.02em}
.dsa-switch-on{color:#1f7fc4;border-color:rgba(40,130,200,.4);background:rgba(70,150,220,.08)}
.dsa-switch-off{color:#a63a3a;border-color:rgba(200,70,70,.35);background:rgba(220,90,90,.06)}
.dsa-timeline{display:flex;flex-direction:column;max-height:220px;overflow:auto}
.dsa-log-item{display:flex;align-items:baseline;gap:8px;padding:4px 0;border-bottom:1px solid rgba(40,120,190,.08);font-size:11.5px;line-height:1.5}
.dsa-log-item:last-child{border-bottom:0}
.dsa-log-kind{color:#2b4155}
.dsa-log-time{margin-left:auto;font-size:10px;color:#7c9ab3;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;white-space:nowrap}
.dsa-empty{font-size:11px;color:#7c9ab3;padding:4px 0;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace}
.dsa-standin{flex:1 1 auto;display:flex;align-items:center;justify-content:center;margin:6px 20px 16px;border:1px dashed rgba(40,130,200,.35);border-radius:10px;background:#f8fbff;padding:20px;text-align:center;font-size:12px;line-height:1.8;color:#6a8cad;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace}
.dsa-embed{display:flex;flex-direction:column;gap:8px;padding:10px 12px;font-size:12px;color:#1c3348}
.dsa-embed .ds-card-h{display:flex;align-items:center;gap:8px}
.dsa-mini-btn{margin-left:auto;background:none;border:1px solid rgba(40,120,190,.3);border-radius:6px;color:#3d6c92;font-size:11px;padding:0 6px;line-height:18px;cursor:pointer;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace}
.dsa-mini-btn:hover{border-color:rgba(40,120,190,.55);color:#1c5a8c}
.dsa-mini-fail{font-size:11px;color:#a63a3a;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace}
.dsa-mood-row{display:flex;align-items:baseline;gap:8px}
.dsa-mood-label{font-size:19px;font-weight:650;letter-spacing:1.5px;color:#16324a}
.dsa-mood-pct{margin-left:auto;font-size:11px;color:#7c9ab3;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace}
.dsa-embed .dsa-mood-track{height:5px;border-radius:3px;background:rgba(40,120,190,.12);overflow:hidden}
.dsa-embed .dsa-mood-fill{height:100%;background:linear-gradient(90deg,#8fc0ea,#2f6fd0);transition:width .5s ease}
.dsa-embed .dsa-mood-reason{padding:0;font-size:11px;color:#7c9ab3}
.dsa-embed-pulse{height:96px;margin:2px 0 0;position:relative}
.dsa-chips-tight{display:flex;flex-wrap:wrap;gap:4px}
.dsa-chips-tight .dsa-chip{font-size:10px;padding:1px 6px;line-height:16px}
.dsa-embed .dsa-switches{gap:6px}
.dsa-embed .dsa-switch{font-size:10px;padding:1px 6px;line-height:16px}
@media (max-width: 980px){.dsa-body{flex-direction:column;overflow:auto}.dsa-main{min-height:440px;flex:none}.dsa-side{width:auto;overflow:visible}}
@media (max-width: 640px){.dsa-body{padding:4px 12px 12px}.dsa-top{padding:12px 12px 8px}.dsa-fail{margin-left:12px;margin-right:12px}.dsa-msg{padding-left:12px;padding-right:12px}.dsa-standin{margin-left:12px;margin-right:12px}}
`

    function ensureAffectStyle() {
      if (typeof document === 'undefined' || !document || !document.head) return
      if (document.getElementById(AFFECT_STYLE_ID)) return
      var el = document.createElement('style')
      el.id = AFFECT_STYLE_ID
      el.textContent = AFFECT_CSS
      document.head.appendChild(el)
    }

    // 化学量基线（出厂基因组：多巴胺 50 / 皮质醇 20 / 血清素 50），画在条上的细刻度
    const CHEM_BASELINE = { dopamine: 50, cortisol: 20, serotonin: 50 }
    const CHEM_COLOR = { dopamine: '#e08a2e', cortisol: '#d8443f', serotonin: '#2f6fd0' }
    const STIM_LABEL = {
      turn_done: '聊完一轮', request_error: '请求失败', tool_error: '工具出错',
      praised: '被夸', scolded: '被怼', mentioned: '被点名', pain: '被戳到', custom: '手工注入',
    }
    const AFFECT_SWITCHES = [
      { key: 'enabled', label: '内核' },
      { key: 'directive', label: '指令' },
      { key: 'temperature', label: '温度' },
      { key: 'moodFile', label: '心情文件' },
    ]

    function stimLabel(kind) {
      var k = String(kind == null ? '' : kind)
      return STIM_LABEL[k] || (k || '未知')
    }
    // affect 的时间戳是毫秒；兼容万一传成秒
    function agoMs(ts) {
      var n = Number(ts)
      if (!n || !isFinite(n)) return '—'
      if (n < 1e11) n = n * 1000
      var diff = Date.now() - n
      if (diff < 0) diff = 0
      var m = Math.floor(diff / 60000)
      if (m < 1) return '刚刚'
      if (m < 60) return m + ' 分钟前'
      var hh = Math.floor(m / 60)
      if (hh < 24) return hh + ' 小时前'
      var dd = Math.floor(hh / 24)
      if (dd < 30) return dd + ' 天前'
      return Math.floor(dd / 30) + ' 个月前'
    }
    function durText(ms) {
      var m = Math.floor(Number(ms || 0) / 60000)
      if (m < 1) return '刚'
      if (m < 60) return m + ' 分钟'
      var hh = Math.floor(m / 60)
      if (hh < 24) return hh + ' 小时'
      return Math.floor(hh / 24) + ' 天'
    }
    // 温度档位：null = 不覆盖（不干扰宿主采样设置）
    function tempText(t) {
      if (t == null) return '不覆盖'
      var n = Number(t)
      if (!isFinite(n)) return '不覆盖'
      return String(Math.round(n * 100) / 100)
    }
    function moodText(mood) {
      var label = mood && mood.label ? String(mood.label) : '平静'
      var intensity = clamp(num(mood && mood.intensity, 0), 0, 1)
      if (label === '平静' && intensity < 0.4) return '安静'
      return label
    }

    // 脉冲图：Canvas 2D 画三条化学曲线（0-100 归一到高度），无 history 时由面板传入轮询累积的 live 点
    function AffectPulse(props) {
      var points = Array.isArray(props.points) ? props.points : []
      var canvasRef = useRef(null)

      useEffect(function () {
        var cv = canvasRef.current
        if (!cv || typeof cv.getContext !== 'function') return
        var c2 = cv.getContext('2d')
        if (!c2) return
        var W = 0
        var H = 0

        function size() {
          var w = Math.max(140, Math.round(cv.clientWidth || 320))
          var h = Math.max(120, Math.round(cv.clientHeight || 160))
          var dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1)
          if (w === W && h === H) return
          W = w
          H = h
          cv.width = Math.round(w * dpr)
          cv.height = Math.round(h * dpr)
          c2.setTransform(dpr, 0, 0, dpr, 0, 0)
        }

        function paint() {
          size()
          if (!W || !H) return
          c2.clearRect(0, 0, W, H)
          var padL = 26
          var padR = 10
          var padT = 10
          var padB = 8
          var innerW = Math.max(1, W - padL - padR)
          var innerH = Math.max(1, H - padT - padB)
          function yOf(v) { return padT + innerH * (1 - clamp(v, 0, 100) / 100) }
          function xOf(i) {
            if (points.length <= 1) return padL + innerW / 2
            return padL + innerW * (i / (points.length - 1))
          }

          // 网格：0/50/100 三条极淡横线（带极小刻度数字）
          c2.lineWidth = 1
          c2.font = '9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
          c2.textAlign = 'right'
          c2.textBaseline = 'middle'
          var ticks = [100, 50, 0]
          for (var ti = 0; ti < ticks.length; ti++) {
            var ty = Math.round(yOf(ticks[ti])) + 0.5
            c2.strokeStyle = 'rgba(40,120,190,0.12)'
            c2.beginPath()
            c2.moveTo(padL, ty)
            c2.lineTo(W - padR, ty)
            c2.stroke()
            c2.fillStyle = 'rgba(124,154,179,0.75)'
            c2.fillText(String(ticks[ti]), padL - 6, ty)
          }

          // 三条化学曲线：多巴胺暖橙 / 皮质醇红 / 血清素蓝
          var keys = [
            { key: 'dopamine', color: CHEM_COLOR.dopamine },
            { key: 'cortisol', color: CHEM_COLOR.cortisol },
            { key: 'serotonin', color: CHEM_COLOR.serotonin },
          ]
          for (var ki = 0; ki < keys.length; ki++) {
            var k = keys[ki]
            if (points.length === 0) continue
            c2.strokeStyle = k.color
            c2.lineWidth = 1.4
            c2.globalAlpha = 0.92
            c2.beginPath()
            for (var i = 0; i < points.length; i++) {
              var px = xOf(i)
              var py = yOf(num(points[i] && points[i][k.key], 0))
              if (i === 0) c2.moveTo(px, py)
              else c2.lineTo(px, py)
            }
            c2.stroke()
            c2.globalAlpha = 1
            if (points.length === 1) {
              c2.fillStyle = k.color
              c2.beginPath()
              c2.arc(xOf(0), yOf(num(points[0] && points[0][k.key], 0)), 2, 0, Math.PI * 2)
              c2.fill()
            }
          }
        }

        paint()
        var raf = 0
        if (typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(paint)
        var ro = null
        if (typeof ResizeObserver !== 'undefined' && cv.parentNode) {
          ro = new ResizeObserver(function () { paint() })
          ro.observe(cv.parentNode)
        }
        function onResize() { paint() }
        if (typeof window !== 'undefined') window.addEventListener('resize', onResize)
        return function () {
          if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf)
          if (ro) { try { ro.disconnect() } catch (e) {} }
          if (typeof window !== 'undefined') window.removeEventListener('resize', onResize)
        }
      }, [points])

      return h('div', { className: 'dsa-pulse-wrap' },
        h('canvas', { ref: canvasRef, className: 'dsa-pulse-canvas', 'aria-hidden': 'true' }),
        points.length < 2
          ? h('div', { className: 'dsa-pulse-empty' },
              points.length ? '还在攒曲线，等下一次采样…' : '还没有历史采样，先靠轮询一点点攒')
          : null
      )
    }

    function AffectPanel() {
      ensureAffectStyle()
      var snapState = useState(null)
      var snap = snapState[0]
      var setSnap = snapState[1]
      var historyState = useState([])
      var history = historyState[0]
      var setHistory = historyState[1]
      var loadingState = useState(true)
      var loading = loadingState[0]
      var setLoading = loadingState[1]
      var errState = useState('')
      var err = errState[0]
      var setErr = errState[1]
      var tickState = useState(0)
      var tick = tickState[0]
      var setTick = tickState[1]
      var confirmingState = useState(false)
      var confirming = confirmingState[0]
      var setConfirming = confirmingState[1]
      var huggingState = useState(false)
      var hugging = huggingState[0]
      var setHugging = huggingState[1]
      var hugMsgState = useState('')
      var hugMsg = hugMsgState[0]
      var setHugMsg = hugMsgState[1]
      var hugBadState = useState(false)
      var hugBad = hugBadState[0]
      var setHugBad = hugBadState[1]
      var liveRef = useRef([])

      // 轮询：affect 每 3s，history 每 60s；挂载即拉一次，卸载清定时器
      useEffect(function () {
        var alive = true

        function pullHistory() {
          getJSON(API + '/affect/history?n=240').then(function (d) {
            if (!alive) return
            setHistory(Array.isArray(d && d.points) ? d.points : [])
          }).catch(function () { /* history 是锦上添花，失败不打扰 */ })
        }

        function pull() {
          getJSON(API + '/affect').then(function (d) {
            if (!alive) return
            var b = (d && d.byId) || {}
            var live = liveRef.current
            live.push({
              at: num(d && d.at, Date.now()),
              dopamine: num(b.dopamine, 0),
              cortisol: num(b.cortisol, 0),
              serotonin: num(b.serotonin, 0),
              mood: (d && d.mood && d.mood.label) || '',
              temp: d && d.temperature != null ? num(d.temperature, 0) : null,
            })
            if (live.length > 240) live.splice(0, live.length - 240)
            setSnap(d)
            setErr('')
            setLoading(false)
          }).catch(function (e) {
            if (!alive) return
            setErr(errText(e))
            setLoading(false)
          })
        }

        pull()
        pullHistory()
        var t1 = setInterval(pull, 3000)
        var t2 = setInterval(pullHistory, 60000)
        return function () {
          alive = false
          clearInterval(t1)
          clearInterval(t2)
        }
      }, [tick])

      function hug() {
        if (hugging) return
        if (!confirming) {
          setConfirming(true)
          setHugMsg('再点一次「确定哄好？」才归位')
          setHugBad(false)
          return
        }
        setConfirming(false)
        setHugging(true)
        setHugMsg('正在哄…')
        postJSON(API + '/affect', { reset: true }).then(function () {
          setHugMsg('已归位到出厂情绪')
          setHugBad(false)
          setTick(function (t) { return t + 1 })
        }).catch(function (e) {
          setHugMsg('没哄成：' + errText(e))
          setHugBad(true)
        }).then(function () {
          setHugging(false)
        })
      }

      var mood = (snap && snap.mood) || {}
      var byId = (snap && snap.byId) || {}
      var st = (snap && snap.state) || {}
      var cfg = (snap && (snap.config || snap.switches)) || null
      var temp = snap ? snap.temperature : null
      var moodLabel = moodText(mood)
      var intensity = clamp(num(mood.intensity, 0), 0, 1)
      var tone = mood && mood.tone ? String(mood.tone) : ''
      var reason = mood && mood.reason ? String(mood.reason) : ''
      var updatedAt = num(snap && snap.at, 0)
      var lastInteractionAt = num(st.lastInteractionAt, 0)
      var lastStimulusAt = num(st.lastStimulusAt, 0)
      var lastStimulusKind = st.lastStimulusKind || ''
      var logAll = Array.isArray(st.log) ? st.log : []
      var lonelyMs = lastInteractionAt > 0 ? Math.max(0, Date.now() - lastInteractionAt) : 0
      var lonelyWarn = lastInteractionAt > 0 && lonelyMs > 12 * 3600 * 1000
      var pulsePoints = history.length ? history : liveRef.current.slice()

      var chemicals = snap && Array.isArray(snap.chemicals) && snap.chemicals.length
        ? snap.chemicals
        : [
            { id: 'dopamine', label: '多巴胺', value: num(byId.dopamine, 0) },
            { id: 'cortisol', label: '皮质醇', value: num(byId.cortisol, 0) },
            { id: 'serotonin', label: '血清素', value: num(byId.serotonin, 0) },
          ]

      var top = h('div', { className: 'dsa-top' },
        h('div', { className: 'dsa-headings' },
          h('h1', { className: 'dsa-title' }, '体征', h('em', null, 'SOMA')),
          h('div', { className: 'dsa-sub' },
            'SOMA // ' + moodLabel + ' · 温度 ' + tempText(temp) +
            (snap ? (updatedAt ? ' · 更新 ' + agoMs(updatedAt) : '') : ' · ' + (err ? 'OFFLINE' : 'LOADING …')))
        ),
        h('div', { className: 'dsa-actions' },
          h('button', {
            type: 'button',
            className: 'dsa-btn',
            onClick: function () { setTick(function (t) { return t + 1 }) },
            disabled: loading,
          }, loading ? '读取中…' : '刷新'),
          h('button', {
            type: 'button',
            className: 'dsa-btn' + (confirming ? ' dsa-btn-on' : ''),
            onClick: hug,
            disabled: hugging,
            title: confirming ? '再点一次就归位到出厂情绪' : '二次确认后把化学池归位',
          }, hugging ? '哄中…' : (confirming ? '确定哄好？' : '哄好'))
        )
      )

      var fail = err
        ? h('div', { className: 'dsa-fail' },
            h('b', null, '读不到体征'),
            '：' + err,
            h('div', { className: 'dsa-dim' }, '宿主侧的 /deep-soul/affect* 路由可能没起来；修好后点「刷新」。')
          )
        : null

      var msg = hugMsg
        ? h('div', { className: 'dsa-msg' + (hugBad ? ' dsa-msg-bad' : '') }, hugMsg)
        : null

      if (!snap) {
        return h('div', { className: 'dsa-panel' },
          top,
          msg,
          fail,
          h('div', { className: 'dsa-standin' }, err ? 'NO DATA // 情绪内核没有回话' : 'LOADING // 正在读取情绪内核 …')
        )
      }

      var moodCard = h('div', { className: 'dsa-card dsa-mood' },
        h('div', { className: 'dsa-card-h' }, 'MOOD · 此刻心情'),
        h('div', { className: 'dsa-mood-main' },
          h('div', { className: 'dsa-mood-label' }, moodLabel),
          h('div', { className: 'dsa-mood-pct' }, Math.round(intensity * 100) + '%')
        ),
        h('div', { className: 'dsa-mood-track' },
          h('div', {
            className: 'dsa-mood-fill' + (lonelyWarn ? ' dsa-mood-fill-warn' : ''),
            style: { width: (intensity * 100).toFixed(1) + '%' },
          })
        ),
        h('div', { className: 'dsa-mood-meta' },
          h('span', null, '强度 ' + Math.round(intensity * 100) + '%'),
          h('span', null, '温度 ' + tempText(temp)),
          updatedAt ? h('span', null, '更新 ' + agoMs(updatedAt)) : null
        ),
        reason ? h('div', { className: 'dsa-mood-reason' }, '因为：' + reason) : null,
        tone ? h('div', { className: 'dsa-mood-tone' }, '语气 · ' + tone) : null
      )

      var pulLegend = [
        { label: '多巴胺', color: CHEM_COLOR.dopamine },
        { label: '皮质醇', color: CHEM_COLOR.cortisol },
        { label: '血清素', color: CHEM_COLOR.serotonin },
      ].map(function (it) {
        return h('span', { key: it.label, className: 'dsa-leg' },
          h('i', { style: { background: it.color, color: it.color } }),
          it.label
        )
      })

      var pulseCard = h('div', { className: 'dsa-card dsa-pulse-card' },
        h('div', { className: 'dsa-pulse-head' },
          h('div', { className: 'dsa-card-h' }, 'PULSE · 化学脉冲'),
          h('div', { className: 'dsa-pulse-legend' }, pulLegend)
        ),
        h(AffectPulse, { points: pulsePoints })
      )

      var chemCard = h('div', { className: 'dsa-card' },
        h('div', { className: 'dsa-card-h' }, 'CHEMICALS · 化学池'),
        chemicals.map(function (c) {
          var id = String((c && c.id) || '')
          var v = clamp(num(c && c.value, num(byId[id], 0)), 0, 100)
          var base = CHEM_BASELINE[id] != null ? CHEM_BASELINE[id] : 50
          var color = CHEM_COLOR[id] || '#5f86a5'
          return h('div', { key: id || String((c && c.label) || 'chem'), className: 'dsa-chem' },
            h('div', { className: 'dsa-chem-head' },
              h('span', { className: 'dsa-chem-name' }, String((c && c.label) || id || '—')),
              h('span', { className: 'dsa-chem-val', style: { color: color } }, v.toFixed(1))
            ),
            h('div', { className: 'dsa-chem-track' },
              h('div', { className: 'dsa-chem-fill', style: { width: v.toFixed(1) + '%', background: color } }),
              h('i', { className: 'dsa-chem-base', style: { left: base + '%' }, title: '基线 ' + base })
            )
          )
        })
      )

      function chipEl(label, value, warn) {
        return h('span', { className: 'dsa-chip' + (warn ? ' dsa-chip-warn' : '') },
          h('i', null, label),
          h('b', null, value)
        )
      }

      var switchEls = AFFECT_SWITCHES.map(function (s) {
        var on = cfg ? cfg[s.key] !== false : null
        var cls = 'dsa-switch'
        if (on === true) cls += ' dsa-switch-on'
        else if (on === false) cls += ' dsa-switch-off'
        return h('span', { key: s.key, className: cls, title: s.key }, s.label + ' ' + (on == null ? '—' : (on ? '开' : '关')))
      })

      var signalsCard = h('div', { className: 'dsa-card dsa-signals' },
        h('div', { className: 'dsa-card-h' }, 'SIGNALS · 状态'),
        h('div', { className: 'dsa-chips' },
          chipEl('温度', tempText(temp), false),
          chipEl('最近刺激', lastStimulusKind ? (stimLabel(lastStimulusKind) + ' · ' + agoMs(lastStimulusAt)) : '还没被触发过', false),
          chipEl('上次有人说话', lastInteractionAt > 0 ? agoMs(lastInteractionAt) : '—', false),
          chipEl('孤独计时', lastInteractionAt > 0 ? durText(lonelyMs) : '—', lonelyWarn)
        ),
        h('div', { className: 'dsa-switches' }, switchEls)
      )

      var logList = logAll.slice(-12).reverse()
      var logCard = h('div', { className: 'dsa-card' },
        h('div', { className: 'dsa-card-h' }, 'STIMULI · 最近刺激 ' + logAll.length),
        logList.length
          ? h('div', { className: 'dsa-timeline' },
              logList.map(function (item, i) {
                return h('div', { key: i, className: 'dsa-log-item' },
                  h('span', { className: 'dsa-log-kind' }, stimLabel(item && item.kind)),
                  h('span', { className: 'dsa-log-time' }, agoMs(item && item.at))
                )
              })
            )
          : h('div', { className: 'dsa-empty' }, '还没被什么触发过')
      )

      var body = h('div', { className: 'dsa-body' },
        h('div', { className: 'dsa-main' }, moodCard, pulseCard),
        h('aside', { className: 'dsa-side' }, chemCard, signalsCard, logCard)
      )

      return h('div', { className: 'dsa-panel' }, top, msg, fail, body)
    }

    // 左侧栏第二个图标：一条心电图式的脉冲线（20x20，跟着 currentColor）
    function AffectIcon() {
      return h('svg', {
        width: 20,
        height: 20,
        viewBox: '0 0 20 20',
        fill: 'none',
        'aria-hidden': 'true',
        focusable: 'false',
      },
        h('path', {
          d: 'M2.4 10.6h3.1l1.7-4.6 2.4 9 2-6.2 1.4 1.8h4.6',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        h('circle', { cx: 17.2, cy: 10.6, r: 0.8, fill: 'currentColor' })
      )
    }

    // ---------- 体征卡片（嵌进识海右栏，不再是独立页） ----------
    function AffectCard() {
      var affectState = useState(null)
      var affect = affectState[0]
      var setAffect = affectState[1]
      var historyState = useState([])
      var history = historyState[0]
      var setHistory = historyState[1]
      var errState = useState('')
      var err = errState[0]
      var setErr = errState[1]
      var tickState = useState(0)
      var tick = tickState[0]
      var setTick = tickState[1]

      useEffect(function () {
        var alive = true
        function pull() {
          getJSON(API + '/affect').then(function (d) {
            if (!alive) return
            setAffect(d || null)
            setErr('')
          }).catch(function (e) {
            if (!alive) return
            setErr(errText(e))
          })
        }
        function pullHistory() {
          getJSON(API + '/affect/history?n=180').then(function (d) {
            if (!alive) return
            var pts = (d && Array.isArray(d.points)) ? d.points : []
            if (pts.length) setHistory(pts)
          }).catch(function () {})
        }
        pull()
        pullHistory()
        var t1 = setInterval(pull, 3000)
        var t2 = setInterval(pullHistory, 60000)
        return function () {
          alive = false
          clearInterval(t1)
          clearInterval(t2)
        }
      }, [tick])

      var byId = (affect && affect.byId) || {}
      var mood = (affect && affect.mood) || {}
      var stateInfo = (affect && affect.state) || {}
      var config = (affect && affect.config) || {}
      var label = moodText(mood)
      var pct = Math.round(clamp(num(mood.intensity, 0), 0, 1) * 100)
      var temp = affect ? tempText(affect.temperature) : '—'
      var lastKind = stateInfo.lastStimulusKind ? stimLabel(stateInfo.lastStimulusKind) : '—'
      var lastAt = stateInfo.lastStimulusAt ? agoMs(stateInfo.lastStimulusAt) : '—'
      var talkAt = stateInfo.lastInteractionAt ? agoMs(stateInfo.lastInteractionAt) : '—'
      var silent = stateInfo.lastInteractionAt ? (Date.now() - num(stateInfo.lastInteractionAt, Date.now())) : 0
      var lonely = silent > 12 * 3600000

      var chemRows = ['dopamine', 'cortisol', 'serotonin'].map(function (id) {
        var v = clamp(num(byId[id], 0), 0, 100)
        return h('div', { key: id, className: 'dsa-chem' },
          h('div', { className: 'dsa-chem-head' },
            h('span', { className: 'dsa-chem-name' }, ({ dopamine: '多巴胺', cortisol: '皮质醇', serotonin: '血清素' })[id]),
            h('span', { className: 'dsa-chem-val' }, (Math.round(v * 10) / 10).toFixed(1))
          ),
          h('div', { className: 'dsa-chem-track' },
            h('div', { className: 'dsa-chem-fill', style: { width: v + '%', background: CHEM_COLOR[id] } }),
            h('i', { className: 'dsa-chem-base', style: { left: CHEM_BASELINE[id] + '%' } })
          )
        )
      })

      var switchEl = AFFECT_SWITCHES.map(function (s) {
        var on = config[s.key] !== false
        return h('span', { key: s.key, className: 'dsa-switch' + (on ? '' : ' dsa-switch-off'), title: s.label + (on ? '：开' : '：关') }, s.label)
      })

      return h('div', { className: 'ds-card dsa-embed' },
        h('div', { className: 'ds-card-h' }, 'SOMA · 体征',
          h('button', {
            type: 'button',
            className: 'dsa-mini-btn',
            title: '刷新',
            onClick: function () { setTick(function (t) { return t + 1 }) },
          }, '↻')
        ),
        err ? h('div', { className: 'dsa-mini-fail' }, '读不到体征：' + err) : null,
        h('div', { className: 'dsa-mood-row' },
          h('span', { className: 'dsa-mood-label' }, label),
          h('span', { className: 'dsa-mood-pct' }, pct + '%')
        ),
        h('div', { className: 'dsa-mood-track' },
          h('div', { className: 'dsa-mood-fill', style: { width: pct + '%' } })
        ),
        mood.reason ? h('div', { className: 'dsa-mood-reason' }, mood.reason) : null,
        chemRows,
        h('div', { className: 'dsa-chips dsa-chips-tight' },
          h('span', { className: 'dsa-chip' }, '温度 ' + temp),
          h('span', { className: 'dsa-chip' }, '最近 ' + lastKind + (lastAt !== '—' ? ' · ' + lastAt : '')),
          h('span', { className: 'dsa-chip' + (lonely ? ' dsa-chip-warn' : '') }, '有人说话 ' + talkAt)
        ),
        h('div', { className: 'dsa-switches' }, switchEl),
        h('div', { className: 'dsa-embed-pulse' },
          h(AffectPulse, { points: history, height: 96 })
        )
      )
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
      // 体征不再是独立页：卡片嵌进识海右栏（AffectCard），这里只保留样式注入
      try { ensureAffectStyle() } catch (e) {}
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
