import type { JsonObject } from './index.js';
import type { Weather } from './playback.js';
export type SoundTag = 'empty' | 'open' | 'sheltered' | 'sealed';
export interface SoundscapeState { sceneKey: string; scene: string; weather: Weather; tags: SoundTag[] }
export interface SoundscapePreset { place: string; exposure: 'open' | 'indoor' | 'sheltered' | 'sealed'; people?: boolean; warnings: string[] }
export interface SoundscapePlan { version: number; layers: (JsonObject & { slot: 'place' | 'weather'; id: string; url: string; gain: number; lowpassHz: number | null })[]; warnings: string[] }
export function forkSoundscapeTags(raw: unknown): { tags: SoundTag[] | null; errors: string[] };
export function forkSoundscapeInitial(start: unknown): SoundscapeState | null;
export function forkSoundscapeReplay(start: unknown, entries: unknown[], para?: number): SoundscapeState | null;
export function forkSoundscapeCarry(state: unknown): SoundscapeState | null;
export function forkSoundscapePreset(scene: unknown): SoundscapePreset;
export function forkSoundscapePlan(state: unknown, scene: unknown, sounds: unknown[]): SoundscapePlan;
export function forkSoundscapeSceneSnapshots(scenes: unknown[]): readonly JsonObject[];
export function forkSoundscapeRecordPlan(direction: unknown, para: number, sounds: unknown[]): SoundscapePlan;
