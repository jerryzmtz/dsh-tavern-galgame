import { defineTool } from '@deepseek-ai/dsh-tools'

export function registerRegexLibraryTools({ chatForSession, regexLibrary, tools }) {
  tools.register(defineTool({
    name: 'tavern_read_regex_library',
    description: '读取正则库。正则库只存放用户导入的原版酒馆正则，本身不生效。用户要求启用时，把 script 原样写入人物卡 /data/extensions/regex_scripts（tavern_update_card 的 rawOperations）或预设的正则列表（tavern_update_preset）；写入前先读目标，追加到末尾，id 与已有正则重复时换新 id。',
    parameters: { id: { type: 'string', description: '可选；只读取这一条' } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { report: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.report }]
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const chat = await chatForSession(exec?.agent?.session?.id || '')
      if (!chat || chat.mode !== 'card') throw new Error('正则库只能在卡片工作台中读取')
      const items = (await regexLibrary.list()).filter(item => !args.id || item.id === args.id)
      if (args.id && !items.length) throw new Error('正则库里没有这条正则: ' + args.id)
      return { report: JSON.stringify(items.map(({ id, name, script }) => ({ id, name, script })), null, 2) }
    }
  }))
}
