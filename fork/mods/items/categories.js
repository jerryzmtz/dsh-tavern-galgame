// Category identity belongs to the mod, not to an enabled pack.
export const ITEM_CATEGORIES = Object.freeze([
  ['key','钥匙'],['document','文书'],['medicine','药品'],['weapon','武器'],
  ['jewel','饰品'],['food','食物'],['money','货币'],['misc','杂物'],
].map(([id,label])=>Object.freeze({id,label,icon:Object.freeze({builtin:id})})))
export const ITEM_CATEGORY_IDS = Object.freeze(ITEM_CATEGORIES.map(row=>row.id))
