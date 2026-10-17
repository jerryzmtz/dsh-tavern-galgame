# dsh-assets 1.3.36

## 修复 parts 动画安装的透明孔洞

parts recipe 的眨眼及嘴型补丁安装现在复用审查/QA 的 `compositePatch`（straight-alpha source-over），不再把透明遮罩矩形直接覆盖到原始 face/mouth 部件。补丁透明处保留原部件，半透明边缘正常混合，完全不透明的嘴型像素保持原样。

whole/static 与 layered-static 的补丁引用、atlas 排布不变。原始批准补丁字节检查、审批、来源校验及 CAS 边界全部保留；无需重新批准相同补丁。

已安装旧部件需使用原作者工程及新鲜库 revision，以 `install --scope animation --slots <exact>` 先 dry-run 后安装；嘴型仍须选完整 closed/small/mid/open 四槽。不要从新 baseline 伪造批准或覆盖三方冲突。重放必须 noop。

现有 `asset-cli-animation-routes.test.mjs` 扩展覆盖透明/半透明 blink 遮罩保留原 face alpha、不透明嘴型像素不变，以及原有篡改字节拒绝与重放检查。未新增测试文件。
