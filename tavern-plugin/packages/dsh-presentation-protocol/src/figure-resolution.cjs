// private fork: shared exact identity resolution, no media or storage access.
const forkFigureResolution = (() => {
// Pure recall evidence. OpenCC subset attribution: shared/OpenCC-NOTICE.md.
const traditional = '醫學樓門開關聲風雨電車馬鈴鐘書館場園廳間網機鐵橋邊廣辦廚臥寢臺燈牆戰鬥劍槍擊響腳步葉鳥蟲蟬貓龍靈藥煉爐陣雲霧島灣樹林綠紅黃藍驚動靜樂溫暖懸謎險傷祕舊報話訊號櫃課體泳禮營礦窯獄廟廢遺跡鎮鄉莊農倉庫邁進傳來後裡遠處側陰陽曉晚時長廊實驗術藝計腦飛發髮滿覺麗區鄰賣買貨攤飲煙塵滅爆彈殼鎖鑰敲碎落濺濕濤浪轟轎輪軌輛廠產經濟會議訓練護衛隊軍敵聖殿國宮寬窄圍觀戲劇院幹'
const simplified = '医学楼门开关声风雨电车马铃钟书馆场园厅间网机铁桥边广办厨卧寝台灯墙战斗剑枪击响脚步叶鸟虫蝉猫龙灵药炼炉阵云雾岛湾树林绿红黄蓝惊动静乐温暖悬谜险伤秘旧报话讯号柜课体泳礼营矿窑狱庙废遗迹镇乡庄农仓库迈进传来后里远处侧阴阳晓晚时长廊实验术艺计脑飞发发满觉丽区邻卖买货摊饮烟尘灭爆弹壳锁钥敲碎落溅湿涛浪轰轿轮轨辆厂产经济会议训练护卫队军敌圣殿国宫宽窄围观戏剧院干'
const conversion = new Map([...traditional].map((c, i) => [c, [...simplified][i]]))
const length = value => [...value].length
const codepointCompare = (a, b) => {
  const x = [...String(a)], y = [...String(b)]
  for (let i = 0; i < Math.min(x.length, y.length); i++) { const d = x[i].codePointAt(0) - y[i].codePointAt(0); if (d) return d }
  return x.length - y.length
}

function normalizeCatalogueText(value) {
  return [...String(value ?? '').normalize('NFKC')].map(c => conversion.get(c) || c).join('').toLowerCase().replace(/\s+/gu, ' ').trim()
}


// Shared display normalization; director resources retain their identity suffix.
function promptHandleStem(value, separator = '_', limit = 24) {
  return [...String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, separator).replace(new RegExp('^' + separator + '|' + separator + '$', 'g'), '')].slice(0, limit).join('')
}
const speakerKey = row => row.actorKey || row.alias
const speakerIdentity = row => row.ref ? row.ref.packId + '/' + row.ref.figureId : speakerKey(row)
function speakerStem(row) {
  const aliases = row.aliases || []
  const readable = aliases.find(value => /^[a-z][a-z0-9 _-]*$/i.test(value)) || aliases[0]
  return promptHandleStem(normalizeCatalogueText(readable || (!row.ref && row.alias) || row.name)) || 'speaker'
}
// Derive from the full card, not the recalled subset. No stored alias table or turn state.
function figureSpeakerHandle(rows, row) {
  rows = rows.filter(other => other.enabled !== false)
  const stem = speakerStem(row), key = speakerIdentity(row)
  const identities = other => [speakerKey(other), other.name, ...(other.aliases || [])].map(normalizeCatalogueText)
  const peers = [...new Set(rows.filter(other => speakerStem(other) === stem).map(speakerIdentity))].sort(codepointCompare)
  if (peers.length === 1 && !rows.some(other => speakerIdentity(other) !== key && identities(other).includes(stem))) return stem
  const rank = peers.indexOf(key) + 1
  let ordinal = 0, suffix = 0, candidate
  do {
    candidate = stem + '_' + ++suffix
    if (!rows.some(other => speakerStem(other) === candidate || identities(other).includes(candidate))) ordinal++
  } while (ordinal < rank)
  return candidate
}

// Exact names and aliases authorize identity; outfit trigger words never do.
function resolveFigureName(rows, segment = {}, roster = {}) {
  const alias = normalizeCatalogueText(typeof segment === 'string' ? segment : segment.alias);
  const name = normalizeCatalogueText(typeof segment === 'string' ? '' : segment.name);
  const available = rows.filter(row => row.enabled !== false);
  const matchesRef = (row, ref) => [row.ref, ...(row.sourceRefs || [])].some(source => source && ref && source.packId === ref.packId && source.figureId === ref.figureId);
  const byRef = ref => available.find(row => matchesRef(row,ref));
  if (segment.figureId) {
    const row = byRef(segment);
    return row ? {status:'resolved', actorKey:row.actorKey, ref:row.ref, row} : {status:'unavailable', ref:segment};
  }
  const exact = value => available.filter(row => normalizeCatalogueText(row.name) === value);
  const named = name ? exact(name) : [];
  const found = available.find(row => row.actorKey === alias) || available.find(row => normalizeCatalogueText(figureSpeakerHandle(rows, row)) === alias) || named[0] || exact(alias)[0]
    || available.find(row => (row.aliases || []).some(value => normalizeCatalogueText(value) === alias || name && normalizeCatalogueText(value) === name));
  const stored = Object.hasOwn(roster, alias) ? roster[alias] : null;
  if (stored?.figure) {
    const row = byRef(stored.figure);
    if (!row) return {status:'unavailable', actorKey:alias, ref:stored.figure};
    if (named.length && !named.some(match => match.ref.packId === row.ref.packId && match.ref.figureId === row.ref.figureId)) return {status:'conflict', actorKey:alias, ref:stored.figure};
    return {status:'resolved', actorKey:alias, ref:row.ref, row};
  }
  if (!found) return {status:'unknown'};
  const carried = Object.keys(roster).sort(codepointCompare).find(key => matchesRef(found,roster[key].figure));
  return {status:'resolved', actorKey:carried || found.actorKey, ref:found.ref, row:found};
}
return {normalizeCatalogueText, codepointCompare, promptHandleStem, figureSpeakerHandle, resolveFigureName};
})();
if (typeof window === 'undefined' && typeof module !== 'undefined') module.exports = forkFigureResolution;
