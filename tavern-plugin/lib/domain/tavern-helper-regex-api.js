// Synchronous Helper APIs share the host's regex engine, with live context reads.
// Keep this installer self-contained for script and message iframe serialization.
function installTavernHelperRegexApi(options) {
  const target = options.window
  const engine = options.createEngine()
  const placements = { user_input: 1, ai_output: 2, slash_command: 3, world_info: 5, reasoning: 6 }

  function helperRegex(script, scope) {
    const placements = Array.isArray(script.placement) ? script.placement.map(Number) : []
    return {
      id: String(script.id || ''), script_name: String(script.name || script.scriptName || ''), enabled: script.enabled !== false,
      find_regex: String(script.findRegex || ''), trim_strings: script.trimStrings || [], replace_string: String(script.replaceString || ''),
      source: { user_input: placements.includes(1), ai_output: placements.includes(2), slash_command: placements.includes(3), world_info: placements.includes(5), reasoning: placements.includes(6) },
      destination: { display: script.markdownOnly === true, prompt: script.promptOnly === true }, run_on_edit: script.runOnEdit === true,
      min_depth: script.minDepth == null ? null : Number(script.minDepth), max_depth: script.maxDepth == null ? null : Number(script.maxDepth), scope
    }
  }

  // Status/message frames and companion scripts read the same live rule catalog.
  target.getTavernRegexes = function (option) {
    const groups = Object.assign({ global: [], character: [] }, (options.context() || {}).regexScripts)
    const resolved = option && typeof option === 'object' ? option : {}
    let items = []
    if (resolved.type) {
      if (!Object.prototype.hasOwnProperty.call(groups, resolved.type)) throw new Error('不支持的酒馆正则类型: ' + resolved.type)
      items = groups[resolved.type].map(script => helperRegex(script))
    } else {
      const scope = resolved.scope || 'all', enabled = resolved.enable_state || 'all'
      if (!['all', 'global', 'character'].includes(scope)) throw new Error('无效的酒馆正则 scope: ' + scope)
      if (!['all', 'enabled', 'disabled'].includes(enabled)) throw new Error('无效的酒馆正则 enable_state: ' + enabled)
      if (scope === 'all' || scope === 'global') items.push(...groups.global.map(script => helperRegex(script, 'global')))
      if (scope === 'all' || scope === 'character') items.push(...groups.character.map(script => helperRegex(script, 'character')))
      if (enabled !== 'all') items = items.filter(script => script.enabled === (enabled === 'enabled'))
    }
    return JSON.parse(JSON.stringify(items))
  }

  function boundCharacter(state) {
    // DSH applies enabled rules on a bound card without SillyTavern's separate
    // avatar opt-in. This reports the same permission as the Helper facade's
    // character_allowed_regex projection, even when all individual rules are off.
    return state.character !== null && typeof state.character === 'object' && !Array.isArray(state.character)
  }

  function substituteIdentity(value, state, characterName, escape = false) {
    function replacement(value) {
      const text = String(value)
      return escape ? text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : text
    }
    return String(value ?? '').replace(/{{\s*(user|char)\s*}}/gi, function (_match, name) {
      return replacement(name.toLowerCase() === 'user'
        ? state.playerName || '你'
        : characterName ?? (state.characterName || state.character?.name || state.character?.data?.name || '角色'))
    })
  }

  target.isCharacterTavernRegexesEnabled = function () {
    return boundCharacter(options.context() || {})
  }

  target.formatAsTavernRegexedString = function (value, source, destination, settings = {}) {
    if (!Object.prototype.hasOwnProperty.call(placements, source)) throw new TypeError('无效的正则来源: ' + String(source))
    if (destination !== 'display' && destination !== 'prompt') throw new TypeError('无效的正则目标: ' + String(destination))
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new TypeError('正则选项必须是对象')
    if (settings.depth !== undefined && (typeof settings.depth !== 'number' || !Number.isFinite(settings.depth))) {
      throw new TypeError('正则深度必须是有限数字')
    }
    const state = options.context() || {}
    const groups = state.regexScripts || {}
    const list = value => Array.isArray(value) ? value : []
    // Preserve DSH's global, preset, character priority; preset rules participate
    // when the host supplies that group. No state or stored message is modified.
    const scripts = list(groups.global).concat(list(groups.preset), boundCharacter(state) ? list(groups.character) : [])
      .filter(script => script && typeof script === 'object')
      .map(function (script) {
        const mode = Number(script.substituteRegex)
        return {
          ...script,
          findRegex: mode === 1 || mode === 2
            ? substituteIdentity(script.findRegex, state, settings.character_name, mode === 2) : script.findRegex,
          trimStrings: list(script.trimStrings).map(value => substituteIdentity(value, state, settings.character_name))
        }
      })
    const result = engine.applyTavernRegexText(value, scripts, {
      placement: placements[source], isMarkdown: destination === 'display', isEdit: false,
      depth: settings.depth, ignoreDepth: settings.depth === undefined
    })
    for (const warning of result.warnings) target.console?.warn?.('[TavernHelper regex] ' + warning)
    // Apply identity macros first, then the shared read-only macro adapter.
    // Unknown or side-effecting macros remain literal during formatting.
    const formatted = substituteIdentity(result.text, state, settings.character_name)
    return typeof target.substitudeMacros === 'function' ? target.substitudeMacros(formatted, {
      character_name: settings.character_name,
      message_id: settings.depth === undefined ? undefined : (state.messages || []).length - settings.depth - 1
    }) : formatted
  }

  return {
    getTavernRegexes: target.getTavernRegexes,
    formatAsTavernRegexedString: target.formatAsTavernRegexedString,
    isCharacterTavernRegexesEnabled: target.isCharacterTavernRegexesEnabled
  }
}

export { installTavernHelperRegexApi }
