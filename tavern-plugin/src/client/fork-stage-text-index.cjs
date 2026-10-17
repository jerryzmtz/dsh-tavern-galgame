'use strict';

// private fork: display-only index; its helpers are the same pure functions used by chat.
// No script execution, voice handles, React publication or host mutations enter this path.
function createStageTextIndex(helpers) {
    let cachedParts = new Map(), cachedTurns = new Map(), snapshot = new Map(), revision = 0;
    const hydrated = new Map();
    const pageCards = typeof stagePageCards === 'function' ? stagePageCards : require('./fork-stage-page-index.cjs').stagePageCards;
    let activeBranch = null, activeHistory = null;
    const {parse, paragraphs, displayUnits, paginate, turnIndex, projectionForTurn, projectionParts, storyTurn, superseded} = helpers;

    function partFor(node, turn, index, text, streaming, branchId, projected) {
        const key = JSON.stringify([branchId, node.id, index]);
        const previous = cachedParts.get(key);
        if (previous && previous.text === text && previous.streaming === streaming && previous.turn === turn && previous.order === node.anchorSeq) return previous;
        const appending = previous && text.startsWith(previous.text);
        let sealedLength = appending ? previous.sealedLength : 0;
        let sealedSegments = appending ? previous.sealedSegments : [];
        const tail = text.slice(sealedLength);
        const boundaries = [...tail.matchAll(/\n\s*\n/g)];
        if (boundaries.length) {
            const boundary = boundaries.at(-1), length = boundary.index + boundary[0].length;
            sealedSegments = sealedSegments.concat(parse(tail.slice(0, length), false));
            sealedLength += length;
        }
        const segments = sealedSegments.concat(parse(text.slice(sealedLength), streaming));
        const presented = paragraphs([{segments, streaming}]);
        // Final identity comes from the host's reader, never a reconstruction of parsed speech.
        // Streaming keeps provisional paragraphs until the final projection is available.
        const canonical = streaming ? null : displayUnits([{kind: 'markdown', text}]);
        const units = (canonical || presented).map((source, ordinal) => {
            const unit = presented[ordinal];
            if (canonical && (!unit || source.kind !== unit.kind)) throw new Error('Unaligned stage display paragraphs');
            return {...unit, source: canonical ? source : null,
                paragraphId: JSON.stringify([branchId, node.id, index, ordinal]),
                segment: segments[unit.index]};
        });
        const localPages = units.flatMap((unit, ordinal) => {
            const oldUnit = previous?.units[ordinal];
            if (oldUnit && !oldUnit.pending && oldUnit.segment?.speech === unit.segment?.speech &&
                ['kind', 'block', 'text', 'alias', 'name', 'mood', 'thought', 'pending'].every(key => oldUnit[key] === unit[key])) {
                unit.cards = oldUnit.cards;
                return unit.cards;
            }
            const cards = pageCards(unit, paginate);
            return unit.cards = cards.map(({text, offset: start}, n) => {
                return {kind: unit.kind, text, alias: unit.alias, name: unit.name, mood: unit.mood,
                    thought: unit.thought, pending: unit.pending && n === cards.length - 1,
                    voice: stageVoiceDescriptor(unit),
                    anchor: {paragraphId: unit.paragraphId, para: unit.para, offset: start}};
            });
        });
        // Preserve sealed pages by reference on append. Only the active tail is repaginated.
        if (previous && text.startsWith(previous.text)) {
            for (let i = 0; i < localPages.length; i++) {
                const old = previous.localPages[i];
                if (old && !old.pending && JSON.stringify(old) === JSON.stringify(localPages[i])) localPages[i] = old;
            }
        }
        return {scope: key, turn, index, order: node.anchorSeq, nodeId: node.id, nativeTurn: node.nativeTurn,
            projected, text, streaming, sealedLength, sealedSegments, segments, units, localPages};
    }

    function reconcile({chat, view, branchId}) {
        // private fork (B2b): historyWindow.revision is the chat's storage revision; saving reading progress or playback
        // metadata bumps it without changing any earlier turn's text. Loaded early turns stay (the branch id and the
        // regenerated-turn mapping are what change a turn's text).
        const history = JSON.stringify(view?.regeneratedDshTurns || null);
        if (activeBranch !== branchId || activeHistory !== history) {
            hydrated.clear(); cachedTurns = new Map(); activeBranch = branchId; activeHistory = history;
        }
        const unloaded = new Set();
        const parts = [], nextParts = new Map(), projectedTurns = new Set();
        const nodes = Array.from(chat?.nodes?.values() || []).filter(node => node.kind === 'assistant-step')
            .sort((a, b) => (a.anchorSeq || 0) - (b.anchorSeq || 0) || String(a.id).localeCompare(String(b.id)));
        const represented = new Set();
        for (const node of nodes) {
            const nativeTurn = Number(node.location?.turn?.turn) || 0;
            const turn = storyTurn(view, nativeTurn);
            if (superseded(view, nativeTurn, turn) || /^tavern-seed-trajectory:v1:.+:2$/.test(String(node.data.finalNode?.messageId || ''))) continue;
            const streaming = node.data.status === 'running';
            const projection = streaming ? null : projectionForTurn(view, turn);
            if (view?.historyWindow && !projection && !streaming && turn < Number(view.latestAssistantTurn)) {
                represented.add(turn); unloaded.add(turn); continue;
            }
            represented.add(turn);
            if (projection && projectedTurns.has(turn)) continue;
            if (projection) projectedTurns.add(turn);
            // A host projection describes the entire story turn, not each native step.
            const selected = projection ? projectionParts(projection) : (node.data.blocks || []).map(block => block?.kind === 'text' ? {kind: 'markdown', text: block.text} : null);
            selected.forEach((part, index) => {
                if (part?.kind !== 'markdown') return;
                const value = partFor({...node, nativeTurn}, turn, index, String(part.text || ''), streaming, branchId, !!projection);
                nextParts.set(value.scope, value); parts.push(value);
            });
        }
        // Greeting/imported projections need no native assistant component (or native node).
        for (const projection of view?.replyProjections || []) {
            const turn = Number(projection.turn);
            if (represented.has(turn) || projectionForTurn(view, turn) !== projection || superseded(view, Number(view?.regeneratedDshTurns?.[turn]) || turn, turn)) continue;
            const node = {id: 'projection:' + turn, nativeTurn: Number(view?.regeneratedDshTurns?.[turn]) || turn, anchorSeq: 0};
            projectionParts(projection).forEach((part, index) => {
                if (part.kind !== 'markdown') return;
                const value = partFor(node, turn, index, String(part.text || ''), false, branchId, true);
                nextParts.set(value.scope, value); parts.push(value);
            });
            represented.add(turn);
        }
        const grouped = turnIndex(parts), nextTurns = new Map();
        // Keep HTML-only turns selectable, but explicitly without readable text.
        for (const turn of represented) if (!grouped.has(turn)) grouped.set(turn, []);
        for (const [turn, items] of grouped) {
            if (unloaded.has(turn) && hydrated.has(turn)) { nextTurns.set(turn, hydrated.get(turn)); continue; }
            const old = cachedTurns.get(turn);
            if (old && old.unloaded === unloaded.has(turn) && old.parts.length === items.length && items.every((part, i) => part === old.parts[i])) {
                nextTurns.set(turn, old); continue;
            }
            let base = 0;
            const pages = [], units = [];
            for (const part of items) {
                // Speech identity survives loading history without the live node/block layout.
                for (const unit of part.units) units.push({...unit, para: base + unit.para, voiceLine:[part.nativeTurn,base + unit.para - 1]});
                for (const page of part.localPages) {
                    const para = base + page.anchor.para;
                    const oldPage = old?.text.pages[pages.length];
                    pages.push(oldPage && oldPage.local === page && oldPage.anchor.para === para ? oldPage
                        : {...page, local: page, anchor: {...page.anchor, para}, voice:page.voice && {...page.voice,lineIdentity:[part.nativeTurn,para - 1]}});
                }
                base += part.units.length;
            }
            const text = {revision: ++revision, streaming: items.some(part => part.streaming), pages,
                hasReadableText: pages.some(page => page.text.length > 0),
                // C compares these numbered display units to its validated host units before accepting direction.
                units: units.map(unit => ({para: unit.para, paragraphId: unit.paragraphId, kind: unit.kind,
                    ...(unit.source || {kind: unit.kind, text: unit.kind === 'narration' ? unit.block.trim() : unit.text,
                        alias: unit.alias, name: unit.name})}))};
            nextTurns.set(turn, {turn, unloaded: unloaded.has(turn), parts: items, units, text, nativeTurn: items[0]?.nativeTurn || Number(view?.regeneratedDshTurns?.[turn]) || turn});
        }
        cachedParts = nextParts;
        const unchanged = snapshot.size === nextTurns.size && [...nextTurns].every(([turn, value]) => snapshot.get(turn) === value);
        cachedTurns = nextTurns;
        if (!unchanged) snapshot = nextTurns;
        return snapshot;
    }
    // private fork: consume canonical units separately; never reconstruct a markdown reply.
    function ingest(turn, sources) {
        const row = snapshot.get(turn);
        if (!row || !Array.isArray(sources) || sources.some(source => !source ||
            !['line','narration'].includes(source.kind) || typeof source.text !== 'string')) return null;
        const units = [], pages = [], segments = [];
        for (const [ordinal, source] of sources.entries()) {
            const parsed = source.kind === 'line' ? parse(source.text, false) : [{kind:'markdown',text:source.text}];
            const presented = paragraphs([{segments:parsed,streaming:false}])[0];
            if (!presented || presented.kind !== source.kind) return null;
            const paragraphId = JSON.stringify([activeBranch, turn, 'display', ordinal]);
            const unit = {...presented, para:ordinal + 1, paragraphId, source, segment:parsed[presented.index],voiceLine:[row.nativeTurn,ordinal]};
            units.push(unit); segments.push(...parsed);
            for (const {text, offset: start} of pageCards(unit, paginate)) {
                pages.push({kind:unit.kind,text,alias:unit.alias,name:unit.name,mood:unit.mood,thought:unit.thought,
                    pending:false,voice:stageVoiceDescriptor(unit),anchor:{paragraphId,para:unit.para,offset:start}});
            }
        }
        const parts = [{scope:JSON.stringify([activeBranch,turn,'display']),turn,index:0,order:0,
            nativeTurn:row.nativeTurn,projected:true,streaming:false,segments,units,localPages:pages}];
        const value = {...row,unloaded:false,emptyHistory:sources.length === 0,parts,units,text:{revision:++revision,streaming:false,pages,
            hasReadableText:pages.some(page => page.text.length > 0),
            units:units.map(unit => ({...unit.source,para:unit.para,paragraphId:unit.paragraphId}))}};
        hydrated.delete(turn); hydrated.set(turn,value);
        while (hydrated.size > 200) hydrated.delete(hydrated.keys().next().value);
        return value;
    }
    return {reconcile, ingest, touch(turn) {
        const row = hydrated.get(turn);
        if (row) {hydrated.delete(turn); hydrated.set(turn,row);}
    }, getSnapshot: () => snapshot, clear() {hydrated.clear(); activeBranch = null; cachedParts = new Map(); cachedTurns = new Map(); snapshot = new Map();}};
}

function stageVoiceDescriptor(unit, settings) {
    if (unit.kind !== 'line' || unit.pending || !unit.segment) return null;
    const segment = unit.segment;
    return {paragraphId: unit.paragraphId, lineIdentity:unit.voiceLine, alias: segment.alias, name: segment.name, mood: segment.mood,
        text: segment.text, speech: segment.speech ?? segment.text, thought: !!segment.thought,
        cardPath: settings?.cardPath || '', character: (typeof forkBubbleCharacter === 'function' ? forkBubbleCharacter : require('./fork-bubble-line.cjs').forkBubbleCharacter)(settings?.config,segment) || null};
}

if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStageTextIndex, stageVoiceDescriptor};
