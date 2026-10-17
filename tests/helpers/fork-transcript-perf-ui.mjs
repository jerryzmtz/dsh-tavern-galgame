import {stagePageSource} from './stage-page-source.mjs' // private fork
import {readFileSync} from 'node:fs'
const figureResolutionSource = readFileSync(new URL('../../tavern-plugin/packages/dsh-presentation-protocol/src/figure-resolution.cjs',import.meta.url),'utf8')
import {withSpriteEmotionSource} from './sprite-emotion-source.mjs'
// Production publication/voice/highlight/paragraph hooks; host Markdown is a local React seam.
// No session data, network requests, synthesis, or live host is used.
export function transcriptSource(read) {
  const between = (s, a, b) => s.slice(s.indexOf(a), s.indexOf(b, s.indexOf(a)))
  const stage = read('fork-gal-stage.js'), bubbles = read('fork-bubbles.js').replace('// @include fork-bubble-line.cjs', read('fork-bubble-line.cjs')) // private fork: extracted mood/name helpers
  const publication = bubbles.includes('function forkBubblePublicationType(') ? 'forkBubblePublicationType()' : bubbles.includes('function ForkBubblePublication(') ? 'ForkBubblePublication' : 'ForkBubbleMarkdown'
  // private fork: the shared ForkSpinner (avatar / voice loading) precedes the transcript, as in main.js; var, since
  // pages also mount the stage shell (mounted-stage-shell.mjs) with its own copy.
  return `
    ${withSpriteEmotionSource('// @include-shared sprite-emotions.cjs')}
    ${read('fork-foreground.js')} // private fork: real foreground controller, as in main.js.
    ${figureResolutionSource}
    ${read('fork-bubble-line.cjs')}
    ${read('fork-spinner.js').replace(/^const /gm, 'var ')}
    const counts = {markdown:0, host:0, rpc:0, messages:{}, publications:{}};
    const rpc = async () => { counts.rpc++; return {available:true,voiceId:'fixture/a',language:'zh',readings:{},scope:'fixture'}; };
    const config = {enabled:true, voice:{enabled:false}, stage:{textLanguage:'zh'}, characters:[]};
    let bubbleData = {cardPath:'offline',config}, voiceEnabled=false;
    // private fork: use the function boundary; the old avatar comment was retired.
    ${between(bubbles, '// Per-session bubble settings', 'async function forkPortraitSource')}
    forkBubbleStore.set('offline', bubbleData);
    const DshUi = {MarkdownText: props => {
      counts.host++;
      return React.createElement(React.Fragment,null,...props.text.split(/\\n\\n/).map((line,i)=>React.createElement('p',{key:i},
        ...line.split(/(\\*\\*[^*]+\\*\\*|\\*[^*]+\\*|\\x60[^\\x60]+\\x60)/).map((part,j)=>
          React.createElement(part.startsWith('**')?'strong':part.startsWith('*')?'em':part.startsWith('\\x60')?'code':'span',{key:j},part.replace(/^[*\\x60]+|[*\\x60]+$/g,''))))));
    }};
    ${between(stage, 'function forkGalIsSuperseded', '// Plain reading text')}
    ${(stagePageSource + '\n' + between(stage, 'function forkGalPlain', '// Film cards'))}
    ${read('fork-gal-history.js')}
    ${between(stage, 'function forkGalTextDigest', '// Offsets ignore')}
    ${read('fork-phone-beat.cjs')} // private fork: production runtime's phone-only voice admission dependency.
    ${read('fork-stage-runtime.cjs')}
    ${read('fork-stage-runtime-store.cjs')}
    ${read('fork-stage-display-units.cjs')}
    ${read('fork-stage-text-index.cjs')}
    ${read('fork-stage-session.cjs')}
    ${read('fork-stage-ui.js')}
    ${between(stage, 'const forkGalActive =', 'let forkGalEntry')}
    function forkGalEnter() {}
    ${read('fork-gal-chat-entry.js')}
    ${read('text-colors.js')}
    // private fork: native pack handles/player with inert local synthesis/audio seams.
    ${between(read('fork-asset-launcher.js'),'const forkPackListeners','function forkPackClient')}
    const forkPackTransport={service:{subscribe:()=>()=>{}}}, tavernSessionSignals={subscribe:()=>()=>{}};
    const forkStageAudio={prepareVoice(){},voice(){}},forkStageReading={get:()=>({voiceRate:1})},forkLipSync={wake(){}};
    // private fork: foreground media ownership listens for terminal audio events.
    class Audio extends EventTarget { constructor(src){super();this.src=src;this.paused=true;this.volume=1} load(){} pause(){this.paused=true;this.onpause?.()} play(){this.paused=false;this.onplay?.();return Promise.resolve()} }
    ${read('fork-voice.js').replace('// @include fork-pack-playback.cjs',read('fork-pack-playback.cjs'))}
    forkTtsScope={get:()=>({apiVersion:1,available:()=>voiceEnabled,subscribe:()=>()=>{},synthesize:async()=>({ticket:'offline',key:'offline'}),audio:async()=>new Blob(['offline'])})};
    forkVoicePlayer.setEnabled(true);
    ${between(bubbles, 'const FORK_BUBBLE_MOODS', '// Per-session bubble settings').replace('__TAVERN_BUBBLE_MOODS__', '[]')}
    function forkStripBubbleCodeQuote(line) { return line; }
    ${between(bubbles, 'function forkBubbleMediaDescriptor', '// ---------------------------------------------------------------------------').replace(/function ForkBubbleContent\(props\) \{/, match => match + ' counts.publications[props.voiceScope]=(counts.publications[props.voiceScope]||0)+1;').replace(/function ForkBubbleMarkdown\(([^]*?)\) \{/, match => match + ' counts.markdown++; counts.messages[props.voiceScope]=(counts.messages[props.voiceScope]||0)+1;')}
    let update, pulse = 0;
    const text = Array.from({length:6},(_,i)=>'Paragraph '+i+': '+('A **quiet street** and a *familiar voice* say "welcome home" beside the old \\x60garden\\x60. ').repeat(3)+'\\n\\n@bubble:a|A|calm|[It is good to see you again. Let us go home together.]').join('\\n\\n');
    function Transcript() {
      const [revision,set] = React.useState(0); update=set;
      return React.createElement('div',{id:'transcript'},Array.from({length:141},(_,i)=>React.createElement(${publication},{key:i,
        sessionId:'offline',voiceScope:(i+1)+':0',stageSource:{nodeId:'n'+i,nativeTurn:i+1,order:i,view:{}},
        text:(i===140?text.replaceAll('@bubble:a|','@bubble:b|'):text)+(i===140&&revision?'\\n\\nLatest '+revision:''),labels:{code:{copy:'Copy'}},streaming:i===140})));
    }
    // private fork: actual non-React session owner, independent of the frozen transcript.
    function fixtureSource(value) { const listeners=new Set(); return {getSnapshot:()=>value,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},set(next){value=next;for(const fn of listeners)fn()}}; }
    const nodeText=(i,revision=0)=>(i===140?text.replaceAll('@bubble:a|','@bubble:b|'):text)+(i===140&&revision?'\\n\\nLatest '+revision:'');
    const nativeNodes=new Map(Array.from({length:141},(_,i)=>['n'+i,{id:'n'+i,kind:'assistant-step',anchorSeq:i,location:{turn:{turn:i+1}},data:{status:i===140?'running':'closed',blocks:[{kind:'text',text:nodeText(i)}]}}]));
    const nativeChat=fixtureSource({nodes:nativeNodes,order:[...nativeNodes.keys()]}),nativeSession=fixtureSource({running:true});
    const nativeBinding={session:nativeSession};
    const owner=createStageSessionOwner({runEffect:(id,...args)=>window.stageSourceRunner?.runEffect(id,...args),sessions:{list:fixtureSource({current:'offline',byId:{offline:{}}}),binding:()=>nativeBinding},resolveChat:()=>nativeChat,
      views:{select:()=>fixtureSource({view:{mode:'story',chatId:'offline'}}),invalidate(){}},viewPaths:[],
      coordination:{getSnapshot:()=>({view:{}}),subscribe:()=>()=>{}},settings:forkBubbleStore,
      preferences:{get:()=>({}),subscribe:()=>()=>{}},storyTurn:(_view,turn)=>turn,
      createIndex:()=>createStageTextIndex({parse:forkParseBubbles,paragraphs:forkGalParagraphs,displayUnits:forkStageDisplayUnits,paginate:forkGalBlockPages,turnIndex:forkGalTurnIndex,projectionForTurn:()=>null,projectionParts:()=>[],storyTurn:(_view,turn)=>turn,superseded:forkGalIsSuperseded})});
    const forkStageSessions={get:id=>owner.get(id),owner};owner.start();
    const parts={get:()=>new Map([...owner.get('offline').getSnapshot().textIndex.values()].flatMap(row=>row.parts.map(part=>[part.scope,part])))};
    const mount=document.createElement('div');mount.id='transcript-scroll';mount.style.cssText='position:fixed;inset:0;overflow:auto;background:white;color:black;z-index:-1';
    document.body.appendChild(mount);
    const root=ReactDOM.createRoot(mount);
    ReactDOM.flushSync(()=>root.render(React.createElement(Transcript)));
    window.transcriptProbe={counts,root,mount,parts,runtime:owner.get('offline'),owner,
      setNodes(nodes,running=false){nativeSession.set({running});nativeNodes.clear();for(const node of nodes)nativeNodes.set(node.id,node);nativeChat.set({nodes:nativeNodes,order:[...nativeNodes.keys()]});},
      reset(){counts.markdown=counts.host=counts.rpc=0;counts.messages={};counts.publications={}},
      enableVoice(value=true){voiceEnabled=value;config.voice={enabled:value};config.characters=value?['a','b'].map(alias=>({alias,voice:'fixture/'+alias,voiceLanguage:'zh'})):[];
        ReactDOM.flushSync(()=>{bubbleData={...bubbleData,config:{...config}};forkBubbleStore.set('offline',bubbleData)});},
      character(alias,patch){config.characters=config.characters.map(item=>item.alias===alias?{...item,...patch}:item);
        ReactDOM.flushSync(()=>{bubbleData={...bubbleData,config:{...config}};forkBubbleStore.set('offline',bubbleData)});},
      stageVoice(index){const row=owner.get('offline').getSnapshot().textIndex.get(index+1),page=row.text.pages.find(page=>page.voice);return forkStageVoiceHandle('offline',page.voice,bubbleData.config,page.anchor.paragraphId);},
      player(index){ReactDOM.flushSync(()=>mount.querySelector('#transcript').children[index].querySelector('.fork-voice-button').click());return forkVoicePlayer.get()?.owner;},
      demand(index){const row=owner.get('offline').getSnapshot().textIndex.get(index+1),page=row.text.pages.find(page=>page.voice);
        const voice=forkStageVoiceHandle('offline',page.voice,bubbleData.config,page.anchor.paragraphId);
        if(forkGalActive.get()==='offline') void voice?.prefetch();},
      stop(){ReactDOM.flushSync(()=>forkVoicePlayer.stop())},
      playerStore:forkVoicePlayer,
      renew(){ReactDOM.flushSync(()=>forkPackChanged())},
      parent(){ReactDOM.flushSync(()=>root.render(React.createElement(Transcript)))},
      active(value){ReactDOM.flushSync(()=>forkGalActive.set(value?'offline':''))},
      tick(){
        pulse++;
        const node=nativeNodes.get('n140');nativeNodes.set('n140',{...node,data:{...node.data,blocks:[{kind:'text',text:nodeText(140,pulse)}]}});
        nativeChat.set({nodes:nativeNodes,order:[...nativeNodes.keys()]});
        ReactDOM.flushSync(()=>{update(pulse);forkVoicePlayer.stop();forkPackChanged();
          bubbleData={...bubbleData,config:JSON.parse(JSON.stringify(config))};forkBubbleStore.set('offline',bubbleData);});
      },
      dispose(){ReactDOM.flushSync(()=>root.unmount());owner.dispose();mount.remove()}
    };
  `
}
