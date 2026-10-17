import type { Context } from '@deepseek-ai/cordis'
import type { ComponentType } from 'react'
export interface LocalStatus {
  state: 'unconfigured' | 'stopped' | 'starting' | 'ready' | 'stopping' | 'error'
  configRevision: string; stale: boolean; error: string; vramBytes?: number
  voiceCount: number
}
export interface TtsLocal {
  readonly apiVersion: 1
  status(): LocalStatus
  start(input?: {expectedRevision?: string}): Promise<LocalStatus>
  stop(): Promise<LocalStatus>
  restart(input?: {expectedRevision?: string}): Promise<LocalStatus>
  recentLogs(input?: {after?: number; limit?: number}): {cursor: number; items: {cursor: number; stream: string; text: string}[]}
  subscribe(listener: (event: {type: string; generation: number}) => void): () => void
  dispose(): Promise<void>
}
/** Optional browser service; the same panel is used by settings and the voice tab. */
export interface TtsLocalClient {
  readonly apiVersion: 1
  call(method: string, args?: Record<string, unknown>): Promise<unknown>
  Panel: ComponentType
}
export const name: 'dsh-tts-local'
export const inject: ['subprocess']
export function apply(ctx: Context, config?: {settings?: object}): void
