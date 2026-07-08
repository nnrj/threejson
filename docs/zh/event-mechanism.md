[中文](./event-mechanism.md) | [English](../en/event-mechanism.md)

# 事件机制与 EventScript

[中文](./event-mechanism.md) | [JSON 配置](./json-format.md) | [核心 API](./api.md) | [Demo t04-09](../../examples/html-demo/track-04-interaction/04-09-event-mechanism.html)

ThreeJSON **Phase 1 事件机制**（core `runtime/eventMechanism/`）让对象 JSON 上的 `events` 块在运行时绑定到平台事件，并执行 **EventScript**（默认 DSL）或可选的 **JavaScript** 脚本。本文分两章：**事件机制用法**与 **EventScript 语法**。

> 产品级编辑器工作区（多标签脚本 IDE 等）见 [lab/scene-editor-event-script-workspace-v2-memo.md](../../lab/scene-editor-event-script-workspace-v2-memo.md)（`deferred`，依赖本文所述 Core 运行时）。

---

## 一、事件机制（使用方法）

### 1.1 架构概览

| 组件 | 职责 |
|------|------|
| **EventBindingRegistry** | 记录 `(threeJsonId, eventName) → binding` |
| **EventListenerManager（ELM）** | 按绑定 refcount **惰性**挂载 DOM 监听；收到平台事件后分发 |
| **bindEventsFromScene** | 遍历场景，读取 `userData.objJson.events` 并注册 binding |
| **bindSceneEventRuntime** | 场景级入口：`bind` + `rebind` + `dispose` |
| **CoreActionExecutor** | 执行 binding 中的 JSON `action` / `actions` |
| **CoreBindingExecutor** | 执行 binding 中的 EventScript / JavaScript |

**执行顺序（同一对象、同一事件）**：先执行 domain 自己注册的 **domain-only binding**（`executeBoundEvent`），再执行 JSON **actions**，再执行 **script**，最后执行 runtime `handler`。JSON action/script 挂在 domain 对象上时，不会重复调用 `executeBoundEvent`。

### 1.2 JSON：`events` 块

在任意可部署对象的 record 上增加 `events`（与 `geometry`、`material` 并列）：

```json
{
  "threeJsonId": "event-demo-box",
  "objType": "box",
  "events": {
    "click": {
      "script": "self.moveBy(-30, 0, 0)\nawait wait(400)\nself.moveBy(30, 0, 0)"
    }
  }
}
```

**声明式 action 与脚本**：

简单交互优先使用 `action` / `actions`，复杂逻辑继续使用 `script`。二者可以共存，固定 **action 先执行，script 后执行**。不写 action/script 的用户无需配置这些字段。

```json
{
  "events": {
    "click": {
      "action": { "type": "object.toggleVisible", "target": "panel-1" },
      "script": "await wait(300)\nself.moveBy(1, 0, 0)"
    },
    "dblclick": {
      "actions": [
        { "type": "object.moveBy", "delta": { "x": 1, "y": 0, "z": 0 } },
        { "type": "object.setVisible", "target": "panel-1", "visible": true }
      ]
    }
  }
}
```

`action` 是单个动作的简写，内部会转为 `actions: [action]`；若同时写 `action` 与 `actions`，`action` 会作为最终 actions 数组的第一条。`target` 默认 `self`。单个 action 默认 fail-fast；可写 `continueOnError: true` 让该 action 失败时只记录错误并继续后续 action/script。

内置对象 actions：`object.setVisible`、`object.toggleVisible`、`object.moveBy`、`object.setPosition`、`object.rotateBy`、`object.setRotation`、`object.scaleBy`、`object.setScale`、`object.patch`。`object.patch` 默认同步/defer，不 await textures；仅显式 `options.awaitTextures: true` 时等待异步贴图/材质同步。

domain action 由各 domain 自己注册，例如 device domain 可提供 `device.showPanel` / `device.hidePanel` / `device.togglePanel`；door domain 提供 `door.toggle`。core 不 import 具体 domain。

**脚本来源（三选一，优先级如下）**：

| 字段 | 说明 |
|------|------|
| `scriptUrl` | HTTP(S) URL 或 `lib://token`（见 `assetLibrary` 中 `assetKind: "eventScript"`） |
| `script` | 内联 EventScript 文本 |
| （均无） | 仅有 action 时仍绑定；无 action 时不绑定 |

`scriptUrl` 与 `script` 同时存在时，**仅使用 `scriptUrl`**。

**不支持（会被校验拒绝并打 warn 日志）**：

- `events.*.handler` 字符串（旧 L3 形态）
- `events.*.{ domain, handler }` 组合

业务域触发仍走 domain 自己的 `bindSceneEvents` / `executeBoundEvent`，不在 `events.handler` 字符串里配置。

完整 tutorial 示例：[assets/json/tutorial/track-04/04-09-event-mechanism.json](../../assets/json/tutorial/track-04/04-09-event-mechanism.json)。

### 1.3 平台事件名

Core 仅识别下列 **platform event**（见 `platformEvents.js`）：

| 事件名 | 典型来源 |
|--------|----------|
| `click` | 指针单击（需宿主 raycast 或 ELM `host` 拾取） |
| `dblclick` | 双击 |
| `pointerdown` / `pointerup` | 指针按下/抬起 |
| `pointerover` / `pointerout` | 对象级 hover enter/leave；默认 canvas raycast host 通过 `pointermove` 状态机合成 |
| `keydown` / `keyup` | 键盘（挂 document） |
| `scene.ready` | 场景 bind 完成后由 `bindSceneEventRuntime` 主动 dispatch |
| `scene.dispose` | 场景 teardown 前由事件机制主动 dispatch；脚本/action 报错只记录并继续真实清理 |
| `object.ready` | 批量 load 时 bind 后 replay；动态部署时对象 deploy 完成后 dispatch |
| `object.dispose` | 显式 async 删除入口在全量 dispose 前 dispatch；`detachOnly` 不触发 |

域扩展 **不得** 向平台 catalog 注册新名字；域专用信号在 domain 层处理。

### 1.3.1 单对象 lifecycle 与场景 load 的区别

| 机制 | 粒度 | 典型用途 |
|------|------|----------|
| `load:onSceneReady` / `scene.ready` | 整场景 | 扩展 bootstrap、全局 wiring |
| `object.ready` / `object.dispose` | 单条 deploy record（有 `threeJsonId`） | 对象创建后/销毁前脚本或宿主 hook |

**JSON 可选**：不写 `events["object.ready"]` / `events["object.dispose"]` 时行为与以前一致。批量 `createJsonScene` 时，若 JSON 声明了 `object.ready`，ELM bind 完成后会对已有 binding **补发一次**（replay），宿主 `onObjectDeployed` 不重复触发。场景 ready 之后动态部署带 `object.ready` 的纯 JSON record 时，会先绑定该 record 的 JSON events，再即时 dispatch `object.ready`；同步部署 API 仍保持同步返回，ELM 脚本作为异步副作用执行。

**显式开启 lifecycle**（可选，默认关闭）：当分片合并、懒加载等导致静态扫描不到 `object.ready` / `object.dispose` 绑定时，可在 JSON 或 `createJsonScene` 选项中强制启用场景级 lifecycle 上下文（保证 bind 后 replay 链路可用；不自动作用于 ad-hoc `deployJsonObject`）：

```json
{
  "sceneConfig": {
    "interaction": {
      "enableObjectLifecycle": true
    }
  }
}
```

```js
await createJsonScene(payload, { enableObjectLifecycle: true });
```

JS 选项优先于 JSON。动态单对象部署也可通过 `_objectLifecycle: createObjectLifecycleContext({ bindSceneEvents: true, ... })` 注入；若 record 自身声明了 `object.ready` / `object.dispose`，运行时会按需创建 lifecycle context（见 [t04-10](../../examples/html-demo/track-04-interaction/04-10-object-lifecycle.html)）。

**宿主 hook（可选）**：`createJsonScene(..., { onObjectDeployed, onObjectBeforeRemove, onObjectBeforeCreate?, onObjectDeployFailed? })`。

**删除 API 边界**：`removeObjectById()` 保持同步，只执行同步删除与可同步的宿主前置 hook，不等待 JSON `object.dispose` 脚本。需要完整 `object.dispose` ELM/script 的调用方使用 `await removeObjectByIdAsync(scene, id, options)`；该入口会在 `disposeObjectTree` 前 dispatch，且 `detachOnly` / `disposeResources: false` 不触发。

完整 lifecycle 示例：[t04-10](../../examples/html-demo/track-04-interaction/04-10-object-lifecycle.html) · [JSON](../../assets/json/tutorial/track-04/04-10-object-lifecycle.json)。

### 1.3.2 ELM 射线拾取与 `pickThroughRaycast`

默认 canvas raycast host（`createCanvasRaycastEventHost`）在 dispatch 平台事件时：

1. 取射线交点列表，对当前 `eventName` 解析 binding；
2. **未声明** `pickThroughRaycast` 时与「最近交点 + `resolveThreeJsonIdFromPick` 链上冒泡」一致；
3. 若交点处于 `pickThroughRaycast: true` 的**最近容器根**后代内且无 binding，则在该根**内部**继续扫描；命中 binding 则返回；**离开该根**后不再用根外 binding（避免误触后方对象）；
4. 根外 first hit（墙体等）仍阻挡。

字段为 subScene 容器可选描述符，默认 `false`。`device.cabinet` 在 deploy 时 runtime 写入 `pickThroughRaycast: true`（机柜门 sibling binding）。JSON 配置见 [json-format § subScene](./json-format.md#subscene-嵌套层级对象)。

### 1.4 objType 能力表

并非所有 `objType` 都允许所有平台事件。交互事件按 objType seed；**lifecycle 事件**（`object.ready` / `object.dispose`）对 **content denylist** 开放：凡非 runtime（`scene`/`camera`/`renderer`/`controls`/`light`/`renderLoop`）且非 `pass`/`default` 的 deploy record 均可声明。可用 `registerObjTypeEventCapabilities` 扩展交互子集。

| objType | 默认允许的事件 |
|---------|----------------|
| `box`、`group`、`native`、`mesh`、`infoPanel` | `click`、`dblclick`、`pointerdown`、`pointerup`、`pointerover`、`pointerout`、`keydown`、`keyup` + `scene.ready` / `scene.dispose` + **`object.ready` / `object.dispose`** |
| `domain` | 交互事件 + `scene.ready` / `scene.dispose` + **`object.ready` / `object.dispose`** |
| `scene`、`camera`、`light` | `scene.ready` / `scene.dispose` |

与 objType 不匹配的配置会在 bind 时 **跳过** 并记录 warn。

### 1.5 场景级绑定（推荐入口）

场景 load 完成、`rebuildObjectRegistryFromScene` 之后调用：

```js
import { createJsonScene } from "threejson";
import {
  bindSceneEventRuntime,
  rebuildObjectRegistryFromScene
} from "threejson/core";

const sceneRuntime = await createJsonScene(sceneJsonRoot, { canvas, resetScene: true });
const scene = sceneRuntime.scene;

rebuildObjectRegistryFromScene(scene);

const eventRuntime = await bindSceneEventRuntime(scene, {
  sceneJsonRoot,
  sceneToken: "my-scene-session"
});

sceneRuntime.start();
```

**Handle 方法**：

| 方法 | 说明 |
|------|------|
| `eventRuntime.rebind()` | 清空本 sceneToken 的 binding，重新扫描 `objJson.events`（改脚本后需调用） |
| `eventRuntime.dispose()` | 解绑监听、清理 registry |
| `eventRuntime.manager.dispatchPlatformEvent(threeJsonId, eventName, ctx)` | 手动触发（教程 demo 用手动 raycast + dispatch） |

页面卸载时务必 `await eventRuntime.dispose()`。

### 1.6 宿主如何触发 `click`

ELM 可通过 `host.canvas` / `host.document` 自动挂 DOM 监听，但 **canvas 上的 click 不会无拾取广播**——必须提供下列之一：

```js
createEventListenerManager({
  host: {
    canvas,
    // 方式 A：由 host 解析 picked threeJsonId
    resolvePickThreeJsonId(eventName, nativeEvent) {
      return pickFromRaycast(nativeEvent); // 返回 string | null
    }
    // 方式 B：host 完全接管 native → dispatch
    // dispatchFromNativeEvent(eventName, nativeEvent) { ... }
  },
  coreBindingExecutor: createCoreBindingExecutor({ sceneConfig })
});
```

[t04-09 示例](../../examples/html-demo/track-04-interaction/04-09-event-mechanism.html) 采用 **手动 raycast + `dispatchPlatformEvent`**，便于与 OrbitControls 共存且避免误触。

### 1.7 `sceneConfig.eventScript`（运行时策略）

写在 `sceneConfig`（或友好 JSON 归一化后的等价位置）：

```json
{
  "sceneConfig": {
    "eventScript": {
      "mode": "dsl",
      "maxSteps": 1000,
      "allowedCommands": [
        "object.patch",
        "object.get",
        "object.reconcile",
        "object.add",
        "object.remove"
      ]
    }
  }
}
```

| 字段 | 默认 | 说明 |
|------|------|------|
| `mode` | `"dsl"` | `"javascript"` 时用 `new Function` 执行脚本（**无沙箱**，仅可信内容） |
| `maxSteps` | `1000` | DSL 解释器步数上限（防死循环） |
| `allowedCommands` | 见上表 | `run` 语句可调用的 command 白名单 |

### 1.8 `assetLibrary` 与 `lib://`

```json
{
  "assetLibrary": [
    {
      "threeJsonId": "script-click-move",
      "assetKind": "eventScript",
      "source": "self.moveBy(10, 0, 0)"
    }
  ],
  "objectList": [
    {
      "threeJsonId": "box-1",
      "objType": "box",
      "events": {
        "click": { "scriptUrl": "lib://script-click-move" }
      }
    }
  ]
}
```

### 1.9 与对象变更 API 的关系

EventScript 内 `self.moveBy` / `self.setPosition` / `$('token').visible = …` 最终调用 [`applyObjectPartial`](./runtime-object-mutation-quickref.md)，同步更新 `userData.objJson` 与 `Object3D`。`run object.patch …` 走 [command 微 DSL](./runtime-object-commands.md) 与同一套 mutation 管线。

### 1.10 调试与测试

- 单测：`tests/eventMechanismM1.test.mjs` … `M3b.test.mjs`、`tests/eventMechanismP2Core.test.mjs`
- Lab 评估（含 Phase 1 实现状态）：[lab/scene-event-mechanism-evaluation.md](../../lab/scene-event-mechanism-evaluation.md)

### 1.11 编辑器与预览（Phase 2）

**自动绑定**：`createJsonScene` 在 `onSceneReady` 自动调用 `bindSceneEventRuntime`；teardown 时 `beforeDispose` 释放。宿主一般无需手动 bind（Demo/编辑器重载场景除外）。

**`sceneConfig.interaction.bindSceneEvents`**（JSON 真源，默认 `true`）：

```json
{
  "sceneConfig": {
    "interaction": {
      "bindSceneEvents": true
    }
  }
}
```

**编辑器设置**（写入 localStorage，不回写 JSON）：

| 设置 | 默认 | 作用 |
|------|------|------|
| 预览事件绑定 | 跟随 JSON | **运行场景**打开的播放器是否绑定 ELM |
| 编辑器事件绑定 | 总是禁用 | 编辑器画布预览是否绑定 ELM |
| 预览热更新 | 开 | 编辑中向已打开的播放器推送场景快照 |
| 预览播放器地址 | 空 | 留空用内置 player 路径 |

入口：**运行 → 运行场景**、标题栏 **▶ 运行**、**F5**。正本编辑器打开 [`scene-player.html`](../../scene-player.html)（`?editorPreview=1`），通过 `postMessage`（`threejson:scene-preview`）接收快照。绿场 [`tools/scene-host/`](../../tools/scene-host/) 为拆分重构版，与正本**代码隔离**，不互相 import。

**右侧 [事件] 标签**（正本 `scene-editor.html` 与绿场编辑器 UI 对齐）：选中 plain 对象 → 平台事件下拉 → 编辑 `script` / `lib://` → **应用并绑定**（`eventMechanism.rebind()`）。域对象事件编辑 Phase 3。

**infoPanel `fix` / `dismissTrigger`**：`fix: true` 或省略 fix → 不可通过面板事件关闭；**`fix: false`** → 默认双击关闭（ELM `infoPanel.dismiss`）；`dismissTrigger` 仅在 `fix: false` 时定制关法（`click` / `keydown` 等，Escape 为 document 级）。Core 内置 binding，不走 `events.*.handler`。无空白双击批量关闭。

**device 域面板 trigger 派生**（写在 device record 上，非 `infoPanelList` 条目）：仅当 **显式写了** `panelShowTrigger` / `panelHideTrigger` 时，`createJsonScene` 加载后为设备派生 `device.showPanel` / `hidePanel` / `togglePanel` ELM 绑定；同 event 合并为 `togglePanel`。内嵌 `infoPanel.visible` 仅控制 deploy 初始显隐；面板 dismiss 与 device show/hide **并行**。详见 [api.md § domains/device](./api.md#domainsdevice-设备面板)。

**door 域开关门 trigger 派生**（写在 door record 上）：与 device 相反，**默认**为所有 `isDoorDescriptor` 门绑定 `dblclick` → `door.toggle`；`doorToggleTrigger: "none"` 关闭派生；显式 `events.dblclick` 优先。机柜 deploy 根不绑定；含机柜场景经 `device.cabinet` 的 `peerDomains` 调用 `door.bindSceneEvents`。编辑器画布不绑门 toggle（预览/room-show/port-show 由 ELM 负责）。详见 [api.md § 门域](./api.md#门域-apidomainsdoor)。

**per-event `mode`**：`events.<name>.mode` 为 `"dsl"` | `"javascript"`，优先于 `sceneConfig.eventScript.mode`。

**统一 `script` 字段**：内联 DSL/JS、`lib://token`、HTTP(S) URL 均写 `events.*.script`；`scriptUrl` 仍可读但会 warn。

---

## 二、EventScript 语法

默认模式为 **EventScript DSL**（`sceneConfig.eventScript.mode: "dsl"`）。语法由 `lexer` + `parser` + AST 解释器实现；**整行** `run` / `await run` 在 tokenize 前单独抽取（便于嵌入 JSON 与 command 微 DSL）。

### 2.1 语句与表达式

**语句**（以换行或 `;` 分隔，块用 `{` `}`）：

| 形式 | 说明 |
|------|------|
| 表达式语句 | 如 `self.moveBy(1, 0, 0)` |
| `await wait(ms)` | 异步等待（毫秒） |
| `if (expr) { … } else { … }` | 条件分支 |
| `var name = expr` | 变量声明 |
| `objType name = expr` | 带类型断言的声明（见 §2.4） |
| `run <commandLine>` | 同步执行 command（见 §2.6） |
| `await run <commandLine>` | 等待 command 完成 |

**注释**：行首 `//` 或 `#`（整行注释会保留在 chunk 中但不参与 tokenize，不影响相邻语句）。

**表达式**：字面量、标识符、成员访问 `.`、函数调用 `()`、一元 `!` / `-`（如 `-nudge` 或 `-28`）、二元 `||` `&&` `==` `!=` `<` `>` `<=` `>=`、赋值 `=`（左值须为标识符或成员）。

### 2.2 内置标识符

| 名称 | 含义 |
|------|------|
| `self` | 当前 binding 对应对象的 **脚本句柄**（见 §2.3） |
| `event` | 当前平台事件名字符串（如 `"click"`） |
| `payload` | 原生 DOM 事件或 dispatch 传入的 payload |

### 2.3 `self` 与对象句柄 API

`self` 为 `createScriptObjectHandle` 返回的对象，常用成员：

| 成员 / 方法 | 说明 |
|-------------|------|
| `threeJsonId` | 对象 ID |
| `objType` | 小写 objType |
| `visible` | 读/写显隐（写时同步 descriptor） |
| `show()` / `hide()` | 显隐快捷方法 |
| `moveBy(dx, dy, dz)` | 相对平移 |
| `setPosition(x, y, z)` | 绝对位置 |

示例（tutorial 默认脚本）：

```text
self.moveBy(-30, 0, 0)
await wait(400)
self.moveBy(30, 0, 0)
await wait(400)
self.moveBy(-90, 20, 0)
```

### 2.4 解析其它对象：`$('token')` / `ref(...)`

```text
var panel = $('target-box')
panel.visible = false
```

`$('token')` 与 `ref(token)` 等价，按下列顺序在 **objectRegistry** 中查找：

1. `threeJsonId`
2. `refName`
3. `name`（取第一个匹配）

返回同为脚本句柄；查不到为 `null`。

**typed 声明**（运行时校验 `objType`）：

```text
box helper = $('demo-box')
```

若解析结果的 `objType` 不是 `box`，变量设为 `null` 并打 warn。

### 2.5 控制流示例

```text
if (self.visible) {
  self.hide()
} else {
  self.show()
}

await wait(200)
self.setPosition(0, 28, 0)
```

### 2.6 `run` 与 command 微 DSL

整行写法（**必须独占一行**）：

```text
run object.patch id=event-demo-box partial={"position":{"x":0,"y":28,"z":0}}
await run object.get id=event-demo-box
```

语法：`run` + 空格 + command 行，格式与 Agent/command 微 DSL 一致：

```text
<object.op> key=value key2={"json":true}
```

**默认允许的 op**（可被 `sceneConfig.eventScript.allowedCommands` 覆盖）：

- `object.patch`
- `object.get`
- `object.reconcile`
- `object.add`
- `object.remove`

**始终禁止**（含 document / scene 级 op）：`scene.load`、`scene.export`、`scene.validate`、`material.patch`、`camera.fit` 等。完整禁止集见 `EVENT_SCRIPT_FORBIDDEN_COMMANDS`。

`object.patch` 示例：

```text
run object.patch id=tj-run-patch partial={"position":{"x":12,"y":0,"z":0}}
```

参数 `id` 为 `threeJsonId`；`partial` 为 JSON 对象，语义同 [`applyObjectPartial`](./runtime-object-mutation-quickref.md)。

### 2.7 JavaScript 模式（opt-in）

`sceneConfig.eventScript.mode: "javascript"` 时，binding 脚本按 **原生 JS 函数体** 执行（非 DSL）：

```js
// script 字段内容示例（不是 .js 文件，是字符串）
await wait(300);
self.moveBy(5, 0, 0);
const other = ref("target-box");
if (other) other.hide();
await runCommand('object.patch id=event-demo-box partial={"visible":true}');
```

注入形参：`self`、`event`、`payload`、`ctx`、`ref`、`wait`、`runCommand`。脚本体在 **async IIFE** 内执行，因此可直接写 `await wait(ms)` / `await runCommand(...)`。  
**无沙箱**：仅用于可信脚本；生产场景默认保持 `mode: "dsl"`。

### 2.8 限制与错误行为

| 限制 | 说明 |
|------|------|
| `maxSteps` | 每条脚本执行步数上限，超出抛错 |
| 未知标识符 | 抛错（除 `self` / `event` / `payload` / 已声明变量） |
| command 不在白名单 | `run` 返回 `{ ok: false }` 并 warn，不抛到宿主 |
| 并发 | 同一对象快速连点可能重叠执行多个 async 脚本；复杂逻辑需自行防抖 |

### 2.9 从编辑器 / 宿主更新脚本

运行时修改 `userData.objJson.events.click.script` 后：

```js
box.userData.objJson.events.click.script = scriptEditor.value;
delete box.userData.objJson.events.click.scriptUrl;
await eventRuntime.rebind();
```

仅改内存 descriptor **不会** 自动刷新 binding；必须 `rebind()`。

---

## 相关链接

| 文档 | 内容 |
|------|------|
| [json-format.md § 通用字段 — events](./json-format.md#通用字段) | JSON 字段速查 |
| [api.md § 事件机制](./api.md#coreruntimeeventmechanism) | 导出 API 列表 |
| [runtime-object-mutation-quickref.md](./runtime-object-mutation-quickref.md) | `applyObjectPartial` 与 redeploy |
| [domains.md](./domains.md) | domain `executeBoundEvent` 与 script 顺序 |
| [tutorial.md § Track 4](./tutorial.md) | t04-09 课表条目 |
