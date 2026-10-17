// private fork (layered pilot phase 1): a small hybrid-face-sprites manifest (parts, whole and missing 差分).
export const GROUPS = ['underlay', 'pose', 'face', 'mouth', 'front']
export function hybridFixture() {
  const part = (group, name, rect, extra = {}) => ({group, src:'parts/' + name + '.png', rect, bbox:[0, 0, rect[2], rect[3]], revision:1, baseRevision:2, ...extra})
  const legacy = id => ({version:2, kind:'layered-static-sprites', character:{id:'dafeiyu', name:'大肥鱼'}, closedBehavior:'restore-base',
    mouthSets:{[id]:{src:'emotions/' + id + '/mouth.png', width:20, height:10, frames:{closed:{x:0, y:0, w:10, h:10}, a:{x:10, y:0, w:10, h:10}}}},
    emotions:{[id]:{mouthSet:id, mouthFrames:{closed:'closed', a:'a'}, closedMouthFrame:'closed',
      stage:{src:'emotions/' + id + '/stage.png', width:100, height:120, mouth:{x:40, y:40, w:10, h:10}}}}})
  return {kind:'hybrid-face-sprites', version:1,
    rigs:{maid:{canvas:[100, 150], baseRevision:2, drawOrder:[...GROUPS],
      parts:{base:part('underlay', 'base', [0, 0, 100, 150]), 'face-calm':part('face', 'face-calm', [30, 30, 40, 20]), 'face-joy':part('face', 'face-joy', [30, 30, 40, 20]),
        'face-blink':part('face', 'face-blink', [30, 30, 40, 20]), 'mouth-calm':part('mouth', 'mouth-calm', [42, 52, 16, 10]), 'mouth-a':part('mouth', 'mouth-a', [42, 52, 16, 12]),
        'mouth-closed':part('mouth', 'mouth-closed', [42, 52, 16, 10]), clip:part('front', 'clip', [20, 10, 60, 30]), 'face-old':part('face', 'face-old', [30, 30, 40, 20], {baseRevision:1})},
      recipes:{calm:{revision:1, selection:{underlay:'base', pose:'none', face:'face-calm', mouth:'mouth-calm', front:'clip'},
        mouthFrames:{closed:'mouth-closed', a:'mouth-a'}, blinkFrames:{closed:'face-blink', half:'face-old'}},
      joy:{revision:3, selection:{underlay:'base', pose:'none', face:'face-joy', mouth:'mouth-calm', front:'none'}},
      shy:{revision:1, selection:{underlay:'base', pose:'none', face:'face-shy', mouth:'mouth-calm', front:'clip'}},
      sad:{revision:1, selection:{underlay:'base', pose:'none', face:'face-old', mouth:'mouth-calm', front:'clip'}}}}},
    emotions:{calm:{render:{kind:'parts', rig:'maid', recipe:'calm'}}, joy:{render:{kind:'parts', rig:'maid', recipe:'joy'}},
      shy:{render:{kind:'parts', rig:'maid', recipe:'shy'}}, sad:{render:{kind:'parts', rig:'maid', recipe:'sad'}},
      singing:{render:{kind:'whole', legacy:legacy('singing')}}, eating:{render:{kind:'whole', legacy:legacy('eating')}}, crying:{render:{kind:'missing'}}}}
}
