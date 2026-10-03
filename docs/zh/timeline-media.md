# 时间线、声音与程序化媒体（alpha / preview）

[English](../en/timeline-media.md)

普通 ThreeJSON 场景可以同时是一幅图片、一段动画或完整视频。多场景只是可选编排，不限制单场景能力。导出按指定时间逐帧求值，不把实际渲染速度当成动画速度，不需要视频生成供应商。

## 应用入口

- ThreeBox 场景卡片底部 **时间线 / 图片 / 视频**，原生与 React 版本共用实现。
- Shower 的 **图片 / 视频**，Editor 和 Player 的文件菜单。
- 官网“时间线与程序化视频”及 [HTML 媒体工作台](../../examples/html-demo/track-08-media/08-01-media-studio.html)。

工作台可播放、暂停、定位、打开 JSON/.tjz、设置时长/尺寸/fps、临时导入本地配乐或旁白。独立预览不改写聊天历史、编辑器文档或撤销栈；工作台参数及临时音频也不自动保存进原场景。

“可选语音模型与缓存”内置一个固定版本的 **MeloTTS 中文本地配音（预览）**，也可导入宿主清单。查看许可和大小后，显式下载或导入文件，再点“启用本地旁白”。内置模型已配套生产器；其他模型仍需宿主适配。不会在打开页面、生成普通场景或无旁白影片时自动下载。

基线站点的 `.assetsignore` 已精确包含工作台所需的浏览器模块，无需先把这些模块发布到 npm 才能预览仓库版本；其他 packages 和本地配置仍排除。独立 React 消费者需要安装/升级相应发布包。普通场景不会提前加载媒体库。

默认 MP4、1080p、30fps。编码能力由浏览器决定，不支持时请明确选择 WebM 等替代格式，不会改扩展名冒充成功。GIF 无声、最多 256 色、以百分之一秒计时；PNG/JPEG/WebP 导出当前定位时刻。帧序列为 `[start,end)`。

全局字幕、乐谱及 timeline.audio 在工作台中完整播放。普通场景画布运行三维时间线，但不会自行加载音频制作 SDK；已有 ambient/positional 音频不变。自建应用可使用 audio-kit 的 createPcmPlayback，以其 WebAudio 时钟 time 驱动画面；用户手势和自动播放权限由宿主处理。

## 单场景

```json
{
  "objectList": [{ "objType": "box", "threeJsonId": "box", "material": { "type": "basic", "color": "#ffc15a" } }],
  "timeline": {
    "version": 1, "duration": 8,
    "tracks": [{ "id": "move", "target": "box", "property": "position", "easing": "smoothstep",
      "keyframes": [{ "time": 0, "value": [0,0,0] }, { "time": 8, "value": [4,2,0] }] }],
    "captions": [{ "id": "title", "text": "ThreeJSON", "start": 0, "duration": 8 }]
  },
  "output": { "width": 1920, "height": 1080, "fps": 30 }
}
```

时间为秒、旋转为弧度。target 使用 threeJsonId 或 `$camera` / `$scene`。支持 position/rotation/scale、visible、材质颜色/透明度等数值、morphTargetInfluences.0、相机 fov/lookAt；四元数 `[x,y,z,w]` 使用球面插值。轨道 ID 唯一、时间严格递增；首个关键点前保持初始值，末尾保持末值。缓动有 linear/step/smoothstep/easeIn/easeOut/easeInOut，或 registerTimelineEasing 注册函数。

`material.opacity` / `material.color` 指向该对象的所有材质槽；无自身材质的 Group（包括 billboard 文字的内部包装）则作用于后代材质，因此 SDF 文字的填充和描边可以一起淡入淡出。`material.1.opacity` 可指定单个材质槽；对于 Group，槽号按各后代对象的材质列表解释。位置、旋转等轨道仍操作 target 本身。不存在的属性或材质槽会明确报错，包含轨道 ID、目标 ID 和对象类型，不会静默丢弃动画。

createJsonScene 按需安装 runtime.timeline：play/pause/seek/renderAt/reset。timelineAutoPlay:false 禁止自动推进。同步 createJsonSceneSimple 不安装异步时间线，改用异步加载或显式 attachSceneTimeline。编辑 `/timeline` 仍走 JSON Patch / SceneSession；帧求值不写回真源，也不产生逐帧撤销记录。元数据随标准/友好 JSON 转换、导出保留。

只有包含有效相机轨道时，时间线接管相机；仅有对象动画的场景继续允许交互转动视角。字幕的 x/y 为相对画布比例，显式 fontSize/outlineWidth 以 `output.height`（缺省 1080）为设计分辨率，预览与导出按比例缩放。

CPU/WebGL-compute 粒子使用固定步长（默认 1/60 秒，simulationStep 可配置），输出 fps 不改变运动速度。CPU 有状态模拟保留有界检查点（默认每 2 秒、缓存 32 MiB，`checkpointInterval/checkpointBytes` 可配置）；后退优先恢复检查点。GPU compute 等其他有状态系统仍重放，首次远距离 seek 仍可能较慢。缓存预算不是粒子数/作品时长限制。不同设备不承诺浮点逐字节一致。WebGPU/自定义后端缺少 resetTime 时明确拒绝；任意交互事件、脚本和外部物理插件不会自动变成确定性动画。

轨道也接受 `signal` 代替 keyframes：constant/sine/pulse/noise/envelope/orbit/path/beat/samples。`start/duration/extrapolation:"hold|loop|none"` 统一起止语义。`$renderer`、`$pass:id`、`$effect:id`、`$caption:id` 和 `$audio:id` 可寻址已有属性；例如 `$pass:glow` 的 strength、`$effect:wave` 的 params.amplitude、`$audio:music` 的 gain/pan。相机位置可以使用 path/orbit，lookAt 在变换后求值。内置 TSL graph 的 time 和 pulse preset 使用场景显式时钟；自定义 factory 使用传入的 `timeNode`，直接使用 TSL 全局时间的第三方代码不在保证范围。

## 粒子和片段

timeline.effects 每项为 `{id,target,operator,start,duration,backend,params}`。内置 wave（amplitude/frequency/speed）、swirl（speed/twist）、orbit（radius/speed）、morph（source/seed）、scatter（distance/seed）、wavefront（amplitude/frequency/speed/width）、flow（path/speed/length/spread）。Flow 复用 CurvePath 描述，speed 是每秒路径圈数，length 是光带占据路径的比例。Morph 稳定采样 Particle V2 source 到已有粒子数，默认空间排序对应，也可 matching:"index"；textMask/imageMask 按需加载 raster，stagger 配置错峰聚散。

CPU 参考实现按顺序组合、仿真后求值，不污染仿真。`backend:"webgl"` 将这七个解析式效果放到静态 Particle V2 points/billboards 的顶点着色器，底层 simulation.backend 仍为 cpu；它不是流体或 GPU compute。单个对象不能混用效果后端。自定义 CPU 算子使用 registerParticleMotionOperator；不支持的 GPU 算子明确报错。生命周期曲线无统一 8 点上限，真实硬件限制会具体报告。

WebGL 新增按需 Pass：`dof`（focus/aperture/maxblur）、`selectivebloom`（targets/strength/radius/threshold）、`cinematic`（vignette/saturation/contrast/exposure/streak）。Pass 使用 `id` 注册，末尾保留 output；景深和选择性辉光处理了内置粒子位移、SDF 填充/描边，仍是 r184 WebGL 预览能力，不代表任意自定义 shader 或 WebGPU 后处理兼容。

标题可混用 objType:text 的 sdf/mesh/texture，以及粒子文字。SDF 适合中文空间标题，mesh 适合挤出实体文字且需要可用字体 JSON；字幕独立合成，支持中文换行、安全区、fadeIn/fadeOut、slideY、reveal:"typewriter"、charactersPerSecond 和 highlights:[{text,color}]。双语使用不同字幕 ID 与 y 位置。没有引入 MathJax/LaTeX 排版器，不把纯文本公式当成完整数学排版。

```json
{
  "documentType": "composition", "compositionVersion": 1,
  "timeline": { "duration": 12, "clips": [
    { "id": "a", "source": "first.json", "start": 0, "duration": 7 },
    { "id": "b", "source": "second.tjz", "start": 6, "duration": 6, "sourceStart": 2, "rate": 1, "fadeIn": 1 }
  ] }
}
```

仍用 JSON/.tjz，不新增扩展名。source 可为内嵌场景、scenes 字典键、JSON/.tjz URL 或 pack 引用。源时间为 sourceStart+(globalTime-start)*rate；重复引用隔离可变状态。后面的片段盖在上面；上层 fadeIn 和保持可见的下层实现交叉溶解。全局音乐不因镜头切换重启。嵌套 composition 首版需展平。

clip.transitionIn 支持 `{type:"wipe",duration:1,direction:"left"}` 或 `{type:"dissolve",duration:1,seed:7,softness:0.08}`，重叠片段可在下一画面揭示时保留下层画面。不同时淡出下层即可避免无意变暗。尚不支持任意外部遮罩 URL。默认在切换前 2 秒准备最近的一个镜头（preloadNext/preloadSeconds 可配置），相容镜头复用 WebGLRenderer，已离场资源及时释放。

归档 entryKind 为 composition，入口 composition.json。packMediaDocument 对显式二进制资产及已有的 Base64 音频 URL 按内容哈希去重保存，不自动抓取远程依赖。生成的旁白可以离线分享，接收方不需要模型。单场景加载器遇到 composition 明确提示使用媒体运行时，不生成占位立方体。

## ThreeBox 分镜制作与 Agent

在 **设置 → AI** 选择输出目标（自动/3D 场景/视频项目）、视频时长（0 表示按内容）、质量和“先确认分镜”。讲解类默认按内容规划，通常 90–180 秒；这是提示策略，不是时长下限/上限。原有普通场景、模型和调整流程保留。图片/GIF 在媒体工作台导出，当前不另设专用生成目标按钮。

视频按「分镜 → 可播放粗剪 → 逐镜头细化 → 检查」执行，不要求一次输出整部影片。发送停止可暂停，后续“继续制作”或“重做第二镜头，其他不变”基于保存的项目继续；刷新不会自动恢复 AI 请求。分镜确认开启时，在分镜保存后暂停，发下一条消息批准。聊天画布提供播放、定位和镜头列表；编辑器入口先选择镜头。历史版本独立，默认仅一个画布活动，移动端沿用同一流程。

“视频画面复核”默认使用模型已声明的图片能力，未知时只进行结构检查。若当前模型确实支持图片输入，可显式开启，Agent 收到真实时间戳截图；这可能增加调用费用。未渲染/无视觉输入不标记为视觉通过。最终审美、叙事和科学正确性仍受模型影响，不能承诺任意模型达到演示作品水平。

SDK：`createMediaProjectSession` 和 `createMediaOperationService` 属于 media-kit；`runVideoAgent` 属于 threejson/ai，只接收注入的服务，不依赖宿主或媒体包。操作有 media.inspect/plan.set/shot.put/shot.edit/shot.query/shot.remove、timeline.inspect/edit、media.validate/captureFrames/render/shot.narrate。编辑按 revision 原子提交，可 undo/redo；无固定 AI 总轮数。模型重复无进展、供应商失败、用户取消或显式预算会停止，保留已完成镜头。宿主注入的 capture/render/narration 能力与权限分开，不存在未实现命令假装成功。

## SDK / 导出

```js
import { renderImage, renderGif, renderVideo, packMediaDocument } from '@threejson/media-kit';
const png = await renderImage(scene, { time: 3, type: 'image/png', alpha: true });
const gif = await renderGif(scene, { fps: 20, end: 8, signal });
const movie = await renderVideo(scene, {
  format: 'mp4', width: 1920, height: 1080, fps: 30,
  signal, onProgress: ({ progress }) => updateProgress(progress)
});
const portable = await packMediaDocument(scene, { assets: { 'voice.wav': wavBytes } });
```

返回真实 MIME 的 blob。也可传 Mediabunny target / writable（支持文件偏移和背压）流式输出。编码交错提交音视频，不保留整段未压缩帧；默认电子配乐按块合成。GIF 优先 Worker，不支持模块解析时通过 onWarning 报告主线程后备；gifModuleUrl 可显式指定编码模块。原 MediaRecorder 保留为实时录制用途。

导出前等待纹理、文字与视频帧就绪；CORS、解码或上下文失败会报错。隐藏场景禁用音频 autoplay，只有显式 timeline.audio 进入离线混音，不推测交互音效/空间声场。DOM/CSS 叠加不进入 WebGL 输出，请使用场景文字或 captions。屏幕字幕字体由浏览器提供，需要跨设备一致时由宿主预加载。

## 音频与本地模型

timeline.audio 使用 id、url 或 recipe，以及 start/duration/sourceStart/rate/loop/gain/pan/fadeIn/fadeOut。rate 同时改变速度和音高。超出源音频时长需要 loop 或 padSilence:true；长于作品时需延长时间线，或明确 end/trimAudio 裁剪。

```json
{ "id": "music", "recipe": { "kind": "score", "score": {
  "version": 1, "ppq": 480, "tempos": [{ "tick": 0, "bpm": 120 }],
  "tracks": [{ "id": "melody", "instrument": "bell", "notes": [
    { "id": "n", "tick": 0, "duration": 480, "pitch": 60, "velocity": 0.7 }
  ] }]
} } }
```

乐谱以 ticks 为真源，支持 tempo map、声部、力度、声像、相邻同音 tie、显式 repeat 区间。sine/triangle/soft-piano/bell/noise 是电子合成，不承诺真实演唱。MIDI/MusicXML 交换、完整记谱和编曲 UI 暂未实现。

audio-kit 主入口提供 compileScore/createScoreRenderer/synthesizeScore、PCM 混音/播放、WAV、decodeAudio 和 registerAudioProducer。可选子路径：

- `/soundfont`：显式传入用户音源与 SpessaSynth loadCore，无自动下载。
- `/models`：manifest、download/import/status/list/remove/acquire、进度、取消、size/SHA-256 校验、原子清单与使用租约；优先 OPFS，回退 IndexedDB。浏览器可能清理缓存。
- `/node-models`：用户缓存目录，可指定目录，不用 package.json 存终端用户路径。
- `/sherpa`：注入配套 sherpa-onnx WASM、模型和配置；`{file:"角色"}` / `{directory:"模型子目录"}` 解析为私有虚拟文件系统路径。
- `/worker-producer`：宿主可信模块在后台合成，支持进度与终止；模块 URL 不由场景 recipe 自行选择执行。

模型 manifest 包含 id/version/adapter/license/files；文件包含 role/bytes/sha256、可选 path/url。用户选择后才调用 download 或 import。模型和运行库必须配套，许可分别记录。模型不自动随作品分享，生成的 WAV 等才是作品资源。

`/models` 的 getBuiltinAudioModels/createLocalSpeechProducer 提供固定版本 MeloTTS + Sherpa-ONNX 单线程 WASM，约 71 MiB，SHA-256/大小/许可固定；权重不随 npm 包下载。已在本机 Edge 用真实模型合成中文 PCM，不要求跨源隔离；CSP 需允许其 Worker/WASM/blob 模块。单音色，中英混读受词典影响，内存成本明显高于电子合成；未做手机实机或专业配音音质验收。Kokoro 仍为后续适配，speechSynthesis 只可试听。

已启用本地旁白后，Agent 可调用 media.shot.narrate。按句合成、按实测 PCM 时长编排并缓存；captions 参数可独立于口播，例如公式显示与读法不同。音频超出镜头会报冲突，显式 extend:true 才延长并移动后续镜头。仅有句级对齐，不声称词/字级精确。

音乐可加 `ducking:{mode:"narration",gain:0.25,attack:0.15,release:0.3}`，旁白片段标记 narration:true；也可 targets 指定音轨。`analyzePcm` 提供 RMS/peak/削波统计及 samples 包络，供效果/材质轨道使用；beat 信号是给定 BPM 的合成节奏，不是自动识别未知音乐。音频 gain/pan 轨道、ducking 与视频导出共用源时间映射。

## 视频生成结果与未完成分镜

`media.plan.set` 只创建分镜占位，不代表已生成画面；`production.shots` 的 title、intent 和 narration 也不会自动渲染或发声。逐镜头通过 `media.shot.put` / `media.shot.edit` 写入实际场景和时间线。普通空镜头不能仅修改 stage 就通过完成检查；有意留白可显式使用 `metadata.intentionalBlank:true`，纯字幕镜头也受支持。

ThreeBox 保留未完成的分镜和已提交镜头。只有计划时显示分镜、暂停原因和“继续制作视频”，不显示空白视频播放器；有部分内容时保留真实时间线并说明未完成状态。历史记录也从实际文档重建状态，不继续显示旧的成功摘要。`production.lastError` 保存最近的失败说明，`stopReason` 区分供应商失败、无效输出、显式预算和分镜待确认。

Agent 支持用 Markdown 包裹的 JSON/JSONL 命令，但不执行说明文字或不完整批次。本地电子背景音乐使用 `timeline.audio[].recipe.kind:"score"`，无需安装 TTS 模型；分镜说明中写“背景音乐”并不会产生音轨。

## CLI / MCP 与后续

```powershell
node packages/scene-tools/bin/threejson.mjs media-export --file assets/json/demo-show/timeline-media/particle-morph.json --output particle.mp4 --browser "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --fps 30
```

安装可选 media-kit/audio-kit/Playwright 软件包并指定已有浏览器，不自动下载浏览器。--config media.json 支持 file/output/executablePath/mediaOptions；命令行优先，配置内路径相对于配置文件。CLI 拒绝覆盖已有文件，失败或取消删除本次未完成输出。MCP 提供同步 `media.render`，以及从文件/不可变会话快照启动的 `media.start`；后者复用 `job.get` / `job.cancel`，不另建作业系统。

`@threejson/media-kit/reconstruction` 只提供模态协商、带时间戳的参考和注入分析接口，不自动上传/调用模型，不声称已重建场景。完整反向 AI 重建属于二期，不要求重构 core 或 threebox-server。新增包已纳入既有 release 总流程；本次不发包、push 或部署。证据与未覆盖项见 [实施记录](../dev/plans/timeline-media/02-implementation.md)。
