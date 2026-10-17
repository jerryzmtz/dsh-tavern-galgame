import device from './builtin/device.json' with {type:'json'}

// Builtins and uploaded settings are presentation resources, never recall candidates.
export function withBuiltinPhoneDevice(catalogue) {
  return {...catalogue,phone:{device:structuredClone(device.ref),wallpapers:[],...catalogue.phone}}
}

const key=ref=>JSON.stringify([ref.modId,ref.packId,ref.kind,ref.entryId])
const fail=()=>{throw Object.assign(new Error('Wallpaper is not available; reopen the picker'),{code:'MOD_PERMISSION_DENIED'})}

export function wallpaperChoices(catalogue) {
  return catalogue.phone?.wallpapers || []
}
export function selectWallpaper(catalogue,choice) {
  const row=wallpaperChoices(catalogue).find(row=>row.id===choice)
  if(!row)fail()
  return structuredClone(row.ref)
}
export function projectWallpaper(catalogue,state) {
  if(!state?.wallpaper)return null
  return wallpaperChoices(catalogue).find(row=>key(row.ref)===key(state.wallpaper)) || null
}
export function phoneDevices(catalogue) {
  return catalogue.phone?.device?[catalogue.phone.device]:[]
}
