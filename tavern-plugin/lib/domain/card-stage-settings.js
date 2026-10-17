// Global stage toggles and card-owned visual/module preferences.
import { DIRECTOR_DIMENSIONS, defaultAssetEngineSettings } from './asset-engine-settings.js'
import { validateAssetRef } from '../../packages/dsh-presentation-protocol/src/asset-packs.js'
import skinContract from '../../packages/dsh-presentation-protocol/src/stage-skin.cjs'
import { shape, bool, check } from '../../packages/dsh-presentation-protocol/src/asset-pack-json.js'

export function validateCardStage(value, path = '$.stage') {
  // private fork (owner 2026-10 r3): no 双语配音 switch; a figure's voice language decides (bin/fork-retire-voice-language.mjs).
  const switches = ['widgets']
  shape(value, [...switches, 'defaultSkin', 'dimensions'], [], path)
  for (const key of switches) if (value[key] !== undefined) bool(value[key], path + '.' + key)
  // private fork: a default is presentation policy, never a recorded director operation.
  if (value.defaultSkin !== undefined) {
    const skin=value.defaultSkin;
    if (typeof skin === 'string') check(Object.hasOwn(skinContract.BUILTIN_STAGE_SKINS,skin), path + '.defaultSkin');
    else {
      validateAssetRef(skin,path + '.defaultSkin','skins');
    }
  }
  // private fork (global only, owner 2026-10, AGENTS rule 15): `dimensions` is a retired per-card override of the director
  // commands. Old cards keep it as stored (never rewritten) and it is still shape-checked, but nothing reads it
  // (cardEngineSettings) and a patch cannot change it (cardAssetRawOperations).
  if (value.dimensions !== undefined) {
    shape(value.dimensions, DIRECTOR_DIMENSIONS.filter(key => !['music','sfx','soundscape'].includes(key)), [], path + '.dimensions')
    for (const [key, enabled] of Object.entries(value.dimensions)) bool(enabled, path + '.dimensions.' + key)
  }
  return value
}

export function effectiveCardStage(extension, engine) {
  const stored = extension?.stage || {}
  validateCardStage(stored)
  const value = {widgets:false, defaultSkin:'classic', ...stored,
    ...(engine?.stageToggles || defaultAssetEngineSettings().stageToggles)}
  value.stage = value.stage && value.dialogue
  return value
}

export function cardEngineSettings(engine, extension) {
  const stage = effectiveCardStage(extension, engine)
  // The director commands are global only (舞台模式 › 可用演出); a stored stage.dimensions is ignored. The audio kinds and
  // widgets follow the global switches / the card's 模组 gate as before.
  const dimensions = {...engine.dimensions, widgets:stage.widgets === true}
  for (const [toggle, dimension] of [['music','music'], ['sfx','sfx'], ['ambience','soundscape'], ['widgets','widgets']]) {
    dimensions[dimension] = stage[toggle] === true
  }
  return {...engine, dimensions}
}
