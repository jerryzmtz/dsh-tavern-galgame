// Optional v1 metadata; absent/invalid values must not invalidate legacy asset indexes.
export function validLoudness(value) {
  return value?.v === 1 && Number.isFinite(value.lufs) && value.lufs >= -100 && value.lufs <= 10 && Number.isFinite(value.peak) && value.peak >= -100 && value.peak <= 20
}
