# 生成质量与视觉创作

[English](../en/visual-quality.md)

生成质量控制 AI 检查与修正的投入，不改变用户的供应商、推理设置、预览性能或导出分辨率。以下四档属于官方宿主产品策略，不是 Core 限制。默认快速档也执行真实运行时的几何、资源和构图数值检查；它不默认发起独立视觉评审请求。

## 质量档位和检查报告

| `creationQuality` | 中文 | 主动修正上限 | 检查方式 |
|---|---|---:|---|
| `quick` | 快速 | 0 | 本地运行时检查 |
| `standard` | 标准 | 1 | 正式画面及视频采样帧审阅 |
| `fine` | 精细 | 2 | 多视角与更密集的视频采样 |
| `ultimate` | 极致 | 3 | 多视角、候选构图比较与重点时刻审阅 |

上限是修正预算，不是完成判据。修正后必须重新检查最终版本；预算用完仍有错误时，报告 `completed:false` 并保留可继续修改的文档。视频检查是采样，不证明每帧均正确。超长作品最多检查 96 个本地时间点，不改变原时长或帧数。

ThreeBox 设置中的“生成质量”控制这套流程。“检查照明”是另一个显式选项，默认关闭；启用后卡片标注“不导出”。质量验收始终新建使用文档正式灯光的运行时，辅助灯不参与验收。视频编辑器预览显示正式照明和实际预览尺寸，AI 菜单提供当前画面检查与当前镜头修正。

视觉能力通过 `provider.capabilities.inputModalities: ["text", "image"]` 或 `vision:true` 声明，不猜测模型名称。内置供应商由服务端公布并仅路由到支持图片的供应商；自定义接口需在设置中明确勾选。无法审图时显示“仅完成结构与数值检查”，没有运行时则标记检查未完成。显式禁用视频视觉评审时不发起额外图片请求。

公共入口为 `threejson/visual-quality`。Core 的 `runCreationQualityReview(document, {profile, inspect, review, repair, validate, ...})` 接受宿主注入的检查与修正流程，自身不持有供应商、凭据、DOM 或产品档位。`profile` 为通用执行参数：`{id, repairRounds, views, samplesPerShot, alternatives, reviewVisual}`；省略时不额外请求视觉评审或修正。主动视觉审阅与修正次数独立，可以只审阅、不修正；显式 `repairRounds:Infinity` 也可用，但宿主应自行提供取消和消费预算。官方档位及中英文展示来自 `@threejson/host-kit/js/creationQualityPolicy.js` 的 `resolveCreationQuality/formatQualityReport`，允许宿主覆写每档参数，不从 Core 反向引用。

默认宿主检查实现会准备资源、编译着色器，并使用确定性单帧渲染获取截图。报告包含：

- `sourceRevision`：检查文档的 SHA-256，不是运行时播放后的变换快照。
- `structural`、`visual`、`issues`、`repairs`、`completed`、`stopReason`：检查范围、问题与实际停止原因。视觉问题不冒充结构失败；要求审图但没有能力时 `completed:false`。
- `checksComplete/coverage`：所请求的检查是否完成、几何/时间采样范围、截图数量。只做结构检查不等于每个像素都合格。
- `messageCode` 与英文 `message`：机器可处理的状态和开发者诊断。宿主翻译并格式化展示，Core 不承载中文 UI 字符串。
- `observation`：可见对象、投影占比、近似遮挡、几何统计、资源异常；主体区域亮度只是测量，不是全屏亮度评分。
- `referencedAssets`：引用模型的来源、作者、许可与页面，不把下载称为原创建模。

宿主无损转换友好 JSON 后可使用 `bindStoredQualityReport` 记录保存版本；重开用 `verifyStoredQualityReport` 核对。纹理更新、JSON 编辑或其他内容改变后旧报告失效，不能沿用旧版“视觉通过”。生成、评审和修正共享请求、token 和时间预算。费用预算依据供应商使用量或宿主成本估算器核算；缺失费用后停止后续请求。它不是供应商级余额硬上限，首次请求的准确账单仍取决于供应商，应同时配置供应商侧限额。

## 预览性能与导出隔离

Core 默认不降级、不采集设备信息、不创建预览降级状态。通过 `previewPerformance` 显式注入数值预算或 `{getBudget,onFrame,resetFeedback}` 策略对象时才启用通用执行机制。`false`、`"full"` 或省略均关闭；Core 不认识 `auto/balanced/economy` 等产品名。

官方共享宿主提供 `createHostPreviewPerformance`。ThreeBox 和视频编辑器默认启用 `auto`，独立复用 `sceneCardSession/mediaCardSession` 默认完整质量；应用也可选固定档位、替换策略或关闭。低内存、少核心、粗指针只影响初始档位；连续帧时间反馈、迟滞窗口允许后续降档和恢复，暂停、手动跳转和导出不驱动自适应。降档时显示“节能预览”，不改变创作质量档位、光照、色调映射、时长或导出设置。

ThreeBox 的“通用 → 预览性能”提供自动/完整质量/均衡/节能，重新载入画布后使用新设置。视频编辑器的工程预览标题旁提供同样的切换，立即重新渲染当前时刻，不修改工程或产生编辑历史。

- `balanced`：最高 1.25 DPR、960×540 等效像素预算。
- `economy`：最高 1 DPR、720×405 等效像素预算。
- `full`：不施加上述限制。
- 默认只调整渲染像素量。宿主显式指定 `allowPointSampling:true` 时才启用 10 万/4 万 Points 预算；`allowLod:true` 时才启用已有 LOD 的 1.25/1.75 倍距离偏置。这些参考参数可通过 `profiles` 覆写，阈值、采样窗口等也可配置。

```js
import { createJsonScene } from "threejson/runtime";
import { createHostPreviewPerformance } from "@threejson/host-kit/js/previewPerformancePolicy.js";
const preview = createHostPreviewPerformance("auto"); // 返回可恢复的宿主策略，不会改 JSON
const runtime = await createJsonScene(sceneJson, { canvas, previewPerformance: preview });
// 不使用官方策略也可以直接传 { maxPixels: 960 * 540 }，或省略以完整渲染。
```

获准的点云抽样覆盖完整绘制区间，不截取前 N 个点。每帧绘制后（包括失败时）恢复原几何和 LOD 状态；恢复完整预算或销毁叠加层时恢复原 DPR 与后处理分辨率，同时尊重宿主后续显式 resize。不修改源 JSON，也不跳过模拟时间。后处理保留全部效果和唯一输出转换，仅降低像素工作量。此机制不宣称降低全部模拟内存；实例化 billboard、自定义算子和没有 LOD 的普通网格不会被偷偷重建或删减。

正式质量检查使用独立完整运行时。媒体导出从源文档重新创建完整工程；若直接把节能预览工程传给 `renderImage/renderGif/renderVideo`，会以 `PREVIEW_PROJECT_NOT_EXPORTABLE` 拒绝，避免误导出低质文件。宿主应传源文档及导出尺寸，而不是复用节能预览对象。所有资源/帧时间改善仍需在具体设备实测。

## 可编辑的灯光和材质配方

配方只展开为普通场景配置，不建立隐藏状态，不创建地板，不烘焙参数化模型。

```js
import { createLightingRecipe, createMaterialRecipe, createFramingCamera } from "threejson/visual-quality";
const sceneConfig = createLightingRecipe("product", { center: [10, 2, 0], size: 4 });
sceneConfig.camera = createFramingCamera({
  bounds: { min: [8, 0, -2], max: [12, 4, 2] }, aspect: 16 / 9, occupancy: 0.72
});
const material = createMaterialRecipe("ceramic", { color: "#e3d6c5" });
```

灯光配方：`product/interior/outdoor/night/diagram`。材质配方：`ceramic/brushedMetal/glass/plastic/matte/diagram`。`sceneConfig.scene.environment:{type:"studio"}` 使用本地生成的 WebGL 摄影棚环境，不下载 HDR 文件。它为金属提供可反射的环境；独立 WebGPU 宿主应使用支持的环境资源，不能假定此 WebGL 配方通用。

Agent 与会话操作服务支持 `look.apply`、`material.recipe`、`camera.frame`，示例：

```json
[
  {"op":"look.apply","args":{"preset":"product","center":[10,2,0],"size":4}},
  {"op":"material.recipe","args":{"id":"vase","preset":"ceramic"}},
  {"op":"camera.frame","args":{"bounds":{"min":[8,0,-2],"max":[12,4,2]},"aspect":1.7777777778}}
]
```

命令以事务写回源文档并可撤销。多材质对象应使用指定槽位的已有材质操作，不能用单一配方覆盖所有槽位。`environmentIntensity/environmentRotation`、背景强度和旋转、相机参数、色调映射以及显式 `castShadow:false` 保持导入导出一致。后处理只允许一个启用的最终 OutputPass，避免重复色调和颜色转换。

## 几何和运镜定义

隐式曲面修正三角面朝向，默认使用场梯度平滑法线；`smoothNormals:false` 保留逐面效果。闭合放样和扫掠只平滑声明的同位置接缝，保留 UV 拆分和端盖硬边；`smoothSeams:false` 可保留硬接缝。封闭截面默认外向，`orientation:"profile"` 保留截面原有顺序，`orientation:"inward"` 明确要求内向表面。这是旧版朝向错误的修正，重开受影响旧模型时外观可能改变。

扫掠中心线与截面框架采用一致弧长采样，支持 `caps:true` 和弧度制 `twist`。参数曲面、Bezier 和 NURBS 可配置 `tessellation:{maxError:0.005,maxSegments:128}`，根据中点与边缘弦差加密。`maxError` 使用模型局部单位；这是采样误差策略，不是全局数学误差证明。`maxSegments` 是作者可选上限，不再被内核偷偷截成 256；省略时没有产品细分上限。几何 `userData.tessellation` 返回实际细分、测得误差与 `converged`，达到作者上限但误差未收敛不会假称达标。

Core 默认不设 200 万顶点或固定体素上限，但仍拒绝无效数值及不可安全表示的分配规模。调用者用 `meshBudget:{maxVertices,maxTriangles,maxBytes,maxSamples}` 显式限制；输入预计分配超过预算时，在分配前以 `E_BUFFER_MESH_BUDGET_EXCEEDED` 失败，不悄悄降低精度。隐式曲面也在增长输出时检查显式预算。浏览器宿主的 `createSceneHostGeometryCompiler({meshBudget})` 默认保护值为 200 万顶点、2,097,152 个隐式采样点；可覆盖或传 `{}` 关闭。该策略不是引擎能力上限，也不证明不可信输入绝不会耗尽内存；宿主仍需按设备隔离、限制并取消任务。

路径保留默认 `parameter` 语义，新作品可选弧长参数化：

```json
{"type":"path","points":[[0,1,10],[0,1,9],[0,3,-1]],"duration":8,
 "parameterization":"arcLength","speedCurve":[[0,0],[0.2,1],[0.8,1],[1,0]]}
```

`speedCurve` 是归一化时间与非负速度的分段线性曲线，积分归一化为路径进度。未指定时可使用 `easing:"smoothstep"` 或 `"smootherstep"`；两者同时存在以速度曲线优先。所有求值依赖绝对时间，随机跳转不累积位移误差。

## 外部模型双开关

ThreeBox 服务端和用户端默认允许。实际获取必须两者同时允许；服务器关闭时个人选项禁用并显示原因，保留原有个人偏好。策略只控制 AI 本轮新引入的模型，不影响历史资源、本地明确导入、纹理或环境贴图。独立 ThreeJSON 可注入自己的资产适配器。

AI 使用 `asset-model://search/<English keywords>` 或 `asset-model://id/<catalog ID>`，由宿主检索、获取、校验许可、保存后写回持久 `modelPath`。任意新 URL、Patch 和提前预览都经过同一检查。没有合适候选应使用参数化建模或报告缺口，不伪造 URL。首批搜索为关键词匹配，不能代替资产尺度和形体的实际验收。

服务端支持 Poly Haven 和管理员配置的 HTTPS glTF/GLB 目录，模型及其贴图/缓冲被合成自包含副本。ThreeBox 选择打包资源时 `.tjz` 会包含该副本；取不到必需模型则明确失败，不输出假装离线完整的包。仅保存 JSON 或选择保留外链时仍需要服务器资源可达。来源和许可记录保留在 `userData.assetProvenance`。

Core 归档接口不识别 ThreeBox API。`packJsonSceneArchive/packJsonObjectArchive` 在 `assetPolicy:"tryPack"` 下接收 `resolveAsset(ref)`，并支持 `requiredAssets:[ref]`、`isAssetRequired({key,ref,path})` 或 `strictAssets:true`（所有发现的外部引用必需）。必需资源无法获取时返回 `ARCHIVE_REQUIRED_ASSET_UNAVAILABLE` 和 `ref`；非必需的未解析资源按原约定保留外链。ThreeBox 的模型 URL 判断和解析由共享宿主 `modelAssetResources.js` 注入，独立集成方可用自己的任意资源地址。

Poly Haven 资源许可与 API 使用要求是不同层面。服务端带标识 User-Agent、缓存元数据，并在结果中保留来源与作者。上线前需核对 [API 说明](https://polyhaven.com/our-api) 和 [使用条款](https://github.com/Poly-Haven/Public-API/blob/master/ToS.md)。自托管目录只接受明确的 CC0 或 CC BY 4.0；管理员必须确认授权和署名资料真实。

发布与验证见 [生成质量实施与验收](../dev/visual-quality-verification.md)。
