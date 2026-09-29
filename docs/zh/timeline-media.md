# 时间线、声音与程序化媒体（alpha / preview）

[English](../en/timeline-media.md)

普通 ThreeJSON 场景可以同时是一幅图片、一段动画或完整视频。多场景只是可选编排，不限制单场景能力。导出按指定时间逐帧求值，不把实际渲染速度当成动画速度，不需要视频生成供应商。

## 应用入口

- ThreeBox 场景卡片底部 **时间线 / 图片 / 视频**，原生与 React 版本共用实现。
- Shower 的 **图片 / 视频**，Editor 和 Player 的文件菜单。
- 官网“时间线与程序化视频”及 [HTML 媒体工作台](../../examples/html-demo/track-08-media/08-01-media-studio.html)。

工作台可播放、暂停、定位、打开 JSON/.tjz、设置时长/尺寸/fps、临时导入本地配乐或旁白。独立预览不改写聊天历史、编辑器文档或撤销栈；工作台参数及临时音频也不自动保存进原场景。

“可选语音模型与缓存”区域支持选择宿主提供的清单或导入清单 JSON，查看许可和大小，显式下载/导入各文件、取消、查询缓存和删除。宿主通过 `modelCatalog` 提供经过验证的目录；没有目录时不会显示虚构的可用音色，也不会自动下载模型。缓存中的模型仍需匹配的音频生产器，不等于已经能合成。

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

createJsonScene 按需安装 runtime.timeline：play/pause/seek/renderAt/reset。timelineAutoPlay:false 禁止自动推进。同步 createJsonSceneSimple 不安装异步时间线，改用异步加载或显式 attachSceneTimeline。编辑 `/timeline` 仍走 JSON Patch / SceneSession；帧求值不写回真源，也不产生逐帧撤销记录。元数据随标准/友好 JSON 转换、导出保留。

只有包含有效相机轨道时，时间线接管相机；仅有对象动画的场景继续允许交互转动视角。字幕的 x/y 为相对画布比例，显式 fontSize/outlineWidth 以 `output.height`（缺省 1080）为设计分辨率，预览与导出按比例缩放。

CPU/WebGL-compute 粒子使用固定步长（默认 1/60 秒，simulationStep 可配置），输出 fps 不改变运动速度。后退重置重放，长仿真的随机 seek 可能较慢；不同设备不承诺浮点逐字节一致。WebGPU/自定义后端缺少 resetTime 时明确拒绝，任意交互事件、脚本和外部物理插件也不会自动变成确定性动画。

## 粒子和片段

timeline.effects 每项为 `{id,target,operator,start,duration,params}`。内置 wave（amplitude/frequency/speed）、swirl（speed/twist）、orbit（radius/speed）、morph（source/seed）。Morph 使用普通 Particle V2 source，稳定采样到已有粒子数；textMask/imageMask 按需加载 raster。自定义纯函数使用 registerParticleMotionOperator。首版位置算子为 CPU，实现按顺序组合、仿真后求值、不反向污染仿真。生命周期曲线不再统一限制 8 点，GPU 真实 uniform 上限会具体报错。

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

归档 entryKind 为 composition，入口 composition.json。packMediaDocument 对显式二进制资产按内容哈希去重，不自动抓取所有远程依赖。单场景加载器遇到 composition 明确提示使用媒体运行时，不生成占位立方体。

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

**尚未随包提供实测可下载的 Melo/Kokoro 目录。** 已实现存储、适配和 Worker 接口；真实模型分发、加载及音质仍需单独验证。mock 适配测试不是模型验证。speechSynthesis 只能试听，不冒充可导出 PCM。

## CLI / MCP 与后续

```powershell
node packages/scene-tools/bin/threejson.mjs media-export --file assets/json/demo-show/timeline-media/particle-morph.json --output particle.mp4 --browser "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --fps 30
```

安装可选 media-kit/audio-kit/Playwright 软件包并指定已有浏览器，不自动下载浏览器。--config media.json 支持 file/output/executablePath/mediaOptions；命令行优先，配置内路径相对于配置文件。CLI 拒绝覆盖已有文件，失败或取消删除本次未完成输出。MCP 提供同步 `media.render`，以及从文件/不可变会话快照启动的 `media.start`；后者复用 `job.get` / `job.cancel`，不另建作业系统。

`@threejson/media-kit/reconstruction` 只提供模态协商、带时间戳的参考和注入分析接口，不自动上传/调用模型，不声称已重建场景。完整反向 AI 重建属于二期，不要求重构 core 或 threebox-server。新增包已纳入既有 release 总流程；本次不发包、push 或部署。证据与未覆盖项见 [实施记录](../dev/plans/timeline-media/02-implementation.md)。
