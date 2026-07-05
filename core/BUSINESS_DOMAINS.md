# 业务域与 `domainModelList`

调用者如果想快速理解 `domains/`、`domainModelList` 和自定义业务域的创建方式，建议优先阅读 [../doc/domains.md](../doc/domains.md)。本文更偏实现契约与内部设计说明。

**文档分层**：`core/` 与 `domains/` 为库；任意宿主（单对象 demo、RoomShow、场景编辑器等）均为平等消费者。本文不写「某编辑器专属」必选 API；宿主 UI 见各应用文档。

场景 JSON 的 `worldInfo` 可使用 **`domainModelList`** 统一描述「由哪个业务域、用哪个能力」创建内容，而无需在宿主里为每种业务写独立分支。

## Composition Root 与 core→domains 依赖

- **业务逻辑**（`sceneLoadHandler`、`businessDomainModelDispatch`）**不** `import` 具体 `domains/port` 等；只通过 **`record.domain` + `getDomain(id)`** 调度。
- **core 不 import domains**；内置域在 [`builtins/register.js`](../builtins/register.js) 注入（清单为 [`builtins/builtinDomainManifest.generated.js`](../builtins/builtinDomainManifest.generated.js)，`npm run generate:business-domain-manifest`）。
- **Mesh 部署**：[`deployMeshWithDomains`](./handler/businessDomainRegistry.js) / `deployMeshListWithDomains` — legacy 映射（如 `dockCrane`）**始终**走 `resolveDomainModel`；`sceneConfig.enableComposeBoxModel === true` 时才 `tryComposeBoxModel`，否则回退 `deployMesh`。
- **Friendly 列表**：保留 `boxModelList`、`sphereModelList`；另支持 **`meshList`**（`objType` 须为 `box` 或 `sphere`）。port 组合体请写 **`domainModelList`**（`objType: "domain"`, `domain`, `handler`）。

## 架构原则（ThreeJSON 契约）

**JSON 为王**  
权威数据来自场景 JSON。`core/` 与 `domains/` 作为解析与渲染管线：**只根据 JSON（及调用方传入的声明式参数）解析并呈现**，不把解析层当作可以改写权威 JSON 的归宿。涉及场景语义变化时，优先：**传入新的或修订后的 JSON 再走加载**；或通过 JSON 中的属性表达显隐与状态；或通过业务调度 **`invokeDomainModel` / `applyDomainModelsFromWorldInfo`**，明确 **`domain` + `handler`**（及 record 中的 `items` / `options` 等），且这些字段应尽量能追溯到 JSON 或上游配置。页面与演示代码避免散落硬编码业务流程（例如绕过调度器直接 import 域实现并写死一串专用步骤）。

**域自治**  
各 `domains/*` 彼此独立演进，不因「与另一域相似」而要求改造 `core/`。`core/` 只提供与具体业务无关的通用能力；域开发者自行决定是否使用。调用方对某一业务能力的通行方式仍是：**通过业务管理器传入业务类型（`domain`）与 `handler`**（[`businessDomains`](./handler/businessDomainRegistry.js) + [`invokeDomainModel`](./handler/businessDomainModelDispatch.js)）。业务专用的只读解析、统计辅助等留在各 `domains/*/index.js` 的 **`api`** 上，**不**作为 `core/index.js` 的独立导出堆叠。

**对外的两句话**  
要么 **拿 JSON 来**（加载 / 重载）；要么 **声明要对哪个 `domain` 做哪种 `handler`**（由调度器执行）。不在此两处之外的「悄悄改场景」应避免成为常态。

## 何时 `invoke` / `apply`，何时 `businessDomains.<id>`

| 调用者是否**事先知道**业务域 | 推荐方式 |
| ------------------------------ | ---------- |
| **不知道**（通用加载器、解析 `domainModelList`） | **`applyDomainModelsFromWorldInfo`** / **`invokeDomainModel`**，`domain` 来自 JSON。 |
| **知道**（如 RoomShow 只关心机柜、PortShow 只关心港口、集成方已选定 `box`/`wall`） | **`deployCabinet`**、**`createCabinetJson`** / **`createCabinet`**、**`createPortStatistics`**、**`deployWall`** 等 **`businessDomains.<id>` 的 `api`**。 |

二者都经同一套 manifest；`invoke` 适合 JSON 驱动，`api` 适合集成层「已选定 domain」的命令式调用。

## `create*Json` / `create*` / `deploy*`（域内约定）

与 [`modelBuilder.js`](./builder/modelBuilder.js) 中 **`createMesh` / `deployMesh`** 一致：**`deploy*`** = **`scene.add(create*(…))`**。

| 层级 | 职责 |
| ------ | ------ |
| **`create*Json`** | 纯数据。可选 **对象** 或 **JSON 字符串**；缺省用域内默认模板。机柜产出 **`createGroup` 用的组 JSON**；港口组合体产出 **港口工厂里的组 JSON**；box/wall/glass 产出 **`createMesh` 用的 mesh 描述对象**。 |
| **`create*`** | **`createGroup` / `createMesh`**：通常返回 **`THREE.Object3D`**（机柜 / 港口组合体为 **`Group`**；primitive 为 **Mesh / InstancedMesh**）。实现上 **`create* === f(create*Json(…))`**，装配逻辑不重复。 |
| **`deploy*`** | `const obj = create*(...); if (obj) scene.add(obj);`（或等价异步/副作用部署，见下表） |

### 注册时强制 API 命名

[`validateDomainDescriptor`](./handler/businessDomainRegistry.js)（`registerDomain` / `initBusinessDomains`）要求：

- **`api.create${PascalCase(leaf)}`**、**`api.deploy${PascalCase(leaf)}`** — `leaf` 为点分 `id` 的最后一段（如 `weather.rain` → `createRain`）；缺失则 **抛错**。
- **`api.create${PascalCase(leaf)}Json`** — 缺失则 **`console.warn`**。
- 点分 **子域**（如 `weather.rain`）须写全 qualified `id`；`getDomain("rain")` 在存在 `*.rain` 时返回 `null`；根域短 id（如 `port`）不受影响。
- **`resolveDomainModel`** 或 **`domainHandlers`** — 皆无则 **`console.warn`**。

单测：[`tests/businessDomainManifest.test.mjs`](../tests/businessDomainManifest.test.mjs)、[`tests/nestedDomainRegistry.test.mjs`](../tests/nestedDomainRegistry.test.mjs)。内置清单含根域 + 子域（如 `weather.rain`）。

### `create*` / `deploy*` 语义例外（仍满足注册函数名）

| `id` | 说明 |
|------|------|
| **nativeThree** | `createNativeThree` 返回加载描述（含 `modelPath`），非 Object3D；网格由 `deployNativeThree` / loader **异步** 加入场景。 |
| **sceneHighlight** | `createSceneHighlight` / `deploySceneHighlight` 部署 composer / pass，常返回 `null`；需 `ctx.composer` 等。 |
| **weather** | `createWeather` 返回 points 记录；`deployWeather` 为 **async**（`createPoints`）。风条带另用 `deployWindStrip` 等扩展 api。 |
| **weather.rain** | `createRain` / `deployRain`；粒子预设，委托 `weatherFactory`。 |
| **weather.wind** | `createWind` / `deployWind`；风条带，委托 `deployWindStrip`。 |
| **weather.particle** | 命名空间中间节点；无 `create/deploy`；不可 `invoke` 调度。 |

**composeBoxModel**（港口）：仍返回 **`THREE.Group`**，即 **`createPort(boxModel)`**（内部 **`createPortJson`** → **`createGroup`**），与 `tryComposeBoxModel` 契约一致。

## 交互与场景变更（示意）

例如机房/港口的统计视图：理想路径是 **更新或切换 JSON 后统一加载**，或 **在 `worldInfo.domainModelList`（或其它 JSON 字段）中声明要执行的 domain 记录** 再 `apply`；集成层在 RoomShow / PortShow 等固定语义页面可直接调用 **`businessDomains.device.cabinet.show*Stats`（单机柜）**、**`businessDomains.port.createPortStatistics`**，仍属于同一套域契约。

## JSON 条目形状

每条记录是一个普通对象，常用字段：

| 字段 | 说明 |
| ------ | ------ |
| `domain` | **必填**。与 [`domains/*/index.js`](../domains/cabinet/index.js) 导出 descriptor 的 `id` 一致（如 `cabinet`、`port`）。 |
| `handler` | **可选**。要调用的能力名。缺省时由各域的 `defaultHandler` 或 `resolveDomainModel` 内部约定决定（例如机柜域默认 `createCabinet`）。 |
| `items` | **可选**。由该域解释，多为对象数组（如多个机柜配置）。 |
| `payload` | **可选**。单条数据的简写，机柜域中等价于 `items: [payload]`。 |
| `options` | **可选**。附加选项（如统计类 API 的动画/样式参数）。 |

### 材质与远程贴图（box / sphere / mesh 描述）

场景中的盒、球、`heatList`/`wind` 平面、`objModelList`（OBJ）等与贴图相关的 JSON 字段约定：

- **首选 `textureUrl`**：在材质的 `textureUrl` 上填写可请求的 `http(s)`、`data:`、绝对路径或以 `./`/`../` 开头的相对路径。相对路径相对**当前页面的 origin**。AI 管线与工具链也以 `**/textureUrl` 为写入目标。
- **`textureKind`（贴图源类型）**：省略或 **`image`** 时走 **`TextureLoader`**（静态图；`.gif` 在 `image` 模式下仍为**首帧静态图**，不按多帧动画解码）。**`video`** 时走 **`THREE.VideoTexture`**，仍使用 **`textureUrl`** 作为视频地址；可选 **`videoMuted`**（默认 `true`，便于自动播放）、**`videoLoop`**（默认 `true`）、**`videoAutoplay`**（默认 `true`）、**`videoCrossOrigin`** / **`crossOrigin`**（跨域视频需服务端 CORS）。**`gif`** 时走 **`CanvasTexture`** + gifuct-js 解码动画，仍使用 **`textureUrl`**；可选 **`gifAutoplay`**（默认 `true`）、**`gifPlaybackRate`**（默认 `1`）、**`gifMaxFps`**（可选上限）。**OBJ `maps` 槽位**可在对应 map 对象上写 **`textureKind: "video"`** / **`gif`** 等相同字段。
- **`map` 字符串**：若为上述可识别 URL，`modelBuilder` 在 `image` 模式下会通过 `TextureLoader` 转成 `THREE.Texture`；若不是可识别 URL，仍会作为「非 Texture」被忽略，以避免无效占位对象导致运行时错误。**不要随意把非 URL 字符串写在 `map` 里冒充贴图路径。**
- **统计方柱标签（cabinet / port 运营 overlay）**：展示文案写在 mesh 描述符的 **`businessInfo.statLabel`**（可选 **`statKind`**）。`deployGroupDescriptor` / subScene 只传递可序列化字段；**`THREE.Texture` 由各 domain 在 deploy 完成后**根据 `userData.objJson.businessInfo.statLabel` **生成并赋给 `mesh.material.map`**，勿在 JSON 描述符上预挂运行时 `material.map`。
- **通用 stat 域（`stat.bar` / `stat.grid` / `stat.panel`）**：与 cabinet/port 业务 overlay **并行**；objType 使用 **`statBar` / `statGrid` / `statPanel`** 等，避免与 `capacity|bear|rackSpace` teardown 冲突。JSON：`domainModelList` + `domain: "stat.bar"` 等。教程 Track 6。
- **stat.chart + extensions/stat-echarts**：2D 图表走 CSS3D 面板 + optional peer **`echarts`**；实现不在 core。
- **CORS**：跨域图片来自其他站点时，需图片服务器返回允许当前源的 CORS（常见为 `Access-Control-Allow-Origin`）。本项目里 **`objModelList`/`nativeThree`** 记录在解析时可传 `crossOrigin`（见 [`nativeObjectLoader.js`](./builder/nativeObjectLoader.js) 中 `loadThreeNativeObjectJsonFromUrl`、`parseThreeNativeObjectJsonAndAdd`）。纹理加载可走 `setModelLoadingManager` 挂载的 LoadingManager。
- **`merge`** 几何与 **`joins`/`inters`/`holes`**：`materialArr` 与各 CSG 子块也会应用与六面盒一致的 `textureUrl` / 可解析 URL 的 `map` 字符串处理（参见 `ensureMaterialTextureFromJson`）。
- **原生 Three `ObjectLoader` JSON** 离线导出：`embedPortableImageUrlsIntoThreeExportJson` 仅对 **`http(s)` / `//` / `blob:`** 等「脱离原站后通常不可用」的 `images[].url` 尝试替换为与克隆场景内存贴图一致的 **data URL**；**采集失败时保留原 URL**，不再写入占位透明 PNG。相对路径、`data:` 等保持原样。视频 / 显式 GIF 动画贴图通常无法进入该「静态 Image 内嵌」路径，导出 JSON 里仍以 URL 为主。
- **`gifuct-js`（显式 `textureKind: "gif"`）**：浏览器示例页需在 import map 中声明 **`gifuct-js`**（与仓库根 `package.json` 的 `dependencies` 版本一致；示例 HTML 使用 `https://esm.sh/gifuct-js@…` 解析裸说明符）。

**安全**：`handler` 只会被解析为已注册的 `domainHandlers` 键，或由域内 `resolveDomainModel` 分支处理；不会把任意字符串当代码执行。

## Core API（仅通用调度）

- `applyDomainModelsFromWorldInfo(scene, worldInfo, ctx?)`：读取 `worldInfo.domainModelList` 并调度。
- `applyDomainModelList(scene, domainModelList, ctx?)`：直接对数组调度。
- `invokeDomainModel(scene, record, ctx?)`：单条记录便捷入口，内部等价于长度为 1 的 `applyDomainModelList`。
- `businessDomains`：按域 id 访问各域 `api`（见 [`businessDomainRegistry.js`](./handler/businessDomainRegistry.js)）。

上述从 [`core/index.js`](./index.js) 导出。未知 `domain` / 不支持的 `handler` 会在控制台 `console.warn`。

**领域 `api`（经 `businessDomains.cabinet` / `businessDomains.port` 调用，实现只在 `domains/`）示例**：

- **device.cabinet**：**`createCabinetJson`** / **`createCabinet`** / **`deployCabinet`**；统计视图使用单机柜 API：`showCapacityStats` / `showLoadStats` / `showRackSpaceStats` / `clearCabinetStatView`。
- **port**：**`createPortJson`** / **`createPort`** / **`deployPort`**；`countPortStatisticsAnchors`、`createPortStatistics` 见 [`domains/port`](../domains/port/index.js)。
- **stat**（子域 **`stat.bar`** / **`stat.grid`** / **`stat.panel`** / **`stat.chart`**）：**`createBar`** / **`deployBar`** 等（叶子段命名）；见 [`domains/stat`](../domains/stat/index.js) 与 [`extensions/stat-echarts`](../extensions/stat-echarts/README.md)。
- **box** / **wall** / **glass**：**`createBoxJson`**（及 **`createWallJson`**、**`createGlassJson`**）+ **`create*`** + **`deploy*`**；`addToScene` 仍为便捷封装。`domainModelList` 中 `handler` 缺省为 **`addToScene`** 时由 `resolveDomainModel` 调度。

**name/label 约定补充**：机柜统一 `name: "cabinet"`（用于 `getObjectsByName` / 批量显隐），差异化文案放 `label`（如“机柜13”）。`threeJsonId` 仍是持久主键，`refName` 为可选编程别名。

### device 域 — `devicePanelRef` 绑定契约

设备 record（UPS、空调、机柜等）绑定信息面板时，运行时 **`devicePanelRef`** = 所绑定面板的 **`threeJsonId`**（唯一真源；方式 2/3 deploy 后回填到 `objJson`）。

**三种方式（优先级 ref > info > infoPanel）**：

1. **`devicePanelRef` 非空** — 引用已有面板 id；不 subScene deploy 内嵌面板。
2. **无 ref，有 `info` 简写** — 生成 sprite 面板，id 默认 `${device.threeJsonId}__infoPanel`，回填 `devicePanelRef`。
3. **无 ref、无 info，有 `infoPanel`** — 完整 descriptor，回填 `devicePanelRef`。

**`devicePanelRef` 写错：仅 warn，不 fallback。** 只要写了非空 `devicePanelRef`，resolver **只走方式 1**，同 record 的 `info` / `infoPanel` **一律忽略**。ref 在 registry 中不存在时输出 `[device] devicePanelRef not found: …`；**不会** fallback 到内嵌 `infoPanel`，**不会**自动 deploy 内嵌面板。请修正 ref 或删除 `devicePanelRef` 以启用方式 2/3。

API：`businessDomains.device.resolveDevicePanelRef`、`showDevicePanel`、`bindDevicePanelTriggers` 等。详见 [doc/api.md § domains/device](../doc/api.md#domainsdevice-设备面板)。

## 注册新业务域

1. 在 `domains/<name>/index.js` 导出默认描述符：`id`、`api`，以及 **`resolveDomainModel(record, scene, ctx)`** 和/或 **`domainHandlers`**、**`defaultHandler`**（见 [`businessDomainRegistry.js`](./handler/businessDomainRegistry.js) 的 JSDoc）。
2. 在仓库根目录执行 **`npm run generate:business-domain-manifest`**，更新 [`builtins/builtinDomainManifest.generated.js`](../builtins/builtinDomainManifest.generated.js)（勿手改）。
3. 可选：在 [`builtins/userDomainDescriptors.js`](../builtins/userDomainDescriptors.js) 覆盖同 `id` 或追加域；应用默认 **`import { ... } from 'threejson'`**（或仓库内 `./builtins/full.js`）。仅 `threejson/core` 时需 **`import 'threejson/builtins/register'`**。

## 与 `boxModelList` / port 域

Port 组合体应写在 **`worldInfo.domainModelList`**（`handler`: `dockCrane` | `rtgCrane` | `portLampPost` | `berthShip`）。`boxModelList` 中同名 `objType` 仅作友好编写糖，normalizer 会改写为 `domain` 记录。

**port 域的 `domainModelList`（非 box 流水线）** 当前支持：

| `handler` | 说明 |
| ----------- | ------ |
| `createPortStatistics` | 根据根 JSON 的 `worldInfo.boxModelList` 与锚点 `businessInfo` 叠加吞吐/负载/堆场条（与机柜统计命名：`options.statType` 为 `capacity` \| `bear` \| `rackSpace`）。 |

调用 **`invokeDomainModel` / `applyDomainModelList`** 且 **`handler: 'createPortStatistics'`** 时须传入 **`ctx`**，且包含 **`sceneJsonRoot`**（或 **`jsonData`**）：完整场景根对象（与 `createPortStatistics` 第一个参数一致）。调度返回后可在 **`ctx.lastPortStatCount`** 读取成功叠加数量（由 port 域写入）。若在集成层已选定港口域，也可直接 **`businessDomains.port.createPortStatistics(sceneJsonRoot, scene, statType)`**，其 **返回值为** 成功叠加的锚点数量（与写入 `ctx.lastPortStatCount` 的值一致）。

**说明**：port 域 **`resolveDomainModel` 要求显式填写 `handler: 'createPortStatistics'`**，不会仅凭 `domain: 'port'` 默认执行统计，以免与仅作为业务标记的条目混淆。

## 兼容与硬编码

- 仓库内若干**宿主应用**（如 RoomShow、PortShow、场景播放器/编辑器）已改用 **`worldInfo.domainModelList`**（`domain: 'cabinet'`），不再使用 **`worldInfo.cabinetList`**。其它后端接口若仍使用旧字段需同步改造。
- **代码中** 仍可绕过 JSON，直接调用 `businessDomains.<id>.<method>(...)`。

## 运行时变更契约（二期，与注册 API 分开）

编辑态宿主（任意应用）若需统一增删改/撤销，见 [lab/domain-runtime-mutation-contract-memo.md](../lab/domain-runtime-mutation-contract-memo.md) 与 [doc/runtime-object-mutation-quickref.md](../doc/runtime-object-mutation-quickref.md)。**未**纳入 `validateDomainDescriptor`。

**待审计 gap（备忘）**：见 [lab/domain-runtime-mutation-contract-memo.md](../lab/domain-runtime-mutation-contract-memo.md) §待改进 domain。
