// private fork (mod settings UI): an in-page fake of the mod settings RPC (docs/fork/mod-config.md) for the browser test
// and the dev gallery (output/mod-plan/config-ui). Plain browser script: defines window.createForkModConfigFake(options)
// → {call(method, args), fileUrl({layer, path}), state}. Fake data: a 小圆-like card (MVU [value, description] tuples,
// nested objects, arrays) plus `bulk` generated rows so the picker is exercised with thousands of nodes.
(function () {
  'use strict'
  const isTuple = v => Array.isArray(v) && v.length === 2 && (v[0] === null || typeof v[0] !== 'object') && typeof v[1] === 'string'
  const seg = s => String(s).replace(/~/g, '~0').replace(/\//g, '~1')
  const typeOf = v => Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v
  function tree(raw, base) {
    const entries = Array.isArray(raw) ? raw.map((v, i) => [String(i), v]) : Object.entries(raw)
    return entries.map(([k, v]) => {
      const path = base + '/' + seg(k)
      if (isTuple(v)) return { name: k, path, type: typeOf(v[0]), value: v[0], description: v[1] }
      if (v && typeof v === 'object' && !v.__pub) return { name: k, path, type: typeOf(v), children: tree(v, path) }
      return { name: k, path, type: typeOf(v), value: v }
    })
  }
  function ptrGet(obj, path) {
    let cur = obj
    for (const raw of path.split('/').slice(1)) {
      const k = raw.replace(/~1/g, '/').replace(/~0/g, '~')
      if (cur == null || typeof cur !== 'object' || !(k in cur)) return undefined
      cur = cur[k]
    }
    return isTuple(cur) ? cur[0] : cur
  }
  function err(code, message, position) { const e = new Error(message); e.code = code; if (position !== undefined) e.position = position; return e }
  const HEX = /^#[0-9a-f]{6}$/i

  window.createForkModConfigFake = function (options) {
    const o = options || {}
    const bulk = Array.from({ length: o.bulk ?? 600 }, (_, i) => ({ 姓名: '路人' + String(i + 1).padStart(4, '0'), 好感: (i * 37) % 100, 所在: ['商店街', '学校', '医院', '河堤'][i % 4], 状态: [i % 3 ? '正常' : '外出', '当前状态'] }))
    const data = {
      mvu: {
        世界状态: { 时间: ['01:00', '24 小时制'], 日期: ['4月10日', '故事内日期'], 地点: ['见泷原市', '当前所在地'], 天气: '晴' },
        活跃魔法少女: {
          '晓美焰（眼镜）': { SG浑浊度: [12, '0–100，越高越危险'], 魔力: [60, '剩余魔力'], 状态: '正常', 能力: ['时间停止', '盾牌', '枪械'] },
          鹿目圆: { SG浑浊度: [5, '0–100，越高越危险'], 魔力: [90, '剩余魔力'], 状态: '未契约' },
          美树沙耶香: { SG浑浊度: [34, '0–100，越高越危险'], 魔力: [40, '剩余魔力'], 状态: '战斗中' }
        },
        悲叹之种: [{ 编号: 'G-01', 剩余: 3 }, { 编号: 'G-02', 剩余: 1 }],
        主角: { hp: [80, '体力'], hp_max: [100, '体力上限'], 所持金: 1200, 当前时间: ['深夜', '粗略时段'] },
        路人档案: bulk
      },
      'helper-chat': { 轮回次数: 3 },
      stage: { 背景: '见泷原·夜晚街道', 时段: '深夜', 天气: '晴', 在场人物: ['鹿目圆', '晓美焰'], 说话人: '鹿目圆', 人物: { 鹿目圆: { 形象色: '#f08cb4' }, 晓美焰: { 形象色: '#7a5bc4' } } },
      'mod:dsh.items': { 持有: '悲叹之种', 数量: 2 },
      'mod:dsh.phone': { 未读: 1, 电量: { __pub: 'battery' }, 信号: { __pub: 'signal' } }
    }
    const SOURCES = [['mvu', '变量'], ['helper-chat', '聊天变量'], ['stage', '舞台'], ['mod:dsh.items', '模组·物品'], ['mod:dsh.phone', '模组·手机']]
    const PUBLISHED = { 'mod:dsh.phone': { '/电量': 'battery', '/信号': 'signal' } }
    const fields = [
      { key: 'accent', label: '主题色', valueType: 'string', autoRef: { source: 'stage', path: '/人物/鹿目圆/形象色' }, ui: { control: 'colour' } },
      { key: 'bodyColor', label: '机身色', valueType: 'string', autoRef: { source: 'stage', path: '/skin/line' }, ui: { control: 'colour' } },
      { key: 'wallpaper', label: '壁纸', valueType: 'object', ui: { control: 'image' } },
      { key: 'carrier', label: '运营商', valueType: 'string', maxLength: 12, default: '' },
      { key: 'frame', label: '机型', valueType: 'string', ui: { control: 'choice', choices: [{ value: 'island', label: '灵动岛' }, { value: 'notch', label: '刘海' }, { value: 'none', label: '无开孔' }, { value: 'flip', label: '翻盖机' }] }, default: 'island' },
      { key: 'clock', label: '状态栏时间', valueType: 'string', guessHints: { format: 'time' }, ui: { control: 'time' }, default: '09:41' },
      { key: 'battery', label: '电量', valueType: 'number', min: 0, max: 100, guessHints: { keywords: ['电量'] }, ui: { unit: '%' }, default: 80 },
      { key: 'signal', label: '信号', valueType: 'number', min: 0, max: 4, guessHints: { keywords: ['信号'] }, ui: { unit: '格', integer: true }, default: 4 },
      { key: 'tone', label: '提示音', valueType: 'string', ui: { control: 'choice', choices: [{ value: 'ding', label: '叮咚' }, { value: 'drop', label: '水滴' }, { value: 'retro', label: '复古' }, { value: 'mute', label: '静音' }] }, default: 'ding', scope: 'global' },
      { key: 'contactName', label: '备注名 · 鹿目圆', valueType: 'string', maxLength: 16, default: '鹿目圆' },
      { key: 'avatar', label: '头像 · 鹿目圆', valueType: 'object', ui: { control: 'image', round: true } }
    ]
    const state = { revision: 1, global: { ...(o.global || { tone: { fixed: 'drop' } }) }, card: { ...(o.card || { carrier: { fixed: '见泷原通信' } }) }, files: {}, data }
    const field = key => fields.find(f => f.key === key)
    const srcObj = id => data[id]
    function readRef(ref, stack) {
      const pub = PUBLISHED[ref.source] && PUBLISHED[ref.source][ref.path]
      if (pub) {
        if (stack.includes(pub)) throw err('CONFIG_CYCLE', '循环引用：' + [...stack.slice(stack.indexOf(pub)), pub].map(k => field(k).label).join(' → '))
        const r = resolveKey(pub, stack)
        if (r.error) throw err(r.error.code, r.error.message)
        return r.value
      }
      const obj = srcObj(ref.source)
      if (!obj) throw err('SOURCE_UNAVAILABLE', '这张卡没有数据源「' + ref.source + '」')
      const v = ptrGet(obj, ref.path)
      if (v === undefined) throw err('SOURCE_MISSING', '找不到 ' + ref.path)
      return v
    }
    // Formula: numbers, "strings", {source:/path}, + - * / (also − × ÷), ( ), min max round floor ceil clamp abs.
    function evaluate(text, stack) {
      const t = []; let i = 0
      while (i < text.length) {
        const ch = text[i]
        if (/\s/.test(ch)) { i++; continue }
        if (ch === '{') {
          const j = text.indexOf('}', i); if (j < 0) throw err('FORMULA_SYNTAX', '引用缺少 }', i)
          const body = text.slice(i + 1, j), k = body.indexOf(':/'); if (k < 0) throw err('FORMULA_SYNTAX', '引用写法应为 {来源:路径}', i)
          t.push({ t: 'ref', v: { source: body.slice(0, k), path: body.slice(k + 1) }, at: i }); i = j + 1; continue
        }
        if (/[0-9.]/.test(ch)) { let j = i; while (j < text.length && /[0-9.]/.test(text[j])) j++; const n = Number(text.slice(i, j)); if (!isFinite(n)) throw err('FORMULA_SYNTAX', '数字写错了', i); t.push({ t: 'num', v: n, at: i }); i = j; continue }
        if (ch === '"') { const j = text.indexOf('"', i + 1); if (j < 0) throw err('FORMULA_SYNTAX', '字符串缺少 "', i); t.push({ t: 'str', v: text.slice(i + 1, j), at: i }); i = j + 1; continue }
        if (/[A-Za-z_]/.test(ch)) { let j = i; while (j < text.length && /[A-Za-z0-9_]/.test(text[j])) j++; t.push({ t: 'id', v: text.slice(i, j), at: i }); i = j; continue }
        if ('+-*/×÷−(),'.includes(ch)) { t.push({ t: 'op', v: ch === '×' ? '*' : ch === '÷' ? '/' : ch === '−' ? '-' : ch, at: i }); i++; continue }
        throw err('FORMULA_SYNTAX', '看不懂「' + ch + '」', i)
      }
      let p = 0
      const peek = () => t[p], next = () => t[p++], isOp = v => peek() && peek().t === 'op' && peek().v === v
      const num = (v, tok) => { if (typeof v !== 'number') throw err('FORMULA_TYPE', '不是数字（' + v + '）', tok.at); return v }
      const FN = { min: a => Math.min(...a), max: a => Math.max(...a), round: a => Math.round(a[0]), floor: a => Math.floor(a[0]), ceil: a => Math.ceil(a[0]), abs: a => Math.abs(a[0]), clamp: a => Math.min(Math.max(a[0], a[1]), a[2]) }
      function expr() { let v = term(); while (isOp('+') || isOp('-')) { const o = next(); const r = term(); v = o.v === '+' ? (typeof v === 'string' || typeof r === 'string' ? String(v) + String(r) : v + r) : num(v, o) - num(r, o) } return v }
      function term() { let v = unary(); while (isOp('*') || isOp('/')) { const o = next(), at = peek(); const r = unary(); if (o.v === '/' && r === 0) throw err('FORMULA_MATH', '除以 0', at ? at.at : o.at); v = o.v === '*' ? num(v, o) * num(r, o) : num(v, o) / num(r, o) } return v }
      function unary() { if (isOp('-')) { const o = next(); return -num(unary(), o) } if (isOp('+')) { next(); return unary() } return primary() }
      function primary() {
        const k = next()
        if (!k) throw err('FORMULA_SYNTAX', '公式没写完', text.length)
        if (k.t === 'num' || k.t === 'str') return k.v
        if (k.t === 'ref') { try { return readRef(k.v, stack) } catch (e) { e.position = k.at; throw e } }
        if (k.t === 'id') {
          const fn = FN[k.v.toLowerCase()]
          if (!fn || !isOp('(')) throw err('FORMULA_SYNTAX', '不认识「' + k.v + '」', k.at)
          next(); const args = []; if (!isOp(')')) { args.push(expr()); while (isOp(',')) { next(); args.push(expr()) } }
          if (!isOp(')')) throw err('FORMULA_SYNTAX', '少了 )', peek() ? peek().at : text.length); next()
          if (k.v === 'clamp' && args.length !== 3) throw err('FORMULA_TYPE', 'clamp 要三个数', k.at)
          return fn(args.map(a => num(a, k)))
        }
        if (k.t === 'op' && k.v === '(') { const v = expr(); if (!isOp(')')) throw err('FORMULA_SYNTAX', '少了 )', peek() ? peek().at : text.length); next(); return v }
        throw err('FORMULA_SYNTAX', '这里不该是「' + k.v + '」', k.at)
      }
      if (!text.trim()) throw err('FORMULA_SYNTAX', '公式是空的', 0)
      const v = expr()
      if (p < t.length) throw err('FORMULA_SYNTAX', '多出了「' + (t[p].t === 'ref' ? '引用' : t[p].v) + '」', t[p].at)
      if (typeof v === 'number' && !isFinite(v)) throw err('FORMULA_MATH', '结果不是有限的数', 0)
      return v
    }
    // Auto: variable candidates by keyword (time values first), else a rule or the declared default.
    function candidates(key) {
      const words = { clock: ['时间', 'time', '当前时间', 'clock'], carrier: ['运营商', 'carrier'], battery: ['电量', 'battery'], signal: ['信号', 'signal'] }[key]
      if (!words) return []
      const out = []
      const walk = (nodes) => { for (const n of nodes) { if (n.children) { walk(n.children); continue } const leaf = String(n.name).toLowerCase(); const wi = words.indexOf(leaf); if (wi < 0) continue; let score = 60 - wi * 5; if (/^\d{1,2}:\d{2}/.test(String(n.value))) score += 30; if (n.path.startsWith('/世界状态/')) score += 8; out.push({ variable: { source: 'mvu', path: n.path }, value: n.value, score }) } }
      walk(tree(data.mvu, ''))
      return out.sort((a, b) => b.score - a.score || a.variable.path.localeCompare(b.variable.path))
    }
    function auto(key) {
      const cands = candidates(key), f = field(key)
      if (key === 'accent') return { value: data.stage.人物.鹿目圆.形象色, autoCandidates: [] }
      if (key === 'bodyColor') return { value: '#d8c3cf', autoCandidates: [] }
      if (cands.length && (f.valueType !== 'number' || typeof cands[0].value === 'number')) return { value: cands[0].value, autoCandidates: cands }
      return { value: f.default ?? null, autoCandidates: cands }
    }
    function resolveKey(key, stack = []) {
      const f = field(key), inCard = f.scope !== 'global' && key in state.card
      const layer = inCard ? 'card' : key in state.global ? 'global' : 'auto', val = inCard ? state.card[key] : layer === 'global' ? state.global[key] : { auto: true }
      const kind = 'fixed' in val ? 'fixed' : 'ref' in val ? 'ref' : 'formula' in val ? 'formula' : 'auto'
      const a = auto(key), base = { layer, kind, autoCandidates: a.autoCandidates }
      try {
        let value
        if (kind === 'auto') value = a.value
        else if (kind === 'fixed') value = val.fixed
        else if (kind === 'ref') { value = readRef(val.ref, [...stack, key]); if (f.valueType === 'number' && typeof value !== 'number') throw err('CONFIG_TYPE', val.ref.path + ' 的值「' + value + '」不是数字'); if (f.ui && f.ui.control === 'colour' && !HEX.test(String(value))) throw err('CONFIG_TYPE', val.ref.path + ' 不是颜色') }
        else value = evaluate(val.formula, [...stack, key])
        if (typeof value === 'number' && typeof f.min === 'number') value = Math.min(Math.max(f.ui && f.ui.integer ? Math.round(value) : Math.round(value * 10) / 10, f.min), f.max)
        return { ...base, value }
      } catch (e) { return { ...base, value: null, error: { code: e.code || 'ERROR', message: e.message, ...(e.position !== undefined ? { position: e.position } : {}) } } }
    }
    const dto = () => ({ modId: 'dsh.phone', revision: state.revision, schema: { fields }, global: { ...state.global }, card: { ...state.card }, resolved: Object.fromEntries(fields.map(f => [f.key, resolveKey(f.key)])) })
    const delay = () => new Promise(r => setTimeout(r, o.latency ?? 30))
    const check = args => { if (args.expectedRevision !== state.revision) throw err('REVISION_CONFLICT', '设置已在别处修改，已重新载入') }
    const api = {
      async getModConfig() { await delay(); return dto() },
      async setModConfig(args) { await delay(); check(args); const f = field(args.key); if (!f) throw err('UNKNOWN_FIELD', '未知设置'); if (args.layer === 'card' && f.scope === 'global') throw err('CONFIG_SCOPE', '只有全局'); state[args.layer][args.key] = args.value; state.revision++; return dto() },
      async clearModConfig(args) { await delay(); check(args); delete state[args.layer][args.key]; state.revision++; return dto() },
      async listModConfigSources() {
        await delay()
        const pubTree = id => tree(data[id], '').map(n => { const pub = PUBLISHED[id] && PUBLISHED[id][n.path]; if (!pub) return n; const r = resolveKey(pub); return { name: n.name, path: n.path, type: 'number', value: r.value, settingKey: pub } })
        return { sources: SOURCES.map(([id, label]) => ({ id, label, exports: [], tree: pubTree(id) })) }
      },
      async evaluateModConfigFormula(args) { await delay(); try { return { value: evaluate(args.formula, []) } } catch (e) { return { error: { code: e.code || 'ERROR', message: e.message, ...(e.position !== undefined ? { position: e.position } : {}) } } } },
      async uploadModConfigFile(args) { await delay(); check(args); const path = 'files/' + Math.random().toString(16).slice(2, 10) + '.' + ((args.mime || 'image/png').split('/')[1] || 'png'); state.files[args.layer + ':' + path] = 'data:' + args.mime + ';base64,' + args.data; state.revision++; return { revision: state.revision, file: { path, mime: args.mime, size: args.data.length } } }
    }
    const log = []
    return {
      state, log, evaluate: text => evaluate(text, []),
      call: async (method, args) => { log.push([method, args]); if (!api[method]) throw err('UNKNOWN_METHOD', method); return api[method](args || {}) },
      fileUrl: ({ layer, path }) => state.files[layer + ':' + path] || (o.demoFiles && o.demoFiles[path]) || null
    }
  }
})()
