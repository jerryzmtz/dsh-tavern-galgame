# dsh-assets 1.3.34

refresh-plan 现在阻止同槽尚未结束的 requested 请求，报错给出阻塞计划 ID；先查 status 并核实该请求结果，不要重复付费生成。新增 --note 替换新计划的备注；迁移旧窗口时必须用它替换旧尺寸说明。旧计划备注、请求时间、调用历史及预算台账不变，刷新不联网、不消费、不批准。

## 女仆 layered blink 迁移

替换项目路径、候选路径及两个旧计划 ID。先确认同槽没有未解决的其他请求。geometry 文件必须保存完整源图的真实眼部测量（不是裁剪坐标）；这两个槽的目标窗口为 1536x1024、x=-156、y=-32。刷新后检查窗口，不符合则停止并修正真实测量，不要缩放图片或改台账。

```powershell
$Project = 'F:\项目\大肥鱼-images'
$Candidates = 'F:\候选\女仆眨眼'
$Figure = 'f-9b82a81a-a11d-435c-a580-54a0473a2988'
node bin/dsh-assets.mjs status --project $Project --slot "$Figure/default/blink/anxious" --json
node bin/dsh-assets.mjs status --project $Project --slot "$Figure/default/blink/disgust" --json
$Anxious = (node bin/dsh-assets.mjs refresh-plan --project $Project --plan OLD_ANXIOUS_PLAN --geometry "$Candidates/geometry-anxious.json" --note 'Edit only the eyes for the anxious layered blink. Use the supplied 1:1 1536x1024 window at full-source x=-156, y=-32; preserve all other pixels and transparency.' --json | ConvertFrom-Json).result
$Disgust = (node bin/dsh-assets.mjs refresh-plan --project $Project --plan OLD_DISGUST_PLAN --geometry "$Candidates/geometry-disgust.json" --note 'Edit only the eyes for the disgust layered blink. Use the supplied 1:1 1536x1024 window at full-source x=-156, y=-32; preserve all other pixels and transparency.' --json | ConvertFrom-Json).result
foreach ($Plan in @($Anxious, $Disgust)) {
  if ($Plan.output.size -ne '1536x1024' -or $Plan.editWindow.x -ne -156 -or $Plan.editWindow.y -ne -32) { throw '窗口不符，停止生成并检查完整源图测量' }
  $Plan | ConvertTo-Json -Depth 20
}
# 仅在另行确认预算、生成完成后导入新窗口结果；刷新本身不生成。
node bin/dsh-assets.mjs import --project $Project --plan $Anxious.id --file "$Candidates/anxious-window-1334.png"
node bin/dsh-assets.mjs import --project $Project --plan $Disgust.id --file "$Candidates/disgust-window-1334.png"
node bin/dsh-assets.mjs review-html --project $Project
```

不要重新 require-blink；真实人工 accept 与 animation pack/install 沿用 NOTE-1.3.31.md。未传 --note 时保留原备注，因此含旧窗口说明的计划务必显式替换。回归测试覆盖同槽 requested 阻塞、无写入，以及更新备注后提示词只包含新尺寸，并保全历史与台账。
