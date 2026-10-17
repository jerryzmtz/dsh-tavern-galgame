const React = require('react')
const h = React.createElement
exports.name = 'dsh-tts-local-client'
exports.inject = ['slots']
exports.apply = function(ctx) {
  let active = true
  async function call(method,args = {}) {
    if (!active) throw new Error('PLUGIN_UNAVAILABLE')
    const r = await fetch('/api/dsh-tts-local/v1/control',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,args})})
    const result = await r.json(); if (!r.ok) throw new Error(result.error); return result
  }
  ctx.provide('ttsLocalClient',Object.freeze({apiVersion:1,call,Panel}))
  ctx.effect(() => () => { active = false })
  // private fork: lifecycle controls only; provider configuration is owned by dsh-tts.
  // private fork: no grey helper text (panel-ui-design.md §一.5); same 「?」 as the 配音 panel (dtts-help classes).
  function Help({text,label = '说明'}) {
    const [open,setOpen] = React.useState(false), root = React.useRef(null), id = React.useId()
    React.useEffect(() => {
      if (!open) return
      const out = e => { if (root.current && !root.current.contains(e.target)) setOpen(false) }
      document.addEventListener('pointerdown',out,true); return () => document.removeEventListener('pointerdown',out,true)
    },[open])
    return h('span',{className:'dtts-help-anchor',ref:root,'data-open':open || undefined,onKeyDown:e => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false) } }},
      h('button',{type:'button',className:'dtts-help','aria-label':label,'aria-describedby':id,'aria-expanded':open,onClick:e => { e.preventDefault(); e.stopPropagation(); setOpen(!open) }},'?'),
      h('span',{role:'tooltip',id,className:'dtts-help-tip'},text))
  }
  // private fork (voice settings r3): ⋯ holds the rarer actions (重启, 日志); Esc / outside tap closes.
  function Menu({label,items}) {
    const [open,setOpen] = React.useState(false), root = React.useRef(null)
    React.useEffect(() => {
      if (!open) return
      const out = e => { if (root.current && !root.current.contains(e.target)) setOpen(false) }
      const key = e => { if (e.key === 'Escape') setOpen(false) }
      const doc = root.current.ownerDocument; doc.addEventListener('pointerdown',out,true); doc.addEventListener('keydown',key,true)
      root.current?.querySelector('[role=menuitem]:not(:disabled)')?.focus?.()
      return () => { doc.removeEventListener('pointerdown',out,true); doc.removeEventListener('keydown',key,true) }
    },[open])
    return h('span',{className:'dtts-menu-anchor',ref:root},
      h('button',{type:'button',className:'dtts-icon-button','aria-label':label,title:label,'aria-haspopup':'menu','aria-expanded':open,onClick:() => setOpen(!open)},
        h('svg',{className:'dtts-icon',width:16,height:16,viewBox:'0 0 16 16','aria-hidden':true},[3.5,8,12.5].map(x => h('circle',{key:x,cx:x,cy:8,r:1.25,fill:'currentColor'})))),
      open && h('div',{className:'dtts-menu',role:'menu','aria-label':label},items.filter(Boolean).map(item => h('button',{key:item.label,type:'button',role:'menuitem',disabled:item.disabled,onClick:() => { setOpen(false); item.onSelect() }},item.label))))
  }
  // One status line (state + voice count) and one action that fits the state: 启动 when idle, 停止 while running.
  const STATES = {stopped:'待机',starting:'启动中…',ready:'运行中',stopping:'停止中…',error:'出错'}
  const ERRORS = {REVISION_CONFLICT:'设置刚改过，请再试一次',STOP_TIMEOUT:'停止超时',INVALID_CONFIG:'服务配置文件有误',PLUGIN_UNAVAILABLE:'插件不可用'}
  const errorText = code => ERRORS[code] || (/^[A-Z_]+$/.test(code || '') ? '出错（' + code + '）' : code)
  function Panel({mode} = {}) {
    const advanced = mode !== 'basic'
    const [config,setConfig] = React.useState(null), [state,setState] = React.useState(null), [message,setMessage] = React.useState(''), [logs,setLogs] = React.useState(null), [busy,setBusy] = React.useState(false)
    React.useEffect(() => {
      let mounted = true
      const status = () => call('status').then(s => {if(mounted)setState(s)}).catch(e => {if(mounted)setMessage(e.message)})
      call('settings').then(c => {if(mounted)setConfig(c)}).catch(e => {if(mounted)setMessage(e.message)})
      status(); const timer = setInterval(status,2000)
      return () => {mounted = false; clearInterval(timer)}
    },[])
    const run = fn => async () => { setBusy(true); setMessage(''); try {await fn()} catch(e) {setMessage(errorText(e.message))} finally {try {setState(await call('status'))} catch {} setBusy(false)} }
    const field = (key,label,props = {}) => h('label',{key,className:'dtts-field'},h('span',{className:'dtts-label'},label),h('input',{name:key,value:config[key] ?? '',...props,onChange:e => setConfig({...config,[key]:key === 'readinessTimeoutMs' ? Number(e.target.value) : e.target.value})}))
    // 基础: nothing to manage until an engine is configured or something is running.
    if (!advanced && config && !config.modelConfigPath && (!state || state.state === 'stopped')) return null
    const s = state?.state || 'stopped', running = s === 'ready' || s === 'starting', configured = !!config?.modelConfigPath
    const control = method => run(() => call(method,{providerId:config.providerId,expectedRevision:state?.configRevision}))
    const summary = [STATES[s] || s,s === 'ready' && state?.voiceCount ? state.voiceCount + ' 个音色' : null].filter(Boolean).join(' · ')
    const warn = state?.error ? errorText(state.error) : state?.stale ? '设置已改，重启后生效' : !configured ? '未配置' : ''
    return h('section',{className:'dtts-section dtts-local'},h('header',{className:'dtts-section-head'},h('h3',null,h('span',null,'本地引擎'),h(Help,{label:'本地引擎 说明',text:'用到本地声音时自动启动，空闲 1 小时后自己停下，释放显存。也可以在这里手动启动或停止。'}))),
      !config ? h('p',{className:'dtts-muted'},message || '正在载入…') : h(React.Fragment,null,
        h('div',{className:'dtts-line dtts-engine'},
          h('span',{className:'dtts-line-main is-static'},h('span',{className:'dtts-dot','data-state':s,'aria-hidden':true}),h('output',{className:'dtts-value','data-state':s,'aria-label':'本地引擎状态'},summary)),
          warn && h('span',{className:'dtts-warn',title:warn},'⚠ ' + warn),
          h('span',{className:'dtts-line-actions'},
            running || s === 'stopping' ? h('button',{type:'button',className:'dtts-button',disabled:busy || !state || s === 'stopping',onClick:control('stop')},'停止')
              : h('button',{type:'button',className:'dtts-button',disabled:busy || !state || !configured,onClick:control('start')},'启动'),
            h(Menu,{label:'本地引擎 更多操作',items:[{label:'重启',disabled:busy || !state || !configured || s === 'stopping',onSelect:control('restart')},
              advanced && {label:'查看日志',onSelect:run(async () => setLogs((await call('logs')).items))}]}))),
        advanced && h(React.Fragment,null,
          field('providerId','安装 ID'),field('installPath','工作目录'),field('pythonExecutable','Python 解释器'),field('workerScript','服务脚本'),field('modelConfigPath','服务配置文件'),field('arguments','额外参数（JSON 数组）'),field('environment','环境变量（JSON 对象）'),field('readinessTimeoutMs','就绪超时（毫秒）',{type:'number',className:'dtts-number'}),
          h('label',{className:'dtts-toggle'},h('span',{className:'dtts-toggle-text'},h('strong',null,'随 DSH Tavern 自动启动')),
            h('input',{type:'checkbox',role:'switch',className:'dtts-switch','aria-label':'随 DSH Tavern 自动启动',checked:config.autoStart,onChange:e => setConfig({...config,autoStart:e.target.checked})})),
          h('div',{className:'dtts-actions'},h('button',{type:'button',className:'dtts-button',onClick:run(async () => {setConfig(await call('saveSettings',config));setMessage('已保存设置')})},'保存设置')),
          logs && h('pre',{className:'dtts-log'},logs.map(l => l.text).join('\n') || '暂无日志'))),
      message && h('p',{className:'dtts-status',role:'status'},message))
  }
  ctx.slots.inject('settings.section',() => ctx.slots.register({name:'settings.section',id:'tts-local',order:71,label:() => '本地语音引擎'},Panel))
}
