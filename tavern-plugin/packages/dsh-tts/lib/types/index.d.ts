import type { Context } from '@deepseek-ai/cordis'
export interface VoiceRef { source: string; id: string }
// private fork: normalized at the dictionary entry boundary.
export interface Reading { forms: string[]; reading: string; language: string; inferredLanguage: 'ja' | 'zh' | 'en'; warnings: string[]; languageOverride?: string }
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
/** private fork: opaque provider requirements, bounded JSON without paths or credentials. */
export type ModelRequirement = Record<string,JsonValue>
export interface PortableVoice {
  schemaVersion: 1; id: string; label: string; enabled: boolean
  kind: 'service' | 'reference' | 'gpt-sovits-api' | 'azure' | 'volcengine' | 'qwen' | 'fish-audio' | 'openai-compatible'
  voiceId?: string; engine?: string; revision?: string; modelSetId?: string; modelVersion?: string
  languages: string[]; params: Record<string, unknown> & { moods?: Record<string, string | null>; styles?: boolean }; moodStyles?: Record<string, string>
  model?: ModelRequirement
  /** Ordered clips including repeated entries; byte/count limits are provider capabilities. */
  references?: {sha256: string; transcript: string; language: string; file?: string}[]
}
export interface VoicePreset extends PortableVoice { kind: 'service' | 'azure' | 'qwen' | 'fish-audio' | 'volcengine' | 'openai-compatible' | 'gpt-sovits-api'; providerId?: string }
export interface VoicePresetImportResult { added: string[]; unchanged: string[]; conflicts: string[] }
declare const consumerGrant: unique symbol
export type ConsumerGrant = { readonly [consumerGrant]: true }
export interface VoiceSourceInput {
  owner: string; sourceId: string; revision: string; voices: PortableVoice[]
  bindings: Record<string,string>
  readReference?(hash: string): Uint8Array | Promise<Uint8Array>
}
export interface ResolvedSynthesis {
  text: string; language: string; params: Record<string,unknown>; identity: string
  voiceId?: string; revision?: string
  mood?: string; resolvedMood?: string | null; model?: ModelRequirement; readingsRevision: string
  reference?: {sha256: string; bytes: Uint8Array; ext?: 'wav' | 'mp3'; mime?: 'audio/wav' | 'audio/mpeg'; transcript: string; promptText: string; promptLanguage: string}
  /** private fork: bytes-list-v1 opt-in; the complete ordered reference set; single-reference providers use index 0. */
  references?: NonNullable<ResolvedSynthesis['reference']>[]
}
export interface Provider {
  id: string; kind: PortableVoice['kind'] | 'reference-api'; revision: string
  capabilities: {referenceInput?: string[]; serviceVoiceEngines?: string[]; voiceKinds?: string[]; portableExport?: boolean; catalogue?: boolean; paid?: boolean; warmupTimeoutMs?: number}
  onRequest?(): void
  /** private fork: JSON wire closure; media values are base64 PCM WAV or MP3, keyed by SHA256. */
  exportVoice?(input: {voiceId: string; revision: string}, options?: {signal?: AbortSignal}): Promise<{voice: PortableVoice; media: Record<string,string>}>
  health(options: {signal?: AbortSignal}): Promise<unknown>
  catalog(options: {signal?: AbortSignal}): Promise<unknown[]>
  synthesize(input: ResolvedSynthesis, options: {signal: AbortSignal}): Promise<Uint8Array>
}
export interface FishVoice {
  voiceId:string; name:string; languages:string[]; gender:string|null; toneTags:string[]; visibility:string; licensed:boolean|null; licenseNote:string
  approval?:'candidate'|'approved'; verification?:{status:'passed'|'failed'|'unverified';model?:string;checkedAt?:string;samplePath?:string}
}
export interface ServiceVoice {
  id: string; label: string; engine: string; languages: string[]; state: string; revision: string; serviceId?: string
  preset?: boolean; modelSetId?: string; modelVersion?: string; params?: Record<string, unknown>
}
export interface ServiceSynthesis { voiceId: string; text: string; language: string; mood?: string }
/** Host consumer service; unregistered while native tts.enabled is false. */
export interface Tts {
  readonly apiVersion: 1
  registerProvider(owner: string, provider: Provider): () => void
  registerReferenceProvider(owner: string, connection: {id: string; url: string; key: string; revision?: string; paid?: boolean; lifecycle?: {
    readinessTimeoutMs: number; ready(): boolean; onRequest(): void
    begin(): () => void; start(options: {signal?: AbortSignal}): Promise<void>
  }}): () => void
  registerVoiceSource(input: VoiceSourceInput): {source: string; replace(next: VoiceSourceInput, expectedRevision: string): void; dispose(): void}
  grantConsumer(input: {principal: string; source: string; scope: string; authorize?: (input: unknown, provider: {serviceId:string;serviceRevision:string}) => void}): {grant: ConsumerGrant; dispose(): void}
  listRecommendedFishVoices(): {voices:FishVoice[]}
  listServiceVoices(): Promise<ServiceVoice[]>
  exportVoicePresets(ids: string[]): Promise<VoicePreset[]>
  /** private fork: validated figure authoring closure, with decoded reference bytes. */
  exportPortableVoice(input: {voiceId: string; serviceId?: string}): Promise<{voice: PortableVoice; media: Record<string,Uint8Array>}>
  importVoicePresets(input: {presets: VoicePreset[]}): Promise<VoicePresetImportResult>
  grantServiceConsumer(input: {principal: string; scope: string}): {grant: ConsumerGrant; dispose(): void}
  synthesize(input: ServiceSynthesis | {voice: VoiceRef; mood: string; text: string; language: string}, options: {grant: ConsumerGrant; scope: string; signal?: AbortSignal}): Promise<{key: string; mime: 'audio/wav'; cacheHit: boolean}>
  readAudio(input: {key: string; grant: ConsumerGrant}): Promise<Uint8Array>
  createAudioTicket(input: {key: string; grant: ConsumerGrant; ttlMs?: number}): Promise<string>
  subscribe(listener: (event: {type: string; source?: string; serviceId?: string; epoch?: number}) => void): () => void
  dispose(): Promise<void>
}
export const name: 'dsh-tts'
export function apply(ctx: Context, config?: {profileId?: string; dataDir?: string; settings?: object}): void

/** Optional browser service, unprovided while native tts.enabled is false.
 * Look up ctx.get('ttsClient') for each speech operation; no enabled-change API.
 * Host-issued source/scope grants remain mandatory.
 */
export interface TtsClient {
  readonly apiVersion: 1;
  available(): boolean;
  listVoices(): Promise<ServiceVoice[]>;
  subscribe(listener: (event: {type: 'unavailable' | 'voicesChanged'}) => void): () => void;
  call(method: string, args?: Record<string, unknown>): Promise<unknown>;
  synthesize(input: ServiceSynthesis | {voice: VoiceRef; text: string; language: string; mood?: string}, options: {scope: string; signal?: AbortSignal}): Promise<{key: string; ticket: string; mime: string; cacheHit: boolean; durationMs?: number}>;
  audio(ticket: string, options?: {signal?: AbortSignal}): Promise<Blob>;
  audioUrl(ticket: string): string;
}
// private fork (docs/fork/reading-dictionary.md): global reading presets (control RPC readingPresets / readingPreset / editReading / …).
export interface ReadingPresetSummary { id: string; name: string; count: number; revision: number }
export interface ReadingPresets { active: string; presets: ReadingPresetSummary[] }
export interface ReadingPresetDocument { version: 1; kind: 'dsh-tts-readings'; name: string; entries: { forms: string[]; reading: string; languageOverride?: string }[] }
