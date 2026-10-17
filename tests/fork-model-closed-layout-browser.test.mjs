import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {browserReactScript} from './fixtures/browser-react.mjs';
import {forkThemeCss} from './helpers/fork-theme-css.mjs';

const source = readFileSync(new URL('../tavern-plugin/packages/dsh-tavern-ui/src/fork-model-control.js', import.meta.url), 'utf8');

test('closed model popover never measures the suspended chat on portal scroll; open positioning still works', async () => {
    const browser = await chromium.launch({headless:true});
    try {
        const page = await browser.newPage({viewport:{width:1200,height:800}});
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setContent('<div data-dsh-fork-session="play" style="display:contents"><main><div id="model"></div><div id="transcript"></div></main></div><div id="backlog" style="height:200px;overflow:auto"><div style="height:2000px">History</div></div>');
        await page.addStyleTag({content:await forkThemeCss()});
        await page.addScriptTag({content:await browserReactScript() + `
            const React=modules.react,ReactDOM={...modules['react-dom'],...modules['react-dom/client']};
            const forkPortal=node=>ReactDOM.createPortal(node,document.body);
            ${source}
            const state={status:'ready',current:{provider:'provider',model:'model'},groups:[{id:'provider',models:[{id:'model',name:'Model'}]}]};
            document.querySelector('#transcript').innerHTML='<p>'+('<span>Transcript </span>'.repeat(20000))+'</p>';
            ReactDOM.flushSync(()=>ReactDOM.createRoot(document.querySelector('#model')).render(React.createElement(ForkModelControl,{
                available:true,directory:{subscribe:()=>()=>{},getSnapshot:()=>state},load:()=>{},select:()=>Promise.resolve(true)
            })));
            const trigger=document.querySelector('.fork-model-trigger'),read=trigger.getBoundingClientRect.bind(trigger);
            window.reads=0;trigger.getBoundingClientRect=()=>{window.reads++;return read()};
        `});
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await page.evaluate(() => {
            document.documentElement.setAttribute('data-fork-gal-stage', '');
            window.reads = 0;
            document.querySelector('#backlog').scrollTop = 1000;
            document.querySelector('#backlog').dispatchEvent(new Event('scroll'));
            window.dispatchEvent(new Event('resize'));
        });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await page.evaluate(() => window.reads), 0, 'closed popover must not force layout inside content-visibility:hidden');
        assert.equal(await page.locator('#transcript span').count(), 20000, 'chat stays mounted');
        await page.evaluate(() => {
            document.documentElement.removeAttribute('data-fork-gal-stage');
            document.querySelector('.fork-model-trigger').click();
        });
        assert.equal(await page.locator(':popover-open').count(), 1);
        await page.evaluate(() => {window.reads=0;window.dispatchEvent(new Event('resize'));});
        assert.ok(await page.evaluate(() => window.reads > 0), 'open popover still measures its anchor');
        assert.ok(await page.locator(':popover-open').evaluate(node => Boolean(node.style.left && node.style.top)), 'open popover is positioned');
        await page.evaluate(() => document.querySelector(':popover-open').hidePopover());
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await page.evaluate(() => {window.reads=0;window.dispatchEvent(new Event('scroll'));});
        assert.equal(await page.evaluate(() => window.reads), 0, 'closing restores the no-layout path');
        assert.deepEqual(errors, []);
    } finally {
        await browser.close();
    }
});
