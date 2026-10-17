# 发音字典与连字符

「配音 → 发音字典」对所有人物卡和语音服务生效；两列为「原文 → 读作」，即改即存，虚线 ＋ 添加，标题 ⋯ → 删除… 批量删除。默认项也可以编辑或删除。

默认 Wi-Fi / WiFi → WiFi、AI → A I、GPT → G P T、OK → O K、Claude → 克劳德；采用常规读法，未播放或转写引擎音频。

字典存于全局 `tts.pronunciationDictionary`，形状为 `{term, spoken}[]`，覆盖同名默认项。空 `spoken` 是删除默认项的记录。拉丁原文不区分大小写，按整词匹配，最长优先；只替换一遍，不递归处理替换结果。

`dsh-tts/src/pronunciation.js` 集中处理合成文本：拉丁词内连字符作短停顿；无算式上下文的数字范围读「到」；数字表达式含 `= + × * / ÷` 或数字间连字符两侧都有空格时读「减」；开头、空格或左括号后紧接数字的连字符读「负」；其余保留。特殊读法可加字典条目。

所有 provider 经同一合成入口，先用现有按语言朗读预设，再用发音字典及连字符规则。缓存身份使用最终合成文本；编辑词典后客户端丢弃解码缓存，但不会自动迁移或生成音频，只有用户重播才合成缺失行。Python 本地服务不变。

控制 API 沿用同源登录鉴权：`pronunciationDictionary` 返回 `{entries, defaults}`；`savePronunciationDictionary` 接受 `{entries}` 并返回相同结构；非法输入为 `INVALID_INPUT`。
