import { projectDisplayParts } from './reply-presentation.js'
import { forkStripBubbleCodeQuote } from '../../src/client/fork-bubble-line.cjs'
import { forkStageDisplayUnits } from '../../src/client/fork-stage-display-units.cjs'

export function stageParagraphs(source, parts = projectDisplayParts(String(source || '')).parts) {
  return forkStageDisplayUnits(parts, forkStripBubbleCodeQuote)
}
