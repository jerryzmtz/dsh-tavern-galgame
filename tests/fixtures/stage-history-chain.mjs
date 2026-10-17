// private fork: synthetic pre-registry history reproducing Madoka's 124 -> 128 digest chain.
import {initialAssetPackStage} from '../../tavern-plugin/lib/domain/stage-asset-pack-tools.js'
import {assetPackDigest} from '../../tavern-plugin/lib/domain/stage-asset-pack-catalogue.js'
import {captureStageTarget} from '../../tavern-plugin/lib/domain/stage-incremental.js'
export function historyChain({retired = false, morning = false} = {}) {
  const packId = '12345678-1234-4234-8234-123456789abc'
  const ref = (kind, assetId) => ({packId,kind,assetId})
  const state = initialAssetPackStage({actor:{figure:{packId,figureId:'22345678-1234-4234-8234-123456789abc'},outfits:[{key:'pajamas'}],ruler:null}})
  const chat = {id:'history-chain',sessionId:'history-session',cardPath:'cards/synthetic.json',mode:'story',timeline:{branchId:'branch',revision:1},messages:[]}
  let previous = null
  for (let turn = 124; turn <= 128; turn++) {
    const message = {role:'assistant',turn,text:'Synthetic saved paragraph.\n\nUnchanged paragraph.'}
    chat.messages.push(message)
    const baseline = structuredClone(state)
    state.scene = {background:ref('backgrounds','room'),timeOfDay:morning ? 'morning' : 'night',timeLook:null}
    state.music = ref('music','quiet')
    state.cast = ['actor']; state.actors.actor.gaze = 'away'
    const ops = turn === 124 ? [
      {op:'scene.set',value:{background:state.scene.background,timeOfDay:state.scene.timeOfDay}},
      {op:'music.set',value:state.music},
      {op:'actor.enter',actor:'actor'},
      {op:'actor.patch',actor:'actor',value:{gaze:'away'}},
      {op:'actor.variant',actor:'actor',value:'pajamas'}
    ] : []
    if (retired && turn === 124) {
      ops.push({op:'phone.message',value:{text:'retired'}},{op:'widget.show',widgetId:'retired'})
      state.phone = {retired:true}
    }
    const binding = {target:{...captureStageTarget(chat,chat.messages.length - 1),predecessorDigest:previous?.digest || null}}
    const body = {binding,baseline,entries:[{at:1,ops,state:structuredClone(state),timeTransitionMs:0}],end:structuredClone(state)}
    previous = message.stageDirectionAssetPacks = {format:'asset-packs-v1',complete:true,...body,diagnostics:[],digest:assetPackDigest(body)}
  }
  return chat
}
