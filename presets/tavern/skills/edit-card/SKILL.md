---
name: edit-card
description: "修改已有的人物卡：设定、开场、文风、世界书、正则美化、MVU 变量与面板。像改代码一样直接改，改完确认格式校验通过；普通卡转 MVU 使用 card-to-mvu，游玩故障诊断使用 debug-card。"
---

# 修改人物卡

完成用户要的修改，其余内容保持不变。目标或要求不明确时只问缺的那一项，明确了就动手。

## 怎么改

人物卡就是一份文件，按需要选顺手的方式改：

- 定位：不确定要改的内容在哪，或要改多处时，先用 `tavern_search_card` 一次搜遍全卡（标准字段、开场、世界书标题/关键词/正文、正则、脚本），按返回的位置读取和修改，不必写脚本翻 JSON。
- 改名、统一措辞等同一段文字要改多处时：`tavern_replace_card_text` 一次替换全卡并保存，结果列出每处位置和全卡剩余处数；只改部分位置时用 `pointers` 限定。
- 标准字段（描述、性格、开场、示例对话等）：`tavern_update_card` 的 `fields`，不用处理 JSON 转义。
- 扩展字段（正则、脚本、MVU 面板等）：`tavern_update_card` 的 `rawOperations`，按 JSON Pointer 设置或删除。
- 世界书条目：`tavern_update_worldbook`。条目字段用 `comment`、`content`、`primaryKeys`、`enabled`、`constant` 等。
- 大段或多处改动也可以用文件编辑器或脚本直接改卡片 JSON。文件结构是 `{kind, version, raw: {spec, data: {…}}, meta}`，标准字段与 `character_book`、`extensions` 都在 `raw.data` 下。
- 读取用 `tavern_read_card`、`tavern_read_card_raw`、`tavern_read_worldbook`，只读需要的部分。

`tavern_update_card` 和 `tavern_update_worldbook` 保存后会自动校验并在结果里返回，不用再单独校验；用文件编辑器或脚本直接改了人物卡、预设或世界书文件，才调用 `tavern_validate_card` 并指定该文件路径。修正 errors，warnings 视情况处理。工具结果就是磁盘上的实际状态，不必再用 bash 复核。

## MVU 卡

变量初值在各开场末尾的 `<initvar>` 里，更新规则在世界书 `[mvu_update]` 条目，面板在 `extensions.regex_scripts` 的状态视图正则里。格式约定用 `tavern_read_skill_reference` 读取 `card-to-mvu` 的 `references/mvu-format.md`。

- 改初值：直接改对应开场的 `<initvar>` JSON。
- 增删变量：每个开场的 `<initvar>` 一起改，同步改 `[mvu_update]` 规则和面板。
- 改面板：直接改状态视图正则的 `replaceString` HTML。
- 改开场正文：保留末尾的 `<initvar>` 和 `<mvu-status/>`。

## 世界书归属

改世界设定或规则前，先确认目标卡实际用的是内置世界书（`cards/...`）还是绑定的独立世界书（`worldbooks/...`）。独立世界书可能被多张卡共用：用户只要求改当前卡、而修改会影响其他卡时，先说明影响。

## 完成

说明改了哪些地方和校验结果。资源保存不会自动改动正在进行的游戏存档。静态校验不等于真实游玩验证，用户要求时才做真实试玩。
