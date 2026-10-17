import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { browserReactScript } from './fixtures/browser-react.mjs';
const source = fs.readFileSync(new URL('../tavern-plugin/src/client/text-colors.js', import.meta.url), 'utf8');
test('streamed React text keeps quote highlights valid before the next paint', { timeout: 30000 }, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent('<style>:root{color:#222;--dsw-alias-brand-primary:#e91e63}</style><main></main>');
        await page.addScriptTag({ content: await browserReactScript() + `
            window.React = modules.react;
            window.ReactDOM = modules['react-dom'];
            window.DshUi = { MarkdownText: props => React.createElement('p', null, props.text) };
            window.testRoot = modules['react-dom/client'].createRoot(document.querySelector('main'));
        ` + source });
        const result = await page.evaluate(async () => {
            const render = (text, streaming = true) => ReactDOM.flushSync(() => testRoot.render(React.createElement(TavernColoredMarkdown, { text, streaming })));
            let delayedRefreshes = 0;
            const nativeTimeout = window.setTimeout;
            window.setTimeout = (fn, delay, ...args) => nativeTimeout(() => {
                if (delay === 32) delayedRefreshes++;
                fn(...args);
            }, delay);
            let text = '<ztl> {"date":"2020", "thought":"';
            render(text);
            await new Promise(resolve => setTimeout(resolve, 60));
            // private fork: the first pass on mount is the batched document timer (long chats mount
            // many messages in one commit); only streamed updates must not wait for it.
            delayedRefreshes = 0;
            const missing = [];
            for (let i = 0; i < 20; i++) {
                text += 'x'; render(text);
                // Inspect synchronously after React commits, before a paint or delayed observer refresh.
                const ranges = [...CSS.highlights.values()].flatMap(h => [...h].map(r => r.toString()));
                if (!ranges.includes('"date"')) missing.push(i);
                await new Promise(resolve => requestAnimationFrame(resolve));
            }
            text += '"}</ztl>'; render(text, false);
            const settled = [...CSS.highlights.values()].some(h => [...h].some(r => r.toString() === '"date"'));
            await new Promise(resolve => setTimeout(resolve, 60));
            ReactDOM.flushSync(() => testRoot.unmount());
            window.setTimeout = nativeTimeout;
            return { missing, settled, delayedRefreshes, remaining: CSS.highlights.size, styles: document.querySelectorAll('[data-dsh-tavern-text-colors]').length };
        });
        assert.deepEqual(result, { missing: [], settled: true, delayedRefreshes: 0, remaining: 0, styles: 0 });
    } finally { await browser.close(); }
});

test('many message highlighters share styles and independently release their ranges', { timeout: 60000 }, async () => {
    const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: 'chrome' });
    try {
        const page = await browser.newPage();
        await page.setContent('<style>:root{color:#222;--dsw-alias-brand-primary:#e91e63}</style><main></main>');
        await page.evaluate(source => {
            const api = new Function(source + ';return {installTavernTextColors,findTavernQuoteRanges};')();
            window.api = api;
            document.querySelector('main').innerHTML = Array.from({ length: 160 }, (_, i) => '<div class="message"><p>Text "quote ' + i + '" <em>thought</em><span style="color:red">"author"</span></p></div>').join('');
            window.original = document.querySelector('main').innerHTML;
            window.owners = [...document.querySelectorAll('.message')].map(root => api.installTavernTextColors(root, {}, api.findTavernQuoteRanges));
            window.count = () => [...CSS.highlights.values()].reduce((sum, h) => sum + h.size, 0);
            window.styles = () => document.querySelectorAll('style[data-dsh-tavern-text-colors]').length;
        }, source);
        await page.waitForFunction(() => window.count() === 320);
        assert.deepEqual(await page.evaluate(() => ({ styles: window.styles(), highlights: CSS.highlights.size, unchanged: document.querySelector('main').innerHTML === window.original })), { styles: 1, highlights: 4, unchanged: true });
        await page.evaluate(() => window.owners[0].setColors({ quote: '#123456', em: '#654321' }));
        assert.equal(await page.evaluate(() => window.styles()), 2);
        assert.equal(await page.evaluate(() => window.count()), 320);
        await page.evaluate(() => { window.owners[1].setColors({ quote: '#123456', em: '#654321' }); window.owners[0].setEnabled(false); });
        assert.equal(await page.evaluate(() => window.count()), 318);
        await page.evaluate(() => { window.owners[1].dispose(); window.owners[1].dispose(); });
        assert.equal(await page.evaluate(() => window.count()), 316);
        await page.evaluate(() => { window.owners[0].setColors({}); window.owners[0].setEnabled(true); });
        await page.waitForFunction(() => window.count() === 318);
        assert.equal(await page.evaluate(() => window.styles()), 1);
        await page.evaluate(() => { document.querySelectorAll('.message')[2].querySelector('p').firstChild.data = 'Text "changed" '; });
        await page.waitForFunction(() => [...CSS.highlights.values()].some(h => [...h].some(r => r.toString() === '"changed"')));
        await page.evaluate(() => document.documentElement.style.color = '#eee');
        await page.waitForFunction(() => [...CSS.highlights].filter(([name]) => name.endsWith('-dark')).reduce((sum, [, h]) => sum + h.size, 0) === 318);
        await page.evaluate(() => window.owners.forEach(owner => owner.dispose()));
        assert.deepEqual(await page.evaluate(() => ({ styles: window.styles(), highlights: CSS.highlights.size })), { styles: 0, highlights: 0 });
        for (let i = 0; i < 3; i++) {
            await page.evaluate(() => { window.owner = window.api.installTavernTextColors(document.querySelector('main'), {}, window.api.findTavernQuoteRanges); });
            await page.waitForFunction(() => window.count() === 320);
            await page.evaluate(() => window.owner.dispose());
            assert.equal(await page.evaluate(() => CSS.highlights.size), 0);
        }
    } finally { await browser.close(); }
});

// private fork: opening a long chat mounts every message in one React commit. Changing a
// shared Highlight invalidates document style, so once any highlighter has written, a later
// colour read recalculates the whole page; interleaving reads and writes per message hung a
// 71-round chat (2026-10-03). All reads of the mount pass must precede its first write.
test('mounting a long conversation reads every colour before writing any highlight', { timeout: 60000 }, async () => {
    const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: 'chrome' });
    try {
        const page = await browser.newPage();
        await page.setContent('<style>:root{color:#222;--dsw-alias-brand-primary:#e91e63}</style><main></main>');
        await page.addScriptTag({ content: await browserReactScript() + `
            window.React = modules.react;
            window.ReactDOM = modules['react-dom'];
            window.DshUi = { MarkdownText: props => React.createElement('div', { dangerouslySetInnerHTML: { __html: props.text } }) };
            window.testRoot = modules['react-dom/client'].createRoot(document.querySelector('main'));
        ` + source });
        const messages = 40, paragraphs = 6;
        await page.evaluate(({ messages, paragraphs }) => {
            const log = window.colourLog = [];
            const read = window.getComputedStyle, add = Highlight.prototype.add;
            window.getComputedStyle = function () { log.push('r'); return read.apply(this, arguments); };
            Highlight.prototype.add = function () { log.push('w'); return add.apply(this, arguments); };
            const body = Array.from({ length: paragraphs }, (_, i) => '<p>她说「第' + i + '句」，又想了想<em>算了</em>，“好的”。</p>').join('');
            ReactDOM.flushSync(() => testRoot.render(React.createElement(React.Fragment, null,
                Array.from({ length: messages }, (_, i) => React.createElement(TavernColoredMarkdown, { key: i, text: body, streaming: false })))));
        }, { messages, paragraphs });
        await page.waitForFunction(n => [...CSS.highlights.values()].reduce((sum, h) => sum + h.size, 0) === n, messages * paragraphs * 3);
        const order = await page.evaluate(() => {
            const log = window.colourLog, first = log.indexOf('w');
            return { reads: log.filter(x => x === 'r').length, writes: log.filter(x => x === 'w').length, readsAfterWrite: log.slice(first).filter(x => x === 'r').length };
        });
        assert.ok(order.reads > 0 && order.writes > 0, JSON.stringify(order));
        assert.equal(order.readsAfterWrite, 0, JSON.stringify(order));
        await page.evaluate(() => ReactDOM.flushSync(() => testRoot.unmount()));
        assert.equal(await page.evaluate(() => CSS.highlights.size), 0);
    } finally { await browser.close(); }
});

// private fork (perf: chat open): inside the chat scroller only messages near the viewport are scanned; opening 小圆
// (352 messages) read every message's colours in one ~310 ms task. A far message is scanned once it scrolls near.
test('in the chat scroller only messages near the viewport are scanned; the rest follow when scrolled near', { timeout: 60000 }, async () => {
    const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: 'chrome' });
    try {
        const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
        await page.setContent('<style>:root{color:#222;--dsw-alias-brand-primary:#e91e63}.message{height:200px}</style><div data-conversation-scroll style="height:400px;overflow:auto"></div>');
        await page.evaluate(source => {
            const api = new Function(source + ';return {installTavernTextColors,findTavernQuoteRanges};')();
            const scroller = document.querySelector('[data-conversation-scroll]');
            scroller.innerHTML = Array.from({ length: 100 }, (_, i) => '<div class="message"><p>Text "quote ' + i + '"</p></div>').join('');
            window.owners = [...scroller.querySelectorAll('.message')].map(root => api.installTavernTextColors(root, {}, api.findTavernQuoteRanges));
            window.quoted = () => new Set([...CSS.highlights.values()].flatMap(h => [...h].map(r => r.toString())));
        }, source);
        await page.waitForFunction(() => window.quoted().has('"quote 0"'));
        await new Promise(resolve => setTimeout(resolve, 200));
        const first = await page.evaluate(() => window.quoted().size);
        assert.ok(first >= 8 && first <= 12, 'viewport plus the 1200px margin, not all 100: ' + first);
        await page.evaluate(() => { const s = document.querySelector('[data-conversation-scroll]'); s.scrollTop = s.scrollHeight; });
        await page.waitForFunction(() => window.quoted().has('"quote 99"'));
        assert.equal(await page.evaluate(() => window.quoted().has('"quote 0"')), true, 'a scanned message keeps its highlights');
        await page.evaluate(() => window.owners.forEach(owner => owner.dispose()));
        assert.equal(await page.evaluate(() => CSS.highlights.size), 0);
    } finally { await browser.close(); }
});
