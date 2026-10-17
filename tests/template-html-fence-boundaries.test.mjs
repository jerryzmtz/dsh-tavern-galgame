import assert from 'node:assert/strict'
import test from 'node:test'
import {Script} from 'node:vm'
import {JSDOM} from 'jsdom'
import {UpstreamTemplateRuntime} from './fixtures/upstream-template-runtime.mjs'
import {projectReplyHistory} from '../tavern-plugin/lib/domain/reply-presentation.js'

const runtime = await UpstreamTemplateRuntime.create()

for (const language of ['', 'html', 'htm', 'text']) {
  test(`template evaluation retains executable ${language || 'unlabelled'} HTML fences`, async () => {
    const source = '<scene_time>\n朝\n</scene_time>\n<now_plot>正文</now_plot>'
    const markup = '<html>\n\n<body><p>正文</p><script>\nwindow.value=0;\n\n    window.value=3;\n</script></body></html>'
    const rules = [{enabled:true,placement:[2],markdownOnly:true,findRegex:'/<now_plot>([\\s\\S]*)<\\/now_plot>/g',replaceString:'```'+language+'\n'+markup+'\n```'}]
    const result = await runtime.lifecycle({settings:{preload_worldinfo_enabled:false,raw_message_evaluation_enabled:false,render_enabled:true},regexScripts:rules,worldBookEntries:[{uid:1,enabled:false,constant:true,content:'@@render_before\n模板前缀=<%= 1 + 2 %>'}],transcript:[{role:'assistant',content:source}]})
    const view = projectReplyHistory([{role:'assistant',turn:1,text:source,sourceText:source,tavernPluginData:result.first.chat[0]}],{regexScripts:rules})
    const html = view.projections.flatMap(p=>p.parts).filter(p=>p.kind==='html').map(p=>p.content).join('')
    assert.match(html, /模板前缀/)
    assert.match(html, /window.value=3;/)
    assert.doesNotMatch(html, /<%|&lt;%/)
    const dom = new JSDOM(html)
    try { for (const script of dom.window.document.querySelectorAll('script')) assert.doesNotThrow(()=>new Script(script.textContent)) }
    finally { dom.window.close() }
    assert.equal(result.first.chat[0].mes,source)
  })
}

for (const fenced of [false, true]) {
  test(`HTML ${fenced ? 'inside fences' : 'without fences'} preserves scripts and evaluates EJS once`, async () => {
    const source = '<scene_time>\n朝\n</scene_time>\n<now_plot>正文</now_plot>'
    const markup = '<html>\n\n<body><noscript><p>fallback</p></noscript><p>正文</p>\n<script>\nwindow.value=0;\n\n    window.value=<%- 1 + 2 %>;\n</script></body></html>'
    const rules = [{enabled:true,placement:[2],markdownOnly:true,findRegex:'/<now_plot>([\\s\\S]*)<\\/now_plot>/g',replaceString:fenced ? '```html\n'+markup+'\n```' : markup}]
    const result = await runtime.lifecycle({settings:{preload_worldinfo_enabled:false,raw_message_evaluation_enabled:false,render_enabled:true,code_blocks_enabled:true},regexScripts:rules,transcript:[{role:'assistant',content:source}]})
    const view = projectReplyHistory([{role:'assistant',turn:1,text:source,sourceText:source,tavernPluginData:result.first.chat[0]}],{regexScripts:rules})
    const html = view.projections.flatMap(p=>p.parts).filter(p=>p.kind==='html').map(p=>p.content).join('')
    const dom = new JSDOM(html)
    try {
      const script = dom.window.document.querySelector('script').textContent
      assert.doesNotThrow(()=>new Script(script))
      assert.match(script,/window.value=3;/)
    } finally {dom.window.close()}
    if (runtime.page) {
      await runtime.page.evaluate(content=>{const frame=document.createElement('iframe');frame.id='evaluated-story';frame.srcdoc=content;document.body.append(frame)},html)
      await runtime.page.waitForFunction(()=>document.querySelector('#evaluated-story')?.contentWindow.value===3)
      await runtime.page.locator('#evaluated-story').evaluate(frame=>frame.remove())
    }
    assert.equal(result.first.chat[0].mes,source)
    assert.deepEqual(result.first.chat,result.second.chat)
  })
}

for (const codeBlocks of [false, true]) {
  test(`fenced EJS honors the code-block switch (${codeBlocks}) without repeated effects`,async()=>{
    const source='标记'
    const markup='<html><body><% setMessageVar("displayRuns", (getMessageVar("displayRuns") || 0) + 1) %><script>window.value=<%- 3 %>;</script></body></html>'
    const rules=[{enabled:true,placement:[2],markdownOnly:true,findRegex:'/标记/g',replaceString:'```html\n'+markup+'\n```'}]
    const result=await runtime.lifecycle({settings:{preload_worldinfo_enabled:false,raw_message_evaluation_enabled:false,render_enabled:true,code_blocks_enabled:codeBlocks},regexScripts:rules,transcript:[{role:'assistant',content:source}]})
    assert.equal(result.first.chat[0].variables[0].displayRuns,codeBlocks ? 1 : undefined)
    assert.deepEqual(result.first.chat,result.second.chat)
    assert.equal(result.first.chat[0].mes,source)
  })
}
