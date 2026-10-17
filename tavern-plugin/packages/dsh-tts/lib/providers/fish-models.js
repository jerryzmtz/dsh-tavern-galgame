// Provider-owned verified billing data. Unknown identifiers are never classified as free.
export const FISH_DEFAULT_MODEL = 's2.1-pro-free'
export const FISH_MODELS = Object.freeze([
  {id:'s2.1-pro-free',label:'S2.1 Pro Free',billing:'free'},
  {id:'s2.1-pro',label:'S2.1 Pro',billing:'paid'},
])
export const fishModel = id => FISH_MODELS.find(model => model.id === id) || {id,label:id,billing:'unknown'}
export function fishModelId(value = FISH_DEFAULT_MODEL) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(value)) throw new Error('Invalid Fish model identifier')
  return value
}
