import assert from 'node:assert/strict'
import test from 'node:test'
import { countGamesByCard, orderCardsForLibrary } from '../tavern-plugin/lib/domain/card-list-order.js'

const DAY = 24 * 60 * 60 * 1000
const now = Date.UTC(2026, 9, 8)

test('最近三天导入的卡按导入时间在前，其余按现存游戏局数排序', () => {
  const cards = [
    { path: 'cards/old-few.json', name: '少', importedAt: now - 30 * DAY },
    { path: 'cards/old-many.json', name: '多', importedAt: now - 40 * DAY },
    { path: 'cards/new-1.json', name: '新一', importedAt: now - 2 * DAY },
    { path: 'cards/new-2.json', name: '新二', importedAt: now - DAY },
    { path: 'cards/old-none.json', name: '无', importedAt: now - 10 * DAY }
  ]
  const gameCounts = countGamesByCard([
    { cardPath: 'cards/old-many.json', mode: 'story' },
    { cardPath: 'cards/old-many.json', mode: 'script' },
    { cardPath: 'cards/old-many.json', mode: 'card' },
    { cardPath: 'cards/old-few.json', mode: 'story' },
    { cardPath: 'cards/new-1.json', mode: 'story' },
    { cardPath: 'cards/new-1.json', mode: 'story' },
    { cardPath: 'cards/new-1.json', mode: 'story' }
  ])
  assert.equal(gameCounts.get('cards/old-many.json'), 2)
  assert.deepEqual(orderCardsForLibrary(cards, { gameCounts, now }).map(card => card.path),
    ['cards/new-2.json', 'cards/new-1.json', 'cards/old-many.json', 'cards/old-few.json', 'cards/old-none.json'])
})
