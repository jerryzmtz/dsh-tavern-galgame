// private fork: one workbench, one slot registration, one transport lifetime.
let forkPackTransport;
const forkPackUi = createForkAssetPackUI(React,{VoicePicker:ForkBubbleLibraryPicker,AvatarImage:ForkPackImage,HelpTip:typeof ForkHelpTip==='function'?ForkHelpTip:undefined,
    live2d:typeof FORK_LIVE2D_PREVIEW_KIT==='object'?FORK_LIVE2D_PREVIEW_KIT:undefined,
    // private fork (docs/fork/spine-figures.md): the Spine importer's reader and live preview (fork-spine-preview.js).
    spine:typeof forkSpineKit==='function'?forkSpineKit():undefined,
    // private fork (owner 2026-10): 舞台设置 › 基础设置 「自动生成选项」 reads/writes through the one preference hook.
    autoChoices:typeof useForkAutoChoicesPreference==='function'?useForkAutoChoicesPreference:undefined,
    // private fork: 开场画面 previews the stage's compensating background grade (same math as the live stage).
    timeGrade:projection=>{const grade=createPackSceneLayers()(projection).backgroundGrade;return forkGalMatrix.isIdentity(grade)?null:grade;},
    emotions:{moods:FORK_BUBBLE_MOODS,max:FORK_CUSTOM_MOOD_MAX,colors:forkCustomMoodColors,upsert:(list,value)=>forkEmotionUpsert(list,value)}});
const forkPackListeners = new Set();
let forkPackRevision = 0;
function forkPackChanged(event) { forkPackRevision++; for (const fn of forkPackListeners) fn(event); }
function useForkPackRevision(select) { return React.useSyncExternalStore(fn => { forkPackListeners.add(fn); return () => forkPackListeners.delete(fn); }, select || (() => forkPackRevision)); }
function forkPackClient() { return forkPackTransport?.available() ? forkPackTransport.service : undefined; }
// private fork: 舞台设置 ↔ 素材库 deep links. The target waits here until the library tab consumes it.
let forkStageSidebar;
const forkPackNav = (function () {
    let pending = null; const listeners = new Set();
    return { go(target) { pending = target || {}; for (const fn of [...listeners]) fn(); }, take() { const next = pending; pending = null; return next; },
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
})();
function forkNavFailed(label, error) { try { tavernErrorHub.report(label, error); } catch (_) { console.warn(label, error); } }
function forkOpenSidebarTab(type, sessionId) {
    if (!forkStageSidebar) return Promise.reject(new Error('当前页面无法切换侧栏标签'));
    return Promise.resolve().then(() => forkStageSidebar.openTab({ type }, sessionId ? { sessionId } : undefined));
}
// private fork (stage setup wizard v2, docs/fork/stage-setup-wizard.md): the first entry into 舞台模式 on a card that binds no
// 素材包 opens 舞台设置 straight on 设置向导 instead (once per card; forkPackUi.stageSetup decides and holds the request until
// the page takes it). null: enter as usual; else a promise of whether the wizard opened.
function forkStageSetupGate(sessionId) {
    const data = forkBubbleStore.get(sessionId);
    return forkPackUi.stageSetup.enter({ service: forkPackClient(), path: data?.cardPath, stageOn: data?.config?.stage?.director === true,
        open: () => forkOpenSidebarTab('dsh-tavern:bubbles', sessionId) });
}
function forkStageNav(sessionId) {
    return { openTab: type => forkOpenSidebarTab(type, sessionId).catch(error => forkNavFailed('打开侧栏标签', error)),
        // private fork (settings polish, owner 2026-10): a pack opened from 舞台设置 gets the sub-page ‹ back to it.
        openLibrary: target => { forkPackNav.go(target && target.packId ? { ...target, back: { label: '舞台设置', open: () => forkOpenSidebarTab('dsh-tavern:bubbles', sessionId).catch(error => forkNavFailed('返回舞台设置', error)) } } : target); return forkOpenSidebarTab('dsh-asset-library:library', sessionId).catch(error => forkNavFailed('打开舞台素材', error)); } };
}
// private fork (owner 2026-10 r2): a card save from 舞台设置 / 素材库 shows at once, as 开启 BGM does: the card's dialogue
// settings reload (the BGM player follows stage.music) and an open stage re-projects (BGM / 音效 / 环境音, default skin),
// instead of waiting for the 60 s poll or the next turn.
function forkCardStageSaved(sessionId) {
    if (!sessionId) return;
    forkBubbleStore.load(sessionId, true);
    const store = typeof forkStageSessions !== 'undefined' ? forkStageSessions.get(sessionId) : null, source = store?.getSnapshot().source;
    if (source) store.dispatch({ type: 'REFRESH_BEGIN', source });
}
function forkWorkbenchRpc(sessionId) {
    return (method,args) => rpc(method,args || {},sessionId).then(result => { if (method === 'saveCardAssetBindings' || method === 'saveAssetEngineSettings') forkCardStageSaved(sessionId); return result; });
}
// private fork (judge ui, owner 2026-10): machine-wide engine RPCs (getJudgeConfig …) take no sessionId: their strict
// argument check refuses it, so they go out without the session.
function forkEngineRpc(method,args) { return rpc(method,args || {}); }
function ForkPackWorkbench({sessionId,cardPath,cardName,cardStamp,loading,page = 'library',prompts}) {
    useForkPackRevision();
    const transport = forkPackTransport, service = forkPackClient(), tts=forkTtsScope?.get('ttsClient');
    const binding = React.useMemo(() => service ? createForkAssetPackBinding({service,tts,
        rpc:forkWorkbenchRpc(sessionId), engineRpc:forkEngineRpc, settings:transport.settings,
        download:result => transport.download(result), readExport:result => transport.bytes(result),
        onUnavailable:fn => transport.onUnavailable(fn)
    }) : {rpc:forkWorkbenchRpc(sessionId),engineRpc:forkEngineRpc,download:result=>transport.download(result),tts}, [transport,service,sessionId,tts]);
    const nav = React.useMemo(() => forkStageNav(sessionId), [sessionId]);
    React.useEffect(() => () => binding?.dispose?.(),[binding]);
    // private fork: the Tavern 舞台 tab is one card-centric page (docs/fork/card-centric-ux.md).
    if(page==='stage')return React.createElement(forkPackUi.StagePanel,{binding,sessionId,cardPath,cardName,loading,nav,prompts});
    return React.createElement(forkPackUi.App,{key:service ? 'available' : 'unavailable',enabled:true,binding,nav:forkPackNav,sessionId,cardPath,cardStamp});
}
// private fork (owner 2026-10 r4): the library owns no card, but it reads the open chat's card (when there is one) so a
// pack bound to that card shows 「本卡使用」 and is listed right after the 全局 packs instead of claiming 「关闭」. Without a chat it shows
// global state only.
function ForkAssetLibraryTab(props) {
    const sessionId=props.scope?.sessionId || '',data=useForkBubbles(sessionId,!!sessionId);
    return React.createElement(ForkPackWorkbench,{key:sessionId,sessionId,cardPath:sessionId?data?.cardPath:undefined,cardStamp:sessionId?data:undefined});
}
// private fork (owner 2026-10 r3): the host half of 舞台设置 › 提示词 (fork-asset-pack-card-ui.js StagePrompts). usePrompts() reads what
// the story model receives (the shared dialogue store: getDialogueBubbles `injection`, `config.injection` for 恢复默认)
// and the director preview; the 对白格式 editor and its reset write the global engine dialogue.injection.
function forkStagePrompts(sessionId) {
    return {
        usePrompts() {
            const data = useForkBubbles(sessionId, true), [director, refreshDirector] = useForkDirectorPreview(sessionId), injection = data?.config?.injection;
            return { story: data ? { parts: Array.isArray(data.injection) ? data.injection : data.instruction ? [{ key: 'format', text: data.instruction, tokens: null }] : [],
                custom: !!(injection?.template?.trim() || injection?.extra?.trim()),
                // private fork (提示词 view complete): the bubble entries the bound worldbooks really hold, so one another card left behind shows too.
                entries: Array.isArray(data.placement?.entries) ? data.placement.entries : null, userName: data.userName || '' } : null,
                director, refresh: () => { forkBubbleStore.load(sessionId, true); refreshDirector(); } };
        },
        dialogueEditor: close => React.createElement(ForkStageDialogueEditor, { sessionId, onClose: close }),
        resetDialogue: () => forkResetDialogueInjection(sessionId)
    };
}
function ForkTavernStageTab(props) {
    const sessionId=props.scope?.sessionId || '',data=useForkBubbles(sessionId,true),prompts=React.useMemo(() => forkStagePrompts(sessionId),[sessionId]);
    return React.createElement(ForkPackWorkbench,{key:sessionId,sessionId,page:'stage',cardPath:data?.cardPath,cardName:data?.cardName,loading:!data,prompts});
}
function installTavernAssetLaunchers(ctx, slots) {
    if (ctx.betterSidebar) { const sidebar = ctx.betterSidebar; forkStageSidebar = sidebar; ctx.effect(() => () => { if (forkStageSidebar === sidebar) forkStageSidebar = undefined; }); }
    ctx.inject(['ttsClient'], child => {
        forkTtsScope = child;
        forkVoicePlayer.setEnabled(true); forkPackChanged();
        const off=child.get('ttsClient').subscribe(event => {
            // private fork: a preset keeps its ID when its synthesis parameters change.
            if (event?.type === 'voicesChanged') forkVoicePlayer.invalidate();
            // private fork: a finished synthesis only refreshes the confirmed-failure ⚠ (its own listeners). Treating it as a
            // pack change reloads the stage, which re-synthesizes the failed line, which fires again: a retry loop that
            // also made the 配音 ⚠ blink.
            if (event?.type === 'modelValidationChanged') return;
            // private fork (docs/fork/reading-dictionary.md): another reading preset (or an edit to it) changes each line's
            // identity in dsh-tts; drop decoded clips so a replay asks again (re-synthesised there only when replayed).
            if (event?.type === 'readingsChanged') { forkVoicePlayer.invalidate(); return; }
            forkPackChanged(event);
        });
        const offRate=forkStageReading.subscribe(() => forkVoicePlayer.setRate(forkStageReading.get().voiceRate));
        child.effect(() => () => {off();offRate();if(forkTtsScope!==child)return;forkTtsScope=undefined;forkVoicePlayer.setEnabled(false);forkVoicePlayer.invalidate();forkPackChanged();});
    });
    ctx.effect(() => {
        const transport = createForkPackTransport(); forkPackTransport = transport;
        const stop = transport.service.subscribe(forkPackChanged);
        transport.start();
        return () => { stop(); transport.dispose(); if (forkPackTransport === transport) forkPackTransport = undefined; forkPackChanged(); };
    });
    ctx.provide('assetPackWorkbench',{render:props=>React.createElement(ForkAssetLibraryTab,props)});
    // private fork (docs/fork/reading-dictionary.md): the global 读音词典 drawn with the shared panel components; the 配音
    // page (dsh-tts) places it and supplies its control RPC.
    ctx.provide('ttsReadingsEditor',{render:props=>React.createElement(forkPackUi.ReadingsEditor,props)});
}
