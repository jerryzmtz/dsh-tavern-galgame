'use strict';

const PERFORMANCE_STAGE_CAPABILITIES = Object.freeze(['state','music','skin','sfx','overlays']);
function performanceOperation(op) {
    if (op?.op !== 'mod.command' || op.modId !== 'dsh.performance') return null;
    if (op.commandId === 'set') return {op:'perform',id:op.params.ref,level:op.params.level};
    if (op.commandId === 'off') return {op:'perform.off'};
    return null;
}
function reducePerformanceCommand(state, command, params, metadata, document, boundary, check) {
    const admission = command.admission?.performance;
    check(admission && PERFORMANCE_STAGE_CAPABILITIES.every(name => admission.permissions.includes(name)), '$.permission', 'Performance channels require host authorization', 'MOD_PERMISSION_DENIED');
    check(Number.isSafeInteger(metadata.page) && metadata.page >= 0 && Number.isSafeInteger(metadata.turn) && metadata.turn > 0, '$.performance', 'Performance requires a verified turn and canonical page', 'PRECONDITION');
    const off = command.id === 'off';
    const choice = !off && admission.choices.find(row => ['packId','kind','assetId'].every(key => row.ref[key] === params.ref[key]));
    check(off || choice, '$.ref', 'Choose a recalled performance', 'REF_UNAVAILABLE');
    const level = off ? undefined : params.level ?? choice.default;
    check(off || choice.levels.includes(level), '$.level', 'Choose a declared performance level', 'ARG_INVALID');
    if (state.performance || choice) state.performance = boundary(state.performance || null, {ref:choice ? structuredClone(choice.ref) : undefined,level,off}, metadata, document);
    return state;
}
if (typeof module !== 'undefined') module.exports = {PERFORMANCE_STAGE_CAPABILITIES,performanceOperation,reducePerformanceCommand};
