import assert from 'node:assert/strict'
import test from 'node:test'

import { projectCharacterDesignDocument } from '../tavern-plugin/lib/domain/character-design-document.js'

const completeDesign = Object.freeze({
  name: '鹿野栞',
  identity: '高二 S 班风纪委员，负责午后校舍巡查',
  narrativeRole: '以秩序维护者身份介入主角的校园生活，并逐渐成为可靠但难以敷衍的盟友',
  coreMotivation: '维持可预测的校园秩序，同时证明温和与坚定并不冲突',
  innerConflict: '渴望与人亲近，却担心私人情感削弱自己的公正形象',
  personality: '温柔随和、分寸感强；面对原则问题会安静而执拗地追问到底',
  appearance: '身高约 164 厘米，纤细匀称，深棕长发束成低马尾，灰褐色眼睛，神情清醒柔和',
  behaviorStyle: '先观察环境和他人反应，再用很小的动作介入；习惯整理袖口和随身记录异常',
  speechStyle: '语速平稳，措辞礼貌精确；质疑时不用高声，而是连续追问具体事实',
  relationships: '与教师保持可靠的工作关系，对违纪学生既警惕又愿意给出解释机会',
  defaultPresentation: '白伊甸制服外套配银色风纪委员徽章，深灰百褶裙，黑色及膝袜和棕色低跟乐福鞋；内搭浅灰衬衣与素色贴身衣物',
  plotPotential: '可由一次看似普通的巡查发现异常，迫使她在制度责任、同伴信任与个人好奇之间作出选择'
})

test('人物档案模块提供不泄漏存储结构的只读状态面板投影', () => {
  const source = {
    spec: 'dsh-tavern.character-design-document', version: 1, revision: 3, updatedAt: 120,
    characters: [{ name: '鹿野栞', aliases: ['阿栞'], design: completeDesign, createdAt: 90, updatedAt: 110, internal: 'hidden' }],
    internal: 'hidden'
  }
  const view = projectCharacterDesignDocument(source)
  assert.equal(view.revision, 3)
  assert.equal(view.characters[0].name, '鹿野栞')
  assert.equal(view.characters[0].identity, completeDesign.identity)
  assert.deepEqual(view.characters[0].aliases, ['阿栞'])
  assert.deepEqual(view.characters[0].sections.map(section => section.label), [
    '身份', '性格', '外貌', '说话方式', '剧情作用'
  ])
  assert.equal(Object.hasOwn(view.characters[0], 'design'), false)
  assert.equal(Object.hasOwn(view.characters[0], 'internal'), false)
  assert.deepEqual(source.characters[0].aliases, ['阿栞'])
})
