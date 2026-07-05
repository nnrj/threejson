# 第三方 Extension 接入与 Domain 对称性评估

状态：`parked`（**本期不做**第三方 extension 标准接入；结论备忘，非发布承诺）

日期：2026-06-28

关联：

- [extension-json.md](./extension-json.md) — Extension JSON 容器约定（草案）
- [npm-publish-and-monorepo-memo.md](./npm-publish-and-monorepo-memo.md) — 单包 `files` 含 `extensions/`
- [doc/domains.md](../doc/domains.md) — 第三方 domain（`add-domain`、独立 npm 包）
- [doc/design-principles.md](../doc/design-principles.md) — core / extensions / 宿主划界
- [extensions/README.md](../extensions/README.md) — 仓库内参考实现说明
- [doc/glossary.md](../doc/glossary.md) — domain vs extension 术语

## 结论（TL;DR）

1. **仓库 `extensions/` 会随 `threejson` npm 包发布**（`package.json` `files` + `exports["./extensions/*"]`），但 **不会** 被 `core/index.js` 或主入口 `builtins/full.js` 自动加载；重依赖（Rapier、ECharts）为 optional peer。
2. **应用开发者今天即可接自定义 extension**：复制/改写官方 `extensions/` 示例，或在自己工程内新建模块，按 `bootstrapFromScene` + `PluginHost` / core registry 模式接入；**不必**修改 `node_modules/threejson`，也**不必**等待「官方第三方 extension 标准」。
3. **自定义业务模型/对象** 应优先走 **domain** 第三方路径（`registerDomain`、`threejson add-domain`），而非 extension。
4. **与 domain 对称的标准接入**（`add-extension`、`threejson.extensions.mjs`、`package.json` 的 `threejson.extension` 字段等）**本期不做**；仅在扩展生态（多团队分发、可发现、编辑器列扩展清单）有明确需求时再立项。

## 当前架构事实

| 维度 | domain | extension（仓库内参考实现） |
|------|--------|------------------------------|
| 意图 | JSON 驱动的业务对象装配 | 横切运行时能力（物理、图表、FPS 贴地等） |
| core 自动加载 | 主入口 `threejson` → `builtins/register.js` 注册内置域 | **否**；宿主显式 import + bootstrap |
| JSON 容器 | `objType: "domain"` + `domain` / `handler` | `sceneConfig.extensions[id]`、物体级 `extensions[id]`；core **只合并 Map，不解析字段语义**（`core/util/extensionsUtil.js`） |
| 运行时钩子 | `businessDomains.<id>.*`、`resolveDomainModel` | `createPluginHost`、`registerParticleEmitterProvider`、`registerControlsType`、`registerObjTypeDeployer` 等 |
| npm 形态 | 内置与 core 同 semver；第三方独立包 | 参考实现打进主包子路径；第三方无官方 manifest 约定 |
| CLI | ✅ `threejson add-domain` → `threejson.domains.mjs` | ❌ 无 `add-extension` |

主入口仅注册 domain，不拉 extension：

```6:7:builtins/full.js
import "./register.js";
export * from "../core/index.js";
```

`PluginHost` 设计说明：具体插件由 `extensions/` 或上游（宿主）注册，core 不引入重依赖。

## 用户如何接自定义 extension（已可行）

### 方式 A：复制官方示例到自有工程

- 复制 `extensions/<name>/`（或单文件）到应用仓库（如 `src/threejson-extensions/`）。
- 将相对路径 `../../core/...` 改为 `threejson/core` 或 `threejson`。
- 在 `createJsonScene` / `onSceneReady` 中显式调用 bootstrap（参考 `examples/html-demo/track-04-interaction/04-02-plugin-physics.html`）。
- 自定义 extension 使用 **独立 extension id**（避免与内置 `"physics-rapier"` 等冲突）。
- 重依赖由**用户工程**安装（optional peer），不会随 `import "threejson"` 自动安装。

### 方式 B：自写模块（推荐，不必复制整目录）

- 新建 ESM 模块，export `bootstrapXxxFromScene(ctx)`。
- `ctx` 通常含 `scene`、`sceneJson`、`pluginHost`；读 `resolveSceneExtensions` / `readExtensionConfig`。
- 在应用入口 import 并在场景就绪后 bootstrap。

### 方式 C：独立 npm 包

- 发布 `@acme/threejson-extension-foo`，用户 `npm i` 后在应用 bootstrap 中 import。
- 与官方 tarball 内 `extensions/` **无耦合**；今天已可行，缺的是约定与脚手架，不是运行时能力。

### 方式 D：本质是「自定义模型」→ 用 domain

- 声明式 JSON、`domain` + `handler` 调度 → [doc/domains.md § 第三方 domain](../doc/domains.md#第三方-domainnpm--cli)。
- 不要强行做成 extension。

## 与 domain「对称」是否有必要

### 不对称是刻意分层，非缺陷

- **domain**：场景内容、「场景里有什么」→ 注册表 + JSON 调度 + 分发 story 自然。
- **extension**：加载后挂载的横切能力 → 历史上由**宿主**在 load 后 bootstrap；core 仅提供容器与钩子。

### 复制/自写已够用的场景（当前默认）

- 扩展仅在单应用或单团队内使用。
- 维护者即应用开发者；不需要 `npx threejson add-*`。
- JSON 里 extension id 由项目内文档约定即可。

### 值得做对称标准时的触发条件（远期）

| 诉求 | 说明 |
|------|------|
| 多项目复用同一扩展包 | 减少各应用重复写 bootstrap 样板 |
| 可发现性 | 编辑器 / AI 生成场景需枚举「已安装扩展」 |
| 声明式安装 | 类似 `threejson.domain` 的包字段 + CLI 写 manifest |
| 扩展生态 | 第三方发布 `@vendor/threejson-extension-*` 且希望低摩擦接入 |

若上述诉求未出现，**不必**为对称而对称；[`extension-json.md`](./extension-json.md) 维持草案 + 参考实现即可。

## 与 domain 第三方能力对照（缺口清单，未承诺实现）

| 能力 | domain | extension（缺口） |
|------|--------|-------------------|
| `package.json` 声明 | `"threejson": { "domain", "domainId" }` | 无 `threejson.extension` 约定 |
| CLI | `threejson add-domain` | 无 `add-extension` |
| 用户 manifest | `threejson.domains.mjs` | 无 `threejson.extensions.mjs` |
| 正式文档 | `doc/domains.md` | JSON 容器见 lab 草案；无 `doc/extensions.md` 级手册 |

## 决策记录

- **2026-06-28**：讨论后决定 **先不做** 第三方 extension 标准接入与 domain 对称 CLI/manifest；应用开发者按本文「已可行」路径自接即可。
- 若将来立项：建议轻量起步（文档 + 可选 `threejson.extensions.mjs` 约定），**不必**与 domain CLI 同重量级，除非明确要做扩展 marketplace。

## 参考实现索引

| extension id | bootstrap / 入口 | 说明 |
|--------------|------------------|------|
| `physics-rapier` | `extensions/physics-rapier/bootstrapFromScene.js` | Rapier WASM；读 JSON `extensions["physics-rapier"]` |
| `simple-gravity` | `extensions/simple-gravity/plugin.js` | `PluginHost.register` 演示 |
| `fps-walk` | `extensions/fps-walk/bootstrapFirstPersonExtensions.js` | 第一人称贴地 |
| `stat-echarts` | `extensions/stat-echarts/bootstrapFromScene.js` | ECharts + css3dPanel |
| `nebula`（provider） | `extensions/particle-nebula/index.js` | `registerParticleEmitterProvider` 骨架 |

宿主职责三步（与 [extension-json.md](./extension-json.md) 一致）：import 扩展 → `onSceneReady` 取得 `pluginHost` / `sceneJson` → 调用 bootstrap。
