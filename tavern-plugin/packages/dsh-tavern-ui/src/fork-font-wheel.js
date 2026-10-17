// Private fork: Ctrl+vertical wheel changes the host reading size, not page zoom.
function forkFontWheelStep(event) {
    if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.defaultPrevented || !event.cancelable) return 0;
    if (!Number.isFinite(event.deltaY) || !Number.isFinite(event.deltaX) || !event.deltaY || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return 0;
    return event.deltaY < 0 ? 1 : -1;
}

function installForkFontWheel(theme, hostWindow) {
    const win = hostWindow || window;
    if (!theme || typeof theme.getTheme !== "function" || typeof theme.setFontSize !== "function") return function () {};
    const doc = win.document;
    let frame = null, pending = null;
    function adjust(step) {
        if (step !== 1 && step !== -1) return;
        const current = pending === null ? theme.getTheme().fontSize : pending;
        if (!Number.isInteger(current) || current < 12 || current > 32) return;
        const next = Math.max(12, Math.min(32, current + step));
        if (next === current) return;
        pending = next;
        // Preserve individual wheel steps, but write settings at most once per frame.
        if (frame !== null) return;
        frame = win.requestAnimationFrame(function () {
            frame = null;
            const size = pending;
            pending = null;
            if (size !== theme.getTheme().fontSize) theme.setFontSize(size);
        });
    }
    function onWheel(event) {
        const step = forkFontWheelStep(event);
        if (!step) return;
        event.preventDefault();
        event.stopPropagation();
        adjust(step);
    }
    const options = { capture: true, passive: false };
    doc.addEventListener("wheel", onWheel, options);
    return function () {
        doc.removeEventListener("wheel", onWheel, options);
        if (frame !== null) win.cancelAnimationFrame(frame);
        frame = null; pending = null;
    };
}

