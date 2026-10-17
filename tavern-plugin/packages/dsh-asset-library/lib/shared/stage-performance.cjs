// Generated from dsh.performance by build.mjs; do not edit.
'use strict';
// Host-side inert authoring contract; no executable assets or player state.
const schema=require('../schema/performance.schema.json');
const {validateSkinSchema}=require('./skin-overlay.cjs');
const {validateStageSkin}=require('./stage-skin.cjs');
function check(ok,message) {if(!ok)throw Object.assign(new Error(message),{code:'INVALID_PERFORMANCE'});}
function validateStagePerformance(document) {
    check(new TextEncoder().encode(JSON.stringify(document)).length<=131072,'Performance document exceeds 128 KiB');
    try {validateSkinSchema(schema,document);} catch(error) {throw Object.assign(new Error(error.message),{code:'INVALID_PERFORMANCE'});}
    // private fork: levels/overlays use the shared skin format, not another renderer.
    if(document.theme) validateStageSkin(document.theme);
    check(document.legacySkinId === undefined || document.legacySkinId === document.theme?.id,'Historical skin alias must match embedded theme');
    check(!document.theme?.license?.privateUse || document.license.privateUse,'Private theme cannot be relabelled public');
    check(!Object.hasOwn(document.packs,'self'),'self is the owning pack, not an overridable alias');
    for (const id of Object.values(document.packs)) check(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id),'Invalid performance pack UUID');
    check(!document.levels || Object.hasOwn(document.levels,String(document.levels.default)),'Default performance level must be declared');
    check([...document.label].length<=120,'Performance label exceeds 120 characters');
    for(const phase of Object.values(document.timeline)) {
        let at=-1;
        for(const event of phase.events) {
            check(event.at>=at,'Performance events must be ordered');at=event.at;
            if(event.slot!==undefined)check(/^[a-z][a-z0-9-]{0,47}$/.test(event.slot),'Invalid widget slot');
        }
        if(phase.every)check(phase.every[0]<=phase.every[1]&&phase.every[1]<=300000,'Invalid idle interval');
        const flashes=phase.events.filter(event=>event.do==='flash');
        for(let i=3;i<flashes.length;i++) check(flashes[i].at-flashes[i-3].at>=1000,'At most three flashes per second');
    }
    for(const {alias} of performanceReferences(document,null)) check(alias==='self'||Object.hasOwn(document.packs,alias),'Undeclared performance pack alias: '+alias);
    return document;
}
function performanceReferences(document,ownerPackId) {
    const rows=[],kinds={skin:'skins',sfx:'sfx',bgm:'music',look:'looks',ambience:'ambience',widget:'widgets'};
    function add(value,kind) {
        const reference=typeof value==='string'?value:value.ref,[alias,assetId]=reference.split(':');
        if(kind==='skins' && alias==='self' && assetId===document.theme?.id) return;
        rows.push({alias,ref:{packId:alias==='self'?ownerPackId:document.packs[alias],kind,assetId}});
    }
    if(document.bgm)add(document.bgm,'music');
    for(const value of Object.values(document.sfxMap||{}))add(value,'sfx');
    for(const block of Object.values(document.timeline))for(const event of block.events)if(event.ref)add(event,kinds[event.do]);
    return rows;
}
// private fork: an explicit migrated alias is only used to resolve old normalized skin refs.
function performanceThemeOwner(pack,skinId,{historical=false}={}) {
    return Object.values(pack?.performances || {}).find(document=>document.theme?.id===skinId && (!historical || document.legacySkinId===skinId));
}
function performanceSkinDocument(pack,skinId) {return pack?.skins?.[skinId] || performanceThemeOwner(pack,skinId)?.theme;}
if(typeof module!=='undefined'&&typeof window === 'undefined'&&module.exports)module.exports={validateStagePerformance,performanceReferences,performanceThemeOwner,performanceSkinDocument};
