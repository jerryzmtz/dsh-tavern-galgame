// Pack integrity and bounded media validation.
import path from 'node:path'
import {assetContent,assetContents,assetContentMedia,assetDocument} from '../shared/asset-variant-content.js'
import { PACK_BUDGET } from './budget.js'
import {validateModPrivate} from './mod-private.js'
import {partAlphaBox} from './part-bbox.js'
import {groupBundleFiles} from '../asset-packs/bundle-files.js'
import skinContract from '../shared/stage-skin.cjs'
import performanceContract from '../shared/stage-performance.cjs'
import widgetContract from '../shared/widget-schema.cjs'
import {validatePerformancePack} from './performance-bundle.js'
const {validateStageSkin, stageSkinFiles} = skinContract
import { imageKind, audioKind, imageDimensions, pngSize, wavInfo } from './media.js'
import { modelReferences } from './model.js'
import { BLOB_MIME_TYPES, validatePackIdentities, validateFigureClosure, verifyPackHashes, verifyPackFiles, computeContentHash, computeBundleHash, canonicalJson, parseJson, sha256 } from '../asset-packs/index.js'
import { check, relativePath, compareCodePoints } from '../asset-packs/common.js'
import { validateSpineBundle } from '../asset-packs/spine.js'

export const PACK_LIMITS = Object.freeze({ entries:20000, entrySize:512 * 1024 ** 2, ...PACK_BUDGET, ratio:200, previews:16, uploads:512, previewTtlMs:15 * 60000 })
export const jsonBytes = value => Buffer.from(canonicalJson(value))
export const readDocument = bytes => parseJson(new TextDecoder('utf-8', {fatal:true, ignoreBOM:true}).decode(bytes))
export const cloneFiles = files => new Map([...files].map(([name, bytes]) => [name, Buffer.from(bytes)]))
export function budget(files, limits) {
  check(files instanceof Map && files.size <= limits.entries, '$.files', 'File count budget exceeded', 'LIMIT_EXCEEDED')
  let total = 0
  for (const [name, bytes] of files) {
    relativePath(name)
    check(bytes instanceof Uint8Array && bytes.length <= limits.entrySize, name, 'File size budget exceeded', 'LIMIT_EXCEEDED')
    total += bytes.length
  }
  check(total <= limits.totalSize, '$.files', 'Pack budget exceeded', 'LIMIT_EXCEEDED')
  return total
}
// The installed plugin supplies a trusted structural validator for compressed codecs.
export async function inspectMedia(input, descriptor, decodeMedia, {settei = false} = {}) {
  const bytes = Buffer.from(input), ext = imageKind(bytes) || audioKind(bytes)
  check(ext && descriptor.ext === ext && descriptor.mime === BLOB_MIME_TYPES[ext] && descriptor.size === bytes.length, '$.blobs', 'Media signature/ext/MIME mismatch')
  const image = descriptor.mime.startsWith('image/')
  check(image&&settei || bytes.length <= (image ? 6 : 60) * 1024 ** 2, '$.media', 'Media byte limit', 'LIMIT_EXCEEDED')
  const dimensions = image ? imageDimensions(bytes, ext) : null
  if (dimensions) check(dimensions.every(n => Number.isInteger(n) && n > 0 && n <= 8192) && dimensions[0] * dimensions[1] <= 32 * 1024 ** 2, '$.media', 'Image dimensions exceed limit', 'LIMIT_EXCEEDED')
  let decoded
  if (ext === 'png' && !(bytes[28] === 1 && decodeMedia)) decoded = pngSize(bytes)
  else if (ext === 'wav') decoded = wavInfo(bytes)
  else {
    check(typeof decodeMedia === 'function', '$.media', 'A trusted media validator is required for ' + ext, 'ASSET_UNAVAILABLE')
    decoded = await decodeMedia(bytes, {...descriptor})
  }
  if (image) check(decoded && decoded.width === dimensions[0] && decoded.height === dimensions[1], '$.media', 'Validated image dimensions mismatch')
  else check(Number.isFinite(decoded?.durationMs) && decoded.durationMs > 0, '$.media', 'Invalid audio duration')
  return decoded
}
// Copy operations preserve Buffer identity even when their destination paths change.
export function storedCopyHashes(files, sources) {
  const digests = new Map()
  for (const source of sources) for (const file of source.manifest.files) digests.set(source.files.get(file.path),file.sha256)
  return new Map([...files].filter(([,bytes]) => digests.has(bytes)).map(([name,bytes]) => [name,digests.get(bytes)]))
}
// `hashed` (path -> sha256) holds digests the same edit just computed from these exact bytes (CAS names); they are reused, not recomputed.
export async function sealPack(manifest, files, previous, hashed) {
  const prior = new Map((previous?.manifest.files || []).map(file => [file.path, file]))
  const listed = new Set((manifest.files || []).map(file => file.path))
  const names = [...listed].filter(name => files.has(name)).concat([...files.keys()].filter(name => !listed.has(name)).sort(compareCodePoints))
  manifest.files = await Promise.all(names.map(async path => previous?.files.get(path) === files.get(path) && prior.has(path) ? prior.get(path) : {path, size:files.get(path).length, sha256:hashed?.get(path) ?? await sha256(files.get(path))}))
  const grouped = groupBundleFiles(manifest.files), priorGrouped = previous && groupBundleFiles(previous.manifest.files)
  for (const [key, bundle] of Object.entries(manifest.bundles)) {
    const prefix = `bundles/${key}/`
    const entries = grouped.get(key) || []
    const old = priorGrouped?.get(key)
    const sameFiles = old?.length === entries.length && old.every((file, i) => file.path === entries[i].path && file.size === entries[i].size && file.sha256 === entries[i].sha256)
    bundle.contentHash = sameFiles ? previous.manifest.bundles[key].contentHash : await computeBundleHash(entries.map(f => ({...f,path:f.path.slice(prefix.length)})))
  }
  manifest.contentHash = await computeContentHash(manifest)
  return {manifest, files}
}
export async function verifyBytes(manifest, files, {limits = PACK_LIMITS, decodeMedia, previous, sealed = false, modValidators} = {}) {
  const total = budget(files, limits)
  await validateModPrivate({files,previous,validators:modValidators,readDocument,inspectMedia,decodeMedia})
  validatePackIdentities([manifest])
  const manifestSize = jsonBytes(manifest).length
  check(files.size + 1 <= limits.entries, '$.files', 'File count budget exceeded', 'LIMIT_EXCEEDED')
  check(manifestSize <= limits.entrySize, 'manifest.json', 'File size budget exceeded', 'LIMIT_EXCEEDED')
  check(total + manifestSize <= limits.totalSize, '$.files', 'Pack budget exceeded', 'LIMIT_EXCEEDED')
  const figures = {}, sprites = {}, widgets = {}
  // Sealed edits computed digests from the new bytes themselves. Imports must
  // still authenticate their supplied digests before anything is installed.
  if (!sealed) await verifyPackFiles(manifest, files)
  for (const id of manifest.figures) figures[id] = readDocument(files.get(`figures/${id}.json`))
  for (const [key, name] of Object.entries(manifest.sprites)) sprites[key] = readDocument(files.get(name))
  validateFigureClosure(manifest, figures, sprites)
  if (!sealed) await verifyPackHashes(manifest)
  const unchanged = name => previous?.files.has(name) && previous.files.get(name) === files.get(name)
  // Boards are authoring evidence, not stage textures. Shared stage media keeps its limit.
  const boards = new Set(), stageMedia = new Set()
  for(const figure of Object.values(figures)) {
    if(figure.identitySettei?.board)boards.add(figure.identitySettei.board)
    for(const outfit of figure.outfits){if(outfit.settei)boards.add(outfit.settei);for(const hash of [...Object.values(outfit.avatars||{}),...Object.values(outfit.sprite?.assets||{})])stageMedia.add(hash)}
  }
  for(const asset of manifest.assets)for(const {hash} of assetContentMedia(asset))stageMedia.add(hash)
  const images = new Map()
  for (const [hash, descriptor] of Object.entries(manifest.blobs)) {
    const name = `media/${hash}.${descriptor.ext}`, bytes = files.get(name)
    if(stageMedia.has(hash)&&descriptor.mime.startsWith('image/'))check(bytes.length<=6*1024**2,name,'Stage media byte limit','LIMIT_EXCEEDED')
    if (unchanged(name) && previous.manifest.blobs[hash] && canonicalJson(previous.manifest.blobs[hash]) === canonicalJson(descriptor)) {
      const size = descriptor.mime.startsWith('image/') ? imageDimensions(bytes, descriptor.ext) : null
      if (size) images.set(hash, {width:size[0], height:size[1]})
    } else images.set(hash, await inspectMedia(bytes, descriptor, decodeMedia, {settei:boards.has(hash)&&!stageMedia.has(hash)}))
  }
  for (const [name, bytes] of files) if (name.startsWith('credits/')) {
    check(bytes.length <= 16 * 1024 ** 2, name, 'Reference text limit', 'LIMIT_EXCEEDED')
    if (!unchanged(name)) new TextDecoder('utf-8', {fatal:true}).decode(bytes)
  }
  // Index actual bytes, not only the manifest, so undeclared resources are still checked.
  const bundleFiles = Map.groupBy(files, ([name]) => name.startsWith('bundles/') ? name.split('/')[1] : null)
  const bundleAssets = Map.groupBy(manifest.assets.flatMap(asset=>assetContents(asset).map(content=>({...asset,...content}))), asset => asset.bundleKey)
  const previousAssets = previous && Map.groupBy(previous.manifest.assets.flatMap(asset=>assetContents(asset).map(content=>({...asset,...content}))), asset => asset.bundleKey)
  for (const [key, bundle] of Object.entries(manifest.bundles)) {
    const prefix = `bundles/${key}/`, entries = bundleFiles.get(key) || [], assets = bundleAssets.get(key) || []
    if (previous?.manifest.bundles[key] && canonicalJson(previous.manifest.bundles[key]) === canonicalJson(bundle)
      && entries.every(([name]) => unchanged(name))
      && canonicalJson(previousAssets.get(key) || []) === canonicalJson(assets)) {
      for (const asset of assets) if (asset.kind === 'widgets') widgets[asset.id] = previous.widgets[asset.id]
      continue
    }
    if (bundle.kind === 'widget') {
      const prefix = 'bundles/' + key + '/', entry = prefix + bundle.entry
      const document = widgetContract.forkValidateWidgetDocument(readDocument(files.get(entry)))
      const base = prefix + (path.posix.dirname(bundle.entry) === '.' ? '' : path.posix.dirname(bundle.entry) + '/')
      for (const file of [document.view.entry, ...Object.values(document.assets || {}).map(asset => asset.path)]) check(files.has(base + file), entry, 'Missing widget private resource: ' + file, 'MISSING_DEPENDENCY')
      for (const asset of assets) if (asset.kind === 'widgets') {
        widgetContract.forkValidateWidgetSettingValues(document, asset.settingsDefaults)
        widgetContract.forkWidgetResolveSettings(document, asset.settingsDefaults)
        widgets[asset.id] = document
      }
      continue
    }
    // private fork: embedded performance themes have the same closed resource validation.
    if (bundle.kind === 'skin' || bundle.kind === 'performance') {
      const prefix = 'bundles/' + key + '/', entry = prefix + bundle.entry
      check(files.get(entry)?.length <= 262144,entry,'Theme document exceeds 256 KiB','LIMIT_EXCEEDED')
      const document = readDocument(files.get(entry))
      const skin = bundle.kind === 'performance' ? performanceContract.validateStagePerformance(document).theme : validateStageSkin(document)
      if (!skin) {
        for (const [name] of entries) check(name === entry, name, 'Executable or undeclared performance resource rejected')
        continue
      }
      if (bundle.kind === 'skin') check(!skin.levels && !skin.overlay, entry, 'Levels and overlays belong to performance themes', 'INVALID_SKIN')
      const dependencies = new Set(stageSkinFiles(skin).map(ref => prefix + path.posix.join(path.posix.dirname(bundle.entry), ref)))
      const overlayFiles = skin.overlay ? await (await import('./skin-overlay-bundle.js')).validateSkinOverlayBundle(skin,{prefix:prefix+(path.posix.dirname(bundle.entry)==='.' ? '' : path.posix.dirname(bundle.entry)+'/'),bundlePrefix:prefix,files,inspectMedia,decodeMedia}) : new Set()
      for (const file of overlayFiles) dependencies.add(file)
      for (const asset of assets) if (asset.kind === 'skins') check(asset.id === skin.id, entry, 'Skin identity differs from asset')
      for (const file of dependencies) check(files.has(file), entry, 'Missing skin resource', 'MISSING_DEPENDENCY')
      for (const [name, bytes] of entries) {
        check(name === entry || dependencies.has(name), name, 'Executable or undeclared skin resource rejected')
        if (name !== entry && !overlayFiles.has(name)) {const ext = path.posix.extname(name).slice(1); const info = await inspectMedia(bytes,{ext,mime:BLOB_MIME_TYPES[ext],size:bytes.length},decodeMedia); check(info.durationMs <= 3000,name,'Skin sound exceeds three seconds')}
      }
      continue
    }
    // private fork (docs/fork/spine-figures.md): skeleton, sibling atlas and its pages; images take the media checks.
    if (bundle.kind === 'spine') {
      const {pages} = validateSpineBundle(bundle.entry, new Map(entries), prefix)
      for (const name of pages) if (!unchanged(name)) {
        const ext = path.posix.extname(name).slice(1).toLowerCase().replace(/^jpg$/, 'jpeg')
        await inspectMedia(files.get(name), {ext, mime:BLOB_MIME_TYPES[ext], size:files.get(name).length}, decodeMedia)
      }
      continue
    }
    if (bundle.kind !== 'live2d') continue
    const entry = prefix + bundle.entry, document = readDocument(files.get(entry))
    check(files.get(entry).length <= 1024 ** 2 && document.FileReferences?.Textures?.length > 0, entry, 'Invalid model entry')
    const base = path.posix.dirname(bundle.entry)
    for (const ref of modelReferences(document, bundle.entry)) {
      const name = ref === bundle.entry ? entry : prefix + (base === '.' ? '' : base + '/') + ref
      check(files.has(name), name, 'Missing relative model resource', 'MISSING_DEPENDENCY')
    }
    for (const [name, bytes] of entries) {
      check(/\.(json|moc3|png|webp|jpe?g|md|txt|wav|mp3|ogg|m4a|flac)$/i.test(name), name, 'Executable model resource rejected')
      if (/\.json$/i.test(name)) readDocument(bytes)
      if (!unchanged(name) && /\.(png|webp|jpe?g|wav|mp3|ogg|m4a|flac)$/i.test(name)) {
        const ext = path.posix.extname(name).slice(1).toLowerCase().replace(/^jpg$/, 'jpeg')
        await inspectMedia(bytes, {ext, mime:BLOB_MIME_TYPES[ext], size:bytes.length}, decodeMedia)
      }
    }
  }
  for (const figure of Object.values(figures)) for (const outfit of figure.outfits) if (outfit.sprite) {
    const sprite = sprites[outfit.sprite.manifestKey]
    if (sprite.kind === 'hybrid-face-sprites') for (const [rigId,rig] of Object.entries(sprite.rigs)) for (const [partId,part] of Object.entries(rig.parts)) {
      const hash = outfit.sprite.assets[part.src], info = images.get(hash)
      check(manifest.blobs[hash]?.ext === 'png','$.part.src','Layered part must bind a PNG blob')
      check(info?.width === part.rect[2] && info?.height === part.rect[3],'$.part.rect','Part decoded dimensions mismatch')
      const old = previous?.sprites[outfit.sprite.manifestKey]?.rigs?.[rigId]?.parts?.[partId]
      const file = 'media/'+hash+'.png'
      if (!unchanged(file) || !old || canonicalJson(old) !== canonicalJson(part)) {
        check(canonicalJson(partAlphaBox(files.get(file))) === canonicalJson(part.bbox),'$.part.bbox','Part bbox differs from alpha>8 pixels')
      }
    }
    if(sprite.kind==='hybrid-face-sprites')for(const {render:r}of Object.values(sprite.emotions))if(r.kind==='parts'&&r.preview) {
      const hash=outfit.sprite.assets[r.preview],info=images.get(hash),canvas=sprite.rigs[r.rig].canvas
      check(manifest.blobs[hash]?.ext==='png'&&info?.width===canvas[0]&&info?.height===canvas[1],'$.render.preview','Preview must match rig canvas')
    }
    function walk(value) {
      if (!value || typeof value !== 'object') return
      if (value.src && value.width !== undefined) {
        const info = images.get(outfit.sprite.assets[value.src])
        check(info?.width === value.width && info?.height === value.height, '$.sprite', 'Sprite decoded dimensions mismatch')
      }
      if (value.mouthOcclusionMask) {
        const mask = images.get(outfit.sprite.assets[value.mouthOcclusionMask])
        check(mask?.width === value.width && mask?.height === value.height, '$.sprite', 'Sprite mask dimensions mismatch')
      }
      if (Array.isArray(value.canvas) && value.frames) for (const source of Object.values(value.frames)) {
        const info = images.get(outfit.sprite.assets[source])
        check(info?.width === value.canvas[0] && info?.height === value.canvas[1], '$.sprite', 'Mouth rig frame dimensions mismatch')
      }
      if (value.binding) {
        const info = images.get(outfit.sprite.assets[value.src])
        check(info?.width === value.binding.canvas[0] && info?.height === value.binding.canvas[1], '$.sprite', 'Flat sprite canvas mismatch')
      }
      // private fork: blink patches are exact rect-sized rasters inside their own base image.
      if (value.blink && value.src) {
        const base = images.get(outfit.sprite.assets[value.src]), [x, y, w, h] = value.blink.rect
        check(base && x + w <= base.width && y + h <= base.height, '$.sprite', 'Blink rect outside the sprite')
        for (const patch of [value.blink.closed, value.blink.half].filter(Boolean)) {
          const info = images.get(outfit.sprite.assets[patch])
          check(info?.width === w && info?.height === h, '$.sprite', 'Blink patch dimensions mismatch')
        }
      }
      Object.values(value).forEach(walk)
    }
    walk(sprite)
  }
  // Retain the established per-use byte limits in addition to the aggregate cap.
  for (const asset of manifest.assets) if (asset.kind === 'backgrounds') for (const {hash} of assetContentMedia(asset)) check(manifest.blobs[hash].size <= 4 * 1024 ** 2, '$.backgrounds', 'Background byte limit', 'LIMIT_EXCEEDED')
  for (const figure of Object.values(figures)) for (const outfit of figure.outfits) for (const hash of Object.values(outfit.avatars || {})) check(manifest.blobs[hash].size <= 3 * 1024 ** 2, '$.avatars', 'Avatar byte limit', 'LIMIT_EXCEEDED')
  const skins = Object.fromEntries(manifest.assets.filter(a => a.kind === 'skins').map(a => [a.id,validateStageSkin(readDocument(files.get('bundles/' + assetContent(a).bundleKey + '/' + assetContent(a).entry)))]))
  const performances = Object.fromEntries(manifest.assets.filter(a => a.kind === 'performances').map(a => [a.id, readDocument(files.get('bundles/' + assetContent(a).bundleKey + '/' + assetContent(a).entry))]))
  validatePerformancePack(manifest, performances, skins)
  const variantDocuments = {}
  for (const asset of manifest.assets) if (asset.variants && ['skins','performances','widgets'].includes(asset.kind)) {
    const documents = {}
    for (const row of asset.variants.entries) {
      const document = readDocument(files.get('bundles/'+row.content.bundleKey+'/'+row.content.entry))
      documents[row.id] = document
      if (asset.kind === 'performances') validatePerformancePack(manifest,{...performances,[asset.id]:document},skins)
    }
    variantDocuments[asset.kind+'/'+asset.id] = documents
  }
  // Default projections remain convenient for callers that do not select a variant.
  for (const asset of manifest.assets.filter(asset=>asset.kind==='widgets'&&asset.variants)) widgets[asset.id]=variantDocuments['widgets/'+asset.id][asset.variants.default]
  return {manifest, figures, sprites, widgets, variantDocuments, files, ...(Object.keys(skins).length ? {skins} : {}), ...(Object.keys(performances).length ? {performances} : {})}
}
// Inspection only: local authoring/copy mutations never create consent state.
export function inspectPackScripts(pack) {
  const widgetAssets = pack.manifest.assets.filter(asset => asset.kind === 'widgets').flatMap(asset=>assetContents(asset).map((content,index)=>({...asset,...content,document:assetDocument(pack,asset,asset.variants?.entries[index].id)})))
  const widgetsByBundle = Map.groupBy(widgetAssets, asset => asset.bundleKey)
  const scripts = [...pack.files].filter(([path,bytes]) => /\.(?:[cm]?js|jsx|tsx?|wasm)$/i.test(path) || /\.(?:html?|svg|css)$/i.test(path) && /<\s*script\b|\bon[a-z]+\s*=|javascript\s*:|srcdoc\s*=/i.test(bytes.toString('utf8'))).flatMap(([path]) => {
    const widgets = path.startsWith('bundles/') ? widgetsByBundle.get(path.split('/')[1]) || [] : []
    return (widgets.length ? widgets : [null]).map(asset => ({packId:pack.manifest.id,packName:pack.manifest.name,path,...(asset ? {widgetId:asset.id,widgetName:asset.name} : {})}))
  });
  for (const asset of widgetAssets) {
    const variables = asset.document?.variables
    if (!variables || !Object.keys(variables.reads || {}).length && !Object.keys(variables.writes || {}).length) continue
    scripts.push({packId:pack.manifest.id,packName:pack.manifest.name,widgetName:asset.name,path:'bundles/' + asset.bundleKey + '/' + asset.entry,widgetId:asset.id,
      variables:{reads:Object.entries(variables.reads || {}).map(([id,read]) => ({id,...read,includesChildren:true})),
        writes:Object.entries(variables.writes || {}).map(([id,write]) => ({id,...write,includesChildren:write.scope === 'subtree'}))}})
  }
  return scripts;
}
export function packDiff(before, after) {
  const changes = (left, right, key) => {
    const a = new Map(left.map(v => [key(v), v])), b = new Map(right.map(v => [key(v), v]))
    return {added:[...b.keys()].filter(k => !a.has(k)), removed:[...a.keys()].filter(k => !b.has(k)), changed:[...b.keys()].filter(k => a.has(k) && canonicalJson(a.get(k)) !== canonicalJson(b.get(k)))}
  }
  return {metadataChanged:before?.contentHash !== after?.contentHash, assets:changes(before?.assets || [], after?.assets || [], a => a.kind + '/' + a.id), files:changes(before?.files || [], after?.files || [], f => f.path), figures:changes((before?.files || []).filter(f => f.path.startsWith('figures/')), (after?.files || []).filter(f => f.path.startsWith('figures/')), f => f.path), affectedCards:{status:'unknown'}}
}
