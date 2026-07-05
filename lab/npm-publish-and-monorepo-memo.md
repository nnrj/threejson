# npm 发布准备与 Monorepo 远期备忘

状态：`idea`（规划备忘，非当前迭代交付）

关联计划：Core 与 domains 解耦（`builtins/`、`threejson/builtins/register`、第三方 domain CLI）。

## 开发阶段约定

- 仓库内所有「npm 发布」相关改动（`package.json` 的 `files` / `exports`、`prepublishOnly`、generate manifest）均为 **开发与将来发布的脚手架**。
- **首版 alpha（`0.1.0-alpha.x`）仅发运行时库**：无 `bin` / CLI；`tools/` 不随包发布。CLI 留在仓库或后续独立包。

## 已采纳的发布策略（首版）

### peerDependencies

- 保持/明确：`three`、`@tweenjs/tween.js`、`html2canvas-pro`。
- `extensions/physics-rapier` 所用 `@dimforge/rapier3d-compat` 列为 **optional peer**，不随 `import 'threejson'` 默认安装。

### 版本策略

- 内置 `domains/*` 与 `core` **同 semver** 发版（预装组件与运行时同步）。
- `extensions/*` 在 README 标明与 core **同 major** 对齐；breaking 随 major 升级。

### 对外 API 形态

- 注册内置域后，`businessDomains.<id>.*` 与今日一致；用户无需感知 `builtins/` 路径。
- 快速开始：`import { createJsonScene, door } from 'threejson'`（主入口 **已** 含 builtins 注册，见 [`builtins/full.js`](../builtins/full.js)）。
- 仅 primitives / 自行控制注册顺序时：`import from 'threejson/core'` + `import 'threejson/builtins/register'`。

### 单包首版内容（`files`）

| 包含 | 不包含 |
|------|--------|
| `core/`、`domains/`、`builtins/`、`extensions/`（子路径按需） | `lab/`、`tools/`、`examples/`、`tests/`、`assets/`（见 [assets-online-hosting-memo.md](./assets-online-hosting-memo.md)） |

## Monorepo 远期（§8.4）

当内置域数量或体积显著增长时，可考虑工作区拆分，**不改变**「用户 `npm i threejson` 即可用」的目标：

```
packages/
  core/              → npm: threejson（或 threejson-core）
  domains-builtin/   → 聚合内置域实现
  builtins/          → registerBuiltinDomains + generated manifest
  assets/            → npm: @threejson/assets（静态纹理/OBJ，见 assets 备忘）
```

- 根包可做 **meta 包**：`threejson` 依赖 `@threejson/core` + `@threejson/builtins`，用户仍一条 install。
- generate manifest 脚本迁到 `packages/builtins` 或根 `tools/`。
- 第三方 domain 仍为独立 npm 包 + `registerDomain` / `threejson add-domain`。
- 第三方 **extension** 标准接入（`add-extension`、与 domain 对称）**本期不做**；评估见 [third-party-extension-adoption-memo.md](./third-party-extension-adoption-memo.md)。

退出条件（何时拆）：主包 tarball 体积、域团队并行发布频率、或需独立 semver 的 domain 集合。

## 第三方 domain

- 用户工程维护 `threejson.domains.mjs`（CLI 写入），不修改已发布的 `threejson` 包内文件。
- 包约定：`package.json` → `"threejson": { "domain": "./index.js", "domainId": "..." }`。
