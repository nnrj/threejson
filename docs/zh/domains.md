[中文](./domains.md) | [English](../en/domains.md)

# 业务域与 `domains/`

[中文](./domains.md) | [English](../en/domains.md)

本页面向 ThreeJSON 的调用者与扩展者，说明项目里的业务域（domain）是什么、何时该用、以及如何创建自己的 domain。

如果你只想“按 JSON 渲染一个普通盒子/球体/组合/外部模型”，优先看 [JSON 配置手册](./json-format.md) 与 [核心 API](./api.md)。如果你希望把某类业务对象封装成可复用能力，或希望通过友好 JSON 的 `worldInfo.domainModelList`、或标准 JSON 的 `objType: "domain"` 记录做统一调度，就需要关注 `domains/`。

补充说明：`domains/` 下还保留了一份实现侧说明 [domains/BUSINESS_DOMAINS_ZH.md](../../domains/BUSINESS_DOMAINS_ZH.md)。本文更偏调用者与扩展入口；后者更偏内部契约与设计说明。

## 文档分层（库 vs 应用）

`core/` 与 `domains/` 是**底层库**；任意 HTML 页、演示、RoomShow、场景编辑器等都是**宿主应用**，地位相同（例如「只渲染一个立方体」与「完整编辑工具」都同样 `import` 本库）。

- 本文与 [domain-scaffold.md](./domain-scaffold.md)、[BUSINESS_DOMAINS.md](../../domains/BUSINESS_DOMAINS_ZH.md) 描述的是**库契约**，默认读者为**集成方 / 通用加载器**。
- **依赖方向**（core 可改、禁止反向依赖、宿主不进 core）见 [design-principles.md §依赖方向](./design-principles.md#依赖方向coredomains-宿主)。
- 某宿主自带的 UI（模型面板、工具栏、撤销栈等）属于**应用文档**（如 [editor-selection.md](./editor-selection.md)），**不是** domain 注册时的必选 API。
- 部分 domain 在 `api` 上提供 `addToScene` 等便捷方法，供 `domainModelList` 的 `handler` 或宿主**自愿**调用；未提供也不影响注册。

## 什么是 domain

可以把 domain 理解为“挂在 ThreeJSON 上的一类业务扩展模块”。每个 domain 都是 `domains/<name>/index.js` 导出的一个描述符（descriptor），用于回答这些问题：

- 这个业务域的 id 是什么。
- 它是否能把某些 `boxModel` 组合成更复杂的 `Object3D`。
- 它如何响应友好 JSON 的 `worldInfo.domainModelList`，以及标准 `objType: "domain"` 记录。
- 它额外暴露哪些可直接调用的 API。

内置 domain 通过清单注册（运行时仍为静态 import，**不会在浏览器里扫描目录**）。多数应用只需：

```js
import { createJsonScene, door } from "threejson";
```

（npm 主入口已注册内置域。）  
克隆仓库 HTML：在 import map 中设 `"threejson": "/builtins/full.js"` 后 `import { ... } from "threejson"`，或拆开 `core/index.js` + `builtins/register.js`（见 [`examples/html-demo/README.md`](../../examples/html-demo/README.md)）。  
仅在使用 **`threejson/core`** 且需自行控制注册顺序时，再 `import "threejson/builtins/register"`。

清单与合并逻辑位于：

- [../builtins/builtinDomainManifest.generated.js](../../builtins/builtinDomainManifest.generated.js)：**发布前 / 开发时**由脚本**递归**扫描 `domains/**/index.js` 生成（勿手改）；descriptor 的 `id` 应与目录路径一致（如 `domains/weather/rain` → `id: "weather.rain"`）。
- [../builtins/userDomainDescriptors.js](../../builtins/userDomainDescriptors.js)：手写覆盖或补充；与生成清单 **同 `id` 时以用户为准**，仅出现在用户清单中的域会 **追加在末尾**。
- [../builtins/register.js](../../builtins/register.js)：合并上述清单并调用 `initBusinessDomains`。

**维护者**在仓库根目录执行 **`npm run generate:business-domain-manifest`** 可重新生成 `generated` 文件。新增标准布局的 domain（`domains/<name>/index.js`）后，一般只需跑该命令。新增**子域**可先跑 **`npm run generate:subdomain -- <parent> <leaf>`**（或 `threejson generate subdomain …`）生成 `index.js` 模板，再补工厂逻辑。**终端用户**安装 npm 包后无需跑该命令。

### 第三方 domain（npm + CLI）

1. `npm install @acme/threejson-domain-warehouse`
2. 包内 `package.json` 建议声明：

```json
{
  "threejson": {
    "domain": "./index.js",
    "domainId": "warehouse"
  }
}
```

3. 在用户工程根目录：`npx threejson add-domain @acme/threejson-domain-warehouse`  
   会安装依赖并写入 **`threejson.domains.mjs`**（及可选 **`threejson.bootstrap.mjs`** 片段）。
4. 应用入口（顺序重要）：

```js
import "./threejson.bootstrap.mjs"; // 可选：builtins + 第三方域
// 或：import { createJsonScene } from "threejson"; import "./threejson.domains.mjs";
```

> **备注（npm 包 `threejson@0.1.x`）**：当前 registry 上的 **`threejson` 运行时包不含 CLI**（无 `bin`）。使用 `npx threejson add-domain` 需 **clone 本仓库** 并在本地链接 [`tools/threejson-cli/`](../../tools/threejson-cli/cli.mjs)，或手写 **`threejson.domains.mjs`** 调用 `registerDomain`；CLI 计划在后续版本或独立 npm 包提供。

## 什么时候该用业务域

适合引入 domain 的场景：

- 你想把一类业务对象封装成固定入口，而不是在页面里手写一堆 Three.js 组装逻辑。
- 你希望场景 JSON 只声明“做什么”，再由运行时统一调度，例如 `domain: "nativeThree"`、`domain: "cabinet"`。
- 你希望页面在“知道自己正在操作哪个业务域”时，可以通过 `businessDomains.<id>.*` 直接拿到该域 API。
- 你需要让某些 `boxModelList` 项自动升级成复合模型，而不是简单 `deployMesh()`。

不适合专门建 domain 的场景：

- 只是新增一个普通盒子、球体、线条、热力图或外部模型 JSON。
- 只是个别页面的一次性手写效果，没有复用价值。

## 三种常见入口

### 1. `domainModelList` / 标准 `objType: "domain"` 记录

这是最通用、最“JSON 驱动”的方式。作者可以在友好 JSON 里写 `worldInfo.domainModelList`，也可以直接在标准 `objectList` 里写 `objType: "domain"` 记录；页面本身不需要提前知道具体业务细节，只需要把记录交给调度器：

```js
import { applyDomainModelsFromWorldInfo } from "../core/index.js";

applyDomainModelsFromWorldInfo(scene, worldInfo, ctx);
```

标准记录一般长这样：

```json
{
  "objType": "domain",
  "domain": "nativeThree",
  "handler": "loadFromUrl",
  "modelPath": "/assets/json/three_native.json",
  "position": { "x": 0, "y": 0.5, "z": 0 }
}
```

常见字段：

| 字段 | 说明 |
| ------ | ------ |
| `objType` | 固定写 `"domain"`，表示进入业务域系统。 |
| `domain` | 必填。要调度到哪个业务域。 |
| `handler` | 可选。该域内部的能力名。若省略，则由域的 `defaultHandler` 或 `resolveDomainModel()` 决定。 |
| `items` | 可选。批量输入，含义由该域解释。 |
| `payload` | 可选。单条输入的简写。 |
| `options` | 可选。附加参数。 |

在友好 JSON 中，同等语义通常写成：

```json
{
  "worldInfo": {
    "domainModelList": [
      {
        "domain": "nativeThree",
        "handler": "loadFromUrl",
        "modelPath": "/assets/json/three_native.json"
      }
    ]
  }
}
```

统一加载入口会先把 `domainModelList` 翻译成标准 `objType: "domain"` 记录，再进入同一调度链。

### 2. `invokeDomainModel(scene, record, ctx)`

它等价于对单条 `domainModelList` 记录调度一次，适合在代码里临时触发某个 domain 行为：

```js
import { invokeDomainModel } from "../core/index.js";

invokeDomainModel(scene, {
  objType: "domain",
  domain: "nativeThree",
  handler: "loadFromUrl",
  modelPath: "/assets/json/three_native.json"
});
```

### 3. `businessDomains.<id>.*`

如果页面**事先就知道**自己只关心某个业务域，也可以直接调用该域公开的 API：

```js
import { businessDomains } from "../core/index.js";

businessDomains.port.createPortStatistics(sceneJsonRoot, scene, "capacity");
```

这种方式更像命令式调用；而 `domainModelList` 更偏声明式编排。两者并不冲突，底层都来自同一套 domain 注册清单。

子域同样可用链式或 bracket 访问：

```js
businessDomains.weather.rain.deployRain(record, scene);
businessDomains["weather.wind"].deployWind(record, scene);
```

根域 api 键优先于同名子段导航（例如 `weather` 上若有 `api.child` 函数，则 `.child` 不会进入子 Proxy）。

## 嵌套子域（qualified id）

v1 起，core 支持 **点分 qualified id**，类似 Java 包名：

| 概念 | 示例 |
|------|------|
| 根域 | `weather` → `domains/weather/index.js` |
| 子域 | `weather.rain` → `domains/weather/rain/index.js` |
| JSON 调度 | `{ "domain": "weather.rain", "objType": "domain", ... }` |
| API 命名 | 按 **叶子段**：`createRain` / `deployRain`（非 `createWeatherRain`） |

要点：

- **`getDomain("rain")`** 在已注册 `weather.rain` 等时返回 `null`；须写全路径 **`weather.rain`**。根域短 id（`port`、`cabinet`）不受影响。
- **父目录不必为每个包层写 `index.js`**：仅有 `weather/rain/index.js` 时，`businessDomains.weather.rain` 仍可用；未注册的中间前缀（如将来的 `weather.particle`）可仅靠 Proxy 导航，但 **`invokeDomainModel` 不能指望对纯包路径部署物体**（会 warn）。
- **根域与子域可并存**：`weather` 根域继续处理 `handler: "snow"` 等；`weather.rain` / `weather.wind` 为独立 manifest 条目。教程见 [`02-03-weather-domain.html`](../../examples/html-demo/track-02-visual-fx/02-03-weather-domain.html)（根域）与 [`05-02-nested-domain.html`](../../examples/html-demo/track-05-tooling/05-02-nested-domain.html)（点分 id）。
- **第三方域**：`threejson.domains.mjs` 与内置域使用同一 `registerDomain`；子域 id 也可被用户清单同 id 覆盖。

实现备忘：[`lab/nested-domain-memo.md`](../../lab/nested-domain-memo.md)。

## Domain 描述符结构

业务域描述符的核心契约在 [../core/handler/businessDomainRegistry.js](../../core/handler/businessDomainRegistry.js) 中定义。`initBusinessDomains` / `registerDomain` 会调用 **`validateDomainDescriptor`**：

| 检查项 | 级别 |
|--------|------|
| `id`（字符串，点分各段为 camelCase）、`api`（对象） | **必须**，否则抛错 |
| `api.create${PascalCase(leaf)}`、`api.deploy${PascalCase(leaf)}` | **必须**，否则抛错（`leaf` 为 id 最后一段：`nativeThree` → `createNativeThree`；`weather.rain` → `createRain`） |
| `api.create${PascalCase(leaf)}Json` | **推荐**，缺失时 `console.warn` |
| `resolveDomainModel` 或 `domainHandlers` | 可部署域 **推荐**；二者皆无则 `console.warn` |
| 无 `create/deploy` 的纯命名空间 descriptor | **允许**，`console.warn`；不可被 `invokeDomainModel` 调度 |

`PascalCase(leaf)` 规则与 registry 内 `toPascalCase` 一致（见 [`domainId.js`](../../core/handler/domainId.js)、[`businessDomainRegistry.js`](../../core/handler/businessDomainRegistry.js)）。内置域清单见 [`builtinDomainManifest.generated.js`](../../builtins/builtinDomainManifest.generated.js)；契约单测见 [`tests/businessDomainManifest.test.mjs`](../../tests/businessDomainManifest.test.mjs)、[`tests/nestedDomainRegistry.test.mjs`](../../tests/nestedDomainRegistry.test.mjs)。

最常见的字段如下：

```js
const demoDomain = {
  id: "demo",
  defaultHandler: "addToScene",
  resolveDomainModel(record, scene, ctx) {
    // 推荐：由域自己解析 record
  },
  domainHandlers: {
    addToScene(record, scene, ctx) {
      // 可选：当你更喜欢按 handler 拆函数时使用
    }
  },
  composeBoxModel(boxModel, ctx) {
    // 可选：把某类 boxModel 转成复合 Object3D
  },
  api: {
    createDemoJson(overrides) {
      return { objType: "box", /* ... */ ...overrides };
    },
    createDemo(overrides) {
      return createMesh(createDemoJson(overrides));
    },
    deployDemo(overrides, scene) {
      const mesh = createDemo(overrides);
      if (mesh) scene.add(mesh);
    }
  }
};
```

### `resolveDomainModel` 和 `domainHandlers` 怎么选

- 推荐优先用 `resolveDomainModel(record, scene, ctx)`，由 domain 自己统一解释 record。
- 如果你的 handler 非常离散，或你更喜欢 `handler -> function` 的映射风格，再用 `domainHandlers` + `defaultHandler`。
- 两种方式都能被 `applyDomainModelList()` 调度；如果两者都存在，`resolveDomainModel()` 的优先级更高。

### `composeBoxModel` 是做什么的

`composeBoxModel(boxModel, ctx)` 不是给 `domainModelList` 用的，而是给 `worldInfo.boxModelList` 用的。

当页面通过 [`deployMeshWithDomains()`](../../core/handler/businessDomainRegistry.js) / `deployMeshListWithDomains()` 部署 mesh 形描述符时：若 `legacyBoxObjTypes` 命中则走 `invokeDomainModel`；若 `sceneConfig.enableComposeBoxModel === true` 则 `tryComposeBoxModel`；否则回退 `deployMesh()`。友好 JSON 另支持 **`meshList`**（`objType` 为 `box` 或 `sphere`），与 `boxModelList` / `sphereModelList` 并存。

**预设薄 domain**（[`domains/wall`](../../domains/wall/index.js)、[`domains/glass`](../../domains/glass/index.js)、[`domains/floor`](../../domains/floor/index.js)）：在 `boxModelList` 中写 `objType: "wall"` / `"glass"` / `"floor"` 即可，默认 **不必** 开 `enableComposeBoxModel`（靠 `legacyBoxObjTypes`）；玻璃可选 `glassKind`（`clear` | `tinted` | `frosted`）。输出材质统一为 `material.type: "standard"`。勿使用已废弃的 `material.type: "floor"`。

**天气域** [`domains/weather`](../../domains/weather/index.js)：粒子 `handler` — `rain` | `snow` | `sparkles` | `embers`（`createPoints`）；条带风 — `wind` | `coldWind` | `hotWind`（`deployWindStrip` → `createPlane` + UV 滚动）。友好列表 `windList` 仍写 `objType: "wind"`，与 `domainModelList` + `handler: "coldWind"` 等价。

**天气子域**（试点）：[`domains/weather/rain`](../../domains/weather/rain/index.js)（`domain: "weather.rain"`，`deployRain`）、[`domains/weather/wind`](../../domains/weather/wind/index.js)（`domain: "weather.wind"`，`deployWind`）。JSON 可写点分 id；根域 `weather` 仍兼容 `domain: "weather"` + `handler`（如 snow）。详见 [`05-02-nested-domain.json`](../../assets/json/tutorial/track-05/05-02-nested-domain.json)。

这就是为什么有些 domain 既支持 `domainModelList`，又支持 `boxModelList` 扩展。

## 先看最小示例：`nativeThree`

[../domains/nativeThree/index.js](../../domains/nativeThree/index.js) 是当前仓库里最接近“纯 `domainModelList` / `objType: "domain"` 调度”的示例。它不做 `composeBoxModel`，只负责把 domain 记录解析成 Three.js 原生 Object/Scene JSON 加载动作。

它的特点：

- `id` 是 `nativeThree`。
- 默认 `handler` 是 `loadFromUrl`。
- `resolveDomainModel()` 同时支持：
  - `handler: "loadFromUrl"`：从 `modelPath` 加载外部原生 JSON。
  - `handler: "parseInline"`：直接解析 `record.json` / `payload.json` / `items[0]` 里的对象图。

最小记录示例：

```json
{
  "objType": "domain",
  "domain": "nativeThree",
  "handler": "loadFromUrl",
  "modelPath": "/assets/json/three_native.json",
  "position": { "x": 0, "y": 0.5, "z": 0 }
}
```

如果你第一次接触业务域，建议先理解 `nativeThree` 这类“单入口、单职责”的 domain，再去看更复杂的 domain。

## 再看进阶示例：`port`

[../domains/port/index.js](../../domains/port/index.js) 是一个混合型 domain：

- 一方面，它通过 `composeBoxModel()` 接管旧 `boxModelList` 中部分历史业务 `objType`，把普通盒模型升级成港口组合体。
- 另一方面，它也支持 `domainModelList` 调度，但当前主要用于 `handler: "createPortStatistics"` 这种统计叠加能力。

这意味着 `port` 并不是“最小 custom domain”模板，而是“复杂 domain 的真实例子”。

### `port` 的 `domainModelList` 路径（规范）

在 [../assets/json/portShow.json](../../assets/json/portShow.json) 中，岸桥等设备以 **`domainModelList`** 声明（`name` 为 slug，`label` 为展示文案）：

```json
{
  "objType": "domain",
  "domain": "port",
  "handler": "dockCrane",
  "name": "dock-crane",
  "label": "岸桥1",
  "geometry": { "width": 70, "length": 90, "height": 280, "depth": 90 },
  "position": { "x": -80, "y": 2, "z": -250 },
  "businessInfo": {
    "deviceTypeCode": "crane",
    "portStatistic": true,
    "portStatMenu": "load",
    "usedLoad": 628,
    "totalLoad": 900
  }
}
```

### `port` 的 `boxModelList` 路径（legacy 编写糖）

历史友好 JSON 也可能在 `boxModelList` 写 `objType: "dockCrane"`；加载时会归一化为 domain 记录并走 `invokeDomainModel`。同样应使用 slug **`name`**（如 `dock-crane`）与 **`label`**（如 `岸桥1`），勿把中文文案写入 `name`。

### `port` 的统计叠加 `domainModelList` 入口

`port` 另有一条 `domainModelList` 入口，主要支持统计条叠加：

```json
{
  "objType": "domain",
  "domain": "port",
  "handler": "createPortStatistics",
  "options": { "statType": "capacity" }
}
```

这一能力通常还需要 `ctx.sceneJsonRoot` 或 `ctx.jsonData`，因为它要回头读取根 JSON 里的 `worldInfo.boxModelList` 与 `businessInfo` 锚点。

统计标签（`businessInfo.statLabel`）可选 `businessInfo.labelStyle`：

```json
{
  "businessInfo": {
    "statLabel": "628/900",
    "labelStyle": {
      "fontSizePx": 22,
      "autoFit": true,
      "fitRatio": 0.78,
      "minFontPx": 14,
      "maxFontPx": 72
    }
  }
}
```

`labelStyle` 用于港口/机柜统计条贴图文字（字号、自动适配、行距等），未配置时保持原默认样式。

所以如果你要写“如何创建自己的第一个 domain”，**不要只照着 `port` 学**；更好的顺序是：先学 `nativeThree` 的调度方式，再理解 `port` 这种混合型设计。

## 如何创建自己的 domain

下面给出一个建议流程。

### 第 1 步：决定你的 domain 属于哪种模式

先想清楚你的 domain 主要属于哪一类：

1. 只需要 `domainModelList` 调度。
2. 只需要 `composeBoxModel`，把特定 `boxModel` 变成复合对象。
3. 两者都需要。

如果只是第一类，先按最小 domain 来写即可。

### 第 2 步：新建 `domains/<name>/index.js`

最小骨架可以参考下面这个例子：

```js
import { createMesh } from "../../core/builder/modelBuilder.js";

function createDemoJson(overrides = {}) {
  return {
    name: "demo-domain-box",
    objType: "box",
    geometry: { width: 80, height: 80, depth: 80 },
    position: { x: 0, y: 40, z: 0 },
    material: { type: "lambert", color: "#67c23a" },
    ...overrides
  };
}

function createDemo(overrides) {
  return createMesh(createDemoJson(overrides));
}

function deployDemo(overrides, scene) {
  const obj = createDemo(overrides);
  if (obj) {
    scene.add(obj);
  }
}

function resolveDemoDomainModel(record, scene) {
  const payload =
    (record.payload && typeof record.payload === "object" ? record.payload : null) ??
    (Array.isArray(record.items) && record.items[0] ? record.items[0] : null) ??
    {};
  deployDemo(payload, scene);
}

const demoDomain = {
  id: "demo",
  defaultHandler: "addToScene",
  resolveDomainModel: resolveDemoDomainModel,
  api: {
    createDemoJson,
    createDemo,
    deployDemo
  }
};

export default demoDomain;
```

这个例子强调的是：

- `api` 给命令式调用用。
- `resolveDomainModel()` 给 `domainModelList` 用。
- `payload` / `items[0]` 可以作为 record 的输入来源。

### 第 3 步：注册到 manifest

推荐：在 `domains/demo/index.js`（或嵌套路径如 `domains/demo/part/index.js`，`id: "demo.part"`）就绪后，于仓库根目录执行 **`npm run generate:business-domain-manifest`**，脚本会递归扫描并更新 [../builtins/builtinDomainManifest.generated.js](../../builtins/builtinDomainManifest.generated.js)。

若需覆盖扫描结果中的某个 `id`，或域文件不在 `domains/<name>/index.js` 这一约定路径下，可在 [../builtins/userDomainDescriptors.js](../../builtins/userDomainDescriptors.js) 中维护 `userDomainDescriptors`，例如：

```js
import demoDomain from "../domains/demo/index.js";

/** @type {import("../core/handler/businessDomainRegistry.js").BusinessDomainDescriptor[]} */
export const userDomainDescriptors = [demoDomain];
```

合并逻辑见 [../builtins/register.js](../../builtins/register.js)。完成生成或用户清单配置后，运行时才能识别 `domain: "demo"`。

### 第 4 步：准备 JSON 记录

如果你的 domain 走 `domainModelList`，最小 world 片段可以是：

```json
{
  "threeJsonId": "domain-example",
  "worldInfo": {
    "boxModelList": [],
    "domainModelList": [
      {
        "domain": "demo",
        "payload": {
          "name": "demo-01",
          "position": { "x": 0, "y": 40, "z": 0 }
        }
      }
    ]
  }
}
```

如果你的 domain 走 `composeBoxModel`，则要准备一条能被该域识别的 `boxModelList` 记录，例如特定的 `objType`。

### 第 5 步：在页面里验证

最常见的验证方式有两种：

```js
import {
  applyDomainModelsFromWorldInfo,
  invokeDomainModel,
  businessDomains
} from "../core/index.js";
```

#### 验证 `domainModelList`

```js
applyDomainModelsFromWorldInfo(scene, jsonData.worldInfo, { jsonData });
```

#### 验证单条调度

```js
invokeDomainModel(scene, {
  domain: "demo",
  payload: { name: "demo-02", position: { x: 120, y: 40, z: 0 } }
});
```

#### 验证命令式 API

```js
businessDomains.demo.deployDemo({ name: "demo-03", position: { x: -120, y: 40, z: 0 } }, scene);
```

## 材质贴图：视频与 GIF（primitive / 平面 / OBJ maps）

与 [`modelBuilder.js`](../../core/builder/modelBuilder.js) 中 **`ensureMaterialTextureFromJson`** 及 OBJ **`maps`** 槽位约定一致：

| `textureKind` | 行为 |
| --------------- | ------ |
| 省略或 **`image`** | **`TextureLoader`** 加载静态图；`.gif` 仅**首帧**（不播动画）。 |
| **`video`** | **`THREE.VideoTexture`**，`textureUrl` 为视频地址；可选 `videoMuted` / `videoLoop` / `videoAutoplay` / `videoCrossOrigin`。跨域需 CORS；移动端注意解码与自动播放策略。 |
| **`gif`** | **`CanvasTexture`** + **gifuct-js** 解码并 rAF 更新；`textureUrl` 为 GIF 地址；可选 `gifAutoplay`（默认 `true`）、`gifPlaybackRate`（默认 `1`）、`gifMaxFps`。页面 import map 需映射裸说明符 **`gifuct-js`**（见根 `package.json` 与各示例 HTML）。跨域 GIF 需 `fetch` CORS。 |

---

## 自定义 domain 的实践建议

- **`create*Json` / `create*` / `deploy*`**：注册时强制 `create${PascalCase(leaf)}` / `deploy${PascalCase(leaf)}`（点分 id 取最后一段）；语义上仍按「纯数据 → Object3D（或等价结果）→ `scene.add` / 副作用部署」分层，见 [BUSINESS_DOMAINS.md](../../domains/BUSINESS_DOMAINS_ZH.md) 中的**语义例外**说明。
- 入口 `index.js` 专注 descriptor、`resolveDomainModel` 与 `api` 暴露；复杂动画、统计视图、对象运维操作优先下沉到 `*Handler.js`。
- 脚手架建议按复杂度分级：简单 domain（1 文件 `index.js`）、复合 domain（3 文件：`index.js` + `*Factory.js` + 模板文件）、复合+统计 domain（4 文件：再加 `*Handler.js`）。
- 先把 domain 写成“小而完整”的单一职责模块，再考虑做成像 `port` 那样的混合型 domain。
- 优先让 `resolveDomainModel()` 接受声明式 record，避免宿主层散落过多 if/else。
- 如果某个能力依赖根 JSON、加载管理器或其它运行时上下文，请明确约定 `ctx` 需要哪些字段。
- 即使主要暴露命令式 `api`，也建议保留 `domainModelList` 调度入口，便于 JSON 驱动加载与其它宿主复用。
- 编辑态宿主若需统一增删改，见 [runtime-object-mutation-quickref.md](./runtime-object-mutation-quickref.md) 与 [lab/domain-runtime-mutation-contract-memo.md](../../lab/domain-runtime-mutation-contract-memo.md)（与 domain 注册 API 分开）。

## 相关文档

- [JSON 配置手册](./json-format.md)：`worldInfo`、`domainModelList` 与其它对象 JSON 的写法。
- [核心 API](./api.md)：`applyDomainModelsFromWorldInfo()`、`invokeDomainModel()`、`businessDomains` 等入口。
- [Domain 脚手架模板](./domain-scaffold.md)：按 1/3/4 文件分级的创建模板与最小契约。
- [演示页面说明](./demos.md)：可结合 [`examples/html-demo/track-03-assets/03-03-native-three-domain.html`](../../examples/html-demo/track-03-assets/03-03-native-three-domain.html)、`port-show.html` 理解不同 domain 的接入方式。
- [嵌套子域演示](../../examples/html-demo/track-05-tooling/05-02-nested-domain.html)：`weather.rain` / `weather.wind` 点分 id 与 `businessDomains` 链式 API。
- [domains/BUSINESS_DOMAINS_ZH.md](../../domains/BUSINESS_DOMAINS_ZH.md)：更偏实现与设计约束的补充说明。
