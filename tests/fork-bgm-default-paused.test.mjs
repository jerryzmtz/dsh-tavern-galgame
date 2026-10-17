// private fork: follow upstream module extraction without weakening behavior assertions.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../tavern-plugin/src/client/fork-bgm-default-paused.js', import.meta.url), 'utf8');
const patch = vm.runInNewContext(source + '\nforkBgmDefaultPaused');
const fixture = `// mitakihara:bgm_follow_story bgm-ball
class s{audioA=new Audio;audioB=new Audio;
active=this.audioA;idle=this.audioB;fadeTween=null;
currentTrack={value:''};isPlaying={value:false};currentTime={value:0};duration={value:0};
crossfadeTo(track){this.currentTrack.value=track;this.active.src=track;this.active.play();this.isPlaying.value=true}
play(){this.active.src?this.active.play():this.crossfadeTo(this.currentTrack.value);this.isPlaying.value=true}
pause(){this.active.pause(),this.isPlaying.value=!1}}
const l=new s,a={value:true},t={value:'A'},i={A:true,B:true},o={watch:(ref,fn)=>{storyWatch=fn;fn(ref.value)}};
let storyWatch;
(0,o.watch)(t,e=>{a.value&&(''!==e?i[e]&&l.crossfadeTo(e):l.pause())},{immediate:!0});
({l,a,storyWatch});`;
function setup() {
    const calls = [];
    class Audio {
        src = ''; paused = true;
        play() { this.paused = false; calls.push(this.src); }
        pause() { this.paused = true; }
        removeAttribute(name) { if (name === 'src') this.src = ''; }
    }
    return { ...vm.runInNewContext(patch({content:fixture}), { Audio }), calls };
}
test('loading selects the story track but never starts audio; explicit play still works', () => {
    const h=setup(); assert.equal(h.l.currentTrack.value,'A'); assert.equal(h.l.isPlaying.value,false); assert.deepEqual(h.calls,[]);
    h.l.play(); assert.deepEqual(h.calls,['A']); assert.equal(h.l.isPlaying.value,true);
    h.storyWatch('B'); assert.deepEqual(h.calls,['A','B']);
});
test('paused story changes stay silent and resume the new track on demand', () => {
    const h=setup(); h.l.play(); h.l.pause(); h.storyWatch('B');
    assert.equal(h.l.isPlaying.value,false); assert.deepEqual(h.calls,['A']); assert.equal(h.l.currentTrack.value,'B');
    h.l.play(); assert.deepEqual(h.calls,['A','B']);
    h.storyWatch(''); assert.equal(h.l.isPlaying.value,false);
    assert.equal(h.l.audioA.paused,true); assert.equal(h.l.audioB.paused,true);
});
test('pause during a crossfade stops both channels and retains the target for resume', () => {
    const h=setup(); let killed=false;
    h.l.audioA.play(); h.l.audioB.src='B'; h.l.audioB.play(); const target=h.l.idle;
    h.l.fadeTween={kill(){killed=true;}}; h.l.pause();
    assert.equal(killed,true); assert.equal(h.l.fadeTween,null); assert.equal(h.l.active,target);
    assert.equal(h.l.audioA.paused,true); assert.equal(h.l.audioB.paused,true);
    h.l.play(); assert.equal(h.calls.at(-1),'B');
});
test('refresh starts paused; follow preference is neither cleared nor overwritten', () => {
    const h=setup(); h.l.play(); const fresh=setup(); assert.deepEqual(fresh.calls,[]); assert.equal(fresh.a.value,true);
    fresh.a.value=false; fresh.storyWatch('B'); assert.equal(fresh.l.currentTrack.value,'A');
});
test('patch is in-memory, idempotent, and fails closed on unknown or ambiguous source', () => {
    const script={content:fixture}; const changed=patch(script);
    assert.notEqual(changed,fixture); assert.equal(script.content,fixture); assert.equal(patch({content:changed}),changed);
    for (const content of ['unrelated',fixture.replace('mitakihara:bgm_follow_story','other'),fixture.replace('this.active.pause()','this.audioA.pause()'),fixture+fixture]) assert.equal(patch({content}),content);
    const main=readFileSync(new URL('../tavern-plugin/src/client/runtime/helper-host.js',import.meta.url),'utf8');
    assert.match(main,/content: forkBgmDefaultPaused\(script\)/);
});
