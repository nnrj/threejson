# ThreeJSON npm 与 GitHub 发布流程

本文面向 ThreeJSON 仓库维护者，统一说明版本号升级、测试、打包、npm 发布、固定 CDN
验证、Git tag 和 Shower 部署顺序。

## 发布对象与顺序

发布工具管理以下 npm 包：

1. `@threejson/assets`（仅资源发生变化并升级版本时发布）；
2. `threejson`；
3. `@threejson/host-kit`；
4. `@threejson/editor-kit`；
5. `@threejson/player-kit`；
6. `@threejson/scene-agent-kit`；
7. `@threejson/react`；
8. `@threejson/react-scene-agent`；
9. `@threejson/react-ui`。

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
- 发布前测试；
- 打包全部 npm 包；
- 发布全部 npm 包；
- 一键执行版本升级、测试、打包和发布；
- 验证发布并创建 Git tag。

也可以分别运行：

```powershell
npm run release:check
npm run release:version
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

# 2. 验证和打包
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

## 测试与打包

```powershell
npm run release:test
npm run release:pack
```

`release:test` 执行发布状态检查、示例目录校验和完整自动化验证。

`release:pack` 按发布顺序对九个包执行 `npm pack`，并额外确认 `threejson` tarball 至少包含：

- `core/runtime.js`；
- `core/ai/index.js`；
- `package.json`。

tarball 写入被 Git 忽略的 `dist/release/<timestamp>/`，不会覆盖之前的打包结果。

## npm 发布与 CDN 门禁

正式发布：

```powershell
npm run release:publish
```

发布前工具会：

1. 检查 npm 登录身份；
2. 生成并检查 ThreeJSON tarball 的关键入口；
3. 查询所有目标版本是否已经存在；
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

- assets 版本未变化且已经存在时，只有本地 tarball 与 npm 完全一致才会复用；内容有变化但
  版本未升级时会终止并要求升级 assets 版本。
- 其他任何目标版本已经存在时，默认在发布任何包之前终止。
- 如果确实属于同一次发布在中途失败，可显式运行：

  ```powershell
  npm run release:publish -- --resume
  ```

- `--resume` 会重新生成本地 tarball，并比较 npm 上的 integrity/shasum。只有内容完全相同时才
  跳过已发布包；内容不同会要求升级版本号。
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
- 九个目标 npm 版本均已存在；
- 全部本地 tarball 与 npm integrity/shasum 一致；
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

它会依次执行版本升级、测试、打包、npm 发布和 CDN 验证。为了避免脚本擅自创建提交或修改
Git 历史，一键流程不会自动 `git commit`、创建 tag 或推送 GitHub。完成后应检查并提交版本
变更，再运行 `npm run release:tag`。

如果需要 Git tag 与提交严格对应，推荐使用前面的分步正式发布流程，而不是在未提交工作区中
直接执行一键发布。
