// private fork: a recording stand-in for fork-ui-sfx.js in vm harnesses of stage components (docs/fork/panel-ui-design.md「界面音效」).
export function forkUiSfxStub(cues = []) {
  return {
    forkUiSfx: { play: cue => { cues.push(cue); return true }, preload() {}, bind: () => () => {} },
    useForkUiSfxControls() {}
  }
}
