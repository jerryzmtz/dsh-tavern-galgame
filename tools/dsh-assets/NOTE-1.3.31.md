# dsh-assets 1.3.31

支持 source-bound blink / mouth 的非标准源画布：按完整源图实测 ROI（眨眼还包含 headRect）加 32 像素余量选择 1024x1024、1024x1536、1536x1024 或 1254x1254 窗口，原像素裁剪，越界透明补边。没有任何缩放。计划 editWindow 保存偏移、尺寸、测量与源 slot/version/hash；references 中该源的 path 是实际编辑用裁剪图，output.size 是必须交付的尺寸。

导入沿用既有局部提取器，patch.rect 自动还原成完整源图坐标，安装仍走原 animation 路由；ROI 外像素不来自模型。错尺寸明确拒绝，不重采样。标准尺寸源完全沿用原流程。接受、源变更失效、CAS 与重放 noop 不变。

## 女仆 default/anxious 与 default/disgust

以下 PowerShell 使用现有项目与完整原生库。替换项目/库路径及当前库 revision；geometry-anxious.json、geometry-disgust.json 必须分别在真实 1313x1198、1312x1199 完整源图上实测 headRect 与 eyeRect（或双眼 eyeMasks，必要时 tearMasks），不是在裁剪图上量坐标。不要猜测几何。

```powershell
$Project = 'F:\项目\大肥鱼-images'
$Library = 'F:\原生素材库'
$Revision = '当前库 revision UUID'
$Figure = 'f-9b82a81a-a11d-435c-a580-54a0473a2988'
$Candidates = 'F:\候选\女仆眨眼'
node bin/dsh-assets.mjs require-blink --project $Project --sprites "$Figure/default/sprite/anxious,$Figure/default/sprite/disgust" --library $Library --expected-revision $Revision
$Anxious = (node bin/dsh-assets.mjs prompt --project $Project --slot "$Figure/default/blink/anxious" --geometry "$Candidates/geometry-anxious.json" --json | ConvertFrom-Json).result
$Disgust = (node bin/dsh-assets.mjs prompt --project $Project --slot "$Figure/default/blink/disgust" --geometry "$Candidates/geometry-disgust.json" --json | ConvertFrom-Json).result
$Anxious | ConvertTo-Json -Depth 20
$Disgust | ConvertTo-Json -Depth 20
# 给模型各计划 references 中对应 sprite 的裁剪 PNG，严格使用各自 output.size。
# 生成后将原始候选保存到下面路径；绝不先缩放成窗口大小。
node bin/dsh-assets.mjs import --project $Project --plan $Anxious.id --file "$Candidates/anxious-window.png"
node bin/dsh-assets.mjs import --project $Project --plan $Disgust.id --file "$Candidates/disgust-window.png"
node bin/dsh-assets.mjs review-html --project $Project
# 真实人工审阅通过后才执行：
node bin/dsh-assets.mjs accept --project $Project --slot "$Figure/default/blink/anxious,$Figure/default/blink/disgust" --reviewer '实际审阅人'
node bin/dsh-assets.mjs pack --project $Project --scope animation --library $Library --expected-revision $Revision
node bin/dsh-assets.mjs install --project $Project --scope animation --library $Library --expected-revision $Revision --dry-run
node bin/dsh-assets.mjs install --project $Project --scope animation --library $Library --expected-revision $Revision --confirm
```

## 旧计划与口型

1.3.29 / 1.3.30 的计划不静默改写。仍为 prepared 的计划使用以下命令，拿返回的新 ID 重新生成裁剪候选；旧 ID 标为 superseded。已请求、已导入或不确定请求结果的计划先核实状态，再显式执行新 prompt，不自动重试或消费。

```powershell
node bin/dsh-assets.mjs refresh-plan --project $Project --plan OLD_ANXIOUS_PLAN --geometry "$Candidates/geometry-anxious.json" --json
node bin/dsh-assets.mjs refresh-plan --project $Project --plan OLD_DISGUST_PLAN --geometry "$Candidates/geometry-disgust.json" --json
# mouth 四帧共用完整源图上的实测 ROI，将 x,y,w,h 替换为整数：
node bin/dsh-assets.mjs prompt --project $Project --slot "$Figure/default/mouth/anxious/closed" --rect x,y,w,h --json
node bin/dsh-assets.mjs refresh-plan --project $Project --plan OLD_MOUTH_PLAN --rect x,y,w,h --json
```

窗口计划的测量已冻结，import 可不再传 geometry/rect；传入时必须与计划一致。修改 ROI 应 refresh-plan（仅 prepared）或新建 prompt。源图真的改变时仍需 require-blink/require-mouth --rebind，再测量、生成与人工批准，不能靠刷新绕过源绑定。
