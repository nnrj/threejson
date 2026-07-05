# Domain 脚手架模板

## 目标

为新业务域提供统一模板，采用 `create*Json` / `create*` / `deploy*` 三层约定。契约由 [`businessDomainRegistry.js`](../core/handler/businessDomainRegistry.js) 的 `validateDomainDescriptor` 在注册时校验（见 [domains.md](./domains.md)）。

本文面向**任意宿主应用**（演示页、业务页、编辑工具等），不把某一应用当作默认读者。

## 文档分层

- **库层**（本文、`doc/domains.md`、`core/BUSINESS_DOMAINS.md`）：descriptor、`api` 命名、`resolveDomainModel`。
- **应用层**：各宿主自己的 UI 与历史栈；可选调用 domain 的 `addToScene` 等便捷方法，**非**注册强制项。

## 三档模板

### 1) 简单 domain（1 文件）

- 适用：仅需轻量 `domainModelList` 调度，且无复杂统计/动画逻辑。
- 文件：
  - `domains/<id>/index.js`

### 2) 复合 domain（3 文件）

- 适用：需要较稳定的对象创建流程、默认 JSON、组装逻辑。
- 文件：
  - `domains/<id>/index.js`
  - `domains/<id>/<id>Factory.js`
  - `domains/<id>/<id>.js`（模板片段/常量）

### 3) 复合 + 统计/动画 domain（4 文件）

- 适用：除构建外，还包含统计视图、复杂动画、对象运维操作。
- 文件：
  - `domains/<id>/index.js`
  - `domains/<id>/<id>Factory.js`
  - `domains/<id>/<id>Handler.js`
  - `domains/<id>/<id>.js`

### 4) 嵌套子域（qualified id）

- 适用：父域下某一子能力需独立 JSON 命名空间或独立 `api`（如 `weather.rain`），且愿在 manifest 中单独注册。
- 文件：
  - `domains/<parent>/index.js` — 根域（可保留聚合 `resolveDomainModel`）
  - `domains/<parent>/<leaf>/index.js` — 子域，`id: "<parent>.<leaf>"`
  - 共享工厂可放在 `domains/<parent>/*Factory.js`，子域 `import` 委托
- 注册后执行 **`npm run generate:business-domain-manifest`**（递归扫描）。
- JSON：`{ "domain": "weather.rain", "objType": "domain", ... }`；**不要**写裸 `domain: "rain"`。
- API：**叶子段**命名 — `createRain` / `deployRain` / `createRainJson`（非 `createWeatherRain`）。
- 可选：`peerDomains: ["weather"]` 便于批量注册时拓扑排序；父域不必为纯包路径单独写空 `index.js`。

参考实现：[`domains/weather/rain/index.js`](../domains/weather/rain/index.js)、[`domains/weather/wind/index.js`](../domains/weather/wind/index.js)、命名空间 [`domains/weather/particle/index.js`](../domains/weather/particle/index.js)。

**脚手架**（仓库根目录）：

```bash
npm run generate:subdomain -- <parent-path> <leaf> [--namespace-only] [--force]
# 例：npm run generate:subdomain -- weather snow
# CLI：threejson generate subdomain weather snow
```

生成后自动执行 `generate:business-domain-manifest`（可用 `--no-manifest` 跳过）。

## 最小契约

- `api.createXJson`（推荐）：规范化输入，返回纯 JSON 结构；注册名须为 `create${PascalCase(leaf)}Json`（点分 id 时 `leaf` 为最后一段）。
- `api.createX`（**必须**）：`create${PascalCase(leaf)}`；通常 `createXJson` + builder，多数域返回 `THREE.Object3D`（少数域见 BUSINESS_DOMAINS「语义例外」）。
- `api.deployX`（**必须**）：`deploy${PascalCase(leaf)}`；通常 `scene.add(createX(...))` 或等价副作用部署。
- `index.js`：仅负责 descriptor（`id/defaultHandler/resolveDomainModel/api`）与调度，不承担大段业务实现。

## `index.js` 参考骨架

```js
import { createXJson, createX, deployX } from "./xFactory.js";

function resolveXDomainModel(record, scene, ctx) {
  const handler = record.handler ?? "createX";
  if (handler === "createX") {
    const items = Array.isArray(record.items)
      ? record.items
      : record.payload != null
        ? [record.payload]
        : [];
    for (const item of items) {
      deployX(item, scene, ctx);
    }
    return;
  }
  console.warn("[x] unsupported domainModel handler:", handler);
}

const xDomain = {
  id: "x",
  defaultHandler: "createX",
  resolveDomainModel: resolveXDomainModel,
  api: {
    createXJson,
    createX,
    deployX
  }
};

export default xDomain;
```

## 子域 `index.js` 参考骨架

```js
import { createRain, createRainJson, deployRain } from "../weatherFactory.js";

function resolveRainDomainModel(record, scene) {
  void deployRain(record, scene);
}

const weatherRainDomain = {
  id: "weather.rain",
  defaultHandler: "rain",
  peerDomains: ["weather"],
  resolveDomainModel: resolveRainDomainModel,
  api: {
    createRainJson,
    createRain,
    deployRain
  }
};

export default weatherRainDomain;
```

## 命名与一致性建议

- 统一使用单一、正确且稳定的 domain 命名。
- 命名调整时，同步修正页面、JSON、文档与调用方，避免同义别名并存。
