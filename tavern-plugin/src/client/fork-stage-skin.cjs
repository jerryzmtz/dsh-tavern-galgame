'use strict';
// One stage-local adapter; surface tokens and text roles share the validated skin paint.
const stageSkinContract = typeof module !== 'undefined' && typeof window === 'undefined' ? require('../../packages/dsh-presentation-protocol/src/stage-skin.cjs') : null;
// Fonts: the skin's `font` declaration through forkFonts.resolve (user override first; `lead` = a director-applied
// performance skin, whose stage fonts beat the override while it is active, witch-barrier-effects.md §11.6).
function stageSkinFont(document, fonts, theme, part, lead = false) {
    return fonts.resolve('stage',{theme,skin:part === 'title' ? {...document.font,title:document.ui?.titleFont} : document.font || {},part,skinWins:lead || part === 'title'}).family;
}
function stageSkinTokens(document, fonts, theme = 'classic', lead = false) {
    (stageSkinContract?.validateStageSkin || validateStageSkin)(document);
    const p=document.textbox.paint, shape=document.textbox.shape || {}, n=document.nameplate;
    const frame=document.textbox.frame || {}, cornerGap = frame.corners && frame.corners.kind !== 'none' ? 36 : 0;
    const tokens = {'--gal-skin-pad-top':Math.max(cornerGap,frame.top ? (frame.top.offset ?? 9)+(frame.top.height || 14)+6 : 0)+'px',
        '--gal-skin-pad-bottom':Math.max(cornerGap,frame.bottom ? (frame.bottom.offset ?? 9)+(frame.bottom.height || 14)+6 : 0)+'px',
        '--gal-skin-bg':p.bg,'--gal-skin-fg':p.fg,'--gal-skin-muted':p.fgMuted || p.fg,'--gal-skin-accent':document.textStyle?.emphasis || p.accent || p.fg,
        '--gal-skin-border':p.border || p.fg,'--gal-skin-radius':(shape.radius ?? 8)+'px','--gal-skin-border-width':(shape.borderWidth ?? 1)+'px',
        '--gal-skin-name-bg':n.paint.bg,'--gal-skin-name-fg':n.paint.fg,'--gal-skin-name-rotate':(n.rotate || 0)+'deg',
        '--gal-skin-name-radius':n.shape === 'pill' ? '99px' : '2px',
        '--gal-skin-weight':String(document.textStyle?.weight || 400),'--gal-skin-spacing':(document.textStyle?.letterSpacing ?? 0.03)+'em',
        '--gal-skin-line-height':String(document.textStyle?.lineHeight || 1.7),
        '--gal-skin-flash':document.textFx.flash || document.textStyle?.emphasis || p.fg,
        '--gal-skin-stamp-y':document.textFx.from === 'bottom' ? '16px' : '-16px',
        ...stageSkinQuickMenu(document)};
    let spread=0;
    tokens['--gal-skin-rings'] = (shape.rings || []).map(r => `0 0 0 ${spread+=r.width}px ${r.color}`).join(',') || 'none';
    for (const [role,part] of [['body',undefined],['name','name'],['ui','ui']]) tokens['--gal-skin-font-'+role]=stageSkinFont(document,fonts,theme,part,lead);
    // private fork: one skin owns every stage panel; chat and host surfaces stay untouched.
    Object.assign(tokens,stageSkinPanelTokens(document,fonts,theme,false,lead));
    for (const [name,value] of Object.entries({bg:p.bg,bgSolid:p.bg,scrim:p.bg,fg:p.fg,fgMuted:p.fgMuted || p.fg,icon:p.fg,border:p.border || p.fg,accent:tokens['--gal-skin-accent'],
        hover:tokens['--gal-skin-qm-hover'],selected:tokens['--gal-skin-qm-active']})) tokens['--fk-s-stage-textbox-'+name]=value;
    // User font size remains authoritative: authored size is not applied here.
    return tokens;
}
// private fork (owner 2026-10): the quick menu sits directly on the opaque textbox plate - no menu plate. Icons use
// the skin's own ink: the authored quickMenu.fg (else fgMuted/fg) at rest, the accent on hover/toggle, over solid
// accent-tinted chips. Every pair keeps >= 3:1 (WCAG non-text) against the plate or chip it sits on.
function stageSkinQuickMenu(document) {
    const contrast=stageSkinContract?.skinContrast || skinContrast, p=document.textbox.paint, bg=p.bg;
    const mix=(a,b,t) => '#'+[1,3,5].map(i => Math.round(parseInt(a.slice(i,i+2),16)*t+parseInt(b.slice(i,i+2),16)*(1-t)).toString(16).padStart(2,'0')).join('');
    const ok=(ink,paint) => contrast(ink,paint)+1e-6 >= 3;
    const idle=[document.quickMenu?.fg,p.fgMuted,p.fg].find(ink => ink && ok(ink,bg)) || p.fg;
    const on=[document.textStyle?.emphasis,p.accent,p.fg].find(ink => ink && ok(ink,bg)) || p.fg;
    const chip=(t,ink) => {for (let k=t;k>0;k-=.02) {const paint=mix(on,bg,k);if (ok(ink,paint)) return paint;} return bg;};
    const hover=chip(.16,on), active=chip(.24,on);
    return {'--gal-skin-qm-idle':idle,'--gal-skin-qm-on':on,'--gal-skin-qm-hover':hover,'--gal-skin-qm-active':active};
}
function stageSkinPanelTokens(document,fonts,theme,builtin=false,lead=false) {
    const p={...document.textbox.paint,...document.ui}, ink=p.fg;
    const contrast=stageSkinContract?.skinContrast || skinContrast;
    const accent=[p.accent,document.textStyle?.emphasis,ink].find(value=>value && contrast(value,p.bg)>=4.5);
    const onAccent=p.onAccent && contrast(p.onAccent,accent)>=4.5 ? p.onAccent : contrast('#ffffff',accent)>=4.5 ? '#ffffff' : '#000000';
    const surface=p.bg, muted=p.fgMuted || ink, border=p.border || muted;
    // private fork: opaque accent-tinted states, bounded by both body and selected-accent text contrast.
    const mix=(a,b,t)=>'#'+[1,3,5].map(i=>Math.round(parseInt(a.slice(i,i+2),16)*t+parseInt(b.slice(i,i+2),16)*(1-t)).toString(16).padStart(2,'0')).join('');
    const tint=share=>{for(let t=share;t>0;t-=.01){const paint=mix(accent,surface,t);if([ink,accent].every(fg=>contrast(fg,paint)+1e-6>=4.5))return paint;}return surface;};
    const dark=contrast(surface,'#000000')<8, raised=tint(.06),hover=tint(dark?.10:.12),selected=tint(dark?.18:.16);
    const veil=document.ui?.veil;
    const veilColor=veil?.color || (dark?'#040818':'#0f1c46'),opacity=veil?.opacity ?? (dark?.68:.45);
    const dim='rgb('+[1,3,5].map(i=>parseInt(veilColor.slice(i,i+2),16)).join(' ')+' / '+opacity+')';
    return {'--gal-base-bg':surface,'--gal-base-ink':ink,'--gal-base-accent':accent,
        '--gal-ui-surface':surface,'--gal-ui-surface-2':raised,'--gal-ui-dim':dim,
        '--gal-ui-ink':ink,'--gal-ui-ink-2':muted,'--gal-ui-muted':muted,'--gal-ui-ink-disabled':mix(ink,surface,.42),'--gal-ui-accent':accent,
        '--gal-ui-accent-ink':onAccent,'--gal-ui-line':border,
        '--gal-ui-hover':hover,'--gal-ui-active':selected,
        // private fork: built-ins own their texture, typography and decoration in theme CSS.
        ...(!builtin ? {'--gal-ui-veil':raised,'--gal-ui-text-shadow':'none','--gal-ui-title-shadow':'none',
            '--gal-ui-shadow':dark?'0 10px 30px rgb(0 0 0 / .42)':'0 10px 28px rgb(15 28 70 / .16)',
            '--gal-ui-radius':(document.ui?.radius ?? document.textbox.shape?.radius ?? 10)+'px',
            '--gal-ui-font':stageSkinFont(document,fonts,theme,'ui',lead),
            // A title face is decoration, like the built-ins' CSS title fonts: it keeps winning over the override.
            '--gal-ui-title-font':stageSkinFont(document,fonts,theme,'title')} : {}),
        '--gal-ui-hud-plate':surface,'--gal-ui-hud-ink-idle':muted,'--gal-ui-hud-ink-on':ink,'--gal-ui-hud-active':accent,
        '--gal-ui-hud-hover':hover,'--gal-ui-hud-selected':selected,'--gal-ui-hud-line':border};
}
function applyStageSkin(root, document, fonts, theme, lead = false) {
    const tokens=stageSkinTokens(document,fonts,theme,lead), previous=new Map();
    const old=root.getAttribute('data-fk-skin');
    for (const [name,value] of Object.entries(tokens)) {previous.set(name,[root.style.getPropertyValue(name),root.style.getPropertyPriority(name)]); root.style.setProperty(name,value);}
    root.setAttribute('data-fk-skin',document.id);
    return () => {
        for (const [name,[value,priority]] of previous) {if (value) root.style.setProperty(name,value,priority); else root.style.removeProperty(name);}
        if (old === null) root.removeAttribute('data-fk-skin'); else root.setAttribute('data-fk-skin',old);
    };
}
// private fork (owner 2026-10): textbox glyph hops are cut-out animation shot "on twos" - one even 12/s clock for
// the reveal steps and the glyph poses (docs/fork/skin-overlay-runtime.md "Text hop"). 83.3 ms is exactly 5 frames at
// 60 Hz (10 at 120, 12 at 144), so every pose is held the same number of frames. The authored textFx.stepFps (6-14)
// was read literally before; 8/s glyph hops over a 60 Hz display alternated 7/8-frame holds and read as lag. The
// collage pieces keep their own slower authored clock (fork-skin-overlay-motion.cjs).
const STAGE_SKIN_TEXT_FPS = 12;
function stageSkinReveal(skin, speed, {reducedMotion = false, photosensitive = true} = {}) {
    const fx = !skin || reducedMotion || photosensitive && skin.photosensitive ? {reveal:'type'} : skin.textFx;
    const interval = 1000/STAGE_SKIN_TEXT_FPS;
    const stepMs = fx.reveal === 'type' ? Math.min(speed * 1.2,Math.max(speed,fx.cps ? 1000/fx.cps : speed)) : interval;
    return {kind:fx.reveal,stepMs,chars:fx.reveal === 'type' ? 1 : Math.max(fx.charsPerStep || 1,Math.ceil(interval/Math.max(1,speed))),
        chunk:fx.reveal === 'type' ? 1 : fx.charsPerStep || 1,maxDurationScale:1.2,speed};
}
// Glyphs revealed on hop step `step` (1-based) when `shown` are already out. The reading speed stays the budget:
// step k may show floor(k*stepMs/speed) glyphs, in authored chunks (charsPerStep) - a slow reader gets held steps
// on the same 12/s grid instead of a slower clock.
function stageSkinRevealCount(reveal, shown, step) {
    if (reveal.kind !== 'stutter') {
        const due = Math.floor(step*reveal.stepMs/Math.max(1,reveal.speed));
        return shown < due ? Math.max(reveal.chunk || 1,due-shown) : 0;
    }
    // Deterministic hesitation, but never an unbounded zero-character stall.
    const random = (Math.imul(step + 1,1103515245) + 12345) >>> 0;
    return Math.max(random % (2*reveal.chars + 1),Math.floor(step*reveal.stepMs/Math.max(1,reveal.speed*reveal.maxDurationScale))-shown,0);
}
if (typeof module !== 'undefined' && typeof window === 'undefined' && module.exports) module.exports = {STAGE_SKIN_TEXT_FPS,stageSkinTokens,stageSkinPanelTokens,stageSkinQuickMenu,applyStageSkin,stageSkinReveal,stageSkinRevealCount};
