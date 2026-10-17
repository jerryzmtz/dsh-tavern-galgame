import { sha } from './fork-mouth-rig.mjs'
export function spriteFixture(source = 'assets/test.webp', count = 11) {
  const frameIds = ['a', 'i', 'u', 'e', 'o', 'closed_patch', 'tense_a']
  const view = (x, y) => ({ src: source, width: 8, height: 8, mouth: { x, y, w: 2, h: 1 } })
  return { version: 2, kind: 'layered-static-sprites', closedBehavior: 'restore-base', character: { id: 'synthetic', name: '合成测试角色' }, defaultState: 'calm',
    mouthAtlas: { src: source, width: 8, height: 8, frames: Object.fromEntries(frameIds.map((id, i) => [id, { x: i, y: 0, w: 1, h: 1 }])), defaultFrames: Object.fromEntries(['a', 'i', 'u', 'e', 'o'].map(id => [id, id])) },
    states: Array.from({ length: count }, (_, i) => ({ id: ['calm', 'sadness', 'nervous', 'signature'][i] || 'state_' + i, label: '状态 ' + i, emotion: i === 3 ? 'joy' : ['calm', 'sadness', 'nervous'][i] || 'state_' + i, stage: view(1, 2), portrait: view(4, 5), ...(i === 3 ? { initialPhoneme: 'a', mouthFrames: { closed: 'closed_patch', a: 'tense_a' }, closedMouthFrame: 'closed_patch' } : {}) })) }
}
// private fork: native ingress fixture is distinct from the low-level compositor's state projection.
export function nativeSpriteFixture(raw = spriteFixture()) {
  const {states,defaultState,...manifest}=structuredClone(raw)
  const aliases={default:'calm',sadness:'sad',nervous:'anxious'}
  return {...manifest,emotions:Object.fromEntries(states.map(({id,label,emotion,...render})=>[aliases[emotion||id]||emotion||id,render]))}
}
export function spriteIndex() { return { version: 2, portraits: [{ id: 'sp0123456789', label: '合成角色', images: { default: sha }, talk: {}, spritePack: spriteFixture(sha) }] } }
export function storedZip(files, options = {}) {
  const chunks = [], directory = []; let offset = 0
  const crc32 = bytes => { let n = 0xffffffff; for (const b of bytes) { n ^= b; for (let i = 0; i < 8; i++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0) } return (n ^ 0xffffffff) >>> 0 }
  for (const [name, value] of files) {
    const bytes = Buffer.from(value), encoded = Buffer.from(name), crc = crc32(bytes), local = Buffer.alloc(30), central = Buffer.alloc(46)
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt32LE(crc, 14); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(encoded.length, 26)
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt32LE(crc, 16); central.writeUInt32LE(bytes.length, 20); central.writeUInt32LE(options.declaredLength ?? bytes.length, 24); central.writeUInt16LE(encoded.length, 28); central.writeUInt32LE(offset, 42)
    chunks.push(local, encoded, bytes); directory.push(central, encoded); offset += local.length + encoded.length + bytes.length
  }
  const central = Buffer.concat(directory), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...chunks, central, end])
}
