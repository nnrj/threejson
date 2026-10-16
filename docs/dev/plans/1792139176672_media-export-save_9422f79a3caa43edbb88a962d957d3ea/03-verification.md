# 实现与验证记录

日期：2026-10-16（Asia/Shanghai）。仅本地源码、离线自动化和隔离 Edge；未提交、推送、发布、部署、调用付费供应商或下载模型。

## 确认的原因与修复

1. 原样夹具 `tests/fixtures/media-export-relativity.json` 长 150 秒，score 只合成 66.7467 秒且未明确 loop/padSilence。保持严格检查，补充结构化时长错误；共享宿主提供本次混音的循环/补静音按钮，旁白不循环。
2. 原保存流程在资源/配音/音轨验证前打开文件写入流；Mediabunny 1.60.0 在 cancel 时也关闭目标流。改为延迟打开写入事务，muxer 的 close 不提交用户文件，完整封装且非空后才 commit，失败/取消 abort。自定义 target 仍由调用方管理。
3. 导出准备遍历所选范围内镜头首帧，保持有限运行时/渲染器数量；错误包含 clipId/cause。制作 paused 不被当作导出禁令。新文件选择器可能留下空占位文件，但不会宣称成功；不会擅自删除已有目标文件。
4. 原草稿 dilation 的 group 使用 children 而非 subScene，导致 restPhoton 不存在；curvature 使用不可执行的 geometry.func，导致 spacetimeGrid 不存在。没有在产品中运行任意 JS、跳过失败镜头或篡改原 JSON。
5. 截图的大白方块可由 points 顶层 size 被忽略、回落到历史默认 4 复现。增加通用顶层 size/color 简写后备，仍以 material 字段优先，不改无设置旧场景的默认值。采用本机可用中文字体做有/无粒子的画面对照，这两行中文正常。未证明所有设备/字体均无缺字，不将粒子遮挡误报为编码故障。
6. 修复副本的整片回归进一步发现：SDF 文字从暂存 holder 同步重挂载到正式 group，会误触发 removed→AbortError。新增最小测试先确认失败，再区分同步重挂载与真正移除。dispose 和真实取消仍生效；媒体边界没有调用方取消信号时，内部资源 AbortError 作为镜头失败报告，不能伪装成用户取消。

Core 只涉及点材质通用参数和 SDF 生命周期；文件事务属于可选 media-kit，音乐选择和提示属于 host-kit。没有从 Core 反向引用应用，也未写死 ThreeBox 的设备/质量政策。更新了 AI 创作字段示例及中英文媒体契约。

## 自动化结果

- 110 项节点测试通过：mediaExportSave、audioMedia、mediaAudioAutomation、mediaNarrationExport、mediaNarration、mediaEditing、mediaProjectSession、mediaTextureReadiness、sdfTextReadiness、textBuilder、points-builder、points-motion、videoAgent、videoEditorWorkbench、videoEditorBridge、nodeBoundary、textureDependencyBoundary。运行方式 `node --test --test-isolation=none tests/<name>.test.mjs ...`。
- 文件写入单测覆盖非空提交、写入/关闭异常、空输出、取消、后续镜头损坏、裁剪/隐藏镜头、暂停草稿、原 JSON 保留。SDF 单测覆盖挂载/移除/释放、成功、超时、取消、迟到回调及 Troika 内部几何重分配。
- `node tools/dev/verify-media-file-export.mjs --text`：真实 Edge / WebCodecs / Mediabunny / OPFS 文件流；MP4 5,763 字节、WebM 883 字节（1 秒无声小场景）；带声音 MP4 32,622 字节；中途失败/取消保留原文件内容；音频错误先于文件选择器；Blob 下载后备正常；390×844 窄屏。
  - 画面对照与报告：`dist/media-file-export/2026-10-16T09-03-10-714Z/`。测试专用 SimHei 仅从 Windows 已有字体读取、内存服务，不打包/分发字体。
- `node tools/dev/verify-media-file-export.mjs --film`：独立修复草稿完整 150 秒，320×180、10 fps、1,500 帧；MP4 **21,455,482 字节**，解复用时长 **150.016 秒**，含视频和配乐，production.state 仍为 paused。
  - 报告与修复 JSON：`dist/media-file-export/2026-10-16T09-13-10-804Z/`。
  - 副本只修正 children→subScene、已知曲面函数→安全数学表达式、标量轨道数组→对应分量、点云 source→bounds/显式材质大小、曲面镜头字幕层级，并明确设置配乐 loop:true。未修改原夹具或将草稿标为完成。该修复函数只存在于回归脚本，不是产品自动猜测/执行脚本的功能。
- `node tools/dev/verify-video-text-readiness.mjs`：SDF 成功、中文字体网络失败后备、billboard、取消以及 ThreeBox 卡片加载覆盖通过。报告：`dist/video-text-readiness/2026-10-16T09-15-03-671Z/`。
- `node tools/dev/verify-media-narration-export.mjs`：仅使用已经安装的本地测试缓存，无模型下载；真实 TTS→MP4/WebM→解码 PCM，峰值约 0.119/0.117，音视频轨道正常；导出失败/取消不偷偷生成静音文件；静音、无文本、图片/GIF 不触发配音。报告：`dist/media-narration-export/2026-10-16T09-15-17-930Z/`。
- `git diff --check` 通过（Git 的 CRLF 转换提示不是差异错误）。

## 边界与待验收

- 文件流测试使用浏览器真实 OPFS FileSystemWritableFileStream，并替换选择器入口；未操作用户真实保存路径、系统选择器、杀毒软件或权限提示。
- 长片回归为低分辨率完整时长，不是原始 1920×1080/30 fps 的性能与显存验收。未进行真实手机、线上发布版本或供应商重新生成测试。
- 离线回归故意阻断外部字体，相关 Failed to fetch 为预期输入；成功中文 SDF 对照使用可用本地字体，不证明线上字体 CDN 全部可达。
- 修复副本是可执行性修复，不是科学内容、构图、镜头质量验收。制作状态和原来的暂停信息保留。
- 人类评审仍待维护者对本次具体实现与证据审阅；本次不自动提交或合并。
