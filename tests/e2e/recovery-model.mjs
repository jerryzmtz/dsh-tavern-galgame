import { readFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'

// Provider fault injection only; the real runtime decides failure and recovery.
export async function recoveryBlocks(input, tools) {
  const directory = process.env.TAVERN_E2E_RECOVERY_DIR
  if (!directory || input.purpose === 'session-title' || tools.has('mvu_submit_update') || tools.has('posture_submit') || tools.has('candidate_submit_choices')) return null
  const control = JSON.parse(await readFile(join(directory, 'recovery-control.json'), 'utf8').catch(() => '{}'))
  if (!control.mode) return null
  await appendFile(join(directory, 'recovery-requests.jsonl'), JSON.stringify({ mode: control.mode, label: control.label, sessionId: input.sessionId }) + '\n')
  return control.mode === 'reasoning-only'
    ? [{ type: 'reasoning', text: 'E2E 模型故障：仅返回思考，没有正文。' }]
    : [{ type: 'text', text: control.reply + '\n\n<StatusPlaceHolderImpl/>' }]
}
