// private fork: automatic blinking for static sprites that carry an authored blink patch.
// Timers only: nothing runs per display frame. The caller owns the overlay; the scheduler only
// reports 'open' | 'half' | 'closed'. No patch, no blink (there is no procedural fallback).
const FORK_BLINK_TIMING = Object.freeze({ minGap: 2500, maxGap: 6000, minClosed: 100, maxClosed: 140, half: 40, doubleChance: 0.15, minDoubleGap: 90, maxDoubleGap: 150 });
function forkBlinkPlan(random, hasHalf, timing = FORK_BLINK_TIMING) {
    const between = (lo, hi) => Math.round(lo + (hi - lo) * random());
    const one = () => hasHalf ? [['half', timing.half], ['closed', between(timing.minClosed, timing.maxClosed)], ['half', timing.half]] : [['closed', between(timing.minClosed, timing.maxClosed)]];
    const steps = one();
    if (random() < timing.doubleChance) steps.push(['open', between(timing.minDoubleGap, timing.maxDoubleGap)], ...one());
    return steps;
}
function forkBlinkGap(random, timing = FORK_BLINK_TIMING) { return Math.round(timing.minGap + (timing.maxGap - timing.minGap) * random()); }
// allowed() is consulted at every wake: reduced motion, hidden figure or stage keep the eyes open.
function createForkBlinkScheduler({ setTimeout: arm, clearTimeout: disarm, random = Math.random, apply, allowed = () => true, hasHalf = false, timing = FORK_BLINK_TIMING }) {
    let timer = null, phase = 'open', running = false;
    const set = next => { if (next !== phase) { phase = next; apply(next); } };
    const wait = () => { timer = arm(fire, forkBlinkGap(random, timing)); };
    function step(steps, index) {
        timer = null;
        if (!running) return;
        if (index >= steps.length || !allowed()) { set('open'); wait(); return; }
        set(steps[index][0]);
        timer = arm(() => step(steps, index + 1), steps[index][1]);
    }
    function fire() {
        timer = null;
        if (!running) return;
        if (!allowed()) { set('open'); wait(); return; }
        step(forkBlinkPlan(random, hasHalf, timing), 0);
    }
    function halt() { if (timer !== null) disarm(timer); timer = null; set('open'); }
    return {
        start() { if (running) return; running = true; set('open'); wait(); },
        // Realign: a new state/emotion starts a fresh interval with the eyes open.
        restart() { halt(); if (running) wait(); },
        stop() { running = false; halt(); },
        phase: () => phase,
        running: () => running
    };
}
// Base-canvas rect → child position under a sprite with the given anchor (same rule as mouth covers).
function forkBlinkPlacement(bundle, width, height, anchor) {
    const [x, y, w, h] = bundle.rect;
    if (!(w > 0 && h > 0 && x >= 0 && y >= 0 && x + w <= width && y + h <= height)) return null;
    if (bundle.canvas && (bundle.canvas[0] !== width || bundle.canvas[1] !== height)) return null;
    return { x: x - width * anchor.x, y: y - height * anchor.y, w, h };
}
function forkBlinkUrls(bundle) { return bundle ? [bundle.closed, bundle.half].filter(Boolean) : []; }
if (typeof window === 'undefined' && typeof module !== 'undefined') module.exports = { FORK_BLINK_TIMING, forkBlinkPlan, forkBlinkGap, createForkBlinkScheduler, forkBlinkPlacement, forkBlinkUrls };
