// private fork: tagged English defaults; retain protocol, payload, cache and budget assertions.
// private fork: historical vocabulary is fixture data, not a runtime default.
// private fork: include source literally, without String.replace replacement-token expansion.
// private fork: assert the extracted native service/retained stage owner contract.
// private fork: follow upstream module extraction without weakening behavior assertions.
import { inspectWorldBookDocument, updateWorldBookDocument, exportSillyTavernWorldBook, exportCharacterBook } from '../tavern-plugin/lib/domain/worldbook-resource.js'
import { promptOrder } from '../tavern-plugin/lib/domain/worldbook-activation.js'
import { projectAgentContent } from '../tavern-plugin/lib/domain/runtime-content-projection.js'
import { BUILTIN_BUBBLE_PRESETS, LEGACY_BUBBLE_TEMPLATE, DEFAULT_BUBBLE_TEMPLATE, OLD_HEADING_BUBBLE_TEMPLATE, PLAYER_SLOT_BUBBLE_TEMPLATE, BUILTIN_BUBBLE_TEMPLATES, normalizeBubbleInjection } from '../tavern-plugin/lib/domain/dialogue-bubble-presets.js'
// private fork: dialogue bubbles (docs/fork/dialogue-bubbles.md).
import {promptSection, promptSectionBody} from '../tavern-plugin/lib/domain/prompt-section.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import moods from '../tests/fixtures/legacy-dialogue-moods.json' with { type: 'json' }
import {normalizeBubbleConfig, bubbleInstruction, syncDialogueBubbleWorldbook, readDialogueBubblePlacement, bubbleInstructionPreview, bubbleInjection, BUBBLE_WORLDBOOK_COMMENT} from '../tavern-plugin/lib/domain/dialogue-bubbles.js'
import {createForegroundCapabilities,foregroundCapabilityEntries} from '../tavern-plugin/lib/domain/foreground-capabilities.js'
import figureResolution from '../tavern-plugin/packages/dsh-presentation-protocol/src/figure-resolution.cjs'
import bubbleLine from '../tavern-plugin/src/client/fork-bubble-line.cjs'
import {projectWorldBookTemplates} from '../tavern-plugin/lib/domain/worldbook-recall.js'

test('speaker handles are card-unique, order/recall stable, and resolve Chinese moods through the existing path', () => {
  const config = normalizeBubbleConfig({enabled:true,characters:[
    {alias:'f_efed52c1c67556e0',name:'大肥鱼',aliases:['dafeiyu'],ref:{packId:'pack',figureId:'figure-a'},recall:{mode:'constant'},emotions:[{id:'calm',label:'平和'}]},
    {alias:'f_abcdef0123456789',name:'大肥鱼',aliases:['dafeiyu'],ref:{packId:'pack',figureId:'figure-b'},recall:{mode:'keyword',keywords:['guest']},emotions:[{id:'joy',label:'喜悦'}]},
    {alias:'f_0123456789abcdef',name:'高坂月',aliases:['Kosaka Tsuki'],ref:{packId:'pack',figureId:'figure-c'},recall:{mode:'constant'},emotions:[{id:'shy',label:'害羞'}]},
    {alias:'guest',name:'来客',emotions:[{id:'surprise',label:'惊讶'}]}
  ]})
  const {figureSpeakerHandle,resolveFigureName}=figureResolution
  const handles=config.characters.map(row=>figureSpeakerHandle(config.characters,row))
  assert.deepEqual(handles,['dafeiyu_1','dafeiyu_2','kosaka_tsuki','guest'])
  assert.equal(new Set(handles).size,config.characters.length)
  const reversed={...config,characters:[...config.characters].reverse()}
  for(const [index,row] of config.characters.entries()) {
    const handle=handles[index]
    assert.equal(figureSpeakerHandle(reversed.characters,row),handle)
    for(const alias of [handle,row.alias]) {
      const [segment]=bubbleLine.forkParseBubbles(`@bubble:${alias}|${row.name}|${row.emotions[0].label}|[你好。]|[こんにちは。]`)
      assert.equal(bubbleLine.forkBubbleCharacter(config,segment)?.alias,row.alias)
      assert.equal(bubbleLine.forkResolveBubbleMood(segment.mood,bubbleLine.forkBubbleCharacter(config,segment).emotions)?.id,row.emotions[0].id)
      assert.equal(segment.speech,'こんにちは。')
      assert.equal(resolveFigureName(config.characters.map(row=>({...row,actorKey:row.alias})),alias).actorKey,row.alias)
    }
  }
  const figureConfig={...config,characters:config.characters.filter(row=>row.ref)}
  const entries=foregroundCapabilityEntries(figureConfig,{messages:[]})
  const text=entries.map(entry=>entry.content).join('\n')
  assert.match(text,/大肥鱼 \(dafeiyu_1\)/)
  // Copy values from the rendered roster, not from internal IDs or a golden prompt.
  for (const line of entries[1].content.split('\n').filter(line=>line.startsWith('- '))) {
    const [,name,handle,variant] = line.match(/^- (.+) \(([^)]+)\): ([^、（]+)/)
    const [segment] = bubbleLine.forkParseBubbles(`@bubble:${handle}|${name}|${variant}|[你好。]`)
    const resolved = bubbleLine.forkBubbleCharacter(config,segment)
    assert.equal(resolved.name,name)
    assert.ok(resolved.emotions.some(row=>row.label===variant))
  }
  const empty = bubbleInjection({enabled:true,characters:[{alias:'f_empty',name:'访客',aliases:['visitor'],ref:{packId:'pack',figureId:'empty'},emotions:[]}]})
  assert.match(empty[1].text,/^- 访客 \(visitor\):$/m)
  assert.deepEqual(bubbleLine.forkParseBubbles('@bubble:visitor|访客||[你好。]')[0].mood,'')
  assert.doesNotMatch(text,/dafeiyu_2|f_efed52c1c67556e0/)
  assert.deepEqual(foregroundCapabilityEntries(figureConfig,{messages:[{role:'user',text:'next turn'}]}),entries)
  const carriedRows=figureConfig.characters.map((row,index)=>({...row,actorKey:'old_'+(9-index)}))
  assert.equal(resolveFigureName(carriedRows,{alias:handles[0],name:'大肥鱼'}).ref.figureId,'figure-a')
  const reserved={alias:'f_9999999999999999',name:'占位',aliases:['dafeiyu_1'],ref:{packId:'pack',figureId:'figure-d'}}
  const full=[...config.characters,reserved]
  assert.equal(new Set(full.map(row=>figureSpeakerHandle(full,row))).size,full.length)
})

test('shared foreground dialogue format never teaches phone markers', () => {
  const {instruction}=bubbleInstructionPreview({enabled:true,characters:[{alias:'sender',name:'Sender'}]})
  assert.match(instruction,/@bubble:handle/)
  assert.match(instruction,/Narration and actions: plain prose, unmarked/)
  const kinds=['Narration and actions:', 'Spoken lines:', 'Inner thoughts:', 'For words attributed to a person in any medium', 'Copy name and handle', 'Line rules:', "Keep each character's voice"]
  const positions=kinds.map(kind=>instruction.indexOf(kind))
  assert.ok(positions.every((position,index)=>position>=0 && (!index || position>positions[index-1])))
  assert.equal(instruction.replaceAll('@bubble:', '').match(/\bbubble\b/g)?.length, 1)
  assert.equal(instruction,bubbleInstructionPreview({enabled:true,characters:[{alias:'sender',name:'Sender'}]}).instruction)
  // Attribution, not the medium, determines whose handle carries the words.
  assert.match(instruction,/words attributed to a person in any medium, use spoken lines with that person's handle/)
  assert.match(instruction,/narrate the surrounding actions/)
  assert.doesNotMatch(instruction,/（手机[^）]*）|（短信）|（语音）|\(phone\)|dsh\.phone|widget\.source/)
})

// private fork: inline previews and separate live entries share one roster, including voice languages.
test('inline and live rosters share names, variants and a single voice-language annotation', () => {
  const config = {enabled:true,voice:{enabled:true},stage:{textLanguage:'en'},characters:[
    {alias:'figure_mira',aliases:['traveler'],name:'Mira',ref:{packId:'pack',figureId:'mira'},voice:'sample',voiceLang:'ja',emotions:[{id:'joy',label:'喜悦'}]},
    {alias:'figure_ren',aliases:['guide'],name:'Ren',ref:{packId:'pack',figureId:'ren'},voice:'same',voiceLang:'en',emotions:[{id:'joy',label:'喜悦'}]}
  ]}
  const preview = bubbleInstructionPreview(config)
  const entries = bubbleInjection(config)
  assert.equal(preview.sections.find(section=>section.key==='characters').text,entries.find(entry=>entry.key==='figure').text)
  assert.match(entries[1].text,/Mira \(traveler\) \[Voice language: Japanese\]/)
  assert.match(entries[1].text,/Ren \(guide\): 喜悦/)
  assert.equal(preview.instruction.match(/^- .*\[Voice language:/gm).length,1)
  assert.equal(entries.map(entry=>entry.text).join('\n').match(/^- .*\[Voice language:/gm).length,1)
  assert.doesNotMatch(entries[0].text,/Characters with|［|Voice language:/)
  const resolved = bubbleInstructionPreview(config,{voices:[{id:'sample',languages:['en']},{id:'same',languages:['en']}]})
  assert.equal(resolved.sections.find(section=>section.key==='voice').text,'')
  assert.doesNotMatch(resolved.instruction,/\[Voice language:/)
  assert.match(entries[1].text,/A `\[Voice language: \.\.\.\]` tag after the handle gives the translation language/)
  const plain = bubbleInstructionPreview({...config,voice:{enabled:false}}).sections.find(section=>section.key==='characters').text
  assert.equal(plain,resolved.sections.find(section=>section.key==='characters').text)
  assert.ok(plain.startsWith('<speaker_roster>\nEach entry is `name (handle): variant options`. Parentheses after a variant give guidance, not part of its value.\n- '))
})

// private fork: examples compose with translated speech without changing the wire format.
test('prompt examples parse with distinct identity, variant and optional translated text', () => {
  const config = {enabled:true, stage:{textLanguage:'en'}, characters:[{alias:'lin_yue',name:'林月',voice:'sample',voiceLang:'ja',emotions:[{id:'joy',label:'喜悦'}]}]}
  for (const enabled of [false,true]) {
    const preview = bubbleInstructionPreview({...config,voice:{enabled}})
    assert.equal(preview.instruction,bubbleInstructionPreview({...config,voice:{enabled}}).instruction)
    const examples = [...preview.instruction.matchAll(/e\.g\. `([^`]+)`/g)].map(match=>match[1])
    assert.equal(examples.length,enabled ? 3 : 2)
    for (const example of examples) {
      const [line] = bubbleLine.forkParseBubbles(example)
      assert.equal(line.alias,'lin_yue')
      assert.equal(line.name,'林月')
      assert.equal(line.mood,'喜悦')
      assert.equal(line.text,line.thought ? '终于赶上了。' : '你好。')
      assert.equal(line.streaming,false)
      if (line.voiced) assert.equal(line.speech,'こんにちは。')
    }
    assert.match(preview.instruction,/within each bracketed text field/)
    const voice = preview.sections.find(section=>section.key==='voice').text
    if (enabled) {
      assert.ok(preview.instruction.indexOf(voice)>preview.instruction.indexOf('Line rules:'))
      assert.ok(preview.instruction.indexOf(voice)<preview.instruction.indexOf('<speaker_roster>'))
      const thought = voice.match(/Their inner thoughts: `([^`]+)`/)[1]
        .replace('handle|name|variant','lin_yue|林月|喜悦').replace('display text','Made it.').replace('voice text','着いた。')
      const [line] = bubbleLine.forkParseBubbles(thought)
      assert.equal(line.thought,true)
      assert.equal(line.text,'Made it.')
      assert.equal(line.speech,'着いた。')
    } else assert.equal(voice,'')
  }
})

test('retired player rule, extras, custom macros, block preview and legacy migration', () => {
  const config = { enabled: true, injection: { playerBubbles: true, extra: '补充要求原样保留\n  第二行' }, characters: [{ alias: 'me', name: '角色表旧名称', appearance: 'avatar', emotions: [{id:'joy',label:'喜悦',guidance:'{{bubble_format}}'}] }] }
  const result = bubbleInstructionPreview(config, { userName: '高坂月' })
  assert.doesNotMatch(result.instruction, /玩家（|@bubble:me|故事正文和显示台词/)
  assert.deepEqual(result.sections.map(section => section.key), ['format', 'voice', 'emotions', 'characters', 'extra'])
  assert.match(result.instruction, /角色表旧名称 \(me\)/)
  assert.ok(promptSectionBody('dialogue_format', result.instruction).endsWith(config.injection.extra))
  assert.equal(promptSection('dialogue_format', result.sections.map(section => section.text).filter(Boolean).join('\n')), result.instruction)
  assert.equal(promptSection('dialogue_format', result.segments.map(section => section.text).join('\n')), result.instruction)
  assert.equal(result.sections.find(section => section.key === 'voice').text, '')
  assert.doesNotMatch(bubbleInstruction({ ...config, characters: [] }, { userName: 'Vedal' }), /@bubble:player|Vedal/)
  assert.doesNotMatch(bubbleInstruction({ ...config, injection: { playerBubbles: false } }), /玩家（|@bubble:me/)
  const template = '{{user}}\n{{bubble_player}}\n{{bubble_characters}}\n{{bubble_format}}\n{{bubble_emotions}}'
  const custom = bubbleInstructionPreview({ ...config, injection: { template, extra: '尾部' } }, { userName: '真实玩家' })
  assert.ok(custom.instruction.startsWith('<dialogue_format>\n真实玩家\n\n<speaker_roster>\nEach entry is `name (handle): variant options`.'))
  assert.match(custom.instruction, /角色表旧名称 \(me\): 喜悦（\{\{bubble_format\}\}）/)
  assert.ok(custom.instruction.endsWith('\n尾部\n</dialogue_format>'))
  assert.doesNotMatch(custom.instruction, /\{\{user\}\}|\{\{bubble_player\}\}/)
  assert.deepEqual(custom.segments.map(section => section.key), ['custom', 'extra'])
  assert.doesNotMatch(bubbleInstruction({ ...config, injection: { template, playerBubbles: false } }), /玩家（/)
  for (const template of ['', DEFAULT_BUBBLE_TEMPLATE, PLAYER_SLOT_BUBBLE_TEMPLATE, LEGACY_BUBBLE_TEMPLATE]) assert.deepEqual(normalizeBubbleInjection({ template }), { template: '', extra: '' })
  for (const playerBubbles of [true, false, 'false']) assert.deepEqual(normalizeBubbleInjection({ template: LEGACY_BUBBLE_TEMPLATE, playerBubbles }), { template: '', extra: '' })
  assert.equal(normalizeBubbleInjection({ extra: 'x'.repeat(2000) }).extra.length, 2000)
  for (const patch of [{ extra: 'x'.repeat(2001) }, { extra: null }]) assert.throws(() => normalizeBubbleInjection(patch))
  assert.deepEqual(normalizeBubbleInjection({ placement: { order: 42 } }).placement, { order: 42 })
  for (const placement of [null, [], { position: 4 }, { order: NaN }, { depth: -1 }, { role: 3 }, { book: '' }]) assert.throws(() => normalizeBubbleInjection({ placement }))
})

test('the default template has no retired {{bubble_player}} line; every built-in default (old ones too) injects exactly the block-mode text', () => {
  assert.equal(DEFAULT_BUBBLE_TEMPLATE, '【对白格式】\n{{bubble_format}}\n{{bubble_emotions}}\n{{bubble_characters}}')
  assert.doesNotMatch(DEFAULT_BUBBLE_TEMPLATE, /bubble_player|\{\{user\}\}/)
  assert.match(PLAYER_SLOT_BUBBLE_TEMPLATE, /\{\{bubble_player\}\}/, 'the previous default stays recognised')
  assert.deepEqual([...BUILTIN_BUBBLE_TEMPLATES], [DEFAULT_BUBBLE_TEMPLATE, OLD_HEADING_BUBBLE_TEMPLATE, PLAYER_SLOT_BUBBLE_TEMPLATE, LEGACY_BUBBLE_TEMPLATE])
  assert.ok(BUILTIN_BUBBLE_PRESETS.every(preset => preset.template === DEFAULT_BUBBLE_TEMPLATE))
  const base = { enabled: true, voice: { enabled: true }, characters: [{ alias: 'f_madoka', aliases:['madoka'], ref:{packId:'pack',figureId:'madoka'}, name: '鹿目圆', voice: 'v', voiceLang: 'ja', note: '粉色' }, { alias: 'me', name: '我', offstage: true }] }
  for (const extra of ['', '补充要求']) {
    const block = bubbleInstructionPreview({ ...base, injection: { template: '', extra } }, { userName: '高坂月' })
    assert.ok(block.instruction)
    for (const template of BUILTIN_BUBBLE_TEMPLATES) {
      const saved = normalizeBubbleConfig({ ...base, injection: { template, extra } })
      assert.equal(saved.injection.template, '', 'a saved built-in default is block mode, not a custom template')
      const result = bubbleInstructionPreview(saved, { userName: '高坂月' })
      assert.equal(result.instruction, block.instruction)
      assert.deepEqual(result.segments, block.segments)
    }
  }
  // Edited away from the default it is custom again, and the retired placeholder still expands to nothing.
  const edited = PLAYER_SLOT_BUBBLE_TEMPLATE + '\n尾行'
  const custom = bubbleInstructionPreview({ ...base, injection: { template: edited } }, { userName: '高坂月' })
  assert.deepEqual(custom.segments.map(section => section.key), ['custom'])
  assert.doesNotMatch(custom.instruction, /\{\{/)
  assert.ok(custom.instruction.endsWith('\n尾行\n</dialogue_format>'))
  // Editing the default keeps the block-mode heading and text; only the edit differs.
  const plain = bubbleInstructionPreview({ ...base, injection: { template: '' } }, { userName: '高坂月' })
  const tweaked = bubbleInstructionPreview({ ...base, injection: { template: DEFAULT_BUBBLE_TEMPLATE + '\n尾行' } }, { userName: '高坂月' })
  assert.equal(tweaked.instruction, promptSection('dialogue_format', promptSectionBody('dialogue_format', plain.instruction).replace(/^.*\n/, '【对白格式】\n') + '\n尾行'))
})

// private fork: this isolated server-case closure must receive every host dependency, including the foreground owner.
async function bubbleRpcFixture({chat,config,placement,foregroundCapabilities}) {
  const host = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
  const blocks = ['getDialogueBubbles', 'previewDialogueBubbleInstruction'].map(method => {
    const start = host.indexOf("      case '" + method + "': {")
    return host.slice(start, host.indexOf('\n      }', start) + 8)
  }).join('\n')
  const dependencies={chatForSession:async()=>chat,
    cardStage:{forSession:async()=>({voices:{list:async()=>({voices:[]})}})},dialogueVoice:{status:async()=>({})},
    dialogueBubbles:{read:async()=>normalizeBubbleConfig(config)},dialogueBubblePresets:{list:async()=>[]},
    DEFAULT_BUBBLE_TEMPLATE,bubbleInstructionPreview,bubbleInjection,readDialogueBubblePlacement:async()=>placement,
    worldBooks:{},normalizeBubbleConfig,str:value=>String(value || ''),assetEngineSettings:{read:()=>({values:{dialogue:config}})},foregroundCapabilities}
  return new Function(...Object.keys(dependencies),`return async (method,args)=>{switch(method){${blocks}}}`)(...Object.values(dependencies))
}

test('editor and compatibility get/preview RPC retain player names, generated sections and legacy live placement', async () => {
  const config = { enabled: true, injection: { template: '{{user}}\n{{bubble_player}}\n{{bubble_format}}\n{{bubble_emotions}}\n{{bubble_characters}}' }, characters: [{ alias: 'me', offstage: true }] }
  const placement = { books: [], current: { book: 'card', order: 555 } }
  // private fork: neither card editing nor the independent compatibility compiler uses the native owner.
  for (const mode of [{mode:'card'},{mode:'story',requestMode:'sillytavern'}]) {
    const rpc=await bubbleRpcFixture({config,placement,
      chat:{...mode,cardPath:'cards/a.json',cardName:'卡',macroState:{userName:'本局玩家'}},
      foregroundCapabilities:{preview:async()=>assert.fail('Editor/compatibility must not invoke the native foreground owner')}})
    for (const method of ['getDialogueBubbles', 'previewDialogueBubbleInstruction']) {
    const result = await rpc(method, { sessionId: 's', config })
    assert.ok(result.instruction.startsWith('<dialogue_format>\n本局玩家\n\n'))
    assert.doesNotMatch(result.instruction, /\{\{user\}\}|玩家（/)
    assert.equal(result.sections.length, 5)
    // private fork (owner 2026-10 r3): 提示词 reads what the story model receives, with the director's token estimate.
    if (method === 'getDialogueBubbles') { assert.equal(result.userName, '本局玩家'); assert.deepEqual(result.placement, placement); assert.equal(result.injection[0].key, 'format'); assert.ok(result.injection[0].text.startsWith('<dialogue_format>\n本局玩家\n\n')); assert.ok(result.injection[0].tokens > 0) }
    }
  }
})

// private fork: execute the actual native RPC branch with the real foreground owner, recall, macro projection and prefix order.
test('native get RPC exposes actual recalled/rendered foreground bytes, not all figures or legacy entries, without freezing preview',async()=>{
  const chat={id:'native',sessionId:'s',mode:'story',cardPath:'cards/a.json',cardName:'卡',macroState:{userName:'本局玩家'},messages:[]}
  const original=structuredClone(chat),config=normalizeBubbleConfig({enabled:true,
    injection:{template:'{{user}}\n{{bubble_format}}\n{{bubble_emotions}}\n{{bubble_characters}}'},characters:[
      {alias:'blue',name:'Blue',ref:{packId:'pack',figureId:'blue'},recall:{mode:'constant'}},
      {alias:'green',name:'UnrecalledGreen',ref:{packId:'pack',figureId:'green'},recall:{mode:'keyword',keywords:['activate-green']}}]})
  const render=(current,worldBook)=>projectWorldBookTemplates({worldBook,chat:current,card:{name:current.cardName},includeConstants:true,
    runtime:{render:()=>assert.fail('This plain-macro fixture must not call a model or author EJS runtime')}})
  const owner=createForegroundCapabilities({session:()=>null,readConfig:async()=>config,render,
    save:async()=>assert.fail('RPC preview must not persist an epoch')})
  const placement={books:['legacy'],current:{book:'card',order:555},entries:[{ref:'legacy',content:'retired placement entry'}]}
  const rpc=await bubbleRpcFixture({chat,config,placement,foregroundCapabilities:owner})
  const result=await rpc('getDialogueBubbles',{sessionId:'s'})
  assert.deepEqual(chat,original)
  assert.deepEqual(result.placement,{...placement,entries:[]})
  const prefix=result.injection.map(row=>row.text).join('\n\n')
  assert.match(prefix,/Blue/);assert.doesNotMatch(prefix,/UnrecalledGreen|\{\{user\}\}|retired placement/)
  assert.deepEqual(result.injection.map(row=>row.key),['format','figure']);assert.ok(result.injection.every(row=>row.tokens>0))
  assert.ok(prefix.indexOf('<dialogue_format>') < prefix.indexOf('<speaker_roster>'))
  assert.match(prefix,/Each entry is/)
  const expected=createForegroundCapabilities({session:()=>null,readConfig:async()=>config,render,save:async()=>assert.fail('persist:false')})
  assert.equal(prefix,(await render(chat,await expected.project(structuredClone(chat),null,{persist:false}))).prefixContext)
  config.enabled=false
  assert.deepEqual((await rpc('getDialogueBubbles',{sessionId:'s'})).injection,[],'Unsent preview cannot freeze the enabled epoch')
  assert.deepEqual(chat,original)
})

test('runtime placement honours numeric/string before anchors in compatibility mode and bucket order in normal mode', async () => {
  const host = await readFile(new URL('../tavern-plugin/lib/domain/compatibility-turn.js', import.meta.url), 'utf8')
  const source = host.slice(host.indexOf('  function compatibilityWorldBookMatch('), host.indexOf('  async function compileCompatibilityTurn('))
  const entries = [
    { ref: 'a', content: 'before-low', position: 0, order: 10, constant: true },
    { ref: 'b', content: 'before-high', position: '0', order: 200, constant: true },
    { ref: 'c', content: 'after', position: '1', order: 100, constant: true }
  ]
  const compile = new Function('worldBooks', 'str', source + '; return compatibilityWorldInfo')({ bound: async () => ({ view: { entries } }) }, value => String(value || ''))
  const result = await compile({ cardPath: 'card', messages: [] }, {}, '')
  assert.equal(result.before, 'before-high\n\nbefore-low')
  assert.equal(result.after, 'after')
  assert.deepEqual(promptOrder(entries).map(entry => entry.ref), ['a', 'b', 'c'])
  const sourceText = bubbleInstruction({ enabled: true, injection: { template: '{{user}}\n{{bubble_format}}\n{{bubble_emotions}}\n{{bubble_characters}}' } }, { userName: '{{user}}' })
  const projected = projectAgentContent(sourceText, { macroState: { userName: '高坂月', local: {}, global: {} } })
  assert.ok(projected.agentText.startsWith('<dialogue_format>\n高坂月\n'))
})

test('设置归一化：别名去重、非法别名与图片丢弃、差分只收声明项', () => {
  const png = 'data:image/webp;base64,AAAA'
  const config = normalizeBubbleConfig({ enabled: true, emotions:[{id:'shy',label:'害羞'}], characters: [
    { alias: 'Madoka', name: '鹿目圆', avatar: png, emotions:[{id:'shy',label:'害羞'}], moods: { shy: png, weird: png }, color: '#E0689F' },
    { alias: 'madoka', name: '重复' },
    { alias: 'bad alias!', name: 'x' },
    { alias: 'player', name: '高坂月', avatar: 'javascript:alert(1)' }
  ] })
  assert.equal(config.enabled, true)
  assert.deepEqual(config.characters.map(c => c.alias), ['madoka', 'player'])
  assert.deepEqual(Object.keys(config.characters[0].moods), ['shy'])
  assert.equal(config.characters[0].color, '#e0689f')
  assert.equal(config.characters[1].avatar, '')
})

test('格式说明含别名表和补充说明，不自动添加玩家规则', () => {
  assert.equal(bubbleInstruction({ enabled: false, characters: [{ alias: 'a' }] }), '')
  const text = bubbleInstruction({ enabled: true, characters: [{ alias: 'kyubey', name: '丘比', note: '只用心灵感应说话' }] })
  assert.match(text, /@bubble:handle\|name\|variant\|\[text\]/)
  assert.match(text, /- 丘比 \(kyubey\)/)
  assert.doesNotMatch(text, /只用心灵感应说话/) // private fork: cast notes move to card worldbooks
  assert.doesNotMatch(text, /玩家（你）/)
})

// private fork: independent figure entries own IDs once, including figures without custom guidance.
test('writer figure entries use display labels and preserve ID-only figures without empty roster text', async () => {
  const config = {enabled:true, characters:[
    {alias:'fish',name:'大肥鱼',ref:{packId:'pack',figureId:'fish'},aliases:['鱼鱼'],recall:{mode:'constant'},emotions:[{id:'smug',label:'得意',guidance:'得意时使用。'},{id:'eating',label:'吃东西'},{id:'joy',label:'喜悦',guidance:'开心时使用。'}]},
    {alias:'guest',name:'来客',ref:{packId:'pack',figureId:'guest'},aliases:[],recall:{mode:'keyword'},emotions:moods.map(({note,...row})=>row)},
    {alias:'other',name:'另一位',ref:{packId:'pack',figureId:'other'},aliases:[],recall:{mode:'constant'},emotions:moods.map(({note,...row})=>row)}
  ]}
  const injected = bubbleInjection(config), text = injected.map(row => row.text).join('\n\n')
  // private fork: one stable roster, grouped by available labels, with compact authored guidance.
  assert.equal(injected.length, 2)
  assert.doesNotMatch(text, /未配置角色表|人物情绪|smug:|eating:|通用差分/)
  for (const handle of ['鱼鱼','来客','另一位']) assert.equal(text.split('(' + handle + ')').length - 1, 1)
  assert.match(injected[1].text, /得意（得意时使用。）/)
  assert.match(injected[1].text, /吃东西/)
  assert.match(injected[1].text, /喜悦（开心时使用。）/)
  assert.equal(injected[1].constant, true)
  assert.match(injected[1].text, /来客 \(来客\)、另一位 \(另一位\): 喜悦、愤怒、悲伤、紧张、平和、害羞、嫌弃、爱恋、哭泣\n<\/speaker_roster>$/)
  const guided = structuredClone(config)
  guided.characters[1].emotions = guided.characters[1].emotions.map(row=>row.id==='joy'?{...row,guidance:'来客高兴时。'}:row)
  assert.match(bubbleInjection(guided)[1].text, /喜悦（来客 \(来客\)：来客高兴时。）/)
  const custom = bubbleInjection({...config,injection:{template:DEFAULT_BUBBLE_TEMPLATE + '\n'}})
  assert.doesNotMatch(custom[0].text, /\n[\t ]*$/)
  assert.doesNotMatch(custom[0].text, /未配置角色表|ID fish|ID guest/)
  const books = fakeWorldBooks()
  await syncDialogueBubbleWorldbook(books, 'cards/a.json', config)
  const entries = books.calls[0].request.operations.map(op => op.entry)
  assert.deepEqual(entries.map(row => row.content), injected.map(row => row.text))
  assert.equal(entries[1].comment, '说话人名单') // private fork
  const projected = await projectWorldBookTemplates({worldBook:{view:{entries}},includeConstants:true,chat:{},card:{},runtime:{render:async text=>({ok:true,text})}})
  assert.ok(projected.prefixContext.indexOf('<dialogue_format>') < projected.prefixContext.indexOf('<speaker_roster>'))
  const existing = fakeWorldBooks(entries.map((row,index) => ({...row,ref:'entry:'+index,
    comment:index === 1 ? '旧标题' : row.comment,
    rawEntry:{extensions:{dsh_tavern_helper_extra:row.helperExtra}}})))
  await syncDialogueBubbleWorldbook(existing, 'cards/a.json', config)
  assert.equal(existing.calls[0].request.operations.find(row => row.ref === 'entry:1').patch.comment, '说话人名单') // private fork
})

function fakeWorldBooks(entries = [], binding = { kind: 'embedded', source: { kind: 'card', cardPath: 'cards/a.json' }, available: true }) {
  const calls = []
  return {
    calls,
    async binding() { return binding },
    async get(source) { return { source, view: { displayName: '見滝原', entries } } },
    async update(source, request) { calls.push({ source, request }) }
  }
}

test('启用新增常驻条目，legacy 迁移，关闭真正删除' , async () => {
  const config = { enabled: true, characters: [{ alias: 'madoka', name: '鹿目圆' }] }
  const empty = fakeWorldBooks()
  const added = await syncDialogueBubbleWorldbook(empty, 'cards/a.json', config)
  assert.equal(added.changed, true)
  const op = empty.calls[0].request.operations[0]
  assert.equal(op.op, 'add')
  assert.equal(op.entry.comment, BUBBLE_WORLDBOOK_COMMENT)
  assert.equal(op.entry.constant, true)
  assert.match(op.entry.content, /鹿目圆 \(madoka\)/) // private fork: unbound legacy rows have no figure entry, so retain their IDs here.

  const existing = fakeWorldBooks([{ ref: 'entry:3', comment: BUBBLE_WORLDBOOK_COMMENT, content: bubbleInstruction(config), enabled: true }])
  assert.equal((await syncDialogueBubbleWorldbook(existing, 'cards/a.json', config)).changed, true)
  const migrated = existing.calls[0].request.operations[0]
  assert.equal(migrated.patch.helperExtra.forkDialogueBubbles.version, 1)
  assert.equal(Object.hasOwn(migrated.patch, 'order'), false)
  assert.equal(Object.hasOwn(migrated.patch, 'position'), false)
  await syncDialogueBubbleWorldbook(existing, 'cards/a.json', { ...config, enabled: false })
  assert.deepEqual(existing.calls[1].request.operations[0], { op: 'delete', ref: 'entry:3' })

  // An entry under the old name (unmarked) is adopted and renamed to the aligned name.
  const renamed = fakeWorldBooks([{ ref: 'entry:4', comment: '对话气泡格式（由「对话气泡」设置维护）', content: bubbleInstruction(config), enabled: true, constant: true }])
  assert.equal((await syncDialogueBubbleWorldbook(renamed, 'cards/a.json', config)).changed, true)
  const rename = renamed.calls[0].request.operations[0]
  assert.equal(rename.op, 'update')
  assert.equal(rename.patch.comment, '对白格式（由「对话气泡」设置维护）')
  assert.equal(BUBBLE_WORLDBOOK_COMMENT, '对白格式（由「对话气泡」设置维护）')

  const disabledNoEntry = fakeWorldBooks()
  assert.equal((await syncDialogueBubbleWorldbook(disabledNoEntry, 'cards/a.json', { ...config, enabled: false })).changed, false)
  assert.equal(disabledNoEntry.calls.length, 0)
})

test('人物卡绑定了独立世界书时写进绑定的那本', async () => {
  const books = fakeWorldBooks([], { kind: 'multiple', books: [{ kind: 'standalone', source: { kind: 'standalone', path: 'worldbooks/x.json' }, available: true }] })
  await syncDialogueBubbleWorldbook(books, 'cards/a.json', { enabled: true, characters: [] })
  assert.deepEqual(books.calls[0].source, { kind: 'standalone', path: 'worldbooks/x.json' })
})

test('客户端解析：旁白保留为 Markdown，气泡行与心里话、流式半行', async () => {
  const source = (await readFile(new URL('../tavern-plugin/src/client/fork-bubbles.js', import.meta.url), 'utf8')).split('// @include fork-bubble-line.cjs').join(await readFile(new URL('../tavern-plugin/src/client/fork-bubble-line.cjs', import.meta.url), 'utf8')).replace('__TAVERN_BUBBLE_MOODS__', JSON.stringify(moods))
  const context = {}
  vm.runInNewContext(source.slice(0, source.indexOf('// Per-session bubble settings')) + ';this.parse = forkParseBubbles; this.mood = forkBubbleMood;', context)
  const segments = context.parse('她抬起头。\n@bubble:madoka|鹿目圆|害羞|[你好]\n@bubble:kyubey|丘比|平静|[*签订契约吧*]\n旁白', false)
  assert.deepEqual(JSON.parse(JSON.stringify(segments.map(s => [s.kind, s.alias || s.text, s.thought || false]))), [['markdown', '她抬起头。', false], ['bubble', 'madoka', false], ['bubble', 'kyubey', true], ['markdown', '旁白', false]])
  const streaming = context.parse('旁白\n@bubble:madoka|鹿目圆|紧张|[正在说', true)
  assert.equal(streaming[1].text, '正在说')
  assert.equal(context.parse('旁白\n@bubble:mad', true).length, 1)
  assert.equal(context.mood('害羞').id, 'shy')
})

// The test double uses the actual resource patcher, including embedded ref ordering.
function mutableBooks(sources, documents) {
  const calls = []
  return {
    calls, sources, documents, fail: false,
    async binding() { return { kind: 'multiple', books: this.sources.map(source => ({ source, available: true })) } },
    async get(source) { const document = documents.get(JSON.stringify(source)); return { source, view: inspectWorldBookDocument(document) } },
    async export(source) { return { document: exportSillyTavernWorldBook(documents.get(JSON.stringify(source))) } },
    async replaceNative(source, document) { documents.set(JSON.stringify(source), source.kind === 'card' ? exportCharacterBook(document, { replace: true }) : structuredClone(document)) },
    async update(source, request) {
      if (this.fail) throw new Error('simulated update failure')
      calls.push({ source, request })
      const key = JSON.stringify(source)
      documents.set(key, updateWorldBookDocument(documents.get(key), request).document)
    }
  }
}
const cardSource = { kind: 'card', cardPath: 'cards/a.json' }
const standaloneSource = { kind: 'standalone', path: 'worldbooks/b.json' }
const documentFor = entries => ({ name: 'isolated fixture', entries, extensions: { untouched: true } })
const rawEntry = (comment, extra = {}) => ({ id: 7, comment, content: 'original', keys: [], enabled: true, insertion_order: 37, position: 'before_char', extensions: { custom: 'keep', dsh_tavern_helper_extra: { another: 'keep', ...extra } } })

test('placement reports live fields, preserves untouched fields, moves across bound books and rolls back failures', async () => {
  const docs = new Map([[JSON.stringify(cardSource), documentFor([])], [JSON.stringify(standaloneSource), { name: 'target', entries: {} }]])
  const books = mutableBooks([cardSource, standaloneSource], docs)
  const config = { enabled: true, injection: { placement: { position: 1, order: 240 } } }
  await syncDialogueBubbleWorldbook(books, cardSource.cardPath, config)
  let live = await readDialogueBubblePlacement(books, cardSource.cardPath, config.injection.placement)
  assert.equal(live.current.book, 'card'); assert.equal(live.current.order, 240); assert.equal(live.manual, false)
  // private fork (prompt view complete): the placement read lists the bubble entries the books hold, with their owner.
  const synced = (await books.get(cardSource)).view.entries[0].content
  assert.deepEqual(live.entries.map(entry => [entry.book, entry.own, entry.constant, entry.text === synced]), [['card', true, true, true]])
  const entry = (await books.get(cardSource)).view.entries[0]
  await books.update(cardSource, { operations: [{ op: 'update', ref: entry.ref, patch: { position: 4, depth: 7, role: 2, order: 19 } }] })
  docs.get(JSON.stringify(cardSource)).entries[0].extensions.unrelated = { preserve: true }
  docs.get(JSON.stringify(cardSource)).entries[0].id = 27 // Embedded ref index and native UID deliberately differ.
  await syncDialogueBubbleWorldbook(books, cardSource.cardPath, { enabled: true, injection: { template: '{{user}}\n{{bubble_format}}\n{{bubble_emotions}}\n{{bubble_characters}}' } })
  live = await readDialogueBubblePlacement(books, cardSource.cardPath, config.injection.placement)
  assert.equal(live.manual, true)
  assert.deepEqual([live.current.position, live.current.depth, live.current.role, live.current.order], [4, 7, 2, 19])
  assert.match((await books.get(cardSource)).view.entries[0].content, /\{\{user\}\}/, 'shared worldbook preserves runtime macro')
  const moving = { enabled: true, injection: { placement: { book: 'standalone:worldbooks/b.json', order: 99 } } }
  await syncDialogueBubbleWorldbook(books, cardSource.cardPath, moving)
  assert.equal((await books.get(cardSource)).view.entries.length, 0)
  const moved = (await books.get(standaloneSource)).view.entries[0]
  assert.equal(moved.order, 99); assert.equal(moved.depth, 7); assert.equal(moved.role, 2)
  assert.deepEqual(moved.rawEntry.extensions.unrelated, { preserve: true })
  assert.equal((await readDialogueBubblePlacement(books, cardSource.cardPath, moving.injection.placement)).manual, false)
  const before = await Promise.all([cardSource, standaloneSource].map(source => books.export(source)))
  const replace = books.replaceNative.bind(books)
  let attempts = 0
  books.replaceNative = async (source, document) => { await replace(source, document); if (++attempts === 2) throw new Error('second write failed after writing') }
  await assert.rejects(syncDialogueBubbleWorldbook(books, cardSource.cardPath, { enabled: true, injection: { placement: { book: 'card' } } }), /已回滚/)
  assert.deepEqual(await Promise.all([cardSource, standaloneSource].map(source => books.export(source))), before)
  await assert.rejects(syncDialogueBubbleWorldbook(books, cardSource.cardPath, { enabled: true, injection: { placement: { book: 'standalone:unbound' } } }), /不在本卡绑定列表/)
  assert.deepEqual(await Promise.all([cardSource, standaloneSource].map(source => books.export(source))), before)
})

test('owned enable/update/disable cycles, duplicates and ordering preserve user entries and extra metadata', async () => {
  const user = rawEntry('对话气泡格式')
  user.content = '用户自写双语条目 @bubble-voice:alias|name|mood|[正文]|[原文]'
  const other = rawEntry(BUBBLE_WORLDBOOK_COMMENT, { forkDialogueBubbles: { version: 1, cardKey: 'another-card' } })
  const docs = new Map([[JSON.stringify(cardSource), documentFor([user, other])]])
  const books = mutableBooks([cardSource], docs)
  const enabled = { enabled: true, characters: [{ alias: 'homura' }] }
  await syncDialogueBubbleWorldbook(books, cardSource.cardPath, enabled)
  const entries = () => docs.get(JSON.stringify(cardSource)).entries
  assert.equal(entries().length, 3)
  assert.deepEqual(entries().slice(0, 2), [user, other])
  const owned = entries()[2]
  owned.insertion_order = 9; owned.position = 'before_char'
  owned.extensions.dsh_tavern_helper_extra.another = 'kept-owned'
  await syncDialogueBubbleWorldbook(books, cardSource.cardPath, { ...enabled, injection: BUILTIN_BUBBLE_PRESETS[1] })
  assert.equal(entries()[2].insertion_order, 9)
  assert.equal(entries()[2].position, 'before_char')
  assert.equal(entries()[2].extensions.dsh_tavern_helper_extra.another, 'kept-owned')
  assert.equal((await syncDialogueBubbleWorldbook(books, cardSource.cardPath, { ...enabled, injection: BUILTIN_BUBBLE_PRESETS[1] })).changed, false)
  entries().push(structuredClone(entries()[2]))
  assert.equal((await syncDialogueBubbleWorldbook(books, cardSource.cardPath, enabled)).removed, 1)
  assert.equal(entries().length, 3)
  const removed = await syncDialogueBubbleWorldbook(books, cardSource.cardPath, { ...enabled, enabled: false })
  assert.equal(removed.removed, 1)
  assert.deepEqual(entries(), [user, other])
  await syncDialogueBubbleWorldbook(books, cardSource.cardPath, { enabled: false })
  await syncDialogueBubbleWorldbook(books, cardSource.cardPath, enabled)
  await syncDialogueBubbleWorldbook(books, cardSource.cardPath, enabled)
  assert.equal(entries().length, 3)
})

test('legacy migration only claims one exact own-card entry, rejects shared or multiple legacy before mutation', async () => {
  const legacy = rawEntry(BUBBLE_WORLDBOOK_COMMENT)
  const docs = new Map([[JSON.stringify(cardSource), documentFor([legacy])]])
  const books = mutableBooks([cardSource], docs)
  await syncDialogueBubbleWorldbook(books, cardSource.cardPath, { enabled: true })
  const entry = docs.get(JSON.stringify(cardSource)).entries[0]
  assert.equal(entry.extensions.dsh_tavern_helper_extra.another, 'keep')
  assert.equal(entry.insertion_order, 37)
  assert.equal(entry.position, 'before_char')
  assert.equal(entry.extensions.custom, 'keep')
  for (const [source, entries] of [[cardSource, [legacy, legacy]], [standaloneSource, [legacy]], [{ kind: 'card', cardPath: 'cards/other.json' }, [legacy]]]) {
    const ambiguous = mutableBooks([source], new Map([[JSON.stringify(source), documentFor(entries)]]))
    await assert.rejects(syncDialogueBubbleWorldbook(ambiguous, cardSource.cardPath, { enabled: false }), /归属不明确/)
    assert.equal(ambiguous.calls.length, 0)
  }
})

test('multiple bindings locate owned entries beyond first target and de-duplicate across current bindings', async () => {
  const docs = new Map([[JSON.stringify(cardSource), documentFor([])], [JSON.stringify(standaloneSource), documentFor([])]])
  const books = mutableBooks([standaloneSource], docs)
  await syncDialogueBubbleWorldbook(books, cardSource.cardPath, { enabled: true })
  books.sources = [cardSource, standaloneSource]
  await syncDialogueBubbleWorldbook(books, cardSource.cardPath, { enabled: true, characters: [{ alias: 'changed' }] })
  assert.equal(docs.get(JSON.stringify(cardSource)).entries.length, 0)
  assert.equal(docs.get(JSON.stringify(standaloneSource)).entries.length, 1)
  const duplicate = structuredClone(docs.get(JSON.stringify(standaloneSource)).entries[0])
  docs.get(JSON.stringify(cardSource)).entries.push(duplicate)
  await syncDialogueBubbleWorldbook(books, cardSource.cardPath, { enabled: true })
  assert.equal(docs.get(JSON.stringify(cardSource)).entries.length + docs.get(JSON.stringify(standaloneSource)).entries.length, 1)
  await syncDialogueBubbleWorldbook(books, cardSource.cardPath, { enabled: false })
  assert.equal(docs.get(JSON.stringify(cardSource)).entries.length + docs.get(JSON.stringify(standaloneSource)).entries.length, 0)
})

test('standalone SillyTavern object entries retain ownership, ordering and unrelated user rules', async () => {
  const document = { name: 'standalone fixture', entries: { 0: { uid: 0, key: [], comment: '用户规则', content: 'Keep this', disable: false, constant: true, order: 37, position: 3 } } }
  const user = structuredClone(document.entries[0])
  const key = JSON.stringify(standaloneSource)
  const docs = new Map([[key, document]])
  const books = mutableBooks([standaloneSource], docs)
  const config = { enabled: true, characters: [{ alias: 'homura', voice: 'fixture/homura', voiceLang: 'ja' }] } // private fork: no inferred voice by name
  await syncDialogueBubbleWorldbook(books, cardSource.cardPath, config)
  const entries = () => docs.get(key).entries
  assert.equal(Object.keys(entries()).length, 2)
  const owned = Object.values(entries()).find(entry => entry.comment === BUBBLE_WORLDBOOK_COMMENT)
  assert.ok(owned.extensions.dsh_tavern_helper_extra.forkDialogueBubbles.cardKey)
  owned.order = 19; owned.position = 4
  await syncDialogueBubbleWorldbook(books, cardSource.cardPath, { ...config, voice: { enabled: true }, injection: { template: '' } })
  const updated = Object.values(entries()).find(entry => entry.comment === BUBBLE_WORLDBOOK_COMMENT)
  assert.equal(updated.order, 19)
  assert.equal(updated.position, 4)
  // private fork: an unbound speaker uses the same roster annotation as separately injected figures.
  assert.match(updated.content, /homura \(homura\) \[Voice language: Japanese\]/); assert.match(updated.content, /\[display text\]\|\[voice text\]/)
  await syncDialogueBubbleWorldbook(books, cardSource.cardPath, { ...config, enabled: false })
  assert.deepEqual(Object.values(entries()), [user])
})
