# 部署范围与域名策略

> **媒体功能更新（2026-09-29）。** 主动打开的媒体工作台复用
> `packages/audio-kit/js`、`packages/media-kit/js`，以及 host-kit 中的
> `mediaStudio.js` / `audioModelPanel.js` 两个浏览器模块。`.assetsignore` 仅放行这些
> 运行文件，其他包、Node 缓存工具、包元数据和本地凭据仍排除。普通场景启动不依赖媒体包。
> 此更新替代下文的 packages 整目录排除规则，不改变原部署策略。
> 规则使用 [Cloudflare 规定的 gitignore 语法](https://developers.cloudflare.com/workers/static-assets/binding/)，
> 已增加部署范围回归测试。

> **实施更新（2026-07-29）。** 下文所述的部署范围排除规则、各应用独立的 Cloudflare
> 部署骨架、显式来源白名单与弹出窗口 `postMessage` 握手均已实现。本次仍保留旧版
> `tools/scene-host` 作为稳定的部署验证基线；React 应用尚未在本次改动中替代它。因而，
> 旧版产品中的 localStorage 场景传递机制也仍只保留在旧版中。

> **维护者已确认的决策。** `apps/*` 最终会取代 `tools/scene-host`，但要先完成部署验证。
> 当前不拆分 `community.threebox.org`：它是现有 ThreeBox 开源版本的入口；未来可再评估
> `threebox.org/community/threebox/` 一类路径。本次不改 DNS，也不改变产品边界。

本文评估 `threejson.org` 当前的部署方式、网站是否应继续保留在该仓库中，以及将 `apps/*` 下的产品迁移到独立子域名实际上需要付出哪些成本。

- 日期：2026 年 7 月 29 日（Asia/Shanghai）
- 状态：评估与分阶段方案。目前只建议立即执行第一阶段的部署范围调整；域名拆分应明确推迟。

## 1. 当前状态：基于实际测量，而非推测

`wrangler.jsonc` 将**整个仓库根目录**作为 Cloudflare 静态资源网站发布：

```jsonc
{ "name": "threejson", "assets": { "directory": "./" } }
```

目前 `.assetsignore` 只排除了 `.git`、`node_modules`、IDE 目录、操作系统垃圾文件、`.wrangler`、日志文件和 `package-lock.json`。

仓库中的其他内容都会被公开发布。线上实际验证结果如下：

```text
https://threejson.org/package.json
```

该地址返回 **HTTP 200**。

在排除 `node_modules` 后，测得的部署范围如下：

| 目录                                            | 大小        | 文件数 | 当前线上网站运行时是否需要                                   |
| ----------------------------------------------- | ----------- | ------ | ------------------------------------------------------------ |
| `assets/`                                       | 132 MB      | 262    | **需要**——演示场景、纹理和模型                               |
| `tools/`                                        | 4.1 MB      | 325    | **需要**——线上编辑器、播放器、Shower 和 ThreeBox             |
| `core/`、`domains/`、`extensions/`、`builtins/` | 约 3.3 MB   | 389    | **需要**——应用的 importmap 会加载 `../../../core/index.js` 和 `builtins/full.js` |
| `docs/en/`、`docs/zh/`                          | 约 0.6 MB   | 73     | **需要**——`core/ai/sceneReferenceCatalog.js` 会在运行时获取文档片段 |
| `website/`                                      | 68 KB       | 3      | **需要**——网站本身                                           |
| `apps/*/dist/`                                  | **10.9 MB** | —      | 不需要——这些是尚未通过当前网站路由访问的产品构建产物         |
| `apps/` 源代码                                  | 526 KB      | 158    | 不需要                                                       |
| `packages/`                                     | 872 KB      | 97     | 不需要——这些内容通过 npm 发布                                |
| `tests/`                                        | 1.2 MB      | 182    | 不需要                                                       |
| `docs/dev/`                                     | —           | —      | 不需要——内部规划归档                                         |

总文件数约为 1500 个，远低于 Cloudflare 的 20000 个静态资源限制。因此，当前约束主要是**资源总体积和部署耗时，而不是文件数量**。

其中，`assets/` 占用了 132 MB，是部署体积的主要来源，而且这些资源确实是线上运行所必需的。

### 1.1 部署范围的安全隐患

无论最终是否拆分域名，都应该立即处理这一问题。

`servertmp/` 大约有 13 MB，其中包括：

- `threebox-server`
- `threebox-cloud`
- `three-box-dashboard`

该目录已经被 Git 忽略，但**没有被 `.assetsignore` 忽略**。

按照约定，这个目录中包含可能携带敏感信息的文件：

```text
servertmp/threebox-server/.dev.vars
# Cloudflare Workers 本地密钥

servertmp/three-box-dashboard/.env.production

servertmp/threebox-server/wrangler.toml
```

这些地址目前在线上返回 404，原因包括：

1. 部分文件本身是点号开头的隐藏文件；
2. CI 或干净克隆的仓库中通常不存在 `servertmp/`，因为它已被 Git 忽略。

但是，如果开发者在一个实际包含 `servertmp/` 的工作目录中执行：

```bash
wrangler deploy
```

这些文件就有可能被上传，因为 `.assetsignore` 并没有排除该目录。

这是一条潜在的凭据泄露路径，并非纯理论风险。

因此，必须在 `.assetsignore` 中明确排除 `servertmp/`，而不能依赖以下偶然条件：

- 文件恰好以点号开头；
- CI 环境恰好没有该目录。

同样的问题也适用于：

```text
apps/*/settings.test.json
```

这类文件中可能包含开发者使用的 AI 密钥。它们虽然已经被 Git 忽略，目前在线上也返回 404，但仍应被 `.assetsignore` 明确排除。

## 2. 网站是否应该继续保留在当前仓库中？

**应该保留。**

这个网站最重要的价值，是它展示的示例始终对应当前版本的引擎：

- 网站直接从 `assets/` 加载场景；
- 线上工具直接加载 `core/` 和 `builtins/`；
- 网站、引擎和演示资源位于同一个仓库中。

这种共置方式意味着，演示内容不会与实际代码版本脱节，也不需要增加额外的发布或同步步骤。

如果把网站拆分到独立仓库中，就会引入项目此前一直努力避免的问题。

例如，`core/util/assetsBase.js` 中已经存在固定资源版本的保护机制，其目的就是避免一个构建产物在不知不觉中落后于另一个构建产物。

将网站保留在当前仓库中的成本，只是维护一个 `.assetsignore` 文件。

将网站拆分出去的成本，则是长期承担两个仓库之间的版本同步义务。

### 网站是否应该迁移到 `website.threejson.org`？

**不应该。**

根域名是项目的主要入口，它承载了：

- 搜索引擎优化；
- 外部链接；
- 项目文档；
- 项目的主要品牌入口。

把网站迁移到子域名会削弱根域名的价值，并破坏现有 URL，却没有带来明显的架构收益。

真正适合迁移到子域名的，是各个**应用程序**，而不是项目官网。

## 3. 将 `apps/*` 迁移到子域名的实际成本

`apps/*` 下的 React 应用是相互独立的 Vite 单页应用，它们使用已发布的 `@threejson/*` npm 包。

在这些应用准备好取代现有 `tools/scene-host` 产品之后，使用独立子域名是一个自然的选择，例如：

```text
editor.threejson.org
player.threejson.org
```

真正需要考虑的问题，是跨域带来的成本。

### 3.1 不会出现问题的部分

资源加载目前本身就是跨域的。

`@threejson/assets` 已经通过 `DEFAULT_CDN_ASSETS_BASE` 从 jsDelivr CDN 加载。

因此，将不同应用拆分到独立域名后，资源加载方式不会发生本质变化。

这是域名拆分成本比表面上更低的最大原因。

### 3.2 会出现问题的部分，以及正确的解决方式

当前产品中，只有两类跨应用机制。

#### 一、编辑器与播放器预览：`postMessage`

文件：

```text
tools/scene-host/shared/js/scenePreviewProtocol.js
```

该模块通过 `window.open()` 打开播放器，然后使用消息把场景传递给播放器。

目前，该机制在两个位置被限定为同源：

```js
if (event.origin && event.origin !== window.location.origin) {
  /* 拒绝 */
}

postScenePreviewMessage(
  target,
  message,
  targetOrigin = window.location.origin
)
```

实际上，`postMessage` 原生就支持跨域通信。

正确的修改方式是：

- 不再默认把目标来源设为当前页面的来源；
- 显式配置对端应用的来源；
- 维护一个允许通信的应用来源白名单。

这是对单个协议模块的小范围、明确修改，**不需要因此搭建后端服务**。

#### 二、ThreeBox 或 Shower 向编辑器传递场景：`localStorage`

三个应用目前共用以下键名前缀：

```text
threejson.editor.openScene.<id>
```

它们使用 `localStorage` 把场景传递给编辑器。

但是，`localStorage` 是按来源隔离的。

当应用被拆分到不同子域名后，这种传递方式将完全失效。

它应该迁移为与前述预览功能相同的机制：

```text
window.open() + postMessage 握手
```

这个机制已经在当前代码库中使用并得到验证。

因此，这不是重新发明一种通信机制，而是把现有的多种场景传递方式统一起来。

### 3.3 场景传递是否需要使用 `threebox-server` API？

**不需要。通过服务器中转反而是一种退步。**

如果使用服务器中转，用户的场景 JSON 将仅仅为了在同一台计算机上的两个浏览器标签页之间传递，就被发送到后端。

这与项目目前的隐私设计相冲突。

例如，在 `threeBoxCloudMigration.js` 中，即使是云端迁移，也要求：

- 由用户明确发起；
- 使用端到端加密。

如果为了标签页之间传递数据而引入服务器，还会额外产生以下问题：

- 需要身份认证；
- 增加网络失败的可能性；
- 需要考虑服务端数据保留期限；
- 原本无需离开浏览器的数据被上传到服务器。

`postMessage` 已经可以完整处理浏览器标签页之间的数据传递，并且支持离线运行。

服务器 API 适合解决的是另一种不同的功能需求：

**可分享的场景链接。**

这种链接应该满足：

- 原始标签页关闭后仍然有效；
- 可以发送给其他用户；
- 可以跨设备访问。

这是一项独立的产品决策，而不是域名拆分的前置条件。

### 3.4 真正的成本：不同来源之间的本地状态被割裂

这是使用子域名的真实缺点。

以下数据均按来源隔离，在拆分为不同子域名后将无法共享：

| 键或数据                                        | 拆分后的后果                                             |
| ----------------------------------------------- | -------------------------------------------------------- |
| `threejson.host.locale`、`threejson.site.lang`  | 用户需要在每个应用中重新选择语言                         |
| `threejson.builtin-provider-privacy.v1`         | **每个应用都会重新要求用户确认内置服务提供商的隐私授权** |
| ThreeBox 设置和对话 IndexedDB                   | 每个来源独立保存，用户的历史记录不会自动跟随到其他应用   |
| `threejson.scenePlayer.*`、`threejson.shower.*` | 每个应用的偏好设置都会重新初始化                         |

这些问题存在解决方案，例如：

- 在一个固定的主来源上部署共享设置 iframe；
- 未来在用户账户系统中同步偏好设置。

但每一种方案都会增加复杂度。

如果这些产品在用户体验上应该被视为同一个产品套件，那么这也是优先使用同源路径而不是独立子域名的重要理由。

例如，可以使用：

```text
threejson.org/editor/
threejson.org/player/
```

而不是：

```text
editor.threejson.org
player.threejson.org
```

## 4. 建议方案

### 第一阶段：现在执行

这一阶段与是否拆分域名无关。

通过 `.assetsignore` 缩小部署范围。

这是纯收益操作：

- 减少大约 13 MB 的上传内容；
- 消除 `servertmp/` 的潜在泄露路径；
- 不影响当前线上网站运行。

建议排除：

```text
servertmp/
apps/
packages/
tests/
**/dist/
docs/dev/
.claude/
*.test.json
```

以下目录**绝对不能排除**，因为已经确认它们是线上产品运行时依赖：

```text
assets/
tools/
core/
builtins/
domains/
extensions/
website/
docs/en/
docs/zh/
```

需要特别注意 `docs/en` 和 `docs/zh`。

它们很容易被误认为只是构建阶段使用的文档，但实际上：

```text
core/ai/sceneReferenceCatalog.js
```

会在运行时获取这些文档片段，为 AI Agent 提供参考内容。

如果把它们排除，不一定会产生明显报错，而是会悄悄降低 ThreeBox 的生成质量。

### 第二阶段：当 `apps/*` 可以取代 `tools/scene-host` 时执行

网站继续保留在根域名。

首先把应用部署到同一来源下的路径中，例如：

```text
threejson.org/editor/
threejson.org/player/
```

这样可以在不需要单独配置跨域部署的情况下上线新产品：显式握手仍在同一来源内运行，
剩余的 `localStorage` 本地状态也会继续共享，且各应用之间的偏好与授权状态不会被拆分。

### 第三阶段：只有存在明确的产品理由时，才拆分到独立来源

可能的理由包括：

- 不同应用需要独立部署节奏；
- 不同应用需要独立的安全边界；
- 某个应用具有独立产品身份，例如：

```text
community.threebox.org
```

在切换 DNS 之前，应依次完成以下事项：

1. 让预览协议明确、可配置地指定对端来源，解决前述编辑器与播放器通信问题。
2. 使用 `postMessage` 握手替换 `threejson.editor.openScene.*` 的 `localStorage` 场景传递机制。
3. 明确共享偏好设置的处理方式，其中重复要求用户授权是最明显的用户体验问题。
4. 完成以上工作之后，再切换 DNS。

执行顺序非常重要。

如果在域名切换前就完成前两项，那么最终的域名拆分基本只是一次配置修改，而不是一次跨域问题排查过程。

## 5. 已确认的维护者决策与实施状态

### 当前实现与延期的路径部署

### 已在本次实现

- 根目录 `.assetsignore` 已排除非运行时源码、测试、本地服务、构建产物和可能携带密钥的
  文件，同时保留线上网站运行所需的内容。
- 每个 React 应用都拥有独立的 `.gitignore`、`.assetsignore`、`wrangler.jsonc` 以及
  `deploy` / `versions:upload` 脚本；这些配置刻意不写入路由或 DNS 绑定。
- `tools/scene-host/shared/js/scenePreviewProtocol.js` 不再接受省略的或不在白名单内的
  `targetOrigin`。当前白名单包括 `threejson.org`、`threebox.org`、
  `cloud.threebox.org`、`editor.threejson.org`、`player.threejson.org` 和
  `shower.threejson.org`，另含明确列出的本地开发端口。
- React ThreeBox 与 Shower 会通过一次性的 `window.open()` + `postMessage` 握手打开 React
  编辑器；React ThreeBox 也以同一机制打开 React 播放器。接收端会在接受场景前校验来源、
  opener 窗口、协议版本和不可预测的会话标识。
- React 应用在各自源码中维护该配置，不会导入旧版 scene-host 协议。

### 延期：将 React 应用映射为同源路径

这在技术上可行，但本次**不启用**。待 React 应用通过旧版部署基线验证后，可采用“生成
静态 staging 目录”的方式，而不是直接发布其源码目录：

1. 为每个 Vite 应用设置最终路径对应的 `base`，如 `"/editor/"`、`"/player/"`、
   `"/shower/"`、`"/threebox/"`。
2. 构建各应用，将各自 `dist/` 复制到根站点 staging 目录中的对应路径
   （`editor/`、`player/` 等）。
3. 让根 Cloudflare 静态资源部署指向 staging 目录；并将现有运行时目录
   （`assets/`、`tools/`、`core/`、`builtins/`、`domains/`、`extensions/`、`website/`、
   `docs/en/`、`docs/zh/`）一同放入 staging 构建。
4. 用最终路径 URL 设置 `VITE_THREEJSON_*_URL` 构建变量。它们仍属于
   `https://threejson.org`，因此显式握手可保持有效，无需削弱白名单。

这项工作属于之后的替代切换，而不是本次准备性改造。仅为映射静态 SPA 路径，无需额外引入
Cloudflare Worker。
