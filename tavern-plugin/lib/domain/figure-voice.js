// Immutable pack declaration; synthesis-time mood and pool selection belong to TTS.
export function figureTtsVoice(binding, voice, figureIdentity, emotions = []) {
  return {id:'voice',kind:'pack',enabled:binding.source !== null,languages:[binding.language || voice.language],
    pack:{voice:structuredClone(voice),binding:structuredClone(binding),figureIdentity,emotions:structuredClone(emotions)}}
}
export async function assetVoiceBinding(tts, defaults, declaration) {
  if (tts?.apiVersion !== 1) return null
  return (await tts.resolveVoiceService({...declaration,defaults})).effective
}
