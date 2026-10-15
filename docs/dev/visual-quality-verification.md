# 生成质量实施与验收

## 实施范围

本轮实现几何正确性修复、统一环境和渲染参数、灯光材质构图操作、弧长运镜、四档质量检查、显式视觉能力声明、受控外部模型与跨应用接入。使用方式与公共契约见 [生成质量与视觉创作](../zh/visual-quality.md)。方案来源与设计边界见 [本轮方案记录](./plans/1792068304152_visual-quality_5a22692188fc40fa94ebf3bd67e7e322/01-prompt-and-context.md)。

| 模块 | 已落实 |
|---|---|
| 内核 | SDF 朝向和平滑法线；放样/扫掠接缝、端盖、朝向、扭转；误差细分与显式预算；几何诊断 |
| 渲染 | 环境强度/旋转、相机、阴影往返；显式关阴影；单一最终输出转换；本地摄影棚环境 |
| 创作 | 三类持久化视觉命令；路径弧长/速度曲线；源参数和撤销保留 |
| 共享 Agent | quick/standard/fine/ultimate；真实采样图像；修正预算；报告版本失效；原失败原因保留 |
| 应用 | 原生/React ThreeBox、Cloud、场景编辑器、视频编辑器；正式灯光、报告、当前镜头限制 |
| 预览 | 宿主设备起始档位及帧时间反馈；默认仅降低像素/后处理分辨率，Points/LOD 需独立启用；可恢复、源状态不变，导出拒用降档工程 |
| 外部模型 | 双开关；任意新 URL 拦截；Poly Haven/自托管目录；许可来源；自包含持久副本与打包 |
| 管理 | migration 0025；模型服务页面；供应商图像能力声明及服务端路由 |

尚未用真实付费生成样本证明平均审美评分提升；四档是实际不同的检查预算，不是“电影级”承诺。设备预览使用帧时间反馈与升降档迟滞，策略阈值和全部模拟内存的预算控制仍需在真实设备实测；实例化 billboard/自定义算子不做未经验证的重采样，不偷偷改写源数据或缩短视频。

## 自动化验证

2026-10-15 本地验收：ThreeJSON 全套 1,735 项通过、1 项跳过；服务端 106 项通过。原生宿主真实画面测试、视频编辑器浏览器回归、React ThreeBox、Cloud 本地包构建和后台构建通过。以下命令用于复验，不代表这些检查已在生产或真实手机上执行。

### 2026-10-16 架构边界修正

根据 [确认后的边界方案](./plans/1792084792826_quality-boundaries_7dad6631377f4209a7faded835b6a084/01-prompt-and-context.md)，保留非侵入和单向依赖原则，不以放宽规则保留产品耦合：

- Core 几何取消固定 2M/256 限额；显式调用预算在分配前检查，浏览器宿主提供可替换保护值。
- Core 归档取消 ThreeBox 服务 URL 特判；宿主注入通用必需资源规则。
- Core 只提供数值预览预算和可恢复执行机制；设备策略、四档创作配置、本地化报告移到共享宿主，并同步 npm 包副本。
- 质量观察、版本绑定与通用检查流程仍在 Core。声明需要审图而实际不能审图时不再标记完成；暂停草稿只做本地检查，不意外重启付费精修。
- 中英文设计原则补充宿主显式 API 启用、运行叠加层与显式通用创作配方的界限。

`qualityPolicyBoundaries.test.mjs` 复现旧上限和应用耦合，并覆盖预算前置/调用者优先、worker 回退、超过 256 的作者精度、采样误差未收敛报告、通用归档策略、未启用无降级状态、双向迟滞、自定义预算和 DPR 恢复。额外覆盖默认复用卡片不启用设备策略以及 `false` 覆盖。

最终全套 Node 测试 1,747 项通过、1 项跳过、0 失败。浏览器离线回归 9 组通过；陶瓷、金属、玻璃、夜景、室内、闭合放样、文字的重开/导出帧平均通道误差均为 0。点云默认节能模式仍绘制 10 万点；显式授权后才抽样为 4 万点，撤销预算恢复 10 万点与 1920×1080。视频编辑器测试通过，包括 320/390px 视口、场景编辑器往返以及带音频的真实编码导出。静态 AI 验证 3 项通过；React ThreeBox、场景编辑器构建通过，Cloud 边界检查与隔离本地包的 TypeScript/构建通过。构建仍有已有的大 chunk/静态动态混合导入提示，未把它们当作架构错误忽略或宣称已经优化。

Cloud 的新验证命令 `node tools/dev/verify-cloud-local-packages.mjs` 用 `npm pack --offline --ignore-scripts` 制作本地包，将 Cloud 源码复制到忽略目录 `dist/cloud-local-packages-*`，只在该隔离目录解包并使用已有第三方依赖。不替换 Cloud 原安装、不改版本/锁文件、不联网安装。它证明当前源码与本地包契约相容，**不能证明 registry 已发布或线上部署有效**。

### 复验命令

在 ThreeJSON 根目录运行：

```powershell
npm run build:geometry-worker
node tools/dev/syncHostSessionModules.mjs
node --test --test-concurrency=1 tests/*.test.mjs
$env:THREEJSON_BROWSER = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
node tools/dev/verify-visual-quality.mjs
node tools/dev/verify-video-editor.mjs
npm run build --workspace=@threejson-apps/threebox
node tools/dev/verify-cloud-local-packages.mjs
```

新增测试为 `visualQualityFoundation.test.mjs`、`creationQuality.test.mjs`、`creationModelPolicy.test.mjs`。它们覆盖法线方向、闭合 UV 接缝、硬端盖、阴影关闭、参数往返、不等距路径、0/1/2/3 次预算、缺少视觉能力、缺少渲染器、取消/无进展/非法修正、四种策略组合、途中关闭、命令与 Patch 绕过、历史模型和纹理不受限制，以及模型归档缺资源明确失败。

`verify-visual-quality.mjs` 只使用安装好的浏览器并阻断外部请求。7 组本地场景覆盖陶瓷、金属、玻璃、夜景、室内、闭合放样、实体文字；包括无地板悬浮主体。测试记录可辨认主体像素数、加载编译时间、几何/绘制统计和截图。预览、配置保存重开与媒体导出帧的平均通道误差在此次本机运行中均为 0。90 秒工程的 2/44/88/2 秒跳转重复帧一致。输出在忽略目录 `dist/visual-quality-verification/`。

`previewPerformance.test.mjs` 覆盖宿主设备档位、显式启用的均匀索引采样/LOD 偏置、异常恢复、后处理分辨率、手动时间线与实时帧的一致预算、导出隔离。真实浏览器验证默认不抽样，授权后 10 万点绘制 4 万点、1920×1080 降为 720×405、12 帧不增长采样几何数量，撤销预算后完整恢复；源文档和原始几何不变，独立导出仍为 1920×1080 完整质量。合计 9 组真实画面检查。

`verify-video-editor.mjs` 覆盖实际渲染、代码/混合视图、JSON 原子应用、场景编辑器往返、撤销重做、并发保存保护、320/390px 窄屏与短横屏，以及导入 WebM 的音频、确定性跳转和真正编码导出。它会故意提交非法 JSON 和非法时长来验证拒绝路径；这些预期错误不等同于未捕获异常。默认不下载语音模型、不调用供应商。

服务端在自身目录执行 `npm run typecheck` 与 `npm test`；测试使用隔离的 Cloudflare 模拟存储与禁网的供应商 mock，不访问线上 R2。后台执行 `npm run build`；Cloud 执行 `npm run check` 与 `npm run build`。

## 发布前的依赖和迁移

本次未发布包、迁移线上数据库或部署。不要只推送 Cloud 源码然后继续使用旧锁文件。

1. 按 [npm 发布流程](./npm-release.md) 升级并发布 `threejson` 及变更的共享包，包含 `host-kit`、`scene-agent-kit`、`react-scene-agent`、`media-kit`、`audio-kit`。已发布版本不能原地覆盖。
2. 对 `threebox-server` 先执行 `npm run db:migrate:remote` 应用 `0025_model_assets_and_provider_inputs.sql`，再按现有流程部署 Worker。迁移只新增表/列，旧 Worker 回退时保留这些表列，不删除已保存模型。
3. 部署后台后在“外部模型资产”检查总开关与 R2。使用既有公共纹理/资产存储（`textures` 角色），但获取策略独立于纹理开关。按需关闭 Poly Haven 或填写自托管目录。
4. 在供应商管理中为**真实支持图像输入**的供应商声明图片能力；迁移默认仅文本，避免猜错而发送无法处理的图片。
5. Cloud 必须将 `threejson` 及三个已有共享包升级到刚发布的版本，显式安装 `@threejson/media-kit`、`@threejson/audio-kit`；提交新的 `package.json` 和锁文件。使用 `npm install --save-exact 包名@已发布版本`，然后 `npm ci`、`npm run check`、`npm run build`。本轮 registry 查询这两个媒体包返回 404，因此只用本地 `npm pack` 产物覆盖测试用 `node_modules` 验证，未伪造 registry integrity 或提交临时 tarball 依赖。
6. 检查内置供应商隐私许可、用户开关、正式预览、历史场景与 `.tjz` 重开，再发布应用。

服务端模型 API：公开 `GET /v1/models/capabilities` 和内容寻址的 `GET /v1/models/objects/:sha256`；设备密钥鉴权的 `POST /v1/models/search`、`POST /v1/models/acquire`；管理 API `GET/PUT /admin/model-assets`。获取仅接受可信目录 ID，不接受客户端 URL/许可证。限制为单资源默认 32 MiB（管理员最多 64 MiB）、原始依赖合计最多单资源额度两倍、最多 32 个外部依赖、每设备最多 2 个并发/全局 16 个、获取整体 110 秒、单次网络 20 秒/最多 3 次跟随重定向。自包含 base64 副本会比原始依赖字节数大，返回 `storedBytes` 单独记录。

自托管目录仅允许命名 HTTPS 公共主机，依赖和重定向限定同主机；Poly Haven 使用固定下载域名。禁止 IP 字面地址、用户名密码、私网主机和非默认端口。管理员必须选择可信、可控 DNS 的源站；应用层主机检查不是 DNS 地址固定机制，不应声称能防御已获管理权限者控制的所有 DNS 重绑定。

## 人工质量与性能验收

下列验证需要获准的供应商预算或真实设备，不以 Node 测试、桌面模拟手机视口替代：

- 固定供应商、推理、token/费用预算和提示集，对照旧版与四档新版本。记录几何比例、材质、主体验读、构图、镜头节奏 5 项评分，以及成功率、响应时延、用量、修正理由和未解决问题。未收集数据前不宣称平均质量提高多少。
- 提示集至少包括陶瓷花瓶、拉丝金属机械件、玻璃瓶、室内空间、夜景、无地板悬浮物、双缝干涉科普视频、中文 SDF/实体标题；继续检查机房、港口和相关 html-demo。
- 同一桌面/手机记录浏览器、GPU、视口/DPR、冷/热加载时间、帧时间 p50/p95、内存、绘制次数、上下文丢失。`renderer.info.memory` 是资源数量，不是显存字节数。
- 对多分钟作品完整播放/导出，检查逐镜头字幕、旁白、转场、取消与恢复、最终时长。不用若干跳转帧证明长时间稳定，不使用复制短片段填充时长。
- 线上核对 R2 持久对象、真实 Poly Haven 元数据与下载、许可页面、配额耗尽、关闭中的获取、历史资源重开、JSON/场景包往返和离线导入。

## 回退

可以关闭服务端新模型获取、将生成档位设回快速、取消显式检查照明。已有资产对象保持可读取，不回收 R2 历史模型，不改变本地导入。代码回退需要同时回退共享包与消费者；不要删除用户 JSON、聊天历史或参数化源数据。原始路径参数化保持默认，新的弧长模式为显式选择。
