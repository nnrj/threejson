# 嵌套 Domain 备忘

状态：**v1 已实现**（2026-06）：core registry 支持点分 qualified id、递归 manifest、`businessDomains` 多层 Proxy；试点 **`weather.rain`** / **`weather.wind`**。

关联文档：[`core/BUSINESS_DOMAINS.md`](../core/BUSINESS_DOMAINS.md)、[`docs/zh/domains.md`](../docs/zh/domains.md)、[`examples/html-demo/track-05-tooling/05-02-nested-domain.html`](../examples/html-demo/track-05-tooling/05-02-nested-domain.html)

## v1 已实现能力

| 能力 | 说明 |
|------|------|
| **Qualified id** | JSON canonical：`domain: "weather.rain"`（无 `subDomain` 拆分字段） |
| **`getDomain(id)`** | Map 精确查找；裸段 `rain` 在存在 `*.rain` 时返回 `null`；根域短 id（`port`）不受影响 |
| **叶子 API 命名** | `weather.rain` → `createRain` / `deployRain`（非 `createWeatherRain`） |
| **中间节点** | 可选注册；未注册时由 Proxy 根据已注册子孙 id 推导导航（`businessDomains.weather.rain`） |
| **Manifest** | `npm run generate:business-domain-manifest` 递归扫描 `domains/**/index.js` |
| **调度** | `invokeDomainModel` → `getDomain(record.domain)`；core **不**自动从父域转发子域 |
| **试点** | `domains/weather/rain`、`domains/weather/wind`；根 `weather` 保留 snow 等 handler 分流 |

演示：Track 5 · [`05-02-nested-domain.html`](../examples/html-demo/track-05-tooling/05-02-nested-domain.html)。既有 [`02-03-weather-domain.html`](../examples/html-demo/track-02-visual-fx/02-03-weather-domain.html) 仍演示 `domain: "weather"` + handler，未改动。

单测：[`tests/nestedDomainRegistry.test.mjs`](../tests/nestedDomainRegistry.test.mjs)、[`tests/businessDomainManifest.test.mjs`](../tests/businessDomainManifest.test.mjs)。

## 概念说明

**嵌套 domain** 指在 `domains/` 下用目录层级表达业务命名空间，子目录各自 `index.js` 并注册 **点分 id**（如 `weather.rain`）；使用时通过 `businessDomains.weather.rain.*` 或 JSON 中 `domain: "weather.rain"` 访问。

这与 [`subscene-memo.md`](./subscene-memo.md) 中的**场景片段嵌套**（`.tjz` / subScene）无关。第三方 domain 仍通过扁平 `registerDomain` / `threejson.domains.mjs` 注入，与子域机制共用同一 registry。

## Phase 4（工具链 + 中间节点示范）

| 交付 | 说明 |
|------|------|
| **`npm run generate:subdomain`** | 生成 `domains/<parent>/<leaf>/index.js` 模板；`threejson generate subdomain …` 同义 |
| **`weather.particle`** | 命名空间中间节点（无 deploy api）；演示 `invoke` warn |
| **演示页增强** | `05-02-nested-domain.html` 按钮 + 控制台 `getDomain` / `businessDomains` 诊断 |
| **全库迁移** | **未做** — cabinet / port / door 仍 `handler` + `deviceType` |

脚手架示例：

```bash
npm run generate:subdomain -- weather snow --dry-run
npm run generate:subdomain -- weather particle --namespace-only --force
threejson generate subdomain weather sparkles
```

## 非目标（仍维持）

- **全库 `domains/` 点分迁移**：cabinet / port / door 等继续 `domain` + `handler` + `deviceType`，无需求时不拆子域。
- **`full.js` 逐子域具名导出**：子域用 `businessDomains.weather.rain` 或 JSON 点分 id。

## 历史：2026-05 parked 评估

2026-05 结论为 **维持扁平、不立项**。2026-06 重新评估后，在「无发布包袱 + weather 天然子能力 + 教程可验证」前提下，采用 **registry 一次到位 + weather 试点**，而非全盘重构。

### 当时暂不实现的核心理由（已部分被 v1 消解）

1. cabinet server/switch 无独立 semver 需求 → 仍用 `deviceType`。
2. 完整嵌套估时 6–10 人日 → v1 仅 core + weather 试点。
3. 命名 `createCabinetSwitch` 混乱 → v1 改为 **叶子段** `createSwitch`（若将来 `cabinet.switch`）。

### 推荐替代路径（仍有效）

| 路径 | 适用 |
|------|------|
| **`deviceType` + handler** | cabinet server/switch（当前） |
| **`domainHandlers` 扩展** | 单域多入口，无需子 id |
| **目录嵌套、注册扁平** | 代码组织，core 零改动 |
| **点分子域注册** | JSON 须 `domain: "weather.rain"` 或独立 api 命名空间 |

## 重新评估：何时再拆业务子域

在 v1 基础设施就绪后，某域满足 **多条** 时可注册 `parent.child`：

1. 子模块需独立 semver / npm，且对外命名空间为 `parent.child`。
2. JSON 或第三方集成**强制**点分 `domain`，不愿经父域 `resolveDomainModel` 转发。
3. 子域与父域发布周期解耦，需独立 manifest 条目。

若仅代码组织问题，优先 **目录嵌套 + 父 index 聚合**（方案 A），不必改 JSON。

## 相关概念

| 概念 | 说明 |
|------|------|
| [`subscene-memo.md`](./subscene-memo.md) | 场景 JSON 内嵌套模块，非 business domain |
| [`npm-publish-and-monorepo-memo.md`](./npm-publish-and-monorepo-memo.md) | 第三方 domain、`threejson.domains.mjs` |
| `port` 多 handler | 单域内分流，可与子域并存 |
