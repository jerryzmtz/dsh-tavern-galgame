// Untrusted runtime archives: inspect paths and limits before selecting bytes; never extract to disk.
import { inflateRawSync, gunzipSync } from 'node:zlib'

const MiB = 1024 * 1024
const fail = message => { throw new Error('运行库归档无效：' + message) }
const text = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes)
function safeName(name) {
  if (!name || name.length > 1024 || /[\\:\x00-\x1f]/.test(name) || name.startsWith('/') || name.split('/').some(x => x === '..' || x === '.')) fail('不安全的文件路径')
  return name
}
function candidate(name) {
  const base = name.split('/').pop()
  if (/^live2dcubismcore(?:\.min)?\.js$/.test(base)) return 'core'
  if (/^(?:cubism4(?:\.min)?|pixi-live2d-display-cubism4\.min)\.js$/.test(base)) return 'display'
}
export function decodeRuntimeInput({ name, base64, consent } = {}) {
  if (consent !== true) throw new Error('请先确认持有有效许可并同意运行库许可条款')
  if (typeof name !== 'string' || !/^[^/\\:]+\.(?:js|zip|tgz|tar\.gz)$/i.test(name)) fail('请选择 JS、ZIP 或 npm TGZ 文件')
  if (typeof base64 !== 'string' || !base64.length || base64.length > Math.ceil(50 * MiB / 3) * 4 || base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) fail('编码无效或文件超过 50 MiB')
  const body = Buffer.from(base64, 'base64')
  if (body.length > 50 * MiB || body.toString('base64') !== base64) fail('编码无效或文件超过 50 MiB')
  if (/\.js$/i.test(name)) {
    if (body.length > 8 * MiB) fail('JS 超过 8 MiB')
    return [{ name, body, kind: candidate(name) }]
  }
  try { return /\.zip$/i.test(name) ? zip(body) : tar(body) }
  catch (error) {
    if (error.message.startsWith('运行库归档无效：')) throw error
    fail('内容损坏、编码无效或解压超过限制')
  }
}
function collector() {
  const names = new Set(), found = [], kinds = new Set()
  let count = 0, total = 0
  return {
    entry(name, size, compressed = size) {
      safeName(name)
      if (++count > 10000 || !Number.isSafeInteger(size) || size < 0 || (total += size) > 150 * MiB || size > Math.max(1, compressed) * 200) fail('文件数、解压大小或压缩比超过限制')
      if (names.has(name)) fail('重复文件路径')
      names.add(name)
      const kind = candidate(name)
      if (kind) {
        if (size > 8 * MiB) fail('运行库超过 8 MiB')
        const key = kind + ':' + /\.min\.js$/.test(name)
        if (kinds.has(key)) fail('存在多个同类运行库文件')
        kinds.add(key)
      }
      return kind
    },
    add(name, body, kind) { if (kind) found.push({ name: name.split('/').pop(), body, kind }) },
    result() {
      return found.filter(x => /\.min\.js$/.test(x.name) || !found.some(y => y.kind === x.kind && /\.min\.js$/.test(y.name)))
    }
  }
}
function zip(b) {
  const c = collector()
  let end = -1
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (b.readUInt32LE(i) === 0x06054b50 && i + 22 + b.readUInt16LE(i + 20) === b.length) { end = i; break }
  }
  if (end < 0) fail('ZIP 目录缺失')
  const count = b.readUInt16LE(end + 10), length = b.readUInt32LE(end + 12), start = b.readUInt32LE(end + 16)
  if (b.readUInt16LE(end + 4) || b.readUInt16LE(end + 6) || count !== b.readUInt16LE(end + 8) || count === 65535 || start + length !== end) fail('不支持多卷或 ZIP64')
  if (count > 10000) fail('文件数量超过限制')
  let offset = start
  const rows = []
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || b.readUInt32LE(offset) !== 0x02014b50) fail('ZIP 中央目录损坏')
    const flags = b.readUInt16LE(offset + 8), method = b.readUInt16LE(offset + 10), packed = b.readUInt32LE(offset + 20), size = b.readUInt32LE(offset + 24)
    const nl = b.readUInt16LE(offset + 28), el = b.readUInt16LE(offset + 30), cl = b.readUInt16LE(offset + 32), local = b.readUInt32LE(offset + 42)
    const next = offset + 46 + nl + el + cl
    if (next > end || flags & 1 || ![0, 8].includes(method) || b.readUInt16LE(offset + 34)) fail('ZIP 加密或格式不支持')
    const mode = b.readUInt32LE(offset + 38) >>> 16
    if ((mode & 0xf000) && ![0x8000, 0x4000].includes(mode & 0xf000)) fail('不支持链接或特殊文件')
    const name = text(b.subarray(offset + 46, offset + 46 + nl)), kind = c.entry(name, size, packed)
    if (local + 30 > start || b.readUInt32LE(local) !== 0x04034b50 || b.readUInt16LE(local + 6) !== flags || b.readUInt16LE(local + 8) !== method) fail('ZIP 本地头损坏')
    const lnl = b.readUInt16LE(local + 26), lel = b.readUInt16LE(local + 28), data = local + 30 + lnl + lel
    if (data + packed > start || text(b.subarray(local + 30, local + 30 + lnl)) !== name || method === 0 && size !== packed) fail('ZIP 内容越界或不一致')
    rows.push({ name, kind, size, packed, method, data, local, crc: b.readUInt32LE(offset + 16) })
    offset = next
  }
  if (offset !== end) fail('ZIP 目录长度不一致')
  const sorted = [...rows].sort((a, b) => a.local - b.local)
  for (let i = 1; i < sorted.length; i++) if (sorted[i].local < sorted[i - 1].data + sorted[i - 1].packed) fail('ZIP 条目重叠')
  for (const r of rows) {
    if (!r.kind) continue
    const packed = b.subarray(r.data, r.data + r.packed)
    const body = r.method === 0 ? packed : inflateRawSync(packed, { maxOutputLength: Math.max(1, r.size) })
    if (body.length !== r.size || crc32(body) !== r.crc) fail('ZIP 校验失败')
    c.add(r.name, body, r.kind)
  }
  return c.result()
}
const crcTable = Array.from({ length: 256 }, (_, n) => { for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0 })
function crc32(b) { let n = 0xffffffff; for (const v of b) n = crcTable[(n ^ v) & 255] ^ (n >>> 8); return (n ^ 0xffffffff) >>> 0 }
function tar(input) {
  const b = gunzipSync(input, { maxOutputLength: Math.min(150 * MiB, input.length * 200) }), c = collector()
  const field = (offset, length) => text(b.subarray(offset, offset + length)).replace(/\0.*$/s, '')
  let offset = 0, ended = false
  while (offset + 512 <= b.length) {
    if (b.subarray(offset, offset + 512).every(x => x === 0)) { ended = true; break }
    const numeric = value => { if (!/^[0-7]+$/.test(value.trim())) fail('TAR 数字无效'); return parseInt(value.trim(), 8) }
    const size = numeric(field(offset + 124, 12)), sum = numeric(field(offset + 148, 8))
    let actual = 0
    for (let i = 0; i < 512; i++) actual += i >= 148 && i < 156 ? 32 : b[offset + i]
    if (actual !== sum) fail('TAR 校验失败')
    const prefix = field(offset + 345, 155), name = (prefix ? prefix + '/' : '') + field(offset, 100), type = b[offset + 156]
    if (![0, 48, 53].includes(type)) fail('不支持 TAR 链接、扩展头或特殊文件')
    const kind = c.entry(name, size)
    const next = offset + 512 + Math.ceil(size / 512) * 512
    if (next > b.length) fail('TAR 内容截断')
    if (type === 53 && size) fail('TAR 目录含数据')
    if (type !== 53) c.add(name, b.subarray(offset + 512, offset + 512 + size), kind)
    offset = next
  }
  if (!ended || b.length - offset < 1024 || !b.subarray(offset).every(x => x === 0)) fail('TAR 结束块无效')
  return c.result()
}
