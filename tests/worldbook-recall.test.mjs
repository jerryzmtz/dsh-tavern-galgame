import assert from 'node:assert/strict'
import test from 'node:test'

import { projectWorldBookTemplates, prepareWorldBookRecall } from '../tavern-plugin/lib/domain/worldbook-recall.js'

function entry(ref, content, options = {}) {
  return {
    ref,
    title: options.title || ref,
    content,
    enabled: options.enabled !== false,
    constant: options.constant === true,
    primaryKeys: options.primaryKeys || [],
    secondaryKeys: options.secondaryKeys || [],
    selective: options.selective === true,
    selectiveLogic: options.selectiveLogic ?? 0,
    caseSensitive: options.caseSensitive ?? null,
    matchWholeWords: options.matchWholeWords ?? null,
    order: options.order ?? 100,
    displayIndex: options.displayIndex ?? Number(ref.replace(/\D/g, '') || 0)
  }
}

function card() { return { name: '阿芙拉' } }

function chat(body = '两人正在旅店大厅交谈。') {
  return {
    id: 'chat-1', cardPath: 'cards/阿芙拉.json', cardName: '阿芙拉', mode: 'story',
    messages: [{ role: 'assistant', text: body, turn: 2 }],
    macroState: { userName: '叶舟', local: {}, global: {} }
  }
}

test('条目正文改变后立即解除冷却，空世界书直接跳过', async function () {
  const skipped = prepareWorldBookRecall({ card: card(), chat: chat(), worldBook: null })
  assert.equal(skipped.kind, 'skip')
  assert.equal(skipped.context, '')
  assert.deepEqual(skipped.refs, [])

  const original = entry('entry:0', '旧设定。', { primaryKeys: ['钟楼'] })
  const first = prepareWorldBookRecall({ card: card(), chat: chat('抵达钟楼。'), turn: 2, worldBook: { view: { entries: [original] } } })
  const current = chat('仍在钟楼。')
  current.worldBookReads = first.recordReads(null)
  const changed = entry('entry:0', '修改后的新设定。', { primaryKeys: ['钟楼'] })

  const prepared = prepareWorldBookRecall({ card: card(), chat: current, turn: 3, worldBook: { view: { entries: [changed] } } })
  assert.deepEqual(prepared.refs, ['entry:0'])
  assert.equal(prepared.context, '修改后的新设定。')
})

for(const ownsHistory of [false,true])test(`worldbook projection respects runtime history ownership: ${ownsHistory}`,async()=>{
 let context,oldReads=0
 const messages=[{role:'assistant',text:'old'},{role:'assistant',text:'latest',variables:[{hp:7}]}]
 Object.defineProperty(messages,0,{get(){oldReads++;return {role:'assistant',text:'old'}},enumerable:true})
 const runtime={...(ownsHistory?{historyContext:'session'}:{}),render:async(_template,value)=>{
  context=value;return {ok:true,text:'rendered',scopes:value.scopes}
 }}
 const result=await projectWorldBookTemplates({worldBook:{view:{entries:[entry('e','<%= 1 %>',{constant:true})]}},runtime,chat:{messages,variables:{x:1}},card:{name:'Alice'}})
 assert.equal(oldReads,ownsHistory?0:1)
 assert.equal(context.scopes.message.hp,7)
 if(ownsHistory)assert.equal(Object.hasOwn(context,'transcript'),false)
 else assert.deepEqual(context.transcript,[{role:'assistant',content:'old'},{role:'assistant',content:'latest'}])
 assert.equal(result.context,'rendered')
})
