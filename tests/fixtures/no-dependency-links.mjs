// private fork: the Windows worktree must never create symlinks/junctions into live dependencies.
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'

const error = () => new Error('Test safety: creating symlinks/junctions is prohibited')
fs.symlinkSync = () => { throw error() }
fs.symlink = (...args) => args.at(-1)(error())
fsp.symlink = async () => { throw error() }
syncBuiltinESMExports()
