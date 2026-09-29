# 时间线与媒体能力实施记录

对应计划：`01-plan.md`。未勾选表示尚未交付，不代表已经可用。

## 基线

- 2026-09-29 开始时 ThreeJSON 工作区干净。
- 现有 `.tjz` 入口只有 scene/object；GIF 与常规动画主要依赖实时推进；现有录屏使用 MediaRecorder。
- 复用当前 SceneDocument/SceneSession、资源、命令、作业及可选能力边界。
- 视频/GIF 反向 AI 重建为二期，不以此为由改动核心或增加后端发布前置条件。

## 首次可用交付（2026-09-29）

本次完成主链路，不代表 `01-plan.md` 的全部扩展条目已经完成。没有执行 push、npm publish、云部署或真实供应商调用。

- [x] 更新计划：不新增 `.tjzs`；单场景完整能力、多场景可选；反向重建独立二期。
- [x] `threejson/timeline`：显式时钟、关键帧、play/pause/seek/renderAt、固定步长粒子重放、旧动画/mixer/shader/GIF/视频贴图求值。相机 lookAt 在位置轨道后处理；仅对象动画不锁住交互相机。
- [x] 时间线元数据进入现有标准/友好 JSON、SceneSession、JSON Patch、导出与撤销；播放不改写文档或制造逐帧历史。
- [x] 动态 clip：内嵌/URL/字典/`.tjz`、裁剪、变速、淡入淡出/溶解、重复源隔离、可复用渲染器。归档新增 composition 入口和二进制资产去重。
- [x] 粒子 wave/swirl/orbit/morph 内置位置算子、可注册纯函数、稳定目标采样；去除生命周期统一 8 关键点上限，保留真实硬件检查。
- [x] `@threejson/audio-kit`：音乐 ticks/tempo map/多轨/tie/repeat，电子合成、分块 PCM 混音、WebAudio 试听、WAV，URL 音频与宿主生产器；裁剪/循环/声像/淡入淡出。
- [x] 可选模型 SDK 和工作台缓存 UI：OPFS/IndexedDB、本地 Node 缓存、清单/size/hash、下载/导入/取消/删除/租约；Worker、Sherpa WASM、SoundFont 适配入口。
- [x] `@threejson/media-kit`：统一 PNG/JPEG/WebP、GIF、MP4/H.264/AAC、WebM/VP9/Opus；按时间采样，音视频交错编码与背压、错误和取消清理。GIF Worker 同时兼容原生 importmap 与 Vite 打包。
- [x] CLI `media-export`、MCP `media.render` / `media.start`，复用 job.get/cancel；使用已有浏览器，不安装浏览器，不覆盖已有输出。
- [x] ThreeBox 原生/React、Shower、Editor、Player 共用可选工作台：播放/定位、片段列表、导出参数、临时本地音频、模型缓存。未改商业后端或账户体系。
- [x] AI 能力索引/意图信号/参考目录接入真实时间线与乐谱契约；修复 export 误命中 port Domain 的词匹配问题。
- [x] 官网/HTML 四个示例（粒子文字、产品运镜、数据动画、多片段）；中英文指南、类型、LICENSE/README 和 release 包顺序。
- [x] 原生站点 `.assetsignore` 精确放行媒体浏览器模块，仍排除其他 package、Node 工具和本地凭据；普通场景启动零媒体请求。

## 尚未完成 / 未验证（不能当成已可用）

1. **真实 TTS 模型目录**：没有发布实测的 Melo/Kokoro 权重、运行库组合和音色目录。Sherpa/Worker 及存储接口已实现，mock 契约测试不证明真实模型可用或音质合格。未自动下载大模型。SoundFont 同样尚未用真实高质量音源验收。
2. **高级声音与音乐**：MIDI/MusicXML、完整记谱/编曲 UI、生成音频配方缓存与一键烘焙、自动音频分析/节拍驱动粒子算子未交付。电子合成不是自然演唱。显式 timeline.audio 可导出；不自动捕获旧交互事件/空间声场。
3. **长作品优化**：状态检查点、下一片段预加载、HTTP Range 归档访问未完成；后退采用从零重放，跳到很晚的状态粒子会有计算成本。模型 SHA-256 校验仍需将单文件读入内存；不宣称任意大模型已做内存压力验证。
4. **更深的应用编辑**：当前是共享播放/导出工作台和 JSON/命令编辑，不是多轨可视化 NLE。没有 ThreeBox 独立的 scene/image/gif/video 目标选择器，AI 通过能力识别生成普通场景加 timeline；用户在工作台选择输出格式。临时导入音频和工作台设置不自动写回原文档。
5. **确定性范围**：WebGL 已接入的内置机制有回放测试；任意脚本、副作用、自定义物理、TSL wall-clock 时间及外部插件不因此自动确定。WebGPU 粒子未提供 resetTime 时明确报错；WebGPU/TSL 媒体导出尚未验收，不能把 WebGL 结果外推。
6. **反向 AI 重建（二期）**：仅 `/reconstruction` 的模态协商、时间戳参考和注入分析接口；没有自动上传、供应商分析或完成场景重建。没有为此改动 core/账户/后端。
7. **跨设备**：本次真实浏览器为本机 Windows Edge；移动端是 390px 视口，不是手机实机。未做 Safari、Firefox、移动 GPU、长时间内存曲线或真实 AI 供应商验收。

## 验证命令与证据

生成物在 gitignored `dist/`，不上传发布站点。以下为可重跑命令，测试结果不等同于生产部署结果。

- 完整 Node 套件：`node --test tests/*.test.mjs`（隔离进程）；1,608 项中 1,607 通过、1 跳过、0 失败，日志 `dist/timeline-media/full-tests.log`。另运行 `npm run verify:ai-static`，3/3 通过。
- 新增用例包括随机/后退求值、固定 tick/fps 一致、曲线/相机顺序、资源等待取消、渲染器所有权与跨片段资源池释放、乐谱/混音分块一致、归档资源所属 base、文件原子缓存、作业取消、timeline patch/undo、真实部署忽略规则。
- `npm run build -w apps/threebox` 成功（保留已有大 chunk/静动态导入告警）；类型 `tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --lib ES2022,DOM --types three` 校验新增声明通过。
- `npm run release:check`、`npm run validate:demo-catalog` 通过。新增两包 dry-run pack 包含源码、声明、README、LICENSE；未发布，也未擅自升版本。

浏览器测试先指定已有浏览器：

```powershell
$env:THREEJSON_BROWSER = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
node tools/dev/verify-scene-operations-browser.mjs
node tools/dev/verify-media-studio-browser.mjs
$env:MEDIA_LONG = '1'
node tools/dev/verify-timeline-media.mjs
```

- 旧能力 8 项通过：cube、room-show、port-show、FPS、intro、computable modeling、particles、Editor 外部操作及撤销原文还原。见 `dist/scene-operation-check/report.json`。
- 工作台 5 项通过：4 示例、明暗主题、390px 窄屏、播放/定位、模型面板零自动下载，以及原生 Editor 导出入口。后者验证普通场景没有媒体依赖请求、非放行包不可访问。见 `dist/media-studio-check/2026-09-29T04-01-13-681Z/report.json`；截图已人工检查。
- 短导出 9 项通过：PNG/GIF/MP4/WebM、多片段、composition.tjz、GIF 贴图 0.05/0.15 秒的红/绿精确像素、取消后不残留输出。见 `dist/timeline-media/2026-09-29T03-56-28-112Z/report.json`。
- 一分钟 1080p/30fps：1,800 帧 MP4 完成，重新解码元信息为 1920×1080、60.0107 秒、有音轨；无浏览器/资源错误。见 `dist/timeline-media/2026-09-29T03-52-19-752Z/minute-1080p.mp4`。该轮短 GIF 用例曾因测试材质默认灰色造成色值断言失败，已明确指定白材质，并在上条短回归中通过；不掩盖失败记录。

## 下一步顺序

先验证并交付一个真正可用的本地语音运行库/模型组合和音源合成样本，再补音频烘焙/缓存与音频驱动算子、长作品回放性能、必要的轨道编辑。视频/图片 AI 反向重建排在这些音视频主线之后；不要求大改 ThreeJSON 核心。

## 2026-09-29：ThreeBox 文字透明度轨道回归修复

- 用户的双缝干涉视频 JSON 在真实浏览器中复现 `Timeline property not found: material.opacity`。`title-text` 是 billboard 包装 Group，而 SDF 文字的填充、描边是后代上的多材质；原轨道绑定只访问直接对象属性。现在无槽号的材质路径绑定所有材质槽，无自身材质的 Group 绑定后代材质；变换轨道仍绑定作者选中的对象。不存在的路径继续报错，并补充轨道 ID、目标 ID、对象类型。
- 浏览器画面检查同时发现，资源等待依赖了 Troika 不存在的 `isTroikaText` 标记，导致图片/视频导出可能漏字。改为 Builder 注册异步就绪 Promise，时间线等待通用对象就绪契约，不导入文字库、不读取其私有状态；重复导出复用已完成的 Promise。字体预热补上传入库要求的完成回调，修复 `r is not a function`。
- 增加 `tests/timelineMaterialTracks.test.mjs`：包装文字、描边/填充、多材质槽、Group、颜色、无关对象、逆向 seek、基线恢复、真源不变及错误定位；`tests/timeline.test.mjs` 补就绪等待、重复等待、失败传播与取消。
- 完整 Node 回归：1,614 项中 1,613 通过、1 跳过、0 失败。日志 `dist/timeline-material-check/full-tests.log`。
- 真实本机 Edge：`THREEJSON_BROWSER` 指定已安装浏览器，执行 `node tools/dev/verify-timeline-material-browser.mjs [可选场景JSON路径]`。原生 ThreeBox 卡片中检验中文 SDF 的实际像素、填充/描边共同淡出、后退结果一致、源文档不变；最小场景及用户原 JSON 均通过，无浏览器错误。报告 `dist/timeline-material-check/2026-09-29T06-22-48-202Z/report.json`。
- 用户原 JSON 未修改，图片及完整 16 秒、192 帧、960×540 MP4 导出通过，重读视频元数据确认为 16 秒；无浏览器/资源错误。报告 `dist/timeline-material-check/export-1790663041668/report.json`。测试产物留在忽略目录，不提交用户附件或生成视频；未调用 AI、未发布或部署。
