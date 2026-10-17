'use strict';

// private fork: canonical reading pages, independent of font, viewport and film cards.
const STAGE_PAGE_CHARS = 130;
function stagePagePlain(text) {
    return String(text || '')
        .replace(/<[^>]+>/g, '')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/^\s{0,3}(#{1,6}|>|[-*+]\s)\s*/gm, '')
        .replace(/(\*\*|__|~~|`)/g, '')
        .replace(/(^|[^*])\*(?!\s)([^*\n]+)\*/g, '$1$2')
        .replace(/^\s*[-*_]{3,}\s*$/gm, '')
        .trim();
}
function stageBlockPages(block) {
    const plain = stagePagePlain(block), pages = [];
    if (!plain) return pages;
    if (plain.length <= STAGE_PAGE_CHARS) return [plain];
    const sentences = plain.match(/[^\u3002\uff01\uff1f!?\u2026\n]+[\u3002\uff01\uff1f!?\u2026\u300d\u300f\uff09)\n]*|[^\u3002\uff01\uff1f!?\u2026\n]+$/g) || [plain];
    let buffer = '';
    for (const sentence of sentences) {
        if (buffer && (buffer + sentence).length > STAGE_PAGE_CHARS) { pages.push(buffer.trim()); buffer = ''; }
        buffer += sentence;
    }
    if (buffer.trim()) pages.push(buffer.trim());
    return pages;
}
// Both raw display units and parsed UI units use this path. Dialogue is always one page;
// only narration is plain/paginated, so names, moods and bubble syntax cannot add pages.
function stagePageCards(unit, paginate = stageBlockPages) {
    if (unit.kind !== 'narration') return [{text: unit.text, offset: 0}];
    const block = unit.block ?? unit.text, plain = stagePagePlain(block);
    let offset = 0;
    return paginate(block).map(text => {
        const start = Math.max(offset, plain.indexOf(text, offset));
        offset = start + text.length;
        return {text, offset: start};
    });
}
function stagePageIndex(displayUnits) {
    const pages = [], firstPageByPara = {};
    for (const [ordinal, unit] of displayUnits.entries()) {
        const para = ordinal + 1;
        for (const card of stagePageCards(unit)) {
            if (!Object.hasOwn(firstPageByPara, para)) firstPageByPara[para] = pages.length;
            pages.push({page: pages.length, para, offset: card.offset});
        }
    }
    return {version: 1, pages, firstPageByPara};
}
function stagePageAtAnchor(index, {para, offset}) {
    if (index?.version !== 1 || !Number.isSafeInteger(para) || !Number.isSafeInteger(offset) || offset < 0) return null;
    let page = null;
    for (const candidate of index.pages) {
        if (candidate.para === para && candidate.offset <= offset) page = candidate.page;
        if (candidate.para > para || candidate.para === para && candidate.offset > offset) break;
    }
    return page;
}

if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {STAGE_PAGE_CHARS, stagePagePlain, stageBlockPages, stagePageCards, stagePageIndex, stagePageAtAnchor};
