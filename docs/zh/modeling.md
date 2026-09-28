[中文](./modeling.md) | [English](../en/modeling.md)

# 可计算建模：参数、算子与源模型

ThreeJSON 保留友好 JSON、标准 JSON、`bufferMesh` 完整坐标和 `editableMesh` 控制网格。新增的 `modeledMesh` 是另一种表达方式：保存参数、依赖关系和建模步骤，由客户端计算三角网格。**计算结果不是第二份权威场景**；修改、撤销、保存以建模图为准，只有显式烘焙才改成完整坐标。

普通立方体不需要建模图。算子也不是模型模板清单：可使用内置算子、注册自己的实现，或把多个算子封装成可复用的子图。直接输出大量坐标仍然允许，不设置引擎默认顶点上限。

## 从一个参数化对象开始

友好格式可以放在 `worldInfo.modelList`，标准格式可以放在 `objectList`，对象写法相同：

```json
{
  "objType": "modeledMesh",
  "threeJsonId": "column",
  "material": { "type": "standard", "color": "#c38b4c", "roughness": 0.3 },
  "modeling": {
    "version": 1,
    "parameters": { "height": { "value": 200, "unit": "cm" }, "twist": 0.8 },
    "nodes": [
      {
        "id": "body", "operator": "primitive.box", "version": 1, "part": "body",
        "params": { "width": 0.4, "depth": 0.4, "height": { "param": "height" }, "heightSegments": 64 }
      },
      {
        "id": "shape", "operator": "mesh.deform", "version": 1,
        "inputs": { "mesh": { "node": "body", "output": "mesh" } },
        "params": { "mode": "twist", "amount": { "param": "twist" } }
      }
    ],
    "output": { "node": "shape", "output": "mesh" }
  }
}
```

使用异步 `createJsonScene()` 或 `createRuntimeSceneSession()` 加载；同步 `deployMesh()` 不负责等待计算。场景加载器检测到 `modeledMesh` 后按需加载建模能力。根入口和普通场景不会加载 CAD、GPU 计算适配器或建模 Worker。

参数数量值使用现有 `design` 的单位/表达式解析，长度默认归一化为米、角度为弧度；显式 `modeling.units.length` 可改变参数表达式的长度目标单位，应与宿主的场景坐标单位一致。节点中的裸数字直接使用算子的单位；`mesh.deform.twist` 是每单位长度的弧度，`bend` 是曲率，`taper` 是线性斜率。`modeling.units` 不把任意坐标数组悄悄缩放；CAD 算子长度始终要求米。

可运行的 [参数编辑、撤销、烘焙与 GPU 对照示例](../../examples/html-demo/track-01-geometry/01-09-computable-modeling.html)，以及官网目录里的“参数与算子建模”章节，使用的就是该管线。

## 算子契约与内置能力

`threejson/modeling` 导出 `getModelingOperatorManifest()`，返回当前注册表中的版本、输入/输出类型、参数契约和可用后端。AI 和编辑器读取这份信息，不需要猜测参数。参数校验支持 `type / properties / required / additionalProperties / enum / minimum / exclusiveMinimum / maximum / items / minItems / maxItems / default`，不是完整 JSON Schema 实现。

| 数据类型 | 本次提供的算子 |
| --- | --- |
| 网格 | `primitive.box/sphere/cylinder/torus`，`mesh.raw/editable/transform/deform/merge/array` |
| 曲线、曲面 | `curve.polyline/bezier/sweep/loft/revolve`，`surface.parametric/bezier/nurbs/tessellate` |
| 隐式场 | `field.sphere/box/combine/mesh` |
| 点、实例 | `points.explicit/instance`，`instances.realize` |
| 精确实体（可选） | `cad.box/cylinder/sphere/boolean/fillet/chamfer/shell/extrude/revolve/loft/sweep/transform/tessellate` |

图的端口类型为 `mesh / curve / surface / solid / field / points / instances`。连接必须匹配；循环、缺失算子、未知版本和非法参数会给出包含 `code`、`nodeId` 的错误，不替换成立方体。多个输出用 `outputs`；场景渲染使用名为 `result` 的输出（没有时取第一个），该输出必须是 mesh。实体、曲面、实例须显式 tessellate/realize。

`mesh.raw` 采用现有完整 BufferGeometry 描述，包括自定义顶点属性、UV、groups、drawRange、morph 和二进制引用。二进制引用走场景资源策略，可随 `.tjz` 保存并离线导入。变形保留 UV 和其他顶点属性，重算法线/切线；暂不支持的蒙皮/morph 几何变形明确报错，普通对象移动不受此限制。合并要求兼容的 attribute 布局，并保留可见 drawRange 与材质分组；它不等于布尔并集。

## 自定义算子与组合算子

```js
import {
  createModelingOperatorRegistry, registerBuiltinModelingOperators,
  registerModelingOperator, createModelingCompiler
} from "threejson/modeling";

const registry = registerBuiltinModelingOperators(createModelingOperatorRegistry());
registerModelingOperator({
  id: "studio.points", version: 1, inputs: {}, outputs: { points: "points" },
  parameters: {
    type: "object", properties: { span: { type: "number", default: 2 } },
    additionalProperties: false
  },
  backends: {
    cpu: ({ params }) => ({ points: {
      type: "points", positions: [[0, 0, 0], [params.span, 0, 0]]
    } })
  }
}, registry);

registerModelingOperator({
  id: "studio.twistedBox", version: 1, inputs: {}, outputs: { mesh: "mesh" },
  parameters: { type: "object", properties: { amount: { type: "number", default: 0.5 } } },
  graph: {
    version: 1,
    nodes: [
      { id: "base", operator: "primitive.box", params: { heightSegments: 32 } },
      { id: "twist", operator: "mesh.deform",
        inputs: { mesh: { node: "base", output: "mesh" } },
        params: { mode: "twist", amount: { param: "amount" } } }
    ],
    outputs: { mesh: { node: "twist", output: "mesh" } }
  }
}, registry);

const compiler = createModelingCompiler({ registry });
const result = await compiler.compile({
  version: 1, nodes: [{ id: "part", operator: "studio.twistedBox", params: { amount: 0.8 } }],
  output: { node: "part", output: "mesh" }
});
compiler.dispose();
```

组合算子通过 `{ "input": "端口名" }` 引用外部输入，支持 multiple 端口。自定义实现接收 `inputs / params / signal / quality / context / nodeId`，返回按端口命名的可序列化 artifact。不得返回 Object3D、WASM 指针或闭包；资源所有权不能隐藏在缓存内。算子应确定性执行，随机算法显式带 seed，外部状态变化通过 `contextKey`/`context.cacheKey` 参与缓存失效。

场景宿主传入 `modelingRegistry` 和 `modelingContext`，`createRuntimeSceneSession` 会同时传给构建和命令执行。注册到默认 registry 也可。注册同名同版本会报错；修改实现应升级版本，或显式调用注册返回的注销函数。JSON 记录的是算子 ID/版本，**不会嵌入或自动下载安装自定义 JavaScript**。接收方须注册相同算子；要交付无需插件的模型则使用 bake。引擎提供能力，代码来源和运行策略由宿主负责。

## 增量计算、Worker 与 GPU

编译器按算子版本/实现、节点身份、参数、输入指纹、后端、质量和上下文标识缓存。只重算受影响分支；缓存属于编译器或场景，不是跨聊天全局变量。输出使用独立数据所有权，画布释放 geometry 或修改返回数组不会破坏缓存。

- `createWorkerModelingCompiler()` 延迟创建自包含 Worker。队列按顺序执行；取消正在运行的任务会终止并重建 Worker，其他排队任务保留。场景宿主已启用 `geometryCompiler` 时，纯内置图可使用此通道。
- 自定义算子/内核可在宿主自己的 Worker 注册，调用 `attachModelingWorkerHost()`；用 `workerFactory` 注入。函数不能直接结构化克隆到 Worker。含运行时二进制解析器的图当前走主线程计算，不假装已 offload。
- `signal` 不可打断同线程同步 WASM 内核；需要强制取消和隔离 WASM 内存时使用 Worker。`dispose()` 清理编译器缓存；终止 Worker 才释放它的整个 WASM 实例。
- 引擎没有固定顶点数、图节点数或计算时间预算。实际内存/设备上限仍可能使操作失败；宿主可另外设置预算，不能悄悄截掉顶点。

GPU 是**可选计算后端**，与场景渲染器的选择分开。目前加速 `mesh.deform` 的 twist/taper/bend，其他算子继续使用 CPU，并非所有算子已经 GPU 化：

```js
import { createModelingCompiler } from "threejson/modeling";
import { createWebgpuModelingBackend } from "threejson/modeling-webgpu";
const gpu = await createWebgpuModelingBackend(); // 不支持时返回 null
const compiler = createModelingCompiler({ context: gpu ? { gpu } : {} });
try { const result = await compiler.compile(graph); }
finally { compiler.dispose(); gpu?.dispose(); }
```

`backend:"auto"` 在该算子有 GPU 实现且宿主提供设备时才选 GPU。设备丢失/真实限制等可恢复错误回退 CPU，并产生 `MODEL_BACKEND_FALLBACK` 诊断。显式 `backend:"gpu"` 失败时不会偷偷换后端。CPU/GPU 是浮点近似等价，不承诺逐 bit 相等；法线/切线整理仍在 CPU。

## 可选精确 CAD 与 STEP

CAD 不是用三角面假装实体。适配器调用真正的 OpenCascade（通过 replicad），用 BREP 作为实体 artifact，预览网格单独生成。

```sh
npm install replicad@^1.1.0 replicad-opencascadejs@^1.1.0
```

```js
import { createModelingOperatorRegistry, registerBuiltinModelingOperators, createModelingCompiler } from "threejson/modeling";
import { createOpenCascadeModelingProvider, registerCadModelingOperators } from "threejson/modeling-cad";
const registry = registerBuiltinModelingOperators(createModelingOperatorRegistry());
const provider = await createOpenCascadeModelingProvider({ wasmUrl: "/vendor/replicad_single.wasm" });
const unregister = registerCadModelingOperators(provider, registry);
const compiler = createModelingCompiler({ registry });
try {
  const result = await compiler.compile({ version: 1, nodes: [
    { id: "block", operator: "cad.box", params: { size: [0.1, 0.08, 0.04] } },
    { id: "preview", operator: "cad.tessellate",
      inputs: { solid: { node: "block", output: "solid" } }, params: { tolerance: 0.0001 } }
  ], outputs: {
    result: { node: "preview", output: "mesh" }, solid: { node: "block", output: "solid" }
  } });
  const stepBlob = await provider.exportSTEP(result.outputs.solid, { unit: "MM", name: "block" });
  // stepBlob 是真实 STEP 文件；由宿主选择保存方式。
} finally { compiler.dispose(); unregister(); provider.dispose(); }
```

宿主部署与所安装版本配套的 WASM，也可传 `wasmBinary` 或已初始化的 `oc`；引擎不选 CDN。长度内部为米，导出明确记录目标单位。replicad 的内核选择是模块级状态，单个 Worker 内串行使用；不要把一个 WASM 实例当作并行线程安全内核。分发时注意 replicad（MIT）和 replicad-opencascadejs（LGPL-2.1-only）的许可证及其依赖许可。

`selector` 支持 plane/offset、边方向、包围盒等几何选择，**不承诺 OCCT 的面编号在拓扑变化后保持不变**。当前 CAD 扩展没有完整草图约束求解器、装配约束、CAM 或通用编辑器 STEP 按钮；STEP 为宿主 API。CAD 失败会保留此前模型，不降级成外形相似的基础几何。

## 命令、AI、编辑器

| 命令 | 用途 |
| --- | --- |
| `model.operators` | 查询实际注册的算子；可按 id/category 筛选 |
| `model.inspect` | revision、节点、连接、参数名和对象变换；可指定 nodeId、includeParameters |
| `model.evaluate` | 计算统计、包围盒、诊断；仅 includeArtifact 显式开启时返回密集坐标 |
| `model.patch` | 对 modeling 图的 RFC6902 原子修改；必须提供 baseRevision |
| `model.bake` | 转为普通 bufferMesh；保留场景身份、材质和变换，可撤销 |

```js
import { executeSceneSessionCommands } from "threejson/session";
await executeSceneSessionCommands(session, [{ op: "model.patch", args: {
  id: "column", baseRevision: 0,
  patch: [{ op: "replace", path: "/parameters/twist", value: 1.1 }]
} }]);
```

以上为命令结构；根据宿主接口使用 `executeSceneSessionCommands(session, commands)` 或 Editor 的 command layer。提交前先构建新 geometry，成功后再换入，失败时保留文档、历史和画布。普通局部更新保留 Object3D、材质、父级与 ID。

若场景 `design.bindings` 控制了建模参数，inspect 同时返回源值、绑定和计算值。应修改 design 参数，不能用 model.patch 悄悄覆盖绑定字段。evaluate/bake 使用绑定后的实际值；bake 原子移除该对象已消费的建模绑定，保留位姿/材质绑定，撤销时一起恢复。二进制输入缓存依据内容和数据类型失效，不把相同 URL 当作内容永远不变。

Editor 选择 `modeledMesh` 后可编辑暴露参数、节点参数 JSON，查看 revision 并烘焙；使用原有撤销/重做，不另建历史系统。ThreeBox 的 AI 能力索引增加 `modelingGraph`：按需获取算子契约、读取局部模型、发出 model.patch，而不是每轮重写三角面。仅移动物体应继续使用 object transform。普通规则物体仍可用原来的简单 JSON。

AI 连续返回重复结果或无变化时，会标记未完成并保留当前场景，ThreeBox 不再把这种停止显示为“完善完成”。本次测试不证明任意 LLM 已能稳定生成生产级车辆/角色；几何表达能力、推理质量和艺术质量是不同验收项。

## 测试、发布与当前边界

```sh
node --test --test-concurrency=1 tests/modelingGraph.test.mjs tests/modelingSession.test.mjs tests/modelingWorker.test.mjs tests/modelingCad.test.mjs
npm run build:geometry-worker
npm run validate:demo-catalog
npm run release:check
```

CAD 测试只有安装真实可选内核后才执行，否则明确标记 skip，不能当作 CAD 验收通过。GPU 数值对照使用上述 HTML 示例的按钮；没有设备时显示不可用，不能把 CPU 冒充 GPU。`prepack` 会构建自包含 Worker；发布包须携带 `core/modeling/modeling.worker.bundle.js`。正常版本升级和发布流程见 [发布说明](../dev/npm-release.md)。

已落地的是类型化建模图、版本化算子、可组合扩展、增量/Worker、局部命令、可选 GPU 和精确 CAD、宿主接入。以下不应宣称已经完成：通用可视化节点编辑器、完整点/边/面/角属性传播体系、跨拓扑修改的永久面命名、误差驱动的通用自适应细分、全套 CAD 约束、自动游戏资产优化以及“AI 自动达到工业生产质量”。现有控制网格 modifier 的细节边界仍以复杂模型手册和实际诊断为准。它们可在同一契约上继续扩展，而不需要再替换所有场景 JSON。
