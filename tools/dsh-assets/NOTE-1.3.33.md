# dsh-assets 1.3.33

修复大肥鱼女仆 default/anxious（1313x1198、原生偏移 100,-227）与 default/disgust（1312x1199、原生偏移 100,-229）的眨眼编辑窗口。gpt-image-2.5 Responses 请求 1024x1024 实际返回 1254x1254，不能将这种输出缩放后导入。

- 新窗口仅选择模型精确支持的 1024x1536 或 1536x1024；完整源图上的 ROI、headRect 加 32px 余量必须全部容纳，优先透明补边最少的方向及位置。这两个源在眼部测量适配时使用 1536x1024。裁剪和补边严格 1:1，不缩放；原生安装偏移不变，窗口偏移以新计划为准。
- 标准尺寸源继续原流程；非标准源不再选择方形窗口。错误尺寸仍明确拒绝，绝不重采样。
- prepare 对绑定来源字节只计算一次哈希并核对 sourceBinding.hash，复用已验证字节裁剪；篡改源图返回 CONFLICT，不再浪费付费生成。
- 窗口导入先检查尺寸再写 raw，失败不新增图片或改动项目；本地 generate 的 received 原始响应仍保留，避免丢失已付费结果。

## 两个女仆槽的旧计划迁移

不要重新 require-blink，也不要改预算台账或把旧调用改成未调用。先查 status 和 received，确认旧请求已结束；未知结果应先核实，不能用刷新触发重复请求。以下操作本身不联网、不消费、不批准，只返回新计划 ID。prepared 旧计划标为 superseded；旧 1024x1024 窗口的 requested / unknown / invalid 计划保留原 status、requestedAt、错误和调用记录，仅增加 refreshedTo。旧 ID 不再允许生成、导入或重复刷新。其他未解决请求继续阻塞刷新。

替换路径和两个旧计划 ID；geometry 文件必须是完整源图上的真实测量，不能使用旧裁剪坐标。若旧计划已保存正确测量，可省略 --geometry。

```powershell
$Project = 'F:\项目\大肥鱼-images'
$Candidates = 'F:\候选\女仆眨眼'
$Figure = 'f-9b82a81a-a11d-435c-a580-54a0473a2988'
node bin/dsh-assets.mjs status --project $Project --slot "$Figure/default/blink/anxious" --json
node bin/dsh-assets.mjs status --project $Project --slot "$Figure/default/blink/disgust" --json
$Anxious = (node bin/dsh-assets.mjs refresh-plan --project $Project --plan OLD_ANXIOUS_PLAN --geometry "$Candidates/geometry-anxious.json" --json | ConvertFrom-Json).result
$Disgust = (node bin/dsh-assets.mjs refresh-plan --project $Project --plan OLD_DISGUST_PLAN --geometry "$Candidates/geometry-disgust.json" --json | ConvertFrom-Json).result
$Anxious | ConvertTo-Json -Depth 20
$Disgust | ConvertTo-Json -Depth 20
# 使用新 references 中的裁剪 PNG 和新 output.size；不要再交付旧 1254x1254 输出。
# 确认预算允许后，才另行发起新生成；刷新不会返还或清零旧调用。
node bin/dsh-assets.mjs import --project $Project --plan $Anxious.id --file "$Candidates/anxious-window-1333.png"
node bin/dsh-assets.mjs import --project $Project --plan $Disgust.id --file "$Candidates/disgust-window-1333.png"
node bin/dsh-assets.mjs review-html --project $Project
```

后续真实人工 accept 与 animation pack/install 沿用 NOTE-1.3.31.md；已导入计划不能刷新，源图确实变化仍需显式 rebind、重新测量及人工审批。现有预算台账和 generationLog 原样保留，新增调用只能在实际另行生成时记录。

回归覆盖：奇数尺寸横/竖窗口、无方形选择、逐像素裁剪及补边、错尺寸拒绝且无新文件、篡改来源拒绝、标准尺寸源不变，以及旧 prepared / 已请求计划刷新保留调用历史和外部预算文件。
