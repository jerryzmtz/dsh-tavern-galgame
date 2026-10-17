// Run with the installed DSH ui-chat client.js path as the first argument.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const host = await readFile(process.argv[2], 'utf8');
const css = [...host.matchAll(/const css(?:\$\d+)? = ("[^\n]+");/g)].map(match => JSON.parse(match[1])).find(value => value.includes('_turnStatus{'));
assert.ok(css, 'use the real host status CSS, not a recreated animation');
const statusClass = css.match(/\.([\w-]+_turnStatus)\{/)[1];
const fork = await readFile(new URL('../../tavern-plugin/lib/client-assets/fork-theme.css', import.meta.url), 'utf8');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
    const page = await browser.newPage({ viewport: { width: 500, height: 180 } });
    await page.setContent(`<style>${css}\n${fork}\nbody{--dsw-static-deepseek-500:#416eff;--dsw-static-deepseek-200:#b9ccff;--dsw-font-s-strong-14:600 24px/32px sans-serif;--dsh-content-font-size:24px;--dsw-alias-label-caption:#888;background:Canvas;color:CanvasText}#control{color:var(--dsw-static-deepseek-500)}</style><body class="dsh-tavern-shell-active"><div role="status" class="${statusClass}">深度求索中...<span class="${statusClass}Clock">15s</span></div><span id="control">control</span></body>`);
    const status = page.getByRole('status');
    for (const [scheme, accent, expected] of [['light','#e91e63','rgb(233, 30, 99)'], ['dark','#2dd4bf','rgb(45, 212, 191)'], ['light','#416eff','rgb(65, 110, 255)']]) {
        await page.evaluate(({scheme,accent}) => { document.body.style.colorScheme=scheme; document.body.style.setProperty('--dsw-alias-brand-primary',accent); }, {scheme,accent});
        const result = await status.evaluate(node => {
            const style=getComputedStyle(node);
            return { image:style.backgroundImage, animation:style.animationName, clock:getComputedStyle(node.firstElementChild).webkitTextFillColor, control:getComputedStyle(document.querySelector('#control')).color };
        });
        assert.ok(result.image.includes(expected), result.image);
        assert.match(result.animation,/dsh-turn-status-shimmer/);
        assert.equal(result.clock,'rgb(136, 136, 136)');
        assert.equal(result.control,'rgb(65, 110, 255)', 'the global static palette must stay unchanged');
        const before=await status.screenshot(); await page.waitForTimeout(400); const after=await status.screenshot();
        assert.notDeepEqual(before,after,'shimmer still changes actual rendered frames');
        console.log('PASS',scheme,accent,result.image);
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await status.evaluate(node=>getComputedStyle(node).animationName),'none','preserve the host reduced-motion behavior');
    await page.evaluate(()=>document.body.classList.remove('dsh-tavern-shell-active'));
    assert.ok((await status.evaluate(node=>getComputedStyle(node).backgroundImage)).includes('rgb(65, 110, 255)'));
    console.log('PASS reduced motion and outside-Tavern scope');
} finally { await browser.close(); }
