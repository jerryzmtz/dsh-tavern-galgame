// Generated from dsh-presentation-protocol by build.mjs; do not edit.
'use strict';
// private fork: inert dsh.skin/1 contract, shared by importer and stage. No CSS input.
const skinColor = value => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
const skinId = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,47}$/.test(value);
const skinNumber = (min,max,integer = false) => value => Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value));
const skinEnum = values => value => values.includes(value);
const skinArray = (item,min,max) => value => Array.isArray(value) && value.length >= min && value.length <= max && value.every(item);
const skinObject = (fields,required = []) => value => value !== null && typeof value === 'object' && !Array.isArray(value) && required.every(key => Object.hasOwn(value,key)) && Object.keys(value).every(key => Object.hasOwn(fields,key) && fields[key](value[key]));
const skinText = value => typeof value === 'string' && value.length > 0 && value.length <= 4096;
const skinPaint = skinObject({bg:skinColor,fg:skinColor,fgMuted:skinColor,accent:skinColor,onAccent:skinColor,border:skinColor},['bg','fg']);
const skinRings = (count,width) => skinArray(skinObject({width:skinNumber(1,width),color:skinColor},['width','color']),0,count);
const skinBand = skinObject({pattern:skinEnum(['staff','rule','dots','stripes','teeth','scanlines','fence','stained','lace','checker','chain']),colors:skinArray(skinColor,1,4),height:skinNumber(2,22),inset:skinNumber(0,60),offset:skinNumber(0,20)},['pattern','colors']);
const skinFile = value => typeof value === 'string' && value.length <= 240 && /^[a-z0-9/._-]+\.(ogg|m4a|mp3|wav)$/.test(value) && !value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..');
const stageSkinShape = skinObject({
    schema:skinEnum(['dsh.skin/1']),id:skinId,label:skinText,
    ui:skinObject({bg:skinColor,fg:skinColor,fgMuted:skinColor,accent:skinColor,onAccent:skinColor,border:skinColor,radius:skinNumber(0,40),textShadow:skinEnum(['none']),titleFont:skinId,veil:skinObject({color:skinColor,opacity:skinNumber(0,1)},['color','opacity'])}),
    levels:value => value && typeof value === 'object' && !Array.isArray(value) && [1,2,3].includes(value.default) && Object.keys(value).every(key => ['1','2','3','default'].includes(key)),
    overlay:value => value && typeof value === 'object' && !Array.isArray(value),
    license:skinObject({privateUse:value => typeof value === 'boolean',notes:skinArray(skinText,0,32),derived:skinArray(skinText,0,32)},['privateUse']),
    textbox:skinObject({paint:skinPaint,shape:skinObject({radius:skinNumber(0,40),borderWidth:skinNumber(0,8),rings:skinRings(3,12)}),frame:skinObject({top:skinBand,bottom:skinBand,corners:skinObject({kind:skinEnum(['none','diamond','rivet','bow','bracket']),colors:skinArray(skinColor,0,2)},['kind']),insets:skinArray(skinNumber(24,80),4,4)})},['paint']),
    nameplate:skinObject({shape:skinEnum(['pill','tag','torn','jagged','plate','plain']),paint:skinObject({bg:skinColor,fg:skinColor,border:skinColor},['bg','fg']),rotate:skinNumber(-3,3),size:skinNumber(18,40),letterSpacing:skinNumber(0,0.2),rings:skinRings(2,8)},['shape','paint']),
    // private fork (docs/fork/fonts.md): the skin's stage-mode fonts, every field optional. body = the stage role (text
    // box; name / ui fall back to it), film = cinematic subtitles (falls back to body).
    font:skinObject({body:skinId,name:skinId,ui:skinId,film:skinId}),
    textStyle:skinObject({weight:skinEnum([400,500,700]),sizeScale:skinNumber(0.85,1.2),lineHeight:skinNumber(1.4,1.9),letterSpacing:skinNumber(0,0.12),emphasis:skinColor}),
    textFx:skinObject({reveal:skinEnum(['type','ink','pop','stutter','stamp','cut','scan','scrawl']),stepFps:skinNumber(6,14),charsPerStep:skinNumber(1,6,true),cps:skinNumber(10,80),from:skinEnum(['top','bottom']),flash:skinColor,emphasis:skinEnum(['none','jitter','ink']),jitter:skinNumber(0,1.5)},['reveal']),
    cursor:skinObject({name:skinEnum(['triangle','wheel','lollipop','eye','rose','rec','candle','gear','light','bell','feather','needle','teacup','whale']),color:skinColor,accent:skinColor,fps:skinNumber(2,12)},['name']),
    quickMenu:skinObject({bg:skinColor,fg:skinColor},['bg','fg']),
    sfx:skinObject({type:skinFile,page:skinFile,open:skinFile}),photosensitive:value => typeof value === 'boolean'
},['schema','id','label','textbox','nameplate','font','textFx']);
function skinLuminance(color) {
    const rgb = [1,3,5].map(i => parseInt(color.slice(i,i+2),16)/255).map(v => v <= 0.04045 ? v/12.92 : ((v+0.055)/1.055)**2.4);
    return rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722;
}
function skinContrast(a,b) {const x=skinLuminance(a),y=skinLuminance(b); return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);}
function validateStageSkin(value) {
    if (!stageSkinShape(value) || new TextEncoder().encode(JSON.stringify(value)).length > (value.overlay || value.levels ? 262144 : 32768)) throw Object.assign(new Error('Invalid dsh.skin/1 document'),{code:'INVALID_SKIN'});
    if ((value.overlay || value.levels) && typeof module !== 'undefined' && typeof window === 'undefined') require('./skin-overlay.cjs').validateSkinOverlay(value);
    const paint=value.textbox.paint, name=value.nameplate.paint;
    const ui={...paint,...value.ui};
    const pairs=[...(value.ui ? [[ui.fg,ui.bg,4.5],[ui.fgMuted,ui.bg,3],[ui.accent,ui.bg,4.5],[ui.onAccent,ui.accent,4.5]] : []),[paint.fg,paint.bg,4.5],[paint.fgMuted,paint.bg,3],[value.textStyle?.emphasis || paint.accent || paint.fg,paint.bg,4.5],[paint.onAccent,paint.accent,4.5],[name.fg,name.bg,4.5],[value.quickMenu?.fg,value.quickMenu?.bg,4.5]];
    if (pairs.some(([a,b,min]) => a && (!b || skinContrast(a,b)+1e-6 < min))) throw Object.assign(new Error('Skin text contrast is unsafe'),{code:'SKIN_CONTRAST'});
    const frame=value.textbox.frame;
    for (const [side,index,fallback] of [['top',0,42],['bottom',2,58]]) {
        const band=frame?.[side];
        if (band && (band.offset ?? 9)+(band.height ?? 14) > (frame.insets?.[index] ?? fallback)) throw Object.assign(new Error('Skin ornament overlaps content'),{code:'SKIN_GEOMETRY'});
    }
    if (value.levels) for (const key of ['1','2','3']) if (value.levels[key]) {const look=stageSkinAppearance(value,Number(key));if (look) validateStageSkin(look);}
    return value;
}
function stageSkinAppearance(value, level = value.levels?.default) {
    const {levels,overlay,...appearance}=value;
    if (!levels) return appearance;
    const selected=levels[level];
    if (!selected) throw Object.assign(new Error('Skin level is not declared'),{code:'INVALID_SKIN_LEVEL'});
    if (selected.look === 'theme') return null;
    for (const key of ['textbox','nameplate','font','textStyle','textFx','cursor','quickMenu','sfx','photosensitive','ui']) if (Object.hasOwn(selected,key)) appearance[key]=selected[key];
    return appearance;
}
function stageSkinFiles(value) {return [...new Set([...Object.values(value.sfx || {}),...Object.values(value.overlay?.sfx || {}),...Object.values(value.levels||{}).flatMap(level=>Object.values(level?.sfx||{}))])];}
// private fork: built-in skin ids preserve the existing layout selectors, not a second theme preference.
const BUILTIN_STAGE_SKINS = Object.freeze(Object.fromEntries([
    ['classic','经典','沉静的深色阅读舞台','#0c0a14','#f5f2fa','#bcb8c6','#e9e4f3','neo-xihei-screen'],
    ['gothic','哥特','暗紫底色与浅金装饰','#0c0816','#f6f1fb','#c2b8cc','#e8d8a8','neo-zhisong-screen'],
    ['magical','魔法少女','明亮的奶油粉色舞台','#fffafd','#6b2f55','#80506d','#b7457b','resource-han-rounded'],
    // private fork: 显像管 phosphor tube (output/crt-skin/DESIGN.md): tight 4px glass corners and a dim phosphor rule.
    ['crt','显像管','深夜绿色荧光的显像管屏幕','#06110c','#c8f5d2','#7fbf95','#4dff88','neo-xihei-screen',4,'#1d5a33'],
    // private fork: 千禧晴空 Frutiger Aero (output/aero-skin/DESIGN.md): sky glass, Aero blue, a pale sky-white scrim
    // behind full sheets (optional 11th item: the ui.veil scene dimmer). No stage font: the stage falls back to the
    // system 微软雅黑 / Segoe UI stack of its era (fork-fonts.js).
    ['aero','千禧晴空','晴朗午后的千禧年玻璃与天空','#f2f9ff','#0e2c48','#3b5f80','#0a5fae',null,16,'#8fbde3',{color:'#d4ebfb',opacity:.55}]
].map(([id,label,directorNote,bg,fg,fgMuted,accent,stage,radius=10,border=fgMuted,veil]) => [id,{schema:'dsh.skin/1',id,label,
    textbox:{paint:{bg,fg,fgMuted,accent,onAccent:bg,border},shape:{radius}},
    // Film subtitles stay 新晰黑 in every built-in (migrated from the old per-theme table, fonts.md).
    nameplate:{shape:'plain',paint:{bg,fg}},font:{...(stage ? {body:stage} : {}),film:'neo-xihei-screen'},textFx:{reveal:'type'},
    ui:{bg,fg,fgMuted,accent,onAccent:bg,border,radius,...(veil ? {veil} : {})}}])));
if (typeof module !== 'undefined' && typeof window === 'undefined' && module.exports) module.exports = {validateStageSkin,stageSkinFiles,skinContrast,stageSkinAppearance,BUILTIN_STAGE_SKINS};
