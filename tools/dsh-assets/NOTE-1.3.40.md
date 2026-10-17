# dsh-assets 1.3.40

## 领养已安装眨眼基线

`adopt-installed-blink` 用于作者项目未跟踪、但原生库已经安装的眨眼。支持 static、layered 和 parts 路由；只建立三方合并的旧基线，不安装像素，也不授予审批。

```powershell
node bin/dsh-assets.mjs adopt-installed-blink --project PROJECT --slots FIG/OUTFIT/blink/calm,FIG/OUTFIT/blink/eating --expected-state installed-blinks.json --library LIB --expected-revision FRESH_UUID --reviewer OPERATOR --dry-run --json
# 检查后去掉 --dry-run；同样的输入再次执行为 noop。
```

`installed-blinks.json` 是以所选规范槽 ID 为键、完整原生眨眼状态为值的 JSON 对象，键必须恰好等于选择。通过现有 `readNativeSnapshot`、`animationRoute`、`animationState(route,'blink',assets)` 读取。static/layered 保存 closed、可选 half 的已存媒体身份及 rect；parts 保存完整 frames 中的部件几何、版本和已存媒体身份。不是新 v2 候选的补丁摘要，也不是历史作者版本。人物先从项目 key 解析为原生 UUID；槽参数只接受规范 ID，不以名称或情绪显示标签查表。

命令复用现有 `animationSource` 的来源身份和路由身份，与声明的 sourceBinding 对齐；比较当前 revision 及完整已安装状态，写入前再次读 revision。没有新增文件哈希校验。来源变更、预期状态不符、现有 tracking 不同或历史领养记录不同均返回 CONFLICT，整批不写入。缺少参数或未知选择返回 INVALID_ARGUMENT。

一次原子写入 `sources/image-install.json`：`blinks[SLOT]={source:{slot,version,hash},blink}`，以及 `blinkAdoptions[SLOT]={slot,record,routing,reviewer,adoptedAt,revision}`。已有相同 tracking 可以补齐领养记录；完全重放不写文件。项目 JSON、候选版本、像素、审批、计划和预算不变。不会伪造旧眨眼的作者版本，也不会写 `slots` 的安装版本。正常安装后 tracking 更新为新眨眼，旧领养记录保留；不能重放旧领养来回滚基线。

随后用同一精确选择及新鲜库 revision 正常发布：

```powershell
$Args = @('--project','PROJECT','--scope','animation','--slots','FIG/OUTFIT/blink/calm,FIG/OUTFIT/blink/eating','--library','LIB','--expected-revision','FRESH_UUID')
node bin/dsh-assets.mjs pack @Args --json
node bin/dsh-assets.mjs install @Args --dry-run --json
node bin/dsh-assets.mjs install @Args --confirm --json
```

不改变三方冲突判断、候选审批或安装 CAS。回归在现有 animation-routes 测试中覆盖 parts/static 的已批准 v2 替换、旧基线缺失冲突、陈旧 CAS、错误媒体身份/来源路由、冲突 tracking、只读预览、领养重放、精确安装及安装重放；fixture UUID 与显示名不同，并包含中文情绪标签。CLI-only，无需重启应用。
