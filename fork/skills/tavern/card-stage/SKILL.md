---
name: card-stage
description: "编写人物卡自带的 HTML 舞台代码（extensions.dsh_stage）：随变量变化的特效、天气、光晕、3D 和 HUD 状态面板。galgame 舞台模式、开场画面、背景、立绘和皮肤用 stage-setup。"
---

# 人物卡舞台（Card Stage）

本 Skill 只写卡自带的 HTML 展示层。用户要的是 galgame 舞台、舞台模式、开场画面、背景素材、人物站位或皮肤时，改用 stage-setup。

舞台是人物卡自带的展示层，写在人物卡 raw 的 `data.extensions.dsh_stage`。游玩时它在正文周围的沙箱 iframe 中运行，只读取变量，不影响剧情和结算。修改后刷新游玩页即可生效，不需要「应用变化到当前游戏」。

## 做法

- **选变量**：从人物卡的变量结构（初始变量、`[initvar]` 世界书条目、MVU schema）和已有状态栏里挑值得表现的：数值（生命、浑浊度、灵气、好感）和枚举/文本（地点、时间、天气、境界、场景警报）。
- **定重点**：用户说了风格和要表现什么就照做；没说时自己按卡的题材选 3–6 个最常变、最有氛围的变量，交付时说明选择，用户可以再调。舞台要克制：背景不抢正文，HUD 只放最常看的信息。
- **选实现**：组件库 `<stage-*>` 能做到就不写 JS；需要独特效果再写 `<script type="module">` 调用 `await dshStage.kit()`；确实需要 3D 才用 `kit.three()`。
- **写入**：用 `tavern_update_card` 的 `rawOperations` 只改 `data.extensions.dsh_stage`，人物卡其他部分不变（用户另有要求除外）；看保存结果附带的校验。
- **交付**：说明表现了哪些变量、用了哪些效果，请用户在游玩页的宽屏和窄屏下各看一次（窄屏时 HUD 收起，`stage-margin` 留白不够会自动隐藏）。静态校验不代表视觉效果已确认。

## 结构

```json
{
  "version": 1,
  "mode": "layers",
  "regions": ["backdrop", "hud"],
  "hudWidth": 280,
  "theme": { "scheme": "dark", "text": "#e8e6f0", "muted": "#9d98b0", "panel": "rgba(12,10,20,.55)", "border": "rgba(255,255,255,.07)", "accent": "#8fd3ff", "readingFont": "serif" },
  "html": "…"
}
```

- `backdrop`：正文背后的全屏层，不接收鼠标。`hud`：右上悬浮面板。`mode: "takeover"` 会完全接管游玩区，只在用户明确要求时使用。
- 同一份 `html` 在每个区域各运行一次。用 `<div data-region="backdrop">…</div>`、`<div data-region="hud">…</div>` 区分内容。
- `theme` 只接受颜色值和字体栈；`panel` 是阅读栏底色，必须足够不透明，保证正文可读。

## 组件（bind 从 stat_data 开始；`@` 开头读完整变量）

- 文本/面板：`<stage-text bind format fallback>`、`<stage-panel title subtitle>`
- 数值：`<stage-stat label bind max unit invert color>`、`<stage-ring bind max label size color>`
- 条件：`<stage-alert bind label when color>正文 {value}</stage-alert>`
- 遍历：`<stage-each bind="角色表"><template>…使用 .相对路径、$key、data-key、data-key-color…</template></stage-each>`
- 布局：`<stage-margin side="left|right" min-width="180">` 把内容放进正文栏旁的留白
- 氛围：`<stage-sky bind-time bind-weather dim>`、`<stage-weather bind>`（雨、雪、花、萤、火、灵气、尘）、`<stage-particles type bind-intensity max color>`（rain snow petals fireflies embers qi dust sparkles）、`<stage-aura bind max color x y size>`、`<stage-image bind map='{"关键词":"url","*":"url"}' dim>`、`<stage-vignette>`、`<stage-flash bind when="down" color>`

## JS API（需要时）

`const kit = await dshStage.kit()` 后可用：`kit.watch(path, fn)`、`kit.follow(v, rate)`、`kit.loop((dt, t) => …)`（共享循环，页面隐藏时自动暂停）、`kit.safeArea()`、`kit.quality()`、`kit.colorFor(name)`、`kit.parseHour(text)`、`kit.three({ bloom })`（返回 `THREE, scene, camera, onFrame, addon()`）。
底层 `dshStage` 提供 `stat()`、`get(path)`、`on('vars'|'host'|'layout'|'turn')`、`host.busy`（正在生成）、`host.reducedMotion`。

## 约束

- 不用 CDN 资源也要能运行，three.js 和组件库都由本地提供。大图片、模型用 URL 引用，整个 html 不超过 2MB。
- 每帧逻辑一律挂在 `kit.loop`，不要自己开多个 requestAnimationFrame 或 setInterval。
- 尊重 `host.reducedMotion`：减少闪烁与剧烈运动。
- 舞台只读变量，数值变化由后台结算负责。
