// private fork: real layout must report scaled heights, including zoom-out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from './fixtures/client-vm.mjs' // private fork: foreground document fixture;
import { chromium } from 'playwright';
test('card zoom scales boxes and auto-height without changing authored font sizes', async () => {
    let descriptor;
    vm.runInNewContext(await readFile('tavern-plugin/lib/client.js', 'utf8'), { window: { __ModuleLoader__: { load(value) { descriptor = value; } } }, console });
    const client = descriptor.factory(() => ({}));
    const browser = await chromium.launch(process.platform === 'win32' ? { executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' } : {});
    try {
        for (const width of [390, 900]) {
            const page = await browser.newPage({ viewport: { width, height: 900 } });
            await page.route('**/*', route => route.abort());
            const html = client.buildTavernFrameDocument({ token: 'zoom', content: '<div id="box" style="height:400px;width:100px;font-size:20px">Card</div>', frameZoom: { value: 1.5, ready: true } });
            await page.setContent('<iframe sandbox="allow-scripts" style="width:100%;height:48px;border:0"></iframe>');
            await page.evaluate(html => {
                window.onmessage = e => { if (e.data.type === 'dsh-tavern-frame-height') document.querySelector('iframe').style.height = e.data.height + 'px'; };
                document.querySelector('iframe').srcdoc = html;
            }, html);
            await page.waitForFunction(() => document.querySelector('iframe').clientHeight === 600);
            const frame = page.frames()[1];
            assert.equal(await frame.locator('#box').evaluate(node => node.getBoundingClientRect().width), 150);
            assert.equal(await frame.locator('#box').evaluate(node => getComputedStyle(node).fontSize), '20px');
            await page.evaluate(() => document.querySelector('iframe').contentWindow.postMessage({ type: 'dsh-fork-frame-zoom', token: 'wrong', zoom: 0.6 }, '*'));
            await page.waitForTimeout(50);
            assert.equal(await frame.evaluate(() => document.documentElement.style.zoom), '1.5');
            await page.evaluate(() => document.querySelector('iframe').contentWindow.postMessage({ type: 'dsh-fork-frame-zoom', token: 'zoom', zoom: 0.6 }, '*'));
            await page.waitForFunction(() => document.querySelector('iframe').clientHeight === 240);
            assert.equal(await frame.locator('#box').evaluate(node => node.getBoundingClientRect().width), 60);
            await page.close();
        }
    } finally { await browser.close(); }
});
