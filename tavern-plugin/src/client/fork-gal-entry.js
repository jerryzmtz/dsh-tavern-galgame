// The covered transcript stays mounted, but must not be forced back into layout by
// fullscreen, focus or host scroll sampling. content-visibility:hidden (fork-theme.css,
// [data-fork-gal-covered]) skips its style/layout/paint and keeps it out of focus, find
// and the accessibility tree, while keeping the rendering state (styles, boxes, scroll
// offsets): leaving the stage repaints it instead of restyling ~20k nodes. Only the
// session roots are touched, so no document-wide style invalidation. Each root's box is
// pinned at its covered size, so a fullscreen resize cannot dirty the skipped layout and
// a forced host read inside it stays a cache hit.
const FORK_GAL_COVER_BOX = ['width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'flex'];
let forkGalUncover = null;
function forkGalCoverChat() {
    if (forkGalUncover) return;
    const roots = [...document.querySelectorAll('[data-dsh-fork-session="play"] > *')];
    // One layout read for all roots before any write.
    const boxes = roots.map(node => node.getBoundingClientRect());
    const saved = roots.map((node, i) => {
        const style = node.style, inline = FORK_GAL_COVER_BOX.map(name => [name, style.getPropertyValue(name), style.getPropertyPriority(name)]);
        const pin = {width:boxes[i].width + 'px', height:boxes[i].height + 'px', 'min-width':'0', 'min-height':'0', 'max-width':'none', 'max-height':'none', flex:'none'};
        if (boxes[i].width || boxes[i].height) FORK_GAL_COVER_BOX.forEach(name => style.setProperty(name, pin[name], 'important'));
        node.setAttribute('data-fork-gal-covered', '');
        return [node, inline];
    });
    document.documentElement.setAttribute('data-fork-gal-stage', '');
    forkGalUncover = () => {
        document.documentElement.removeAttribute('data-fork-gal-stage');
        saved.forEach(([node, inline]) => {
            node.removeAttribute('data-fork-gal-covered');
            inline.forEach(([name, value, priority]) => { if (value) node.style.setProperty(name, value, priority); else node.style.removeProperty(name); });
        });
        forkGalUncover = null;
    };
}

function forkGalEntryPhase(elapsed, ready, revealedAt, shown) {
    if (revealedAt !== null) return elapsed - revealedAt >= 250 ? 'ready' : 'revealing';
    if (ready) return shown ? 'revealing' : 'ready';
    return elapsed >= 10000 ? 'slow' : elapsed >= 300 ? 'loading' : 'pending';
}

// private fork (perf round 3): the runtime store whose stage has finished its entry (ready, or shown as slow).
// Speculative work for a stage that is still loading (voice beyond the first page and its status polling,
// adjacent-turn presentation reads) waits for it, so it does not compete with the reveal for the browser's
// six connections or for the main thread while the figures are built.
const forkGalEntryShown = (() => {
    let shown = null;
    const listeners = new Set();
    return {
        get: () => shown,
        set(store) { if (shown === store) return; shown = store; listeners.forEach(listener => listener()); },
        // The stage unmounted (closed, possibly before it was shown): waiters re-check.
        release(store) { if (shown === store) shown = null; listeners.forEach(listener => listener()); },
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        // Resolves once `store`'s stage is shown, or right away when no stage of it is opening.
        wait(store, opening) {
            if (shown === store || !opening()) return Promise.resolve();
            return new Promise(resolve => { const stop = this.subscribe(() => { if (shown === store || !opening()) { stop(); resolve(); } }); });
        }
    };
})();

// private fork (perf r5): how long a ready backdrop and text box wait for figures that are still loading before the
// entry reveals without them. Warm opens build their figures within this, so they still reveal complete; a cold
// Live2D bundle (model, textures and every expression/motion file) can take seconds, and those figures fade in later.
const FORK_GAL_FIGURE_GRACE_MS = 300;
// The entry may reveal while only figure groups are outstanding: the scene shows the backdrop and the text box, and
// each figure fades in once its own resources and model are ready.
function forkGalEntryBackdropSettled(state) {
    if (!state.pending.projection && !state.pending.resources) return true;
    const projection = state.projection;
    return !!projection?.figureKeys && projection.outstanding.every(key => key.startsWith('figure:'));
}

// One entry gate, not a new persistent stage state. Later turns keep the existing
// incremental group presentation and one-shot ledger; only the first reveal waits.
function useForkGalEntry(store, rootRef) {
    const [phase, setPhase] = React.useState('pending');
    const presented = React.useRef(-1), backdrop = React.useRef(-1);
    React.useEffect(() => {
        const start = performance.now();
        let timer, shown = false, revealedAt = null, stopped = false, backdropAt = null;
        function poll() {
            if (stopped) return;
            const state = store.getSnapshot(), root = rootRef.current, elapsed = performance.now() - start;
            const images = root ? [...root.querySelectorAll('.fork-gal-box img, .fork-gal-standins img')] : [];
            const revision = state.accepted.presentationRevision;
            // Audio may wait indefinitely for an autoplay gesture; only visual resources gate entry.
            const base = !!state.source && forkGalEntryBackdropSettled(state) && !!root?.querySelector('.fork-gal-box') &&
                document.fonts.status !== 'loading' && images.every(image => image.complete && image.naturalWidth > 0);
            const complete = base && !state.pending.projection && !state.pending.resources && presented.current === revision;
            // A figure group committing during the grace bumps the revision; the backdrop already on screen still counts.
            if (!base) backdropAt = null;
            else if (backdrop.current === revision || presented.current === revision) backdropAt ??= elapsed;
            const ready = complete || base && backdropAt !== null && elapsed - backdropAt >= FORK_GAL_FIGURE_GRACE_MS;
            const next = forkGalEntryPhase(elapsed, ready, revealedAt, shown);
            if (next === 'revealing' && revealedAt === null) revealedAt = elapsed;
            shown ||= next === 'loading' || next === 'slow';
            setPhase(next);
            if (next === 'ready' || next === 'slow') forkGalEntryShown.set(store);
            if (next !== 'ready') timer = setTimeout(poll, 32);
        }
        poll();
        return () => { stopped = true; clearTimeout(timer); forkGalEntryShown.release(store); };
    }, [store]);
    const onPresented = React.useCallback(revision => { presented.current = revision; }, []);
    const onBackdrop = React.useCallback(revision => { backdrop.current = revision; }, []);
    return {phase, onPresented, onBackdrop, visible:phase === 'ready' || phase === 'slow'};
}

function ForkGalEntryOverlay(props) {
    const h = React.createElement;
    return h('div', {className:'fork-gal-entry-overlay', role:props.phase === 'loading' || props.phase === 'slow' ? 'status' : undefined,
        'aria-hidden':props.phase === 'pending' || props.phase === 'ready' || undefined,
        onClick:event => event.stopPropagation(), onWheel:event => event.stopPropagation()},
        h(ForkSpinner, {delay:0, className:'fork-gal-entry-spinner'}),
        h('span', null, props.phase === 'slow' ? '\u4ecd\u5728\u8f7d\u5165\u2026' : '\u6b63\u5728\u8f7d\u5165\u2026'));
}
