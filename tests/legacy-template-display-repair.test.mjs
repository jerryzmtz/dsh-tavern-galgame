import test from 'node:test'
import assert from 'node:assert/strict'
import {marked} from 'marked'

import {projectReplyHistory} from '../tavern-plugin/lib/domain/reply-presentation.js'

const source='<scene_time>\n朝\n</scene_time>\n<now_plot>正文</now_plot>'
const markup='<html>\n\n<body><p>正文</p>\n<script>\nwindow.value=0;\n\n    (()=>{window.value=3})();\n</script></body></html>'
const rule={enabled:true,placement:[2],markdownOnly:true,findRegex:'/<now_plot>([\\s\\S]*)<\\/now_plot>/g',replaceString:markup}
const broken=marked.parse(source.replace(/<now_plot>[\s\S]*<\/now_plot>/,markup))
const snapshot={source,swipe:0,html:broken,parts:[{kind:'html',content:broken}]}
const project=(display,rules=[rule])=>projectReplyHistory([{role:'assistant',turn:1,text:source,sourceText:source,tavernPluginData:{template_display:display}}],{regexScripts:rules}).projections[0]

test('does not replace historical scripts with a different current card implementation',()=>{
  const view=project(snapshot,[{...rule,replaceString:markup.replace('window.value=3','window.value=4')}])
  assert.equal(view.parts[0].content,broken)
})
