# 实现与验证

2026-10-16，Asia/Shanghai。仅本地修改/离线验证，未提交、推送、部署、请求付费供应商或下载新语音模型。人工评审：待维护者审阅，不自动合入。

## 原因与实现

- 共享导出窗口先合成 18 段旁白，再调用内部镜头预检查，导致用户等完配音才见 `restPhoton` 错误。此前延迟 createWritable 仍不能避免早期文件选择器产生 0 字节占位文件。
- 原始 fixture 的 clockRest / clockMoving 等 group 使用有内容的 children，同时 subScene 为空；更早的 JSON 文档也以 children 举例，而加载器只读 subScene。这是输入适配/文档不一致，不能简单归咎于用户草稿未完成。
- Core 的通用描述符适配补全 group 别名与受限算术曲面表达式转换。双数组冲突报错；native 和几何算子 children 不受影响；规范 geometry.expressions 优先，不执行 JavaScript。不修改原始输入（包括单记录浅克隆入口的 geometry）。worker 保持无 handler/宿主依赖。
- media-kit 提供 preflightMediaExport，宿主在合成旁白前检查所有包含的镜头及音轨/编码能力；renderVideo 仍复查实际输出。不同阶段明确标识，不把配音 100% 当作编码结束。
- host-kit 使用私有临时文件完成视频，之后“保存视频”在新的用户点击内打开文件选择器。保存失败可用现有成品重试；没有选择器时下载成品，OPFS 不可用时保留 Blob 后备。失败/取消和窗口关闭释放本次缓存，不删除用户已有文件。更新了静态部署白名单，防止新增宿主模块线上 404。

## 自动验证

节点回归共 215 项通过（去重的以下三组）：

1. mediaExportSave、mediaExportFile、descriptorCompatibility、subSceneHierarchy、statLabelSubSceneDeploy、audioMedia、mediaAudioAutomation、mediaNarrationExport、mediaNarration、mediaEditing、mediaProjectSession、mediaTextureReadiness、sdfTextReadiness、textBuilder、points-builder、points-motion、videoAgent、videoEditorWorkbench、videoEditorBridge、nodeBoundary、textureDependencyBoundary：128 项。
2. numericExpression、legacyGeometryAlias、subSceneTextDeploy、geometryWorkerBundle、geometryWorker：11 项。
3. appsDeploymentPreviewProtocol、architectureDependencies、sceneDocument、sceneToJson、sceneValidationContract、complexMesh：76 项。

运行使用 `node --test --test-isolation=none tests/<name>.test.mjs ...`。依赖边界与已提交 worker 一致性通过，无需重建 worker；`git diff --check` 通过。

`node tools/dev/verify-media-file-export.mjs --film --hd`：

- 用户原始、未经手工修复的 JSON：8 个镜头分别在开始/中间/结束前检查通过。移除了旧脚本的专用 repairedDraft 转换。
- 通过真实共享窗口，先选择循环配乐，再以“仅原有音轨”完整导出 **150 秒 / 320×180 / 10 fps / 1,500 帧**；MP4 **19,760,857 字节**，解复用时长 **150.016 秒**，有视频和音频轨道。原 JSON 完全不变、production.paused 保留。
- **1920×1080 / 30 fps**，34–40 秒跨越 postulate→dilation 的 6 秒片段：**180 帧 / 3,146,152 字节 / 6.016 秒**，音视频轨道正常。
- 在后镜头人为设置 missing-target，窗口报错早于自动旁白调用和文件选择；旁白调用计数为 0。
- MP4/WebM 小样真实编码和文件保存均非空；模拟保存失败后重试，不增加编码帧数；关闭窗口后无本次临时文件。中途取消/失败仍保留已存在的目标内容；下载后备通过。
- 报告及 390×844 截图：`dist/media-file-export/2026-10-16T13-30-59-546Z/`。前次独立完整复测：`dist/media-file-export/2026-10-16T13-12-01-957Z/`。

`node tools/dev/verify-media-narration-export.mjs`：

- 仅使用已安装的测试模型缓存；真实本地 TTS→WebM/MP4→解码 PCM，有音视频轨道，音量峰值约 **0.108**。
- 声音生成失败、取消、仅原音轨、静音、无台词、PNG/GIF、缓存复用及窗口关闭后的临时文件清理通过；未发出外网请求。
- 报告：`dist/media-narration-export/2026-10-16T13-31-14-450Z/`。

## 证据边界

- 文件选择器被测试替换为真实 OPFS FileSystemWritableFileStream，不操作用户保存路径/系统原生对话框。未验证杀毒软件、真实磁盘权限、各移动浏览器或线上部署。
- 整片为低分辨率回归；1080p/30 fps 为跨故障点短片，不宣称原规格整片性能/显存已验收。整片包含原配乐，本地 TTS 在独立 6 秒用例验证，未声称已为整片 18 段逐一完成配音质量验收。
- 离线阻断外部字体导致的 Failed to fetch 为预期，使用既有字体后备；不是字体 CDN 可达性验收。原文档仍有构图、部分动画和科学表达待完善，本轮不声称完成作品质量评审。
- 私有文件在正常失败/取消/关闭时清理；浏览器崩溃后可能存在孤立站点缓存。提前检查只能覆盖指定检查时间点，运行中资源/GPU故障仍会明确失败，但不会将半成品下载到用户路径。
