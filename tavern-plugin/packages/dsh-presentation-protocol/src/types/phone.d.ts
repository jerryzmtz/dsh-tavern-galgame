export interface PhoneMarker { op: 'phone.message'; contact: string; side: 'in' | 'out' }
export interface PhonePage { para: number; kind: string; alias?: string; name?: string }
// private fork: source names resolve to the canonical alias before marker projection.
export interface PhoneCharacter { alias: string; name?: string; aliases?: string[]; enabled?: boolean; ref?: { packId: string; figureId: string } }
export interface Rect { x: number; y: number; width: number; height: number }
export interface PhoneProjection<P extends PhonePage> {
  active: boolean; current: PhoneMarker | null; messages: { line: P; mark: PhoneMarker; continued: boolean }[]; key: string;
  contact?: string; first?: number; last?: number;
}
export function forkPhoneMarker(raw: unknown, unit: PhonePage, characters: PhoneCharacter[]): PhoneMarker | null;
export function forkPhoneProjection<P extends PhonePage>(pages: P[], at: number, record: { status: string; key: string; entries: { at: number; commands?: unknown[] }[] }, characters: PhoneCharacter[]): PhoneProjection<P>;
export function forkPhoneSize(width: number): { screenWidth: number; width: number; height: number };
export function forkPhonePlace(options: { width: number; height: number; figures?: unknown[]; blocked?: Rect[]; size: { width: number; height: number }; previous?: Rect }): Rect | null;
export function forkPhoneLayout(options: { width: number; height: number; figures?: unknown[]; blocked?: Rect[]; caption?: Rect; previous?: Rect; compactPrevious?: Rect }): (Rect & { compact: boolean }) | null;
