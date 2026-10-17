// Recursive copy/remove built only on libuv primitives. Node's native fs.cpSync
// and recursive fs.rmSync mishandle non-ASCII Windows paths (e.g. a Chinese user
// name): cpSync fails or crashes, rmSync silently deletes nothing. Fixed upstream
// only in late Node 24 releases (nodejs/node#61878, #56049); installers must not
// depend on the user's Node being new enough.
import { copyFileSync, lstatSync, mkdirSync, readdirSync, readlinkSync, rmdirSync, statSync, symlinkSync, unlinkSync } from 'node:fs'
import path from 'node:path'

const sleep = milliseconds => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)

export function copyTreeSync(from, to, { dereference = false } = {}) {
  const stat = dereference ? statSync(from) : lstatSync(from)
  if (stat.isSymbolicLink()) {
    symlinkSync(readlinkSync(from), to, process.platform === 'win32' && statSync(from, { throwIfNoEntry: false })?.isDirectory() ? 'dir' : undefined)
  } else if (stat.isDirectory()) {
    mkdirSync(to, { recursive: true })
    for (const name of readdirSync(from)) copyTreeSync(path.join(from, name), path.join(to, name), { dereference })
  } else {
    mkdirSync(path.dirname(to), { recursive: true })
    copyFileSync(from, to)
  }
}

// Like rmSync(target, { recursive: true, force: true }); links are removed, never followed.
// Windows may briefly hold handles (antivirus, indexer), so busy entries are retried.
export function removeTreeSync(target, { retries = 0, retryDelay = 100 } = {}) {
  let stat
  try { stat = lstatSync(target) } catch (error) { if (error.code === 'ENOENT') return; throw error }
  if (stat.isDirectory()) for (const name of readdirSync(target)) removeTreeSync(path.join(target, name), { retries, retryDelay })
  for (let attempt = 0; ; attempt++) {
    try {
      if (!stat.isDirectory()) unlinkSync(target)
      else rmdirSync(target)
      return
    } catch (error) {
      if (error.code === 'ENOENT') return
      // Windows directory symlinks and junctions are unlinked with rmdir.
      if (stat.isSymbolicLink() && ['EPERM', 'EISDIR'].includes(error.code)) { try { rmdirSync(target); return } catch {} }
      if (attempt >= retries || !['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY'].includes(error.code)) throw error
      sleep(retryDelay)
    }
  }
}
