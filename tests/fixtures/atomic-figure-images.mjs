// private fork: test images enter the pack with their figure binding in one CAS transaction.
import {createHash} from 'node:crypto'
export async function patchFigureImages(service, snapshot, figureId, images, patch) {
  const blobs = {...snapshot.manifest.blobs}, fileUpdates = new Map(), hashes = {}
  for (const [key, bytes] of Object.entries(images)) {
    const hash = createHash('sha256').update(bytes).digest('hex')
    hashes[key] = hash
    blobs[hash] = {ext:'png',mime:'image/png',size:bytes.length}
    fileUpdates.set('media/' + hash + '.png', bytes)
  }
  const figure = {...snapshot.figures[figureId],...patch(hashes)}
  fileUpdates.set('figures/' + figureId + '.json', Buffer.from(JSON.stringify(figure)))
  return {...await service.patchPack({packId:snapshot.manifest.id,expectedRevision:snapshot.revision,patch:{blobs},fileUpdates}),hashes}
}
