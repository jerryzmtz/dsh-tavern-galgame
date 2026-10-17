// Offline host seams. The stage, publishing, bubble parser and highlighter are production code.
// Only RPC/catalogues, voice synthesis and the host MarkdownText implementation are simulated.
const rainBase = H.scene.debug.description();
const rainBackground = { id: 'rain-night', name: '\u6cb3\u4e0a\u7684\u6865\u00b7\u591c', url: rainBase.background.url };
const rainConfig = { enabled: true, characters: [], stage: { director: true, background: 'rain-night', music: true } };
const rainDataSource = { config: rainConfig };
const rainLibrary = { loaded: true, core: '', models: [] };
const rainBackgrounds = { loaded: true, backgrounds: [rainBackground] };
const rainMusic = { loaded: true, tracks: [{id:'bgm', name:'Offline BGM', url:'/api/dsh-tavern/card-assets/card-muh1tsxf-rile9a/music/46cc80b4f6c8d9e532c7611278e6ff3cd167591383528a61ea1d3eea0558c360.mp3'}] }, rainSfx = { loaded: true, sounds: [] };
window.rainAudio=[];
const NativeAudio=window.Audio;
window.Audio=function(...args) {const audio=new NativeAudio(...args);rainAudio.push(audio);return audio;};
function useForkLive2dLibrary() { return rainLibrary; }
const forkLookStore = { get: () => ({ loaded: true }) };
function useForkStageLooks() { return H.registry; }
function useForkBackgrounds() { return rainBackgrounds; }
function forkCardBackgrounds(value) { return value.backgrounds; }
function useForkMusic() { return rainMusic; }
function useForkStageSfxLibrary() { return rainSfx; }
function useForkWidgetCatalogue() { return null; }
function useForkBubbles() { return rainDataSource; }
function useForkVoiceBubbles() { return {}; }
function useForkAutoChoicesPreference() { return { enabled: false }; }
function useLiveTavernView() { return null; }
const forkLipSync = { wake() {} };
const forkVoicePlayer = { subscribe: () => () => {}, get: () => null, stop() {} };
const forkStageVoiceDemand = { set() {} }, forkBackgroundStore = { load() {} };
Object.assign(forkStageSfx, { ambience() {}, stop() {}, setThunder() {} });
function ForkVoiceButton() { return null; }
function forkSpriteBundle() { return null; }
rpc = async method => {
 if (method === 'measureStageAudio') return {loudness:{v:1,lufs:-18,peak:-1}}; // Warm-cache seam, no analysis/RPC writes.
 if (method === 'getStageDirection') return { status: 'done', key: 'rain-direction', start: {}, entries: [{ at: 1, scene: rainBackground.name, music:'Offline BGM', cast: [], commands: [{op:'weather',value:'rain'}, {op:'light',value:'night'}, ...(window.rainMood ? [{op:'light',value:window.rainMood}] : [])] }] };
 throw Error('Unexpected offline RPC: ' + method);
};
const DshUi = { MarkdownText: function MarkdownText(props) {
 React.useLayoutEffect(() => { window.rainData.chatCommits++; });
 return React.createElement(React.Fragment, null, props.text.split('\n\n').map((text, i) => React.createElement('p', {key:i}, text)));
} };
const baseText = ('A quiet night. "The rain keeps falling." A paragraph behind the stage.\n\n').repeat(30);
function Message({turn}) {
 const [reply, set] = React.useState(turn === 101 ? null : {text:baseText, streaming:false});
 if (turn === 101) {
  window.startRainReply = () => set({text:baseText, streaming:true});
  window.appendRainChunk = () => set(r => ({text:r.text + ' "Another streamed sentence."', streaming:true}));
 }
 return reply && React.createElement(ForkBubblePublication, {sessionId:'rain-perf', voiceScope:turn+':0', text:reply.text, streaming:reply.streaming});
}
function ForkGalScene(props) {
 const root = React.useRef(null);
 React.useLayoutEffect(() => { root.current.appendChild(document.getElementById('host')); document.getElementById('root')?.remove(); }, []);
 React.useLayoutEffect(() => { window.rainData.stageCommits++; H.set(props.scene); props.onUi && (window.rainUi=props.onUi); });
 return React.createElement('div',{className:'fork-gal-scene',ref:root});
}
const chat = document.createElement('div'); chat.style.cssText='position:absolute;inset:0;overflow:auto;z-index:-1'; document.body.prepend(chat);
const mount = document.createElement('div'); mount.className='fork-gal-mount'; document.body.appendChild(mount);
forkGalActive.set('rain-perf');
window.rainRoot = ReactDOM.createRoot(chat);
rainRoot.render(React.createElement(React.Fragment,null,Array.from({length:101},(_,i)=>React.createElement(Message,{key:i,turn:i+1}))));
window.rainStageRoot = ReactDOM.createRoot(mount);
rainStageRoot.render(React.createElement(ForkGalStage,{sessionId:'rain-perf',data:rainDataSource,onExit(){}}));
