# dsh-assets 1.3.35

## 原生已装槽的受控替换

此前铁盆饭图通过保留作者工程的数值版本槽及 `sources/image-install.json` 替换；这条路径继续使用 `prompt` -> `import --replace`（plan 冻结当前版本），或带 `expected_version` 的 merge。不能从新 baseline 伪造这些作者版本或批准。

原生 images baseline 的 `baseline-installed` 槽现在可显式导入替换候选：

```powershell
node bin/dsh-assets.mjs replace-installed --project PROJECT --slot FIG/OUTFIT/avatar/EMOTION --expected-version NATIVE_SLOT_UUID --library LIB --expected-revision CURRENT_NATIVE_UUID --file candidate.png --geometry measured.json --source owner-redraw
```

- 仅支持实际单图的 sprite/avatar；必须同时匹配槽当前 UUID、库当前 revision、原安装哈希及父立绘。复杂分层源不被猜测成单图。
- 原生 UUID 是不透明 CAS 令牌，不是整数。首次替换保留 `replacementBase:{version,hash,revision}` 作为原生前驱，建立作者 v1；后续沿用数值版本增加。不会把 UUID 拼接数字或制造历史批准。
- `replacementBase` 接入已有 image-install 三方合并基线；成功安装后使用正常 `sources/image-install.json` 跟踪。未安装候选不会更新库。
- 导入在一个项目事务内完成。头像使用正常 normalize/check-avatar QA，并绑定父立绘精确版本及哈希；立绘仍须 register。QA 失败继续保持 REDO，不自动重试或接受。
- 外部作者文件的字节身份检查保留，篡改候选、父图或审批绑定文件会拒绝。安装仍须真实人工 accept、pack 和库 revision CAS；头像单独安装还核对当前库父立绘。

## 动画精确选择（给 Dot）

`pack` 与 `install --scope animation` 支持可重复 `--sprites FIG/OUTFIT/sprite/EMOTION`，每次也可逗号分隔。选择该立绘已声明的 mouths 与 blink；不选的组，即使已接受，也保持库内原样。也可用 `--slots` 逗号列出具体动画槽；嘴型必须完整列出 closed/small/mid/open 四槽，blink 可单独选。两种选择取并集。未知、空选择或残缺 mouthSet 拒绝。

```powershell
$Args = @('--project','PROJECT','--scope','animation','--library','LIB','--expected-revision','CURRENT_NATIVE_UUID','--sprites','FIG/basin/sprite/crying','--sprites','FIG/basin/sprite/anger')
node bin/dsh-assets.mjs pack @Args --json
node bin/dsh-assets.mjs install @Args --dry-run --json
# 主人确认 dry-run.written 后，使用完全相同的选择与 CAS：
node bin/dsh-assets.mjs install @Args --confirm --json
```

如 crying 只要嘴型、不要眨眼，改用 `--slots FIG/basin/mouth/crying/closed,FIG/basin/mouth/crying/small,FIG/basin/mouth/crying/mid,FIG/basin/mouth/crying/open`。不要选已否决的 smug 或暂停的 eating。未给筛选时兼容原行为；筛选不会授权未接受的槽。收据冻结规范化选择，pack/install 不同选择拒绝；dry-run 的 `written` 是实际改变的槽，重放为 noop。

## 回归

现有测试扩展覆盖原生立绘与头像的导入、QA、批准及安装回环，错误 expected-version 无写入、篡改候选拒绝、精确父绑定，以及动画仅安装选中组、未选中已接受组不变、未知选择拒绝和收据选择一致性。未新增测试文件。
