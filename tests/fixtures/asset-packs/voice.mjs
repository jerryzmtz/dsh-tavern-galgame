// private fork: authored v4 fixtures and provider-level execution fixtures are distinct.
import {resolveVoiceSpec} from '../../../tavern-plugin/packages/dsh-tts/src/voice-resolver.js'
export const onlineSpec=(name='First',voiceName='ja-JP-NanamiNeural',provider='azure')=>({name,language:'ja',defaultSource:provider,sources:{[provider]:{kind:'preset',provider,voiceName}}})
export function localSpec(pack) {
  const voice=structuredClone(Object.values(pack.manifest.voiceLibrary.voices)[0])
  voice.defaultSource='local'
  // Explicit synthetic local authoring, not migration/restoration of a user's Fish list.
  voice.sources.local.fallback=structuredClone(voice.sources.fish.references)
  return voice
}
export function referenceVoice(pack) {
  const voice=localSpec(pack)
  return {...resolveVoiceSpec({voice,binding:{voice:'actor'},figureIdentity:'fixture',text:'fixture'}).effective.voice,
    references:voice.sources.local.fallback.map(r=>({sha256:r.media,transcript:r.text,language:r.language}))}
}
