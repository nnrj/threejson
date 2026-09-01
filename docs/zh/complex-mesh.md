[中文](./complex-mesh.md) | [English](../en/complex-mesh.md)

# 复杂模型、控制网格与渐进建模

ThreeJSON 可以直接描述完整 `BufferGeometry`，也可以用稳定 ID 控制网格、参数曲面、NURBS、Bézier、Loft、Sweep 或 SDF 紧凑表达自由形态模型。这些入口属于引擎能力，不依赖外部模型搜索或三维生成服务。

高级建模模块按描述符加载。异步 `createJsonScene()` 在首次遇到相关 `objType` 时加载它；同步宿主可显式导入：

```js
import "threejson/complex-mesh";
```

普通立方体不会加载该模块，也不会产生额外网络请求。

## 完整坐标：`bufferMesh`

`bufferMesh` 对应 Three.js `BufferGeometry`。它支持任意 attribute、Uint16/Uint32 index、材质 groups、drawRange 和 morph target：

```json
{
  "threeJsonId": "raw-model",
  "objType": "bufferMesh",
  "geometry": {
    "attributes": {
      "position": { "array": [0, 0, 0, 1, 0, 0, 0, 1, 0], "itemSize": 3, "type": "Float32Array" },
      "uv": { "array": [0, 0, 1, 0, 0, 1], "itemSize": 2, "type": "Float32Array" },
      "customWeight": { "array": [0.2, 0.6, 1], "itemSize": 1, "type": "Float32Array" }
    },
    "index": { "array": [0, 1, 2], "type": "Uint16Array" },
    "groups": [{ "start": 0, "count": 3, "materialIndex": 0 }],
    "morphAttributes": {
      "position": [{ "array": [0, 0, 0, 1, 0.2, 0, 0, 1.2, 0], "itemSize": 3, "type": "Float32Array" }]
    },
    "morphTargetsRelative": false
  },
  "morphInfluences": [0.4],
  "materials": [{ "type": "physical", "color": "#38bdf8" }]
}
```

兼容简写 `positions`、`indices`、`normals`、`uvs` 仍可使用。`position`、`normal`、`tangent`、`color`、多套 UV、`skinIndex`、`skinWeight` 以及自定义 attribute 使用同一通用描述符。

### 二进制数据与 `.tjz`

大型数组可放入命名 buffer：

```json
{
  "geometry": {
    "buffers": {
      "positions": "https://example.com/model.positions.bin",
      "indices": { "base64": "..." }
    },
    "attributes": {
      "position": { "ref": "positions", "itemSize": 3, "type": "Float32Array", "length": 600000 }
    },
    "index": { "ref": "indices", "type": "Uint32Array", "length": 1200000 }
  }
}
```

`.tjz` 的 `tryPack` 会发现这些引用并尝试归档。引擎不设顶点数、三角面数或 JSON 字节数上限；只拒绝非法索引、非有限数值、attribute 数量不一致等客观错误。宿主可选传入 `meshBudget`，所有字段默认均为 `undefined`：

```js
const options = {
  meshBudget: {
    maxVertices: undefined,
    maxTriangles: undefined,
    maxBytes: undefined,
    maxBuildTimeMs: undefined
  }
};
```

## 可编辑控制网格：`editableMesh`

`editableMesh` 保存低密度控制拓扑，运行时结果可由 modifier 重新生成：

```json
{
  "threeJsonId": "chair-shell",
  "objType": "editableMesh",
  "topology": {
    "revision": 0,
    "vertices": [
      { "id": "v-a", "position": [-1, 0, 0] },
      { "id": "v-b", "position": [1, 0, 0] },
      { "id": "v-c", "position": [1, 1, 0] },
      { "id": "v-d", "position": [-1, 1, 0] }
    ],
    "faces": [
      { "id": "f-seat", "vertices": ["v-a", "v-b", "v-c", "v-d"], "part": "seat", "materialIndex": 0, "smooth": true }
    ],
    "edges": [{ "vertices": ["v-a", "v-b"], "crease": 0.5 }]
  },
  "modifiers": [
    { "id": "subdivision", "type": "catmullClark", "levels": 2 },
    { "id": "thickness", "type": "solidify", "thickness": 0.12 }
  ],
  "material": { "type": "physical", "color": "#d97757" }
}
```

面支持三角形、四边形和 n-gon，运行时统一三角化。顶点、面与语义 `part` 使用稳定 ID；数组位置不是跨轮编辑的身份。

支持的 modifier 包括 Mirror、Catmull–Clark、Loop、Smooth、Bevel、Solidify、Triangulate、Tessellate、EdgeSplit/crease normal、Simplify、平面/盒状/柱面/球面/triplanar UV，以及法线/切线重算。Simplify 只有在描述符或宿主明确要求时才执行，引擎不会自动简化模型。

## 紧凑曲面

按形态选择相应 `objType`：

- `parametricSurface`：`expressions: {x,y,z}`、参数范围和采样段数。
- `nurbsSurface`：带权控制点、次数、节点向量和采样段数。
- `bezierPatch`：矩形控制点网格。
- `latheMesh`：二维轮廓旋转成面。
- `loftMesh`：多个截面之间放样。
- `sweepMesh`：二维 profile 沿三维 path 扫掠。
- `implicitSurface`：组合 SDF 或显式标量场，经 Marching Tetrahedra 生成网格。

这些描述是 `bufferMesh` 的补充而不是替代。需要最终完整坐标时，可以 bake；用户也始终可以直接提供原始顶点和索引。

## 网格运行时命令

命令通过 `threejson/commands` 的统一执行器调用：

- `mesh.inspect`：统计、包围盒、材质槽、part、modifier 和 revision。
- `mesh.getTopology`：按 part、ID、空间范围和分页读取控制拓扑。
- `mesh.validate`：退化面、重复面、悬空顶点、边界、非流形边和绕序；`checkSelfIntersectionRisk:true` 可额外执行非相邻面包围盒风险检查。
- `mesh.edit`：带 `baseRevision` 的原子控制网格事务。
- `mesh.buffer.*`：分段追加/修改原始 attribute 与 index，最后 `commit` 原子发布或 `cancel` 放弃。
- `mesh.bake`：将运行时细分结果转换为完整 `bufferMesh` 描述符。
- `mesh.renderViews`：调用宿主注入的多视图渲染器。

`mesh.edit.operations` 支持顶点/面增删改、`assignPart`、`setEdgeCrease`、`extrudeFaces`、`insetFaces`、`bevelEdges`、`bridgeLoops`、`loopCut`、`mirror` 及 modifier 设置/排序。一次事务中任一操作失败时不发布新几何；新几何构建成功后才原子换入，并保留原 Object3D、材质、父级和身份。

```json
{
  "op": "mesh.edit",
  "args": {
    "id": "chair-shell",
    "baseRevision": 8,
    "operations": [
      { "type": "setVertex", "id": "v-a", "position": [-1.1, 0.1, 0] },
      { "type": "assignPart", "faceIds": ["f-seat"], "part": "seat-cushion" }
    ]
  }
}
```

只移动顶点且没有改变几何语义的 modifier 时，可直接更新 Position BufferAttribute；拓扑变化则重新评估该对象。命令返回可逆差异，Editor 可将它作为一个撤销事务。

ThreeBox 选择“仅保存差异”缓存时，以命令日志保存连续细化，并默认每 12 个命令 turn 写入一个完整 checkpoint；间隔可由 `io.turnDiffCheckpointInterval` 调整，设为 `0` 可关闭。恢复时只从最近 checkpoint 重放，命令链不会无限增长。

## AI 与宿主策略

复杂模型生成有两条等价能力路线：

- `full-coordinates`：直接输出完整 `bufferMesh`，可用 `mesh.buffer.*` 跨任意数量响应持续写入。
- `progressive`：先输出可识别控制笼，再按语义 part 读取、编辑、验证和细化。

### 草稿不是必须推倒重来的占位物

自由形态模型的默认草稿是低密度 `editableMesh` 或紧凑曲面：它既能立即展示轮廓、比例、朝向和配色，也是后续细化的控制真源。这样无需先用立方体、圆柱拼一套代理，再把代理丢掉重建顶点网格。

基础几何草图仍有明确用途：整场景的空间布局、最终本来就是规则件/硬表面装配的对象，以及用户明确要求先确认构图的高成本流程。它是 AI 可选策略，不是所有复杂模型之前的强制确认关卡。

表示选择遵循“足够准确的最低复杂度”：规则几何、Three.js 原生参数几何、实例化或 CSG 已能准确表达时，不因“高质量”三个字改用 `editableMesh`；只有不规则轮廓、自由曲率、拓扑、Morph 或局部表面特征确实需要时才进入复杂网格管线。

### 本地细化优先于冗余坐标

当控制笼的形状已经正确、问题只是表面分段感或运行时密度不足时，AI 应设置本地 modifier，而不是继续生成控制顶点：

- 四边形/n-gon 控制笼使用 Catmull–Clark；
- 全三角控制笼使用 Loop；
- 只有在不破坏目标轮廓时才叠加 Smooth。

`mesh.inspect` 会返回三角面、四边形和 n-gon 的控制面统计，AI 无需读取整份拓扑就能选择算法。modifier 在用户浏览器本地确定性计算，低密度控制拓扑仍是 JSON 真源；只有轮廓、特征或变形需要变化时才新增/移动控制顶点。

### 非形状调整使用紧凑空间上下文

位置、旋转、缩放、父子布局、可见性、材质、动画和相机调整不需要把稠密坐标发送给模型。默认空间卡片只携带稳定 ID、精确局部/世界变换、几何统计和包围盒；`bufferMesh` attribute、`editableMesh` 顶点/面和曲面控制点不会进入该紧凑上下文。嵌套对象会合成父级变换。

只有请求确实改变形状、拓扑、语义 part、modifier 或 morph 时，Agent 才使用 `mesh.inspect`、分页/按 part 的 `mesh.getTopology` 或可选多视图复核。显式开启“附带完整场景 JSON”仍会按用户选择发送完整描述。

`complexModelStrategy` 的默认值是 `auto`，`modelQuality` 默认 `balanced`。ThreeJSON core 不设置轮数、Token、费用或时间硬上限；这些只在用户或宿主明确传入 `modelBudget` 时生效。Token 预算优先使用供应商返回的实际用量，缺失时只对完成内容作明确标记的近似估算；费用预算必须由供应商返回费用，或由宿主提供 `estimateModelCost` / `providerAdapter.estimateCost`，引擎不会猜测不同模型的价格。正常终止由模型返回 `done`、质量检查通过或用户暂停决定；重复命令、连续无进展和非法结果属于异常停止，而不是固定质量轮数。

## 示例

网站“查看示例”的“复杂模型与曲面”章节覆盖家具、车辆、机械件、植物、动物、类人形体、非对称有机物、自由曲面产品和 raw BufferGeometry/Morph。源文件位于 `assets/json/demo-show/complex-modeling/`。
