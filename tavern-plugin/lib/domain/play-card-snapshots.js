import { worldbookContentDigest } from './worldbook-version.js'
import { createHash } from 'node:crypto'
import { constantWorldBookContext } from './worldbook-recall.js'
import { sanitizeAgentProjectionText } from './runtime-content-projection.js'
import { defaultUserPreferenceProfile } from './user-preference-profile.js'

export function cardContentDigest(card) { return createHash('sha256').update(JSON.stringify(withoutPresentationOnly(card ?? null))).digest('hex') }
// private fork: the Card Stage (extensions.dsh_stage) is presentation only and is read
// live; editing it must not offer a save migration. Cards without a stage hash unchanged.
function withoutPresentationOnly(card) {
  if (!card || typeof card !== 'object' || !card.extensions || typeof card.extensions !== 'object' || !('dsh_stage' in card.extensions)) return card
  const { dsh_stage: _stage, ...extensions } = card.extensions
  return { ...card, extensions }
}

const VERSION = 7
function str(value) { return value === undefined || value === null ? '' : String(value) }
function usesFixedContext(chat) { return chat && (!chat.mode || ['story', 'script', 'card'].includes(chat.mode)) }
function cardAgent(chat) { return chat.mode === 'card' && chat.cardEditContext?.version !== 1 }
function preferenceOnly(chat) { return cardAgent(chat) && chat.cardReferenceContext?.version !== 1 }

/** Owns snapshot preparation, migration, persistence and concurrent build sharing. */
export function createPlayCardSnapshots({ worldBooks, planner, readCard, writeChat, captureSceneWorldbook, userPreferenceProfile, prepareCapabilities, logger = console }) {
  const pending = new Map()

  async function constantContext(chat, card) {
    try { return constantWorldBookContext({ worldBook: await worldBooks.bound(chat.cardPath, card, chat) }).context }
    catch (error) { logger.warn('dsh-tavern: 常驻世界书读取失败，已跳过:', str(error && error.message || error)) }
    return ''
  }

  async function build(chat, card, preservePreferences = false, resolvedWorldBook) {
    let worldBook = resolvedWorldBook ?? null
    try { if (!preferenceOnly(chat) && resolvedWorldBook === undefined) worldBook = await worldBooks.bound(chat.cardPath, card, chat) }
    catch (error) { logger.warn('dsh-tavern: 常驻世界书读取失败，已跳过:', str(error && error.message || error)) }
    if (!cardAgent(chat) && !(chat.messages || []).length && prepareCapabilities) worldBook = await prepareCapabilities(chat, worldBook)
    const worldBookContext = constantWorldBookContext({ worldBook }).context
    const planned = preferenceOnly(chat) ? '' : sanitizeAgentProjectionText((await planner.plan({ purpose: 'play-card-snapshot', card, chat, worldBookContext })).text)
    let preference = null
    if (preservePreferences) {
      if (chat.userProfileContextSnapshot) preference = { text: chat.userProfileContextSnapshot, revision: chat.userProfileRevision, profileId: chat.userProfileId }
    } else if (chat.userProfileEnabled === true && userPreferenceProfile) {
      preference = await userPreferenceProfile.stableContext(chat.userProfileId || 'default')
    }
    const text = preference === null ? planned : sanitizeAgentProjectionText([preference.text, planned].filter(Boolean).join('\n\n'))
    const patch = {
      cardContextSnapshot: text,
      cardContextSnapshotVersion: VERSION,
      userProfileId: preference?.profileId || chat.userProfileId || 'default',
      userProfileRevision: preference === null ? 0 : preference.revision,
      userProfileContextSnapshot: preference === null ? '' : preference.text
    }
    // Card Agents edit the card itself: keep only the reference text, never a
    // definition snapshot that later reads would prefer over the live card.
    if (cardAgent(chat)) return patch
    Object.assign(patch, {
      cardDefinitionSnapshot: structuredClone(card),
      cardContentDigest: cardContentDigest(card),
      worldbookLibraryDigest: chat.openingWorldbookSnapshot ? chat.openingWorldbookSnapshot.libraryDigest : worldbookContentDigest(worldBook)
    })
    // Only new, unpublished openings: migration cannot manufacture their past.
    if (!(chat.messages || []).length && typeof captureSceneWorldbook === 'function') {
      patch.sceneOpeningWorldbook = await captureSceneWorldbook(chat, card, worldBook, 0)
    }
    return patch
  }

  // A new chat is not published yet; preparation must not create a partial save.
  async function prepare(chat, card) {
    if (!usesFixedContext(chat)) return ''
    const patch = await build(chat, preferenceOnly(chat) ? null : card === undefined ? await readCard(chat) : card)
    Object.assign(chat, patch)
    return patch.cardContextSnapshot
  }

  /** The stored snapshot when ensure() would neither rebuild nor rewrite it. */
  function settled(header) {
    if (!usesFixedContext(header)) return ''
    const existing = str(header.cardContextSnapshot)
    if ((existing !== '' || preferenceOnly(header)) && Number(header.cardContextSnapshotVersion) >= VERSION
      && sanitizeAgentProjectionText(existing) === existing && !pending.has(header.id)) return existing
    return undefined
  }

  async function ensure(chat, card) {
    if (!usesFixedContext(chat)) return ''
    const key = chat.id || chat
    if (pending.has(key)) {
      const patch = await pending.get(key)
      // Other readers keep their own storage revision for optimistic merging.
      Object.assign(chat, patch)
      return patch.cardContextSnapshot
    }
    const operation = (async function () {
      const existing = str(chat.cardContextSnapshot)
      let patch, source
      if ((existing !== '' || preferenceOnly(chat)) && Number(chat.cardContextSnapshotVersion) >= VERSION) {
        const sanitized = sanitizeAgentProjectionText(existing)
        patch = { cardContextSnapshot: sanitized, cardContextSnapshotVersion: chat.cardContextSnapshotVersion }
        if (sanitized === existing) return patch
        source = 'card-context.sanitize'
      } else {
        let preparation = chat
        if (preferenceOnly(chat)) {
          // Old card workspaces had no preference snapshot. Freeze the current
          // default once, including disabled state, without changing their tool target.
          const profile = await defaultUserPreferenceProfile(userPreferenceProfile)
          preparation = { ...chat, userProfileEnabled: profile?.hasConfirmed === true && profile.defaultEnabled === true,
            userProfileId: profile?.profileId || 'default', userProfileManagementId: chat.userProfileManagementId || chat.userProfileId || 'default' }
        }
        patch = await build(preparation, preferenceOnly(chat) ? null : card === undefined ? await readCard(chat) : card)
        if (preferenceOnly(chat)) Object.assign(patch, { userProfileEnabled: preparation.userProfileEnabled, userProfileManagementId: preparation.userProfileManagementId })
        source = 'card-context.snapshot'
      }
      const draft = Object.assign({}, chat, patch)
      const saved = await writeChat(draft, { source })
      // Persistence may merge unrelated concurrent edits. The owner must adopt
      // that committed record before adopting its revision; waiters do not.
      const committed = saved && typeof saved === 'object' ? saved : draft
      for (const field of Object.keys(chat)) if (!Object.hasOwn(committed, field)) delete chat[field]
      Object.assign(chat, committed)
      return patch
    })()
    pending.set(key, operation)
    try { return (await operation).cardContextSnapshot }
    finally { if (pending.get(key) === operation) pending.delete(key) }
  }

  function bookSnapshot(record) {
    return { version: 1, libraryDigest: worldbookContentDigest(record), source: structuredClone(record?.source ?? null), document: structuredClone(record?.document ?? null) }
  }

  async function liveBook(chat, card) {
    const liveChat = { ...chat }
    delete liveChat.openingWorldbookSnapshot
    return worldBooks.bound(chat.cardPath, card, liveChat)
  }

  function updateDigest(card, snapshot) {
    return cardContentDigest({ card: cardContentDigest(card), worldbook: worldbookContentDigest(snapshot) })
  }

  async function updateStatus(chat, card) {
    const cardChanged = !chat.cardContentDigest || chat.cardContentDigest !== cardContentDigest(card)
    const migrations = (card?.extensions?.dsh_tavern?.stateMigrations || []).filter(plan => !chat.cardStateMigrationIds?.includes(plan.id)).flatMap(plan => plan.operations || []).map(op => op.op === 'move' ? op.from + ' → ' + op.path : op.op === 'convert' ? op.path + ' → ' + op.type : '删除 ' + op.path)
    const base = { legacy: !chat.cardContentDigest, cardChanged, migrations }
    try {
      const snapshot = bookSnapshot(await liveBook(chat, card))
      const digest = updateDigest(card, snapshot)
      const previous = chat.worldbookLibraryDigest ?? chat.openingWorldbookSnapshot?.libraryDigest
      // Legacy snapshots may already contain local script writes. Without the
      // original resource version, request explicit synchronization instead of
      // silently adopting the current library as the historical baseline.
      const worldbookChanged = previous ? previous !== snapshot.libraryDigest
        : JSON.stringify(chat.openingWorldbookSnapshot?.source ?? null) !== JSON.stringify(snapshot.source ?? null)
      const worldbookSyncRequired = !previous && !!(snapshot.source || snapshot.document || chat.openingWorldbookSnapshot?.source || chat.openingWorldbookSnapshot?.document)
      return { ...base, available: cardChanged || worldbookChanged || worldbookSyncRequired, worldbookChanged, worldbookSyncRequired, digest }
    } catch (error) {
      // Missing/corrupt library resources must not prevent reading a saved game.
      return { ...base, available: true, worldbookChanged: true, digest: '', error: str(error?.message || error) }
    }
  }

  async function replacement(chat, card, expectedDigest) {
    // Explicit user consent replaces the live book snapshot as well as the card
    // prefix. Resolve without the old snapshot, and fail before publishing if
    // a binding is missing; never mark a partial refresh as successfully applied.
    const worldBook = await liveBook(chat, card)
    const openingWorldbookSnapshot = bookSnapshot(worldBook)
    if (expectedDigest !== undefined && expectedDigest !== updateDigest(card, openingWorldbookSnapshot)) {
      throw new Error('人物卡或世界书已再次修改，请刷新后确认')
    }
    const patch = await build({ ...chat, openingWorldbookSnapshot }, card, true, worldBook)
    return { ...patch, cardName: card.name || chat.cardName, openingWorldbookSnapshot, cardContextRevision: (Number(chat.cardContextRevision) || 0) + 1 }
  }

  async function preferenceReplacement(chat, enabled, profileId) {
    if (!usesFixedContext(chat) || chat.mode === 'card') throw new Error('仅支持游玩会话')
    if (typeof enabled !== 'boolean') throw new Error('画像开关必须为布尔值')
    if ((chat.userProfileEnabled === true) === enabled && !profileId) return {}
    const preference = enabled ? await userPreferenceProfile?.stableContext(profileId || chat.userProfileId) : null
    if (enabled && !preference) throw new Error('请先建立并确认用户画像')
    let base = str(chat.cardContextSnapshot)
    if (!base) throw new Error('当前游戏缺少人物卡快照，请先恢复会话后重试')
    const previous = sanitizeAgentProjectionText(str(chat.userProfileContextSnapshot))
    if (previous) {
      if (base === previous) base = ''
      else if (base.startsWith(previous + '\n\n')) base = base.slice(previous.length + 2)
      else throw new Error('当前画像与提示词快照不一致，未修改游戏')
    }
    return {
      userProfileEnabled: enabled,
      userProfileId: preference?.profileId || chat.userProfileId || 'default',
      userProfileRevision: preference?.revision || 0,
      userProfileContextSnapshot: preference?.text || '',
      cardContextSnapshot: sanitizeAgentProjectionText([preference?.text, base].filter(Boolean).join('\n\n')),
      cardContextRevision: (Number(chat.cardContextRevision) || 0) + 1
    }
  }

  return Object.freeze({ prepare, ensure, settled, constantContext, updateStatus, replacement, preferenceReplacement })
}
