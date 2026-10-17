# dsh-assets 1.3.42

## 眨眼补丁保留 RGBA

显式 eyeRect / eyeMasks 导入现在声明 `blend: "replace"`：mask 内非透明补丁像素替换原图 RGBA，透明像素保留原图（包括双眼间隙与 tearMasks）。alpha 是原有图像覆盖率，不再作为第二层不透明度叠加。原来的 alpha 容差与透明孔洞检查不变；没有改源图，也没有新增 hash 校验。

根因：例如源 alpha=253、补丁 alpha=253，正确的 straight-alpha source-over 仍会得到 alpha=255，并把旧眼颜色混入新眼。四份获批 baked raw 的旧合成分别有 43226、44466、48697、6741 个差异像素，全部对应非零半透明补丁像素；不是 sharp 预乘转换，也不是本次路径的羽化。显式替换使四份新合成与获批全画布 RGBA 差异均为 0。

`compositePatch(base, patch, rect, blend)` 的默认值仍为旧 source-over；传入 artifact 的 `blend` 才启用替换。既有作者项目和原生包没有此字段，保持原渲染及安装目标，不迁移或重解释旧批准。重新导入相同 PNG 但合成语义变化时会增加作者版本，须重新 accept。自动羽化提取器仍输出旧叠加补丁；不把羽化权重误当图像 alpha。

- CLI 的 static / layered 原生 blink 引用保留 blend；parts 在原部件层内使用相同替换语义。
- 审阅页与客户端分层合成器同步支持替换；static 舞台替换整张合成纹理，layered 在口型之前替换眼区，不再把同一半透明覆盖率重复叠加。旧 overlay 和 parts 路由不变。
- 常规 `prompt` → `import` → 精确 RGBA 核对 → 主人批准的 `accept` → `pack` → 新鲜 CAS 下 `install --dry-run` / `--confirm`；安装重放必须 noop。安装已有眨眼仍走正常三方合并，必要时用 1.3.40 的显式领养，不绕过冲突。

回归覆盖半透明边缘、透明 mask 保留、旧 straight-alpha source-over、浏览器半透明像素、parts / static / layered 安装与重放。由于原生 blink 合同及客户端发生变化，发布时需要宿主空闲重启，而非仅更换 CLI。
