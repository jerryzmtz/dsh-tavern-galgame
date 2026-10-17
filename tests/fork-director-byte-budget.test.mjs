// private fork: tagged English defaults; retain protocol, payload, cache and budget assertions.
// private fork: measured main 1d1aaa46; 980b7285's +79 B cast guidance prevents survivor reordering, while total wire bytes shrink.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {syntheticPack, cardExtension, OTHER_PACK_ID, FIGURE_ID, OTHER_FIGURE_ID,distinctMedia} from './fixtures/asset-packs/pack.mjs';
import { prepareAssetPackDirector, buildAssetPackRequest } from '../tavern-plugin/lib/domain/stage-asset-pack-director.js';
import { defaultAssetEngineSettings } from '../tavern-plugin/lib/domain/asset-engine-settings.js';
const first = await syntheticPack(), second = distinctMedia(first,OTHER_PACK_ID);
second.manifest.id = OTHER_PACK_ID;
// private fork: background has no ambience dependency.
second.figures[FIGURE_ID].id = OTHER_FIGURE_ID;
const snapshots = [first, second].map((p, i) => ({manifest:p.manifest, figures:Object.values(p.figures),widgets:p.widgets, revision:'r' + i}));
const assetStatus = {}, widgetAuthorizations = {};
for (const p of snapshots) for (const a of p.manifest.assets) {
  const key = p.manifest.id + '/' + a.kind + '/' + a.id;
  assetStatus[key] = {available:true, executableDigest:'a'.repeat(64)};
  widgetAuthorizations[key] = 'a'.repeat(64);
}
const input = {snapshots, assetStatus,
  raw:{extensions:{dsh_tavern:cardExtension()}}, cardRevision:'card-1',
  engine:{...defaultAssetEngineSettings(), widgetsEnabled:true, widgetAuthorizations},
  target:{sourceKey:'reply-1', branchId:'branch-1', revision:1},
  units:['Synthetic fixture.', 'Later at night.', 'An unchanged paragraph.']};
const bytes = value => Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
function measure() {
  const request = buildAssetPackRequest(prepareAssetPackDirector(input), true, undefined, '', true);
  return {inputBytes:request.inputBytes, systemBytes:bytes(request.system), toolSchemaBytes:bytes(request.tools[0].parameters), toolBytes:bytes(request.tools), sections:request.sections.map(s => ({key:s.key, bytes:bytes(s.text)}))};
}
const small = measure();
for (const p of snapshots) for (const kind of ['backgrounds','music','sfx','looks']) {
  const base = p.manifest.assets.find(a => a.kind === kind);
  for (let i = 0; i < 24; i++) {
    const a = distinctMedia({...structuredClone(base), id:kind + '-' + i},p.manifest.id+kind+i);
    p.manifest.assets.push(a);
    assetStatus[p.manifest.id + '/' + kind + '/' + a.id] = {available:true};
  }
}
const measurements={small,filled:measure()};
const baseline=JSON.parse(await readFile(new URL('./fixtures/director-byte-baseline.json',import.meta.url),'utf8'));
const frozen=JSON.parse(await readFile(new URL('./fixtures/director-cache-byte-baseline.json',import.meta.url),'utf8'));
for(const [name,value] of Object.entries(measurements))test('director UTF-8 budget: '+name,t=>{
  const sections=value.sections.reduce((out,item)=>{const key=item.key.startsWith('catalogue.')?'catalogue':item.key;out[key]=(out[key]||0)+item.bytes;return out},{});
  // Keep earlier baselines as evidence; freeze the new wire and section budgets exactly.
  const expected = structuredClone(frozen[name]);
  // Character-owned emotions remove redundant outfit differences: 73 section / 81 wire bytes.
  expected.inputBytes -= 81;
  expected.sections['actors.constant'] -= 73;
  // Fully inline actor/ref at the provider boundary: measured +822 B, no prompt-section growth.
  for (const key of ['inputBytes','toolSchemaBytes','toolBytes']) expected[key] += 822;
  expected.sections.tools += 822;
  // Scene transition guidance: measured +102 B; schemas stay byte-identical.
  expected.inputBytes += 102;
  expected.sections['command-guidance'] += 102;
  // B5: exact handles +20 B, persistent outfits +121 B, silence/turn contract +74 B;
  // one additional escaped newline makes the total wire delta +216 B. Tools unchanged.
  expected.inputBytes += 216;
  expected.sections.director += 20;
  expected.sections['command-guidance'] += 121;
  expected.sections['music-state'] += 74;
  // B5 follow-up: entry/group outfit selection +107 B and spatial scene guidance +132 B.
  // Handle normalization changes no emitted identities or frozen tools.
  expected.inputBytes += 239;
  expected.sections['command-guidance'] += 239;
  // Everyday mood-turn example distinguishes active-track reselection from silent carry (+46 B).
  expected.inputBytes += 46;
  expected.sections['music-state'] += 46;
  // Explicit temporary-prop removal/gag end is a story change: +124 B, no tool growth.
  expected.inputBytes += 124;
  expected.sections['command-guidance'] += 124;
  // private fork: offline English/tagged request +313 wire B; schema unchanged (8530 B).
  expected.inputBytes += 313;
  expected.sections["director"] += 99;
  expected.sections["command-guidance"] += 143;
  expected.sections["music-state"] += 58;
  // private fork (owner 2026-10): weather 扬尘 (dust) retired from weather.set: -7 B tool schema and wire, no prompt section change.
  for (const key of ['inputBytes','toolSchemaBytes','toolBytes']) expected[key] -= 7;
  expected.sections.tools -= 7;
  // Remove the redundant installed-op index: -452 section B, -456 escaped wire B; tools unchanged.
  expected.inputBytes -= 456;
  expected.sections.director -= 452;
  // Owner 2026-10 (director grammar v4): the role, inputs, persistence and stage_update protocol are explained
  // (+1011 B); one verb convention plus plain command notes replace terse shorthand (+954 B); music wording +38 B.
  // Tools: weather.clear, camera.reset and cg.focus.reset, per-field handle sources and shorter field
  // descriptions (+10 B schema), shorter tool description (-4 B). Wire +2056 B.
  expected.inputBytes += 2056;
  expected.sections.director += 1011;
  expected.sections['command-guidance'] += 954;
  expected.sections['music-state'] += 38;
  expected.toolSchemaBytes += 10;
  expected.toolBytes += 6;
  expected.sections.tools += 6;
  // Owner 2026-10 (glue review): the bare 「Fixed stage data:」 label becomes <stage_assets> with a one-sentence
  // lead-in on what the entries are and which fields commands take (+193 B), role wording +4 B. Wire +199 B.
  // The prompt view names the lead-in and the allowedCommands list (already sent) as sections.
  expected.inputBytes += 199;
  expected.sections.director += 4;
  expected.sections['stage-assets-lead'] = 179;
  expected.sections['allowed-commands'] = value.sections.find(s => s.key === 'allowed-commands').bytes;
  // P5: flat background variant names add catalogue bytes; retired time-ref grammar removes 150 tool bytes.
  // Measured against the preserved pre-P5 fixture: +132 / +6564 wire B, no performance mod admitted here.
  expected.inputBytes += name==='filled'?6564:132;
  expected.sections.catalogue += name==='filled'?5300:212;
  expected.sections.carried -= 2;
  for(const key of ['toolSchemaBytes','toolBytes'])expected[key]-=150;
  expected.sections.tools-=150;
  // Optional force/reason and separate guidance (+493 B), then self-contained grammar (+822 B).
  assert.ok(value.inputBytes < (name === 'filled' ? 60441 : baseline[name].inputBytes + 493 + 822 + 102 + 216 + 239 + 46 + 124 + 313 + 2056 + 199));
  if(name==='filled') {
    const catalogue=prepareAssetPackDirector(input).context.catalogue;
    assert.deepEqual(['backgrounds','music','sfx'].map(kind=>catalogue.candidates[kind].length),[52,50,50]);
    assert.ok(['backgrounds','music','sfx'].every(kind=>catalogue.candidates[kind].every(row=>row.reasons.includes('hard-trigger'))));
  }
  assert.deepEqual(Object.keys(sections).sort(),Object.keys(expected.sections).sort());
  for(const key of ['toolSchemaBytes','toolBytes'])assert.equal(value[key],expected[key],key);
  assert.equal(value.inputBytes,expected.inputBytes);
  assert.equal(measurements.small.toolBytes,measurements.filled.toolBytes,'candidate count cannot change frozen tools');
  assert.deepEqual(sections,expected.sections);
  t.diagnostic(JSON.stringify({...value,sections,wireDelta:value.inputBytes-baseline[name].inputBytes}));
});
