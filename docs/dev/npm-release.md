# ThreeJSON npm 与 GitHub 发布流程

本文面向 ThreeJSON 仓库维护者，统一说明版本号升级、测试、打包、npm 发布、固定 CDN
验证、Git tag 和 Shower 部署顺序。

场景文档/运行时重构的接口变化、可选 Worker 和宿主接入说明见
[场景文档与运行时接入](./scene-authoring-runtime.md)。该文档也记录了本次已准备但尚未发布的
版本；版本已升级时，不要重复执行 `release:version`。

可计算建模新增 `threejson/modeling`、`threejson/modeling-cad` 和 `threejson/modeling-webgpu`，
接口与可选依赖见 [可计算建模](../zh/modeling.md)。`prepack` 同时构建几何与建模 Worker；
发布校验会检查两个 Worker 及上述入口确实进入 tarball。CAD 的 replicad/OCCT 为可选 peer，
其 WASM 不随 ThreeJSON 默认打包，需由启用 CAD 的宿主部署。普通场景和官网示例不要求安装 CAD。
新增能力不表示可以覆盖已有 npm 版本；本次代码发布前仍须按下述流程升级变更包版本。

AI 操作协议新增 `threejson/operations`、`threejson/query` 及 `@threejson/scene-tools`。
根包的 tarball 检查包含这两个入口；CLI/MCP 与共享 host-kit 应随本次根包一起升级并发布，
不能让新版工具解析到不含这些入口的旧版 ThreeJSON。本次实现没有自动修改版本号或发布。

## 发布对象与顺序

发布工具管理以下 npm 包：

1. `@threejson/assets`（仅资源发生变化并升级版本时发布）；
2. `threejson`；
3. `@threejson/audio-kit`；
4. `@threejson/media-kit`；
5. `@threejson/scene-tools`（Node CLI/MCP，可选 AI/浏览器入口）；
6. `@threejson/host-kit`；
7. `@threejson/editor-kit`；
8. `@threejson/player-kit`；
9. `@threejson/scene-agent-kit`；
10. `@threejson/react`；
11. `@threejson/react-scene-agent`；
12. `@threejson/react-ui`。

`threejson` 必须先于依赖它的 packages 发布。发布工具会在继续发布 packages 前确认固定版本的
`threejson/runtime` 已经能从 jsDelivr 访问。只有工具输出“现在可以部署 Shower”后，才应部署
包含新版下载模板的 Shower。

## 不可破坏的版本原则

- npm 已发布版本不可覆盖，也不可让同一版本号对应不同源码。
- 根目录 `package.json` 的 `version` 是 ThreeJSON 发布版本的唯一权威来源。
- Shower 下载的 HTML 使用精确版本 URL，例如：

  ```text
  https://cdn.jsdelivr.net/npm/threejson@0.1.0-alpha.10/core/runtime.js
  ```

- 下载模板只导入 `threejson/runtime`，不回退到旧 `threejson/core`。固定版本尚未发布时，失败应
  直接暴露发布顺序错误，不能用兼容代码掩盖。
- `@threejson/assets` 版本可以保持不变；资源内容发生任何变化时必须升级 assets 版本。

曾经出现过 `threejson@0.1.0-alpha.9` 已发布、但仓库继续在相同版本号下新增
`core/runtime.js` 的情况。此时本地源码和 npm tarball 已不是同一份内容。发布工具现在会拒绝
静默复用这种版本；应先升级到新的版本号。

## 命令总入口

在仓库根目录运行：

```powershell
npm run release
```

交互菜单提供：

- 版本号升级；
- 联网预检目标版本及可复用包；
- 发布前测试；
- 打包全部 npm 包；
- 发布全部 npm 包；
- 一键执行版本升级、预检、测试、打包和发布；
- 验证发布并创建 Git tag。

也可以分别运行：

```powershell
npm run release:check
npm run release:version
npm run release:preflight
npm run release:test
npm run release:pack
npm run release:publish
npm run release:tag
npm run release:all
```

## 推荐的正式发布流程

首次配置 npm 身份：

```powershell
npm login
npm whoami
```

一次正式发布推荐按以下顺序操作：

```powershell
# 1. 升级并同步版本号
npm run release:version

# 2. 提前发现版本冲突，再测试和打包
npm run release:preflight
npm run release:test
npm run release:pack

# 3. 检查版本变更并提交到本地 Git（此时先不要推送）
git add .
git commit -m "release: v0.1.0-alpha.10"

# 4. 发布 npm；工具会等待固定版本的 runtime 在 jsDelivr 就绪
npm run release:publish

# 5. 验证 npm 内容并创建本地 annotated tag
npm run release:tag

# 6. npm/CDN 均就绪后再推送代码和 tag
git push --follow-tags
```

如果 GitHub 分支推送会自动触发网站或 Shower 部署，务必在 `release:publish` 完成 CDN
验证后再执行最后的 `git push`。发布脚本不会自行部署网站。

## 版本同步

`release:version` 默认：

- 将 `threejson` 的预发布序号加一；
- 将全部 `@threejson/*` packages 的预发布序号加一；
- 保持 `@threejson/assets` 版本不变。

只有 assets 内容变化时才输入新的 assets 版本，或使用 `--bump-assets`。

若主包和组件版本已经准备好，仅需要补升 assets，不要重新运行默认的 `release:all` 或
`release:version`，否则会再次递增主包与组件版本。可以只升级 assets 并同步 CDN 引用：

```powershell
npm run release:version -- --only-assets
# 或指定目标版本（以下仅为示例，需确认该版本尚未发布）
npm run release:version -- --only-assets --assets 1.1.7
```

`--only-assets` 保留当前主包和组件版本，默认将 assets 补丁号加一，不接受同时指定
`--threejson` / `--packages`。版本同步不会重写语义未变化的 JSON 文件。

版本命令同步更新：

- 根包、assets 和全部 packages 的 `package.json`；
- packages 之间及其对 `threejson` 的 peer 依赖；
- 两份下载模板构建器中的 `TEMPLATE_THREEJSON_VERSION`；
- assets CDN 固定版本（assets 升级时）；
- 中英文 quick-start 文档中的版本示例；
- 本地存在的 `package-lock.json`。

指定版本：

```powershell
npm run release:version -- --threejson 0.1.0-alpha.10 --packages 0.1.0-alpha.2 --assets 1.1.4
```

只预览、不写文件：

```powershell
npm run release:version -- --dry-run
```

`release:check` 会拒绝以下状态：

- packages 版本或 peer 依赖不一致；
- 模板固定版本与根包版本不一致；
- 中英文 quick-start 中的 npm/CDN 示例版本与当前包版本不一致；
- 工具源码和 `@threejson/host-kit` 中的模板构建器不一致；
- 缺少 `./runtime` 或 `./ai` 导出；
- 下载模板重新出现旧 core 回退。

## 联网预检与可选文件对比

`release:check` 只检查仓库内部版本一致性；`release:preflight` 额外读取 npm 目标版本，
在全量测试和正式打包之前检查版本冲突及可复用包，不登录、发布、打 tag 或升级版本。
它可能运行本地 `npm pack --dry-run` 取得摘要（会执行该包的生命周期脚本），不生成
`dist/release` 正式产物；不要把预检通过等同于 npm 发布或 CDN 验证成功。

`preflight`、`publish`、`tag`、`all` 执行前会询问是否进行可选的逐文件对比，默认 **否**。
也可以明确指定，避免交互：

```powershell
# 摘要不同时，下载并比较文件，输出新增/删除/修改清单
npm run release:preflight -- --compare-files
# 已了解资源状态，不下载远端 tarball、不做文件对比或差异报告
npm run release:preflight -- --no-compare-files
```

- 无论选择哪项，都先检查目标版本及本地/远端 `integrity`（必要时用 `shasum`）。
- 摘要一致直接复用，不下载远端 tarball，也不做逐文件对比。
- 摘要不一致且选择跳过时，停止并说明“未做文件级对比，无法确认是否一致”；不会把
  “打包摘要不同”直接说成“资源确实变化”，也不会据此静默跳过已变资源。
- 允许文件对比时，临时打包本地包，流式读取本地与远端 tarball。远端字节须通过 npm 摘要
  校验；不把远端文件解压到磁盘。比较文件路径、原始字节和可执行权限，忽略 tar 时间戳、
  所有者、条目顺序及压缩差异。文本换行和二进制变化仍算内容变化。
- 文件一致才复用 npm 已发布包（不重新发布）。真实差异会列出文件清单，要求升级版本；
  下载、摘要验证或归档解析失败时不会假定一致。
- `--yes` 只跳过发布/tag 确认，不启用文件对比；非交互环境未指定时默认跳过。
  `--compare-files` 与 `--no-compare-files` 互斥。
- 一键流程只询问一次；发布前重新检查本地和远端摘要。仅当两者都没变时，复用本次流程
  已通过的文件比较结果，不跨运行缓存结论。

目录“最后修改日期”不能证明包内资源未变。2026-10-27 的只读核查中，本地 assets 比 npm
`1.1.6` 多了 13 个建模/视频示例 JSON，并修改了 `json/demo-show/manifest.json`；因此该次
确实需要升级 assets，不是仅仅重新打包造成的误报。若已经确认资源变化，可直接使用
`--only-assets` 升级，再用 `--no-compare-files` 预检，节省深度比较时间。

## 测试与打包

```powershell
npm run release:test
npm run release:pack
```

`release:test` 执行发布状态检查、示例目录校验和完整自动化验证。

独立的 `release:pack` 不查询 registry，按发布顺序对十二个包执行 `npm pack`，并额外确认 `threejson` tarball 至少包含：

- `core/runtime.js`；
- `core/ai/index.js`；
- `core/document.js` 与 `core/session.js`；
- `core/geometry/geometryCompiler.js` 与生成的 `geometry.worker.bundle.js`；
- `package.json`。

tarball 写入被 Git 忽略的 `dist/release/<timestamp>/`，不会覆盖之前的打包结果。
在 `release:all` 中，已通过预检、可以复用的包不再生成正式 tarball；检查摘要和可选的
文件比较仍可能临时打包，不能理解为完全不读取本地资源。

## npm 发布与 CDN 门禁

正式发布：

```powershell
npm run release:publish
```

发布前工具会：

1. 询问是否启用文件对比，查询所有目标版本，验证需要复用的已发布包；
2. 检查 npm 登录身份；
3. 生成并检查 ThreeJSON tarball 的关键入口；
4. 要求输入 `PUBLISH`；
5. 按依赖顺序发布；
6. 在 `threejson` 发布后检查 npm registry；
7. 轮询固定版本的 jsDelivr `core/runtime.js`，确认其中存在 `createJsonScene`；
8. CDN 就绪后继续发布 packages。

预发布版本默认使用 npm `alpha` dist-tag；稳定 assets 使用正常稳定标签。可以覆盖预发布标签：

```powershell
npm run release:publish -- --tag beta
```

CDN 默认最多等待 180 秒，可调整：

```powershell
npm run release:publish -- --cdn-timeout 300
```

只执行 npm 自带发布预演，不写入 registry：

```powershell
npm run release:publish -- --dry-run
```

### 已存在版本与断点续发

- assets 版本未变化且已经存在时，归档摘要一致或经可选文件对比确认完全一致才会复用；
  确认文件变化但版本未升级时会终止并要求升级 assets 版本。
- 其他任何目标版本已经存在时，默认在发布任何包之前终止。
- 如果确实属于同一次发布在中途失败，可显式运行：

  ```powershell
  npm run release:publish -- --resume
  ```

- `--resume` 会重新检查本地 tarball 与 npm 摘要，摘要不一致时遵循上述可选文件对比规则。
  只有验证内容相同才能跳过已发布包；该参数不能绕过差异检查。
- 如果 `threejson` 已发布但 jsDelivr 尚未同步，命令会在 runtime 门禁处停止。稍后使用
  `--resume` 重试即可，不需要再次升级版本。

## Git tag 与 GitHub

发布成功并提交版本文件后运行：

```powershell
npm run release:tag
```

该命令要求：

- Git 工作区干净；
- `HEAD` 中的根包版本等于当前版本；
- 十二个目标 npm 版本均已存在；
- 全部本地 tarball 与 npm 摘要一致，或经可选的逐文件对比确认内容一致；
- 固定版本的 jsDelivr runtime 已就绪。

随后输入 `TAG`，工具会创建类似 `v0.1.0-alpha.10` 的本地 annotated tag。它默认不推送，
因此不会擅自触发 GitHub 自动部署。

自定义 tag 名称：

```powershell
npm run release:tag -- --tag-name v0.1.0-alpha.10
```

明确要求脚本推送到 GitHub：

```powershell
npm run release:tag -- --push --remote origin
```

推送前还需要输入 `PUSH_TAG`。也可以自行执行：

```powershell
git push origin refs/tags/v0.1.0-alpha.10
```

## 一键执行

```powershell
npm run release:all
```

它会依次执行版本升级、联网预检、测试、打包、npm 发布和 CDN 验证。预检失败会在全量测试
和打包前停止，保留已同步的版本文件；修正问题后可分步继续，不必再次递增版本。
为了避免脚本擅自创建提交或修改
Git 历史，一键流程不会自动 `git commit`、创建 tag 或推送 GitHub。完成后应检查并提交版本
变更，再运行 `npm run release:tag`。

如果需要 Git tag 与提交严格对应，推荐使用前面的分步正式发布流程，而不是在未提交工作区中
直接执行一键发布。

## English summary: optional content comparison

`release:preflight` checks registry versions before full tests and packing, without publishing. Commands
ask whether to run a file-level comparison; the default is **no**, including non-interactive runs.
Use `--compare-files` or `--no-compare-files` explicitly; `--yes` does not authorize file comparison.
Matching archive hashes need no download. A mismatch with comparison disabled stops as **unverified**,
not as proof of changed files. Opted-in comparisons verify registry integrity and compare paths, raw
bytes and executable permissions without extracting files; archive timestamps/order are ignored.
`--resume` never bypasses a content mismatch. `release:version --only-assets` updates assets and its pins
while preserving prepared root/component versions. Standalone `release:pack` still packs all twelve
packages without registry lookups; `release:all` omits verified reused packages from formal pack output.
