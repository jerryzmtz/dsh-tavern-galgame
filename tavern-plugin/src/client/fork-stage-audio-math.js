// BS.1770-4: K weighting, 400 ms blocks / 100 ms steps, absolute and relative gating.
// Kept platform-free so the browser fallback can be checked against ffmpeg in Node.
const FORK_AUDIO_TARGETS = Object.freeze({ voice: -18, music: -23, sfx: -20, ambience: -28 });
// Five normalized cached voice outputs: -21.3..-22.1 LUFS (median -21.7).
// Keep the provider's guaranteed -1 dBFS ceiling rather than assume spare peak headroom.
const FORK_AUDIO_VOICE = Object.freeze({ lufs: -22, peak: -1, v: 1 });
function forkAudioMeasurement(value) {
    return value && value.v === 1 && Number.isFinite(value.lufs) && value.lufs >= -100 && value.lufs <= 10 && Number.isFinite(value.peak) && value.peak >= -100 && value.peak <= 20;
}
function forkAudioGain(layer, measured, gainDb = 0) {
    // Unknown audio is assumed hot, never boosted. Silence must not become a huge gain.
    const value = forkAudioMeasurement(measured) ? measured : { lufs: -10, peak: 0 };
    if (value.lufs <= -70) return 0;
    // private fork: authored SFX gain follows normalization, with the same true-peak ceiling.
    const normalized = Math.min(FORK_AUDIO_TARGETS[layer] - value.lufs, -1 - value.peak, 12);
    const authored = layer === "sfx" ? gainDb : 0;
    return Math.pow(10, Math.min(normalized + authored, -1 - value.peak) / 20);
}
function forkAudioDuck(layer, active) { return active ? Math.pow(10, (layer === "music" ? -4 : layer === "ambience" ? -3 : 0) / 20) : 1; }
function forkAudioEnvelope(from, to, elapsed, attack) { return from + (to - from) * Math.min(1, Math.max(0, elapsed / (attack ? 0.15 : 0.4))); }
function forkMeasureLoudness(channels, rate) {
    if (!channels.length || channels.length > 2 || !Number.isFinite(rate) || rate < 8000) throw new Error("Unsupported audio layout");
    const length = channels[0].length;
    if (!length || channels.some(channel => channel.length !== length)) throw new Error("Empty audio");
    function coefficients(f, q, shelf) {
        const k = Math.tan(Math.PI * f / rate), k2 = k * k, a0 = 1 + k / q + k2;
        const vh = Math.pow(10, 3.999843853973347 / 20), vb = Math.pow(vh, 0.4996667741545416);
        return shelf ? [(vh + vb * k / q + k2) / a0, 2 * (k2 - vh) / a0, (vh - vb * k / q + k2) / a0, 2 * (k2 - 1) / a0, (1 - k / q + k2) / a0]
            : [1, -2, 1, 2 * (k2 - 1) / a0, (1 - k / q + k2) / a0];
    }
    const shelf = coefficients(1681.974450955533, 0.7071752369554196, true), highpass = coefficients(38.13547087602444, 0.5003270373238773, false);
    function filter(c) {
        let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
        return x => { const y = c[0] * x + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
    }
    const hop = Math.round(rate * 0.1), block = hop * 4, padded = Math.max(length, block);
    const energy = new Float64Array(padded);
    let peak = 0;
    // Four-times, 48-tap windowed-sinc interpolation estimates intersample peaks.
    const phases = [0.25, 0.5, 0.75].map(phase => {
        const taps = []; let sum = 0;
        for (let j = -23; j <= 24; j++) { const x = phase - j, sinc = Math.sin(Math.PI * x) / (Math.PI * x), w = 0.5 + 0.5 * Math.cos(Math.PI * x / 24); const v = sinc * w; taps.push(v); sum += v; }
        return taps.map(v => v / sum);
    });
    for (const channel of channels) {
        const a = filter(shelf), b = filter(highpass);
        for (let i = 0; i < padded; i++) { const sample = i < length ? channel[i] : 0, y = b(a(sample)); energy[i] += y * y; peak = Math.max(peak, Math.abs(sample)); }
        for (let i = 0; i < length; i++) for (const taps of phases) {
            let sample = 0;
            for (let j = 0; j < taps.length; j++) sample += (channel[i + j - 23] || 0) * taps[j];
            peak = Math.max(peak, Math.abs(sample));
        }
    }
    const blocks = []; let sum = 0;
    for (let i = 0; i < padded; i++) {
        sum += energy[i]; if (i >= block) sum -= energy[i - block];
        if (i >= block - 1 && (i + 1 - block) % hop === 0) blocks.push(sum / block);
    }
    const loudness = power => -0.691 + 10 * Math.log10(Math.max(1e-15, power));
    const absolute = blocks.filter(power => loudness(power) >= -70);
    const relative = loudness(absolute.reduce((a, b) => a + b, 0) / (absolute.length || 1)) - 10;
    const gated = absolute.filter(power => loudness(power) >= relative);
    return { lufs: gated.length ? loudness(gated.reduce((a, b) => a + b, 0) / gated.length) : -100, peak: peak ? Math.max(-100, 20 * Math.log10(peak) + 0.2) : -100, v: 1 };
}
