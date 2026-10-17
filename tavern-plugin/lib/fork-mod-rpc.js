import contract from '../packages/dsh-presentation-protocol/src/mod-contract.cjs'
const {modCheck:check,modShape:shape,modJson,modResultError} = contract

// Mount only under the existing authenticated same-origin Tavern dispatcher.
// authorize is required, including for reads/exports; never expose this table to a mod iframe.
export function createModRpc({library,authorize,archives}) {
  check(typeof authorize === 'function', '$.authorize', 'Management authorization is required', 'MOD_PERMISSION_DENIED')
  const declarations = {
    listMods:[['cardId'],[]],
    getMod:[['modId','cardId'],['modId']],
    listModPacks:[['modId','cardId'],['modId']],
    authorizeMod:[['modId','allowed','expectedRevision'],['modId','allowed','expectedRevision']],
    setModScopes:[['changes','expectedRevision'],['changes','expectedRevision']],
    setModScope:[['modId','scope','expectedRevision'],['modId','scope','expectedRevision']],
    setModPackScope:[['modId','packId','cardId','scope','expectedRevision'],['modId','packId','scope','expectedRevision']],
    saveModSettings:[['modId','values','expectedRevision'],['modId','values','expectedRevision']],
    saveModPack:[['modId','pack','expectedRevision'],['modId','pack','expectedRevision']],
    saveModEntry:[['ref','entry','expectedRevision'],['ref','entry','expectedRevision']],
    putModMedia:[['modId','packId','mime','data'],['modId','packId','mime','data']],
    readModMedia:[['modId','packId','path'],['modId','packId','path']],
    deleteModPack:[['modId','packId','confirmed','expectedRevision'],['modId','packId','confirmed','expectedRevision']],
    deleteMod:[['modId','confirmed','expectedRevision'],['modId','confirmed','expectedRevision']],
    inspectModImport:[['uploadId','url','catalogueId','cardId'],[]],
    applyModImport:[['inspectionId','decision','expectedRevision'],['inspectionId','decision','expectedRevision']],
    exportMod:[['modId','packIds','expectedRevision'],['modId','packIds','expectedRevision']],
    exportModPack:[['modId','packId','expectedRevision'],['modId','packId','expectedRevision']],
  }
  const archiveMethods = new Set(['inspectModImport','applyModImport','exportMod','exportModPack'])
  return Object.freeze(Object.fromEntries(Object.entries(declarations).map(([method,[allowed,required]]) => [method,async (args = {}, context) => {
    try {
      check(await authorize({method,context}) === true, '$', 'Mod management permission required', 'MOD_PERMISSION_DENIED')
      modJson(args, 1024 * 1024)
      shape(args,allowed,required)
      for (const key of ['modId','cardId','expectedRevision','uploadId','catalogueId','inspectionId']) if (args[key] !== undefined) check(typeof args[key] === 'string' && args[key].length > 0 && args[key].length <= 256, '$.' + key)
      if (method === 'inspectModImport') check(['uploadId','url','catalogueId'].filter(key => Object.hasOwn(args,key)).length === 1, '$', 'Choose one import source')
      if (method === 'applyModImport') check(['install','replace','keep-both'].includes(args.decision), '$.decision')
      const target = archiveMethods.has(method) ? archives : library
      const name = method === 'authorizeMod' ? 'authorize' : method
      check(typeof target?.[name] === 'function', '$', 'Mod service is unavailable', 'MOD_RESOURCE_UNAVAILABLE')
      return await target[name](structuredClone(args))
    } catch (error) {
      const result = modResultError(error).error
      throw Object.assign(new Error(result.message),result)
    }
  }])))
}
