// private fork: candidates only. Loading a scene never persists or confirms calibration.
const forkFigureCandidateCache = new Map();
function forkFigureCached(key, measure) {
    if (forkFigureCandidateCache.has(key)) {
        const result = forkFigureCandidateCache.get(key); forkFigureCandidateCache.delete(key); forkFigureCandidateCache.set(key, result); return result;
    }
    const result = measure();
    if (forkFigureCandidateCache.size >= 256) forkFigureCandidateCache.delete(forkFigureCandidateCache.keys().next().value);
    forkFigureCandidateCache.set(key, result);
    return result;
}
function forkFigureMeasureTexture(sourceSha, texture) {
    return forkFigureCached(sourceSha + ":alpha:" + FORK_FIGURE_ALGORITHM + ":2048", function () {
        try {
            const canvas = document.createElement("canvas"), ratio = Math.min(1, 2048 / Math.max(texture.width, texture.height));
            canvas.width = Math.max(1, Math.round(texture.width * ratio)); canvas.height = Math.max(1, Math.round(texture.height * ratio));
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            ctx.drawImage(texture.baseTexture.resource.source, 0, 0, canvas.width, canvas.height);
            return { sourceSha, canvas: [texture.width, texture.height], status: "pending", auto: forkMeasureFigureAlpha(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, [texture.width, texture.height]) };
        } catch (_) { return { sourceSha, status: "pending", auto: { invalid: true, warnings: ["pixel-read-failed"] } }; }
    });
}
function forkFigureMeasureLive2d(model, modelRevision) {
    const im = model.internalModel, core = im.coreModel;
    const coreVersion = String(window.Live2DCubismCore?.Version?.csmGetVersion?.() || "unknown");
    return forkFigureCached(modelRevision + ":rest-default-pose:" + coreVersion + ":" + FORK_FIGURE_ALGORITHM, function () {
        const canvas = [im.originalWidth, im.originalHeight];
        try {
            // Do not call internalModel.update: it runs blink, breath and physics. Pose alone is deterministic.
            if (!core.getParameterCount || !core.getParameterDefaultValue || !core.update) throw new Error("Rest state unavailable");
            for (let i = 0; i < core.getParameterCount(); i++) core.setParameterValueByIndex(i, core.getParameterDefaultValue(i));
            if (im.settings.pose && !im.pose) throw new Error("Pose unavailable");
            if (im.pose) im.pose.updateParameters(core, 0);
            core.update(); core.saveParameters();
            let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
            const hit = new Set((im.settings.hitAreas || []).map(h => h.Id));
            const ids = im.getDrawableIDs(), transform = im.localTransform;
            ids.forEach(function (id, index) {
                if (hit.has(id) || /(?:effect|sparkle|shadow|hitarea)/i.test(id) || core.getDrawableOpacity(index) < 0.05 || !core.getDrawableDynamicFlagIsVisible(index)) return;
                // The Pixi adapter converts Cubism units to pixels and flips Y; apply only its local layout here.
                const vertices = im.getDrawableVertices(index);
                for (let i = 0; i < vertices.length; i += 2) {
                    const p = transform.apply({ x: vertices[i], y: vertices[i + 1] });
                    left = Math.min(left, p.x); top = Math.min(top, p.y); right = Math.max(right, p.x); bottom = Math.max(bottom, p.y);
                }
            });
            if (!(right > left && bottom > top)) throw new Error("Empty drawable bounds");
            const declared = im.settings.json.ForkStage;
            const auto = { figureTop: top, visibleBottom: bottom, supportX: (left + right) / 2, inkBounds: [left, top, right - left, bottom - top], method: "rest-drawable-upper-bound", restPosePolicy: "default-parameters-pose-v1", coreVersion, algorithmVersion: FORK_FIGURE_ALGORITHM, confidence: 0.3, warnings: ["drawable-upper-bound", "confirm-mask-and-texture-alpha"] };
            if (declared?.Chin > declared?.HeadTop) {
                auto.headTop = transform.apply({ x: canvas[0] / 2, y: declared.HeadTop * canvas[1] }).y;
                auto.chin = transform.apply({ x: canvas[0] / 2, y: declared.Chin * canvas[1] }).y;
            }
            return { version: 1, modelRevision, canvas, status: "pending", auto };
        } catch (_) { return { version: 1, modelRevision, canvas, status: "pending", auto: { invalid: true, warnings: ["rest-pose-unavailable"] } }; }
    });
}

// Render the default rest pose once; never infer anatomy from a texture atlas.
function forkFigureMeasurePackLive2d(model, identity, renderer, PIXI) {
    return forkFigureCached(identity + ":pack-rest-alpha-v1", function () {
        const rest = forkFigureMeasureLive2d(model, identity), canvas = rest.canvas;
        if (rest.auto.invalid) return rest;
        let texture;
        try {
            texture = renderer.generateTexture(model, {region: new PIXI.Rectangle(0, 0, ...canvas), resolution: Math.min(1, 1024 / Math.max(...canvas))});
            const pixels = renderer.plugins.extract.canvas(texture), ctx = pixels.getContext("2d");
            return {...rest, auto: forkMeasureFigureAlpha(ctx.getImageData(0, 0, pixels.width, pixels.height).data, pixels.width, pixels.height, canvas)};
        } catch (_) { return {...rest, auto: {invalid: true, warnings: ["rest-alpha-unavailable"]}}; }
        finally { if (texture) texture.destroy(true); }
    });
}
