// private fork: changes are accepted at page boundaries; never persist font overrides.
// A skin other than the card's default skin was applied by the director (performance / skin command).
function forkStageSkinPerformed(skin, defaultKey) {
    if (!skin) return false;
    let value = null;
    try { value = defaultKey ? JSON.parse(defaultKey) : null; } catch (_) { value = null; }
    if (skin.builtin) return skin.document?.id !== (typeof value === 'string' ? value : 'classic');
    return !(skin.ref && value && typeof value === 'object' && skin.ref.packId === value.packId && skin.ref.assetId === value.assetId);
}
function useForkStageSkin(rootRef, candidate, pageKey, film, theme, {ready = true, snap = false, defaultKey = '', fallback = null} = {}) {
    const selected = React.useRef({page:null,value:null,hydrated:false});
    const previousDefault=React.useRef(defaultKey);
    if(previousDefault.current!==defaultKey) {selected.current={page:null,value:null,hydrated:false};previousDefault.current=defaultKey;}
    if (selected.current.page !== pageKey || snap || !selected.current.hydrated && ready) selected.current = {page:pageKey,value:candidate || null,hydrated:ready};
    // Explicit withdrawal/revocation is immediate; a late replacement waits for the next page.
    if (!candidate) selected.current.value = null;
    const skin = selected.current.value;
    const chosen = React.useMemo(() => {
        const appearance=skin?.document ? stageSkinAppearance(skin.document,skin.level) : null;
        return appearance ? {appearance,builtin:skin.builtin===true} : {appearance:fallback?.document ? stageSkinAppearance(fallback.document,fallback.level) : null,builtin:fallback?.builtin===true};
    },[skin,fallback]);
    const {appearance,builtin}=chosen, lead=forkStageSkinPerformed(skin,defaultKey);
    const revision = React.useSyncExternalStore(forkFonts.subscribe,forkFonts.getSnapshot);
    React.useLayoutEffect(() => {
        const root = rootRef.current;
        if (!root || !appearance) return;
        let restore;
        try {
            // A pack skin's font declaration on the root: fork-fonts.js resolves --gal-ui-font / --gal-film-font from it
            // and the CONFIG pickers read it as the current skin (docs/fork/fonts.md). Built-ins carry none: fork-fonts.js
            // reads the client's own BUILTIN_STAGE_SKINS by data-theme (as before, independent of the host's copy).
            const attributes=[['data-fk-fonts',builtin ? null : JSON.stringify(appearance.font || {})],['data-fk-fonts-lead',lead && !builtin ? 'skin' : null]].map(([name,value]) => {
                const old=root.getAttribute(name);
                if (value === null) root.removeAttribute(name); else root.setAttribute(name,value);
                return [name,old];
            });
            if (builtin || film) {
                const tokens=stageSkinPanelTokens(appearance,forkFonts,theme,builtin,lead), previous=new Map();
                for (const [key,value] of Object.entries(tokens)) {previous.set(key,root.style.getPropertyValue(key));root.style.setProperty(key,value);}
                restore=()=>{for(const [key,value] of previous) {if(value)root.style.setProperty(key,value);else root.style.removeProperty(key);}};
            } else restore = applyStageSkin(root,appearance,forkFonts,theme,lead);
            const undo=restore;
            restore=()=>{undo();for (const [name,old] of attributes) {if (old === null) root.removeAttribute(name); else root.setAttribute(name,old);}};
            // Only the faces this view uses; film/reading register through fork-fonts.js when they are shown.
            if (!builtin) for (const part of [undefined,'name','ui']) {const id=forkFonts.resolve('stage',{theme,skin:appearance.font || {},part,skinWins:lead}).id;if (id) forkFonts.ensure(id).catch(() => {});}
            if (appearance.ui?.titleFont) forkFonts.ensure(appearance.ui.titleFont).catch(() => {});
            root.dispatchEvent(new Event('stage-layout'));
        } catch (error) { console.warn('Stage skin rejected',error); }
        return () => {restore?.(); root.dispatchEvent(new Event('stage-layout'));};
    },[appearance,builtin,film,theme,revision,lead]);
    return builtin || film ? null : appearance;
}
