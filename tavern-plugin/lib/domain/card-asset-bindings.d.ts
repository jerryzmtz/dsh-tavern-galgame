import type { FigureRef, UUID } from '../../packages/dsh-presentation-protocol/src/types/asset-packs.js';
// private fork: a card owns only story identity and appearance; figures own character data.
export interface CardAssetBindings { boundPackIds: UUID[] }
export interface CardStageSettings { defaultSkin?: 'classic' | 'gothic' | 'magical' | 'crt' | 'aero' | {packId: UUID; kind: 'skins'; assetId: string}; dialogue?: boolean; voice?: boolean; stage?: boolean; music?: boolean; sfx?: boolean; ambience?: boolean; widgets?: boolean; dimensions?: Record<string, boolean> }
export interface CardVariableBindings { version: 1; entries: { target: { kind: 'widgets'; ref: { packId: UUID; kind: 'widgets'; assetId: string }; slot: string }; variable: { source: 'mvu' | 'helper-chat'; path: string } }[] }
export interface CardAssetExtension { variableBindings?: CardVariableBindings; stage?: CardStageSettings; schemaVersion: 1; assetBindings: CardAssetBindings; [key: string]: unknown }
export function validateCardAssetExtension(value: unknown, path?: string): CardAssetExtension;
export function cardAssetExtensionPointer(raw: object): string;
export function readCardAssetExtension(raw: object): CardAssetExtension | undefined;
export function cardAssetRawOperations(raw: object, patch: Partial<Pick<CardAssetExtension, 'assetBindings' | 'stage' | 'openings' | 'variableBindings'>>): { op: 'set'; path: string; value: unknown }[];
