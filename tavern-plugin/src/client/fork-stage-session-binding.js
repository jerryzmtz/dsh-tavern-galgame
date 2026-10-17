// private fork: session-owned inputs and continuous read-only direction observation.
// D supplies resource effects; F switches the UI. No second player runs here.
// @include-mod performance/state.cjs
// @include-mod performance/timeline.cjs
// @include fork-mod-projection.cjs
// @include fork-phone-beat.cjs
// @include fork-stage-runtime.cjs
// @include fork-stage-runtime-store.cjs
// @include fork-stage-display-units.cjs
// @include fork-stage-page-index.cjs
// @include fork-stage-text-index.cjs
// @include fork-stage-session.cjs
// @include fork-stage-director-source.cjs
// @include fork-stage-resources.cjs
// @include fork-stage-resource-runner.cjs
// @include fork-stage-ui.js
// @include-protocol stage-skin.cjs
// @include fork-stage-skin.cjs
// @include fork-stage-skin-ui.js
// @include fork-stage-skin-decoration.js
// @include fork-stage-rects.cjs
// @include fork-skin-overlay-loader.cjs
// @include fork-performance-layer.js

// fork-gal-entry.js (stage bundle) owns the entry signal; harnesses that load this file alone treat every stage as shown.
const forkStageEntryShown = () => typeof forkGalEntryShown === 'undefined' ? {get: () => undefined, subscribe: () => () => {}, wait: () => Promise.resolve()} : forkGalEntryShown;
const forkStageSessions = {
    owner: null,
    resourceOwner: null,
    modNotifications: new Map(),
    get(sessionId) { return this.owner?.get(sessionId) || null; },
    notifyMod(sessionId,event,state,detail={}) {
        if(!state?.source)return;
        const input={sessionId,event,active:!state.disposed && state.opened && state.visible,mode:state.cursor.mode,turn:state.source.turn,...detail};
        const task=(this.modNotifications.get(sessionId) || Promise.resolve()).then(()=>{if(event!=='session.disposed' && state.source!==this.get(sessionId)?.getSnapshot()?.source)return;return rpc('notifyModPresentation',input,sessionId);})
            .catch(error=>console.warn('Mod presentation notification failed',error));
        this.modNotifications.set(sessionId,task);
        void task.then(()=>{if(this.modNotifications.get(sessionId)===task)this.modNotifications.delete(sessionId);});
    },
    start(ctx) {
        const preferences = {
            get: () => ({reading: forkStageReading.get(), film: forkStageFilm.get(), audio: forkStageAudio.get()}),
            subscribe(listener) {
                const stops = [forkStageReading, forkStageFilm, forkStageAudio].map(source => source.subscribe(listener));
                return () => stops.forEach(stop => stop());
            }
        };
        const resourceOwner = createStageResourceOwner({service:() => forkPackTransport?.service,
            async decode(blob,url,{avatar = false} = {}) {
                if (!blob.type.startsWith('image/')) return null;
                // private fork: a temporary sprite decode must have an explicit close.
                if (avatar && typeof createImageBitmap === 'function') return createImageBitmap(blob);
                const image = new Image(); image.src = url;
                try { await image.decode(); return image; }
                catch (error) { image.src = ''; throw error; }
            }});
        this.resourceOwner = resourceOwner;
        const resourceDebug = {snapshot:() => ({...resourceOwner.debug(), runtime: (() => {
            const state = this.get(window.__dshTavernSelectedSessionId)?.getSnapshot();
            return state ? {source:state.source, visible:state.visible, opened:state.opened,
                pending:state.pending, projection:state.projection, director:state.director,
                observation:state.observation, text:{revision:state.text.revision,
                    streaming:state.text.streaming, units:state.text.units.length, pages:state.text.pages.length}} : null;
        })()})};
        window.forkStageResourceDebug = resourceDebug;
        const overlayModule=createSkinOverlayLoader();
        let runtimeRead = null;
        // Both imported Live2D pieces (installed; older hosts report the Core alone), else static sprites.
        const stageLive2dReady = status => status && status.installed !== false && status.core || '';
        const live2dRuntime = sessionId => {
            if (!runtimeRead || runtimeRead.sessionId !== sessionId || performance.now() - runtimeRead.at > 60000) {
                const value = rpc('getLive2dRuntime',{},sessionId), entry = {sessionId, at:performance.now(), value};
                value.then(status => { if (!stageLive2dReady(status) && runtimeRead === entry) runtimeRead = null; }, () => { if (runtimeRead === entry) runtimeRead = null; });
                runtimeRead = entry;
            }
            return runtimeRead.value;
        };
        const resources = createStageResourceRunner({
            foreground:forkForeground,
            resolveSpeaker:(state,page) => forkBubbleCharacter(state.settings?.config,page)?.alias,
            async idle(id,current) {
                // Speculation must not compete with model upload or the atomic entry reveal.
                while (current()) {
                    const root = document.querySelector('.fork-gal-stage');
                    if (!root || window.__dshTavernSelectedSessionId !== id) return false;
                    if (root.dataset.entry === 'ready') {
                        await new Promise(resolve => typeof requestIdleCallback === 'function' ? requestIdleCallback(resolve) : setTimeout(resolve,0));
                        return current();
                    }
                    await new Promise(resolve => setTimeout(resolve,100));
                }
                return false;
            },
            preparePerformance:value => Promise.all(value.dependencies.filter(item=>item.document?.overlay).map(item=>overlayModule(item.document))),
            music:() => forkBgm,
            performance:(id,intent) => forkStageConsumers.get(id)?.performance?.(intent),
            async read(args) {
                // private fork (stage perf): the installed Cubism core is app-wide. Ask for it beside the
                // presentation rather than after it, and let one answer serve a stage visit's reads.
                const runtime = live2dRuntime(args.sessionId);
                const result = await rpc('getAssetPackPresentation',args,args.sessionId);
                if (result.status === 'ready' && result.value.characters.some(figure => figure.form === 'live2d')) {
                    result.value.scene = {...result.value.scene,core:stageLive2dReady(await runtime)};
                }
                return result;
            },
            present:(id,intent) => forkStageConsumers.get(id)?.present(intent),
            play:(id,value,token) => forkStageConsumers.get(id)?.play(value,token),
            cancelPlayback:(id,intent) => forkStageConsumers.get(id)?.cancel(intent),
            owner: resourceOwner
        });
        const director = createStageDirectorSource({
            onEffect:resources.onEffect,
            read: args => rpc('getStageDirection', args, args.sessionId),
            // private fork (O09): an arrow keeps `this` = forkStageSessions. The director source calls `watch` bare, and the
            // real signal service runs onConnect synchronously when already connected (履历 jump, re-entry, remount) and on
            // every reconnect snapshot; a method shorthand there threw `this.get is not a function` and failed the stream.
            watch: (source, wake) => {
                const stops = ['stage-direction','tavern-state'].map(kind =>
                    tavernSessionSignals.subscribe(source.sessionId, kind, wake, wake, () => {wake();this.notifyMod(source.sessionId,'activity.changed',this.get(source.sessionId)?.getSnapshot());}));
                return () => stops.forEach(stop => stop());
            }
        });
        const owner = createStageSessionOwner({
            runEffect: director.runEffect,
            observe:(id,event,previous,state)=>{
                if(event.type==='DISPOSE'){this.notifyMod(id,'session.disposed',state);return;}
                if(!state.source){if(previous.source)this.notifyMod(id,'stage.left',{...previous,opened:false});return;}
                if(!previous.source || previous.opened!==state.opened)this.notifyMod(id,state.opened?'stage.entered':'stage.left',state);
                if(!previous.source || previous.visible!==state.visible || previous.cursor.mode!==state.cursor.mode)this.notifyMod(id,'activity.changed',state);
                const anchor=state.cursor.anchor,prior=previous.cursor.anchor;
                if(anchor && (anchor.paragraphId!==prior?.paragraphId || anchor.offset!==prior?.offset))
                    this.notifyMod(id,'page.changed',state,{anchor:{paragraph:anchor.para,charOffset:anchor.offset}});
                const page=state.text.pages.find(row=>row.anchor.paragraphId===anchor?.paragraphId && row.anchor.offset===anchor?.offset);
                const end=page && page.anchor.offset+page.text.length;
                if(event.type==='READ_PROGRESS' && page && !page.pending && previous.cursor.readThrough<end && state.cursor.readThrough>=end)
                    this.notifyMod(id,'text.revealed',state,{anchor:{paragraph:anchor.para,charOffset:page.anchor.offset},revealed:{id:JSON.stringify([state.source.sourceKey,anchor.paragraphId,page.anchor.offset,end]),text:page.text}});
            },
            readHistory: (args,source,text) => director.cached(source,text) || rpc('getStageDirection', args, args.sessionId),
            primeHistory: director.prime,
            // private fork (perf round 3): adjacent-turn presentation reads (~0.5 MB each) start after the entry reveal.
            prefetchHistory: async (source, envelope) => {
                await forkStageEntryShown().wait(owner.get(source.sessionId), () => window.__dshTavernSelectedSessionId === source.sessionId && !!document.querySelector('.fork-gal-stage'));
                return resources.prefetch(source, envelope);
            },
            invalidateHistory(id) {director.invalidate(id); resources.invalidate(id);},
            invalidatePresentation: resources.invalidate,
            opened:false,
            sessions: ctx.sessions,
            visible: () => !document.hidden,
            resolveChat: binding => resolveConversationChatBinding(ctx.get('uiConversation') || ctx.get('conversation'), binding),
            views: liveTavernView,
            viewPaths: ['chatId', 'mode', 'card', 'replyProjections', 'regeneratedDshTurns', 'suppressedDshTurns',
                'latestAssistantTurn', 'foregroundError', 'historyWindow'].map(key => [key]).concat([['tavernHelper', 'lifecycleRevision']]),
            coordination: tavernCoordination,
            settings: forkBubbleStore,
            preferences,
            storyTurn: tavernStoryTurnForDshTurn,
            createIndex: () => createStageTextIndex({parse: forkParseBubbles, paragraphs: forkGalParagraphs, displayUnits: forkStageDisplayUnits,
                paginate: stageBlockPages, turnIndex: forkGalTurnIndex, projectionForTurn: tavernProjectionForTurn,
                projectionParts: projectionPartsOf, storyTurn: tavernStoryTurnForDshTurn,
                superseded: forkGalIsSuperseded})
        });
        this.owner = owner;
        owner.start();
        // private fork: the session index survives transcript virtualization. Only the
        // selected chat's latest completed turn and viewed/next turns are synthesized.
        let voiceStore = null, stopVoiceSource = null;
        const syncVoice = () => {
            const id = ctx.sessions.list.getSnapshot().current || null;
            const store = id ? owner.get(id) : null;
            if (store !== voiceStore) {
                stopVoiceSource?.(); voiceStore = store; stopVoiceSource = null;
                if (store) {
                    const source = store.select(state => ({textIndex:state.textIndex,source:state.source,latestSource:state.latestSource,
                        settings:state.settings,opened:state.opened,interrupted:state.interrupted}),forkStageUiEqual);
                    const stop = source.subscribe(syncVoice);
                    stopVoiceSource = () => {stop();source.dispose();};
                }
            }
            const state = store?.getSnapshot(), handles = [];
            const config = state?.settings?.config;
            const latest = state?.latestSource?.turn;
            const turns = new Set(latest === undefined ? [] : [latest]);
            // private fork (perf round 3): the opened turn's other pages and the next turn wait for the entry reveal;
            // until then the stage itself prefetches only its current page.
            if (state?.opened && state.source && (typeof forkGalEntryShown === 'undefined' || forkGalEntryShown.get() === store)) {
                turns.add(state.source.turn);
                const next = [...state.textIndex.keys()].filter(turn => turn > state.source.turn).sort((a,b) => a-b)[0];
                if (next !== undefined) turns.add(next);
            }
            const available = forkStageVoiceAvailable();
            for (const turn of turns) {
                const row = state.textIndex.get(turn);
                if (!row || row.text.streaming || state.interrupted && turn === latest) continue;
                for (const page of row.text.pages) {
                    if (page.pending) continue;
                    const handle = forkStageVoiceHandle(id,page.voice,config,page.anchor.paragraphId,available);
                    if (handle) handles.push(handle);
                }
            }
            forkVoicePlayer.cancelPrefetch(handles);
            for (const handle of handles) void handle.prefetch();
        };
        const stopVoiceSession = ctx.sessions.list.subscribe(syncVoice), stopVoiceEntry = forkStageEntryShown().subscribe(syncVoice);
        const stopVoiceSettings = forkBubbleStore.subscribe(syncVoice);
        if (typeof forkPackListeners !== 'undefined') forkPackListeners.add(syncVoice);
        syncVoice();
        // private fork: the BGM player follows the selected session (after the owner made its store).
        const bgmSelect = () => forkBgm.activate(ctx.sessions.list.getSnapshot().current || null);
        const stopBgmSelect = ctx.sessions.list.subscribe(bgmSelect), bgmKick = () => forkBgm.kick();
        document.addEventListener('pointerdown', bgmKick, true); document.addEventListener('keydown', bgmKick, true);
        bgmSelect();
        const prefetches = new Map();
        let avatarGeneration = 0, avatarSession = null, avatarStore = null, stopAvatarSource = null;
        const avatarRevisions = new Map();
        const syncAvatars = () => {
            const id = ctx.sessions.list.getSnapshot().current || null;
            if (id !== avatarSession) { avatarSession = id; avatarGeneration++; prefetches.clear(); }
            forkAvatarCache.select(id);
            const store = id ? owner.get(id) : null;
            if (store !== avatarStore) {
                stopAvatarSource?.(); avatarStore = store; stopAvatarSource = null;
                if (store) {
                    const source = store.select(state => state.source);
                    const stop = source.subscribe(syncAvatars);
                    stopAvatarSource = () => { stop(); source.dispose(); };
                }
            }
            if (!id) return;
            const source = store?.getSnapshot().source;
            const characters = forkBubbleStore.get(id)?.config?.characters || [];
            for (const character of characters) {
                const descriptor = character.avatarMedia?.default;
                if (!descriptor || (avatarRevisions.has(descriptor.ref.packId) && avatarRevisions.get(descriptor.ref.packId) !== descriptor.revision)) continue;
                forkAvatarCache.revision(descriptor.ref.packId,descriptor.revision);
                const avatar = {...descriptor,sessionId:id}, key = JSON.stringify(avatar), generation = avatarGeneration;
                if (!source || prefetches.has(key) || forkAvatarCache.get(avatar)) continue;
                const job = resourceOwner.acquire(descriptor,JSON.stringify([source.sessionId,source.authorityEpoch])).then(async pin => {
                    try {
                        if (generation === avatarGeneration) await forkAvatarCache.prepare(avatar,pin.handle.url);
                    } finally { pin.release(); }
                }).catch(() => {}).finally(() => { if (prefetches.get(key) === job) prefetches.delete(key); });
                prefetches.set(key,job);
            }
        };
        const stopAvatarSession = ctx.sessions.list.subscribe(syncAvatars), stopAvatarSettings = forkBubbleStore.subscribe(syncAvatars);
        syncAvatars();
        // private fork: deletion is authoritative even while observation timers sleep.
        // Other transport events only request validation; disconnect is not revoke.
        const packChanged = event => {
            if (event?.type === 'unavailable') { avatarGeneration++; forkAvatarCache.clear(); }
            else if (event?.packId && event.revision !== undefined) {
                avatarRevisions.set(event.packId,event.revision);
                forkAvatarCache.revision(event.packId,event.revision);
            }
            for (const id of Object.keys(ctx.sessions.list.getSnapshot().byId || {})) {
                const store = owner.get(id), source = store?.getSnapshot().source;
                if (!source) continue;
                resources.invalidate(id);
                if (event?.type === 'unavailable') resources.revoke(id,{authority:true},store.dispatch,store.getSnapshot);
                else if (event?.revision === null && event.packId) resources.revoke(id,{packId:event.packId},store.dispatch,store.getSnapshot);
                else store.dispatch({type:'REFRESH_BEGIN',source});
            }
            if (event) forkBgm.invalidate();
        };
        if (typeof forkPackListeners !== 'undefined') forkPackListeners.add(packChanged);
        // private fork (new-user journey 2026-10): installing the Cubism Core re-reads open stages, so figures shown as their
        // static sprite switch to Live2D in place (no reload, no state change). Importing the Spine runtime does the same.
        const stopLive2dCore = typeof forkCubismCore !== 'undefined' ? forkCubismCore.subscribe(() => packChanged(null)) : () => {};
        const stopSpineRuntime = typeof forkSpineRuntimeState !== 'undefined' ? forkSpineRuntimeState.subscribe(() => packChanged(null)) : () => {};
        const stopCore = () => { stopLive2dCore(); stopSpineRuntime(); };
        const visibility = () => {
            const snapshot = ctx.sessions.list.getSnapshot();
            for (const id of Object.keys(snapshot.byId || {})) owner.get(id)?.dispatch({type: 'VISIBILITY', visible: !document.hidden});
        };
        // Visibility is observation/visual policy only. Never mute audio on hide.
        document.addEventListener('visibilitychange', visibility);
        visibility();
        return () => {
            document.removeEventListener('visibilitychange', visibility);
            stopAvatarSession(); stopAvatarSettings(); stopAvatarSource?.(); avatarGeneration++; forkAvatarCache.select(null);
            stopVoiceSession(); stopVoiceEntry(); stopVoiceSettings(); stopVoiceSource?.();
            if (typeof forkPackListeners !== 'undefined') forkPackListeners.delete(syncVoice);
            if (typeof forkPackListeners !== 'undefined') forkPackListeners.delete(packChanged);
            stopCore();
            stopBgmSelect(); document.removeEventListener('pointerdown', bgmKick, true); document.removeEventListener('keydown', bgmKick, true);
            forkBgm.activate(null);
            owner.dispose();
            director.dispose();
            resources.dispose();
            if (window.forkStageResourceDebug === resourceDebug) delete window.forkStageResourceDebug;
            if (this.resourceOwner === resourceOwner) this.resourceOwner = null;
            if (this.owner === owner) this.owner = null;
        };
    }
};
