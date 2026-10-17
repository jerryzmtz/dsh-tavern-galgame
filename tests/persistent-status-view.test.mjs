import assert from 'node:assert/strict'
import test from 'node:test'

import { projectPersistentStatusView } from '../tavern-plugin/lib/domain/persistent-status-view.js'

test('text 围栏的 body 根状态栏仍提升为右侧面板', () => {
  const replaceString = "```text\n<body>\n<script>\n$('body').load('/api/dsh-tavern/remote-assets/hash/bottom-status-bar.html_V_1?host=1')\n</script>\n</body>\n```"
  const rule = { id: 'adf31d55-5ab4-4be7-a720-c0c96a5e1ed4', name: '状态栏', enabled: true, placement: [2], markdownOnly: true,
    findRegex: '<StatusPlaceHolderImpl/>', replaceString }
  const result = projectPersistentStatusView([{ role: 'assistant', turn: 2, text: '正文' }], [], { regexScripts: [rule] })
  assert.equal(result.statusViews.length, 1)
  assert.match(result.statusView.content, /bottom-status-bar\.html/)
  assert.match(result.statusView.content, /<body[\s>]/i)
  assert.equal(projectPersistentStatusView([{ role: 'assistant', turn: 2 }], [], {
    regexScripts: [{ ...rule, replaceString: '```text\n<body><p>无脚本</p></body>\n```' }]
  }).statusView, null)
})
