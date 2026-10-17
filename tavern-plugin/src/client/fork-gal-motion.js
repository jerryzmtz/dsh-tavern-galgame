// Private fork: uninterrupted idle, an independent gesture queue, then parameter springs.
// Cubism4-specific adapter; the vendored runtime and loaded clip cache stay untouched.
function forkGalGestureWeight(age, duration, fadeIn = 0.40, fadeOut = 0.50) {
    const ramp = (x, time) => { if (!(time > 0)) return 1; x = Math.max(0, Math.min(1, x / time)); return x * x * (3 - 2 * x); };
    return age < 0 || age >= duration ? 0 : ramp(age, fadeIn) * ramp(duration - age, fadeOut);
}
// Gesture fades are what the model declares: the motion3 Meta, then its model3 motion entry (Cubism's order in the
// runtime's createMotion); the stage's 0.40 / 0.50 s apply only when neither declares one.
function forkGalGestureFades(meta, entry) {
    const declared = key => [meta && meta[key], entry && entry[key]].find(value => Number.isFinite(value) && value >= 0);
    const fadeIn = declared("FadeInTime"), fadeOut = declared("FadeOutTime");
    return { fadeIn: fadeIn === undefined ? 0.40 : fadeIn, fadeOut: fadeOut === undefined ? 0.50 : fadeOut };
}
// Switches are only what the model declares as one: pose3 groups/links and PartOpacity tracks (poseIds), and
// parameters named as a switch (our rigs' ParamArmPoseSwitch, game rigs' ParamHand*Display). Arm-set letters are
// not switches: game rigs key continuous angles as ParamArmLA02 / ParamArmRB03 / ParamArmLC01, the arm-set
// choice itself is their pose3 parts, so those angles blend and spring like any other arm parameter.
function forkGalMotionDiscrete(id, poseIds) {
    return Boolean(poseIds && poseIds.has(id)) || /^Param(?:Arm|Hand).*(?:Display|Switch|Visible|Opacity)$/.test(id);
}
function forkGalMotionParameter(id) {
    if (forkGalMotionDiscrete(id)) return null;
    if (/^ParamAngle[XYZ]$/.test(id)) return { omega: 14, velocity: 180 };
    if (/^ParamBodyAngle[XYZ]$/.test(id)) return { omega: 14, velocity: 90 };
    if (/^ParamEyeBall[XY]$/.test(id)) return { omega: 20, velocity: Infinity };
    if (/^Param(?:Arm|Hand|Shoulder)/.test(id)) return { omega: 12, velocity: Infinity };
    return null;
}
function forkGalMotionSpring(s, target, omega, velocity, dt) {
    if (!(dt > 0)) return s.v;
    const old = s.v;
    forkGalSpring(s, target, omega, dt);
    s.d = Math.max(-velocity, Math.min(velocity, s.d));
    s.v = Math.max(old - velocity * dt, Math.min(old + velocity * dt, s.v));
    return s.v;
}
function forkGalMotionClone(source, gesture, discreteIds) {
    const motion = Object.assign(Object.create(Object.getPrototypeOf(source)), source);
    motion._motionData = Object.assign({}, source._motionData, {
        curves: source._motionData.curves.map(function (curve) {
            const discrete = curve.type === 2 || forkGalMotionDiscrete(curve.id, discreteIds);
            // Route PartOpacity through its (often virtual) parameter channel, independent of
            // CubismConfig.setOpacityFromMotion. Publish the winning track to real parts later.
            return Object.assign({}, curve, {
                type: curve.type === 2 ? 1 : curve.type, forkDiscrete: discrete,
                fadeInTime: discrete ? 0 : gesture ? -1 : curve.fadeInTime < 0 ? -1 : forkGalMotionFade(curve.fadeInTime),
                fadeOutTime: discrete ? 0 : gesture ? -1 : curve.fadeOutTime < 0 ? -1 : forkGalMotionFade(curve.fadeOutTime)
            });
        })
    });
    motion._firedEventValues = [];
    motion.setIsLoop(false);
    // Gesture envelopes are applied once by our mixer, not again by Cubism's curve fades.
    motion.setFadeInTime(gesture ? 0 : forkGalMotionFade(source.getFadeInTime()));
    motion.setFadeOutTime(gesture ? 0 : forkGalMotionFade(source.getFadeOutTime()));
    motion.setFinishedMotionHandler(undefined);
    return motion;
}
function forkGalInstallMotionLayers(internal) {
    const manager = internal.motionManager, core = internal.coreModel;
    if (manager.forkMotionLayers || !manager.queueManager || !core) return;
    // Pose's first update resets its virtual selectors; initialize it before taking our snapshots.
    if (internal.pose) internal.pose.updateParameters(core, 0);
    const parameters = core.getModel().parameters, values = parameters.values, ids = parameters.ids;
    const partIds = core.getModel().parts && core.getModel().parts.ids || [];
    const queue = new manager.queueManager.constructor();
    queue.setEventCallback((q, event) => manager.emit("motion:" + event));
    const state = manager.forkMotionLayers = {
        queue, time: 0, dt: 0, previousTime: null, gesture: null, pending: null, serial: 0,
        base: new Float32Array(values), scratch: new Float32Array(values.length),
        output: new Float32Array(values), springs: new Map(), idleClips: [], dead: false,
        visibility: new Map(), discreteIndices: new Set()
    };
    function registerDiscrete(id, part) {
        const index = core.getParameterIndex(id);
        if (index < values.length) state.discreteIndices.add(index);
        let channel = state.visibility.get(id);
        if (!channel) {
            channel = { index, part: -1, idle: core.getParameterValueByIndex(index) };
            state.visibility.set(id, channel);
        }
        if (part) channel.part = partIds.indexOf(id);
    }
    for (const id of ids) if (forkGalMotionDiscrete(id)) registerDiscrete(id, false);
    const poseParts = internal.pose && internal.pose._partGroups || [];
    for (const part of poseParts) {
        registerDiscrete(part.partId, true);
        for (const link of part.link || []) registerDiscrete(link.partId, true);
    }
    function prepareMotion(source, gesture) {
        for (const curve of source._motionData.curves) if (curve.type === 2) registerDiscrete(curve.id, true);
        return forkGalMotionClone(source, gesture, state.visibility);
    }
    const profiles = Array.from(ids, forkGalMotionParameter), lipIds = new Set(forkGalLipSyncIds(internal.settings));
    const start = manager.startMotion, update = manager.update, stop = manager.stopAllMotions, create = manager.createMotion;
    manager.createMotion = function (data, group, definition) {
        const motion = create.call(this, data, group, definition);
        motion.forkGestureFades = forkGalGestureFades(data && data.Meta, definition);
        return motion;
    };
    const idleGroup = Object.keys(manager.definitions).find(group => /^idle$/i.test(group));
    function beginIdle(source) {
        const motion = prepareMotion(source, false);
        // Overlap even when the clip declares zero fades. Never let an idle's last frame empty the queue.
        const duration = motion.getDuration();
        motion.setFadeInTime(Math.min(motion.getFadeInTime(), duration / 3));
        motion.setFadeOutTime(Math.min(motion.getFadeOutTime(), duration / 3));
        for (const curve of motion._motionData.curves) {
            if (curve.forkDiscrete) continue;
            if (curve.fadeInTime >= 0) curve.fadeInTime = motion.getFadeInTime();
            if (curve.fadeOutTime >= 0) curve.fadeOutTime = motion.getFadeOutTime();
        }
        manager.queueManager.startMotion(motion, false, state.time);
        state.idle = { source, motion, start: null };
    }
    manager._startMotion = function (motion) { beginIdle(motion); };
    if (idleGroup) {
        manager.groups.idle = idleGroup;
        manager.definitions[idleGroup].forEach((_, index) => {
            Promise.resolve(manager.loadMotion(idleGroup, index)).then(motion => {
                if (!state.dead && motion && motion.getLoopDuration() > 0) state.idleClips.push(motion);
            }).catch(() => {});
        });
    }
    manager.startMotion = async function (group, index, priority) {
        if (state.dead) return false;
        if (group === manager.groups.idle) return start.call(this, group, index, priority);
        priority = priority == null ? 2 : priority;
        if (state.dead || (state.pending && state.pending.priority > priority) || (state.gesture && state.gesture.priority > priority)) return false;
        const request = { serial: ++state.serial, priority };
        state.pending = request;
        let source;
        try { source = await this.loadMotion(group, index); }
        finally { if (state.pending === request) state.pending = null; }
        if (!source || state.dead || request.serial !== state.serial) return false;
        const motion = prepareMotion(source, true), duration = motion.getDuration();
        if (!(duration > 0)) return false;
        const fades = source.forkGestureFades || forkGalGestureFades();
        const from = state.gesture ? new Float32Array(state.output) : null;
        const touchedIds = new Set(motion._motionData.curves.filter(curve => curve.type !== 0).map(curve => curve.id));
        for (const curve of motion._motionData.curves) {
            if (curve.type === 0 && curve.id === "EyeBlink") for (const id of motion._eyeBlinkParameterIds) touchedIds.add(id);
            if (curve.type === 0 && curve.id === "LipSync") for (const id of motion._lipSyncParameterIds) touchedIds.add(id);
        }
        const touched = new Set(state.gesture ? state.gesture.touched : []);
        ids.forEach((id, index) => { if (touchedIds.has(id)) touched.add(index); });
        // A pose snapshot provides bounded-cost interruption even under rapid FORCE replacements.
        queue.stopAllMotions();
        queue.startMotion(motion, false, state.time);
        state.gesture = { motion, group, index, priority, duration, fadeIn: fades.fadeIn, fadeOut: fades.fadeOut, start: null, from, touched };
        this.emit("motionStart", group, index);
        return true;
    };
    manager.update = function (model, time) {
        state.dt = state.previousTime == null ? 0 : Math.max(0, time - state.previousTime);
        state.previousTime = time; state.time = time;
        if (state.dt > 0.25) state.springs.clear(); // Resume/teleport, not a large integration step.
        if (state.idle) {
            if (state.idle.start == null) state.idle.start = time;
            const duration = state.idle.motion.getDuration(), overlap = Math.min(0.50, duration / 3);
            if (time - state.idle.start >= duration - overlap) {
                const clips = state.idleClips;
                beginIdle(clips.length ? clips[Math.floor(Math.random() * clips.length)] : state.idle.source);
                state.idle.start = time;
            }
        }
        return update.call(this, model, time);
    };
    internal.on("beforeMotionUpdate", function () {
        // Do not feed last frame's gesture, spring or blink back into the continuously evaluated idle.
        values.set(state.base);
        for (const channel of state.visibility.values()) core.setParameterValueByIndex(channel.index, channel.idle);
    });
    internal.on("afterMotionUpdate", function () {
        state.base.set(values);
        for (const channel of state.visibility.values()) channel.idle = core.getParameterValueByIndex(channel.index);
        const gesture = state.gesture;
        let gestureDominates = false;
        if (gesture) {
            if (gesture.start == null) gesture.start = state.time;
            const age = state.time - gesture.start, weight = forkGalGestureWeight(age, gesture.duration, gesture.fadeIn, gesture.fadeOut);
            gestureDominates = weight >= 0.5;
            state.scratch.set(values);
            queue.doUpdateMotion(core, state.time);
            const t = gesture.fadeIn > 0 ? Math.max(0, Math.min(1, age / gesture.fadeIn)) : 1, change = t * t * (3 - 2 * t);
            for (let i = 0; i < values.length; i++) {
                if (state.discreteIndices.has(i)) continue;
                if (!gesture.touched.has(i)) { values[i] = state.scratch[i]; continue; }
                const target = state.scratch[i] + (values[i] - state.scratch[i]) * weight;
                values[i] = gesture.from ? gesture.from[i] + (target - gesture.from[i]) * change : target;
            }
            if (age >= gesture.duration) { state.gesture = null; queue.stopAllMotions(); }
        }
        // Pose runs later (after physics). Its selected parts already have the authored opacity,
        // so its own fade/links cannot cross-dissolve mutually exclusive 0/1 arm variants.
        for (const channel of state.visibility.values()) {
            const value = gestureDominates ? core.getParameterValueByIndex(channel.index) : channel.idle;
            core.setParameterValueByIndex(channel.index, value);
            if (channel.part >= 0) core.setPartOpacityByIndex(channel.part, Math.max(0, Math.min(1, value)));
        }
        const expressionIds = new Set();
        const expressions = manager.expressionManager && manager.expressionManager.queueManager._motions || [];
        for (const entry of expressions) for (const parameter of entry._motion._parameters || []) expressionIds.add(parameter.parameterId);
        for (let i = 0; i < values.length; i++) {
            const profile = profiles[i];
            if (!profile || state.discreteIndices.has(i) || lipIds.has(ids[i]) || expressionIds.has(ids[i])) { state.springs.delete(i); continue; }
            let spring = state.springs.get(i);
            if (!spring) { spring = { v: values[i], d: 0 }; state.springs.set(i, spring); }
            values[i] = forkGalMotionSpring(spring, values[i], profile.omega, profile.velocity, Math.min(0.05, state.dt));
        }
        state.output.set(values);
    });
    manager.stopAllMotions = function () {
        state.serial++; state.pending = null; state.gesture = null; state.idle = null;
        queue.stopAllMotions(); state.springs.clear(); state.previousTime = null;
        state.base.set(values); state.output.set(values);
        for (const channel of state.visibility.values()) channel.idle = core.getParameterValueByIndex(channel.index);
        return stop.call(this);
    };
    // InternalModel emits destroy before destroying its manager (which calls stopAllMotions again).
    internal.once("destroy", function () { state.dead = true; state.serial++; queue.stopAllMotions(); state.springs.clear(); });
}
