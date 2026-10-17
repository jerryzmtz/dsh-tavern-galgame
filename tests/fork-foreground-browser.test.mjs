// private fork: isolated real WebGL/WebAudio test, no DSH RPC, credentials or live data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {browserReactScript} from './fixtures/browser-react.mjs';
const client = name => readFile(new URL('../tavern-plugin/src/client/' + name, import.meta.url), 'utf8');
test('foreground controller stops PIXI rendering, media, contexts, RAF and timers without catch-up', {timeout:30000}, async t => {
    const browser = await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required','--mute-audio']});
    t.after(() => browser.close());
    const page=await browser.newPage(); const errors=[];
    page.on('pageerror',error=>errors.push(String(error)));
    await page.setContent('<!doctype html><div id="stage"></div><div id="mini"></div><iframe srcdoc="<input autofocus>"></iframe>');
    await page.addScriptTag({path:new URL('../tavern-plugin/lib/vendor/runtime-assets/live2d/pixi.min.js',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')});
    await page.addScriptTag({content:await client('fork-foreground.js')});
    await page.addScriptTag({content:'const rpc=async()=>{throw Error("offline")};\n'+(await Promise.all(['fork-stage-audio-math.js','fork-stage-audio.js','fork-stage-music.js'].map(client))).join('\n')});
    const stageSource = await client('fork-gal-stage.js');
    const typewriter = stageSource.slice(stageSource.indexOf('function ForkGalTypewriter(props)'), stageSource.indexOf('// Dialogue box dressing'));
    await page.addScriptTag({content:await browserReactScript() + '\nconst React=modules.react;\n' + typewriter});
    await page.evaluate(async () => {
        window.focused=true;
        Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>window.focused});
        forkForeground.refresh();
        window.apps=[]; window.counts={frames:[0,0],renders:[0,0],ticks:0,raf:0,timeout:0};
        const prose=document.createElement('div'); prose.id='prose'; document.body.appendChild(prose);
        modules['react-dom/client'].createRoot(prose).render(React.createElement(ForkGalTypewriter,{text:'abcdefghijklmnopqrstuvwxyz'.repeat(4),speed:45}));
        for (const [i,id] of ['stage','mini'].entries()) {
            const app=new PIXI.Application({width:64,height:64,forceCanvas:false});
            document.getElementById(id).appendChild(app.view);
            app.stage.addChild(new PIXI.Graphics().beginFill(0xeebb44).drawCircle(32,32,20).endFill());
            app.ticker.add(()=>counts.frames[i]++);
            app.renderer.on('postrender',()=>counts.renders[i]++);
            forkForeground.application(app); apps.push(app);
        }
        // Generated 12s PCM, long enough to verify seek positions without external media.
        const sampleRate=8000, size=sampleRate*12*2, bytes=new ArrayBuffer(44+size), v=new DataView(bytes);
        const text=(at,s)=>[...s].forEach((c,i)=>v.setUint8(at+i,c.charCodeAt(0)));
        text(0,'RIFF'); v.setUint32(4,36+size,true); text(8,'WAVE'); text(12,'fmt '); v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true); v.setUint32(24,sampleRate,true); v.setUint32(28,sampleRate*2,true); v.setUint16(32,2,true); v.setUint16(34,16,true); text(36,'data'); v.setUint32(40,size,true);
        for(let i=0;i<size/2;i++)v.setInt16(44+i*2,Math.sin(i*2*Math.PI*220/sampleRate)*2000,true);
        window.audioUrl=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));
        window.nodes=[];
        for(const layer of ['music','ambience','sfx','voice']) {
            const node=new Audio(audioUrl); node.loop=true;
            forkStageAudio.bind(node,layer,audioUrl); nodes.push(node); await node.play();
        }
        window.uiContext=new AudioContext(); const gain=uiContext.createGain(); gain.connect(uiContext.destination);
        const oscillator=uiContext.createOscillator(); oscillator.connect(gain); oscillator.start();
        forkForeground.context(uiContext,gain); await uiContext.resume();
        forkForeground.setInterval(()=>counts.ticks++,50);
        function frame(){counts.raf++;forkForeground.requestAnimationFrame(frame)} frame();
        // private fork: the typewriter lays out the whole line; only the revealed glyphs count as typed text.
        window.snapshot=()=>({text:[...document.querySelectorAll('#prose .fork-gal-type > :not(.fork-gal-type-rest)')].map(n=>n.textContent).join(''),counts:structuredClone(counts),positions:nodes.map(n=>n.currentTime),paused:nodes.map(n=>n.paused),context:uiContext.state,state:forkForeground.state(),clock:forkForeground.now()});
    });
    await page.waitForTimeout(350);
    const active=await page.evaluate(()=>snapshot());
    assert.ok(active.counts.frames.every(n=>n>3)); assert.ok(active.positions.every(n=>n>0));
    // Blur without visibility loss (the Electron alt-tab case), then hold for many normal frames.
    await page.evaluate(()=>{window.focused=false;dispatchEvent(new Event('blur'));});
    await page.waitForTimeout(380);
    const paused=await page.evaluate(()=>{forkForeground.setTimeout(()=>counts.timeout++,300);return snapshot()});
    await page.waitForTimeout(500);
    const held=await page.evaluate(()=>{apps.forEach(app=>{app.ticker.update(performance.now());app.render()});return snapshot()});
    assert.equal(held.state.foreground,false); assert.deepEqual(held.counts,paused.counts,'zero PIXI frames/renders, RAF or timer callbacks in background');
    assert.equal(held.text,paused.text,'production React typewriter retains its exact character');
    assert.deepEqual(held.positions,paused.positions); assert.ok(held.paused.every(Boolean));
    assert.equal(held.context,'suspended'); assert.ok(held.state.audioContexts.every(s=>s==='suspended'));
    assert.equal(held.clock,paused.clock);
    await page.evaluate(()=>{window.focused=true;dispatchEvent(new Event('focus'));});
    await page.waitForTimeout(180);
    const resumed=await page.evaluate(()=>snapshot());
    assert.equal(resumed.state.foreground,true); assert.equal(resumed.context,'running'); assert.equal(resumed.counts.timeout,0);
    assert.ok(resumed.counts.frames.every((n,i)=>n>held.counts.frames[i]));
    assert.ok(resumed.text.startsWith(held.text) && resumed.text.length>held.text.length && resumed.text.length-held.text.length<7,'typewriter continues without replay or catch-up');
    assert.ok(resumed.positions.every((n,i)=>n>=held.positions[i]&&n-held.positions[i]<0.4),'audio continues from paused position');
    await page.waitForTimeout(180); assert.equal(await page.evaluate(()=>counts.timeout),1);
    // Hidden/minimized signal is immediate, rather than waiting for blur debounce.
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
    await page.waitForTimeout(60); const hidden=await page.evaluate(()=>snapshot());
    await page.waitForTimeout(250); assert.deepEqual((await page.evaluate(()=>snapshot())).counts,hidden.counts);
    await page.evaluate(()=>{delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));});
    // Native document focus, including an iframe, and CDP focus emulation use the same predicate.
    await page.evaluate(()=>{delete document.hasFocus;document.querySelector('iframe').contentWindow.focus();});
    const cdp=await page.context().newCDPSession(page);
    await cdp.send('Emulation.setFocusEmulationEnabled',{enabled:true});
    await page.evaluate(()=>{dispatchEvent(new Event('blur'));forkForeground.refresh();});
    await page.waitForTimeout(350);
    assert.equal(await page.evaluate(()=>forkForeground.state().foreground),true);
    assert.deepEqual(errors,[]);
    t.diagnostic('two real PIXI WebGL apps: 0 background frames/renders; four media layers paused at position; mixer + UI contexts suspended; RAF/interval/timeout frozen; CDP focus emulation foreground');
});

test('private fork: installed host thinking shimmer stays running outside stage on blur/hidden and mutations', { timeout: 30000, skip: !process.env.DSH_BOOT_MODULE }, async t => {
    const { pathToFileURL } = await import('node:url');
    const hostSource = await readFile(new URL('../../dsh-client-ui-chat/lib/client.js', pathToFileURL(process.env.DSH_BOOT_MODULE)), 'utf8');
    const literal = [...hostSource.matchAll(/const css\$\d+ = ("(?:\\.|[^"\\])*");/g)].find(match => match[1].includes('_turnStatus{'))?.[1];
    assert.ok(literal, 'installed host thinking CSS found');
    const css = JSON.parse(literal), className = css.match(/\.([\w-]+_turnStatus)\{/)[1];
    const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage({ reducedMotion: 'no-preference' });
    await page.setContent(`<style>${css}\n@keyframes stage-test { to { opacity:.2 } } .stage-test { animation:stage-test 2s linear infinite }</style><span id="thinking" class="${className}">Thinking</span><section class="fork-gal-stage"><span id="stage-animation" class="stage-test">Stage</span></section>`);
    await page.evaluate(() => {
        window.focused = true; window.visible = true;
        Object.defineProperty(document, 'hasFocus', { configurable:true, value: () => focused });
        Object.defineProperty(document, 'visibilityState', { configurable:true, get: () => visible ? 'visible' : 'hidden' });
    });
    await page.addScriptTag({ content: await client('fork-foreground.js') });
    const sample = () => page.evaluate(() => Object.fromEntries(['thinking','stage-animation','new-thinking'].map(id => {
        const el = document.getElementById(id), animation = el?.getAnimations()[0], style = el && getComputedStyle(el);
        return [id, animation && { state:animation.playState, time:animation.currentTime, name:style.animationName, cssPlayState:style.animationPlayState, duration:style.animationDuration }];
    })));
    await page.waitForTimeout(80);
    await page.evaluate(() => { focused=false; dispatchEvent(new Event('blur')); });
    await page.waitForTimeout(400);
    const paused = await sample();
    await page.waitForTimeout(180);
    const later = await sample();
    assert.equal(paused.thinking.state, 'running');
    assert.match(paused.thinking.name, /dsh-turn-status-shimmer/); assert.equal(paused.thinking.duration, '1.8s');
    assert.ok(later.thinking.time > paused.thinking.time);
    assert.equal(later['stage-animation'].state, 'paused'); assert.equal(later['stage-animation'].time, paused['stage-animation'].time);
    await page.evaluate(() => {
        visible=false; document.dispatchEvent(new Event('visibilitychange'));
        const next=document.getElementById('thinking').cloneNode(true); next.id='new-thinking'; document.body.appendChild(next);
    });
    await page.waitForTimeout(100);
    const hidden = await sample();
    assert.equal(hidden.thinking.state, 'running'); assert.equal(hidden['new-thinking'].state, 'running');
    await page.evaluate(() => { visible=true; focused=true; dispatchEvent(new Event('focus')); });
    await page.waitForTimeout(100);
    const resumed=await sample(); assert.equal(resumed['stage-animation'].state, 'running');
    assert.ok(resumed['stage-animation'].time > hidden['stage-animation'].time);
    t.diagnostic(JSON.stringify({ paused, hidden, resumed }));
});
