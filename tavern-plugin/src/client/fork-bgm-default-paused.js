// Private fork: adapt the known Mitakihara BGM companion only in its loaded copy.
function forkBgmDefaultPaused(script) {
    const source = String(script && script.content || "");
    if (!source.includes("mitakihara:bgm_follow_story") || !source.includes("bgm-ball") || !source.includes("class s{audioA=new Audio;audioB=new Audio;")) return source;
    const watch = "(0,o.watch)(t,e=>{a.value&&(''!==e?i[e]&&l.crossfadeTo(e):l.pause())},{immediate:!0})";
    const pause = "pause(){this.active.pause(),this.isPlaying.value=!1}";
    // Fail closed if the card ships a different implementation; never partially patch it.
    if (source.split(watch).length !== 2 || source.split(pause).length !== 2) return source;
    return source.replace(watch,
        "(0,o.watch)(t,e=>{a.value&&(''!==e?i[e]&&(l.isPlaying.value?l.crossfadeTo(e):(l.currentTrack.value=e,l.active.removeAttribute('src'),l.currentTime.value=0,l.duration.value=0)):l.pause())},{immediate:!0})")
        .replace(pause,
        "pause(){if(this.fadeTween){this.fadeTween.kill(),this.fadeTween=null;const e=this.active;this.active=this.idle,this.idle=e}this.audioA.pause(),this.audioB.pause(),this.isPlaying.value=!1}");
}
