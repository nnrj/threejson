[中文](./scene-operations.md) | [English](../en/scene-operations.md)

# 场景操作协议与 AI 工具

同批次编辑后的查询是未提交候选状态：返回 `documentState:candidate`、`revision:null` 和
`baseRevision`，不会把内部计算版本冒充已发布版本。游标和增量查询必须在提交后执行。

## 依赖与真源

Editor、ThreeBox、可选 AI、CLI 和 MCP 调用同一中性操作服务，服务使用已有 `SceneSession`。
没有第二套场景数据库或撤销系统。编辑器不依赖 MCP；工具包依赖引擎，反向依赖禁止。
标准 JSON 是完整表达入口；友好 JSON 是手写优先的入口，不要求每个高级字段都有另一套简写。
目前可直接承载标准记录的高级能力仍保留，不自动简化稠密网格。

```js
import { createSceneSession, createSceneOperationService } from 'threejson/session';
const session = createSceneSession({ objectList: [
  { objType: 'box', threeJsonId: 'chair', geometry: { width: 1, height: 1, depth: 1 } }
] });
const service = createSceneOperationService({ session });
const batch = [{ op: 'object.transform', args: {
  id: 'chair', frame: 'world', position: [2, 0, 1]
} }];
const check = await service.preflight(batch); // 查看 checks，不能当成渲染通过
const result = await service.execute(batch, { baseRevision: 0, requestId: 'move-chair-1' });
await service.undo({ baseRevision: result.revision, requestId: 'undo-chair-1' });
session.dispose();
```

## 契约、事务与回执

`service.discover()` 返回 `inputSchema/outputSchema`、目标类型、前提条件、分类、撤销/取消语义。
`threejson/operations` 导出纯契约注册表和验证器。自定义命令注册纯准备函数，返回 document operations；
不能在准备函数中写画布、发消息或执行其他不可回滚副作用。

- authoring：整批准备成功才提交一个 revision；失败保留此前文档和可见场景。
- read：读取，不产生撤销节点。draft：BufferGeometry 暂存，不等于已提交。
- runtime：视口或播放动作，不写源文档。`action.invoke` 必须单独调用，不能声称可事务回滚。
- `camera.fit` 可作为编辑后的视口动作；若编辑已提交而视口失败，回执为 `partial`，不可盲目重放写入。
- 状态包括 `read/draft/noop/preflight/committed/applied/partial/failed/cancelled/unavailable`。
- 同一会话的同一 requestId + 同一输入复用回执；换输入报冲突。撤销/重做也支持 requestId。
- 会话关闭或进程重启后，不提供持久的 exactly-once 保证。调用方应重新读取文件/场景确认结果。

`preflight` 不提交文档、历史、buffer draft 或视口命令。已有 runtime 时使用同一 driver 准备候选并释放；
仅文档会话没有 renderer，geometry/resources/render 可能仍为 `unchecked`。预检可能读取资源、填充缓存或
编译候选，因此不是“零开销”操作。取消保证在提交前生效；同步 CPU 运算须返回或由 Worker 支持中断。
`checks` 分开报告参数、引用、结构、几何、资源、渲染、后置条件；缺少验证能力绝不冒充通过。

## 查询与空间语义

`scene.query/observe` 支持 ID、类型、名称/语义别名、父级、后代、标签、类别、part、空间 AABB 筛选。
projection 可选 identity、transform、bounds、summary、controls、semantic、materials、descriptor。
默认只返回摘要；只有显式 descriptor/object.get 才返回完整坐标。分页不限制模型本身的大小。

- authored：源记录；evaluated：设计参数求值和编译后的锚点关系；runtime：当前播放/动画状态。
- 回执包括 revision、时间、长度单位（默认 m）与角度单位 rad；变换含 local TRS 和 worldMatrix。
- cursor 绑定文档 revision 和查询条件；`sinceRevision` 返回服务观察到的变更及移除 ID。
  子对象受父变换影响时也返回；删除 ID 不按当前筛选过滤。该增量是创作文档增量，不是逐帧动画流。
- `spatial.measure` 是对象原点距离和 AABB 间隙/重叠，不是精确实体碰撞。
- `spatial.raycast` 使用当前会话的 Three.js 几何。无 runtime 时明确不可用。
- `scene.check` 支持存在性、数量、世界位置、AABB 大小、材质字段和 AABB 间隙。
  “逼真”“工业可制造”等不能伪装成已验证的几何断言。

## 操作与建模

`object.transform` 要求显式 frame：parent/world/object/camera；object frame 只支持 delta。
长度可指定 m/cm/mm/km/in/ft。不可逆父变换和不能无损写为 TRS 的剪切报错，不偷偷近似。
`object.reparent` 默认保持世界姿态；`object.clone` 重建子树 ID、重映射已知内部引用、保留并报告外部引用。
任意自定义 metadata 中的字符串不猜测为引用。

`scene.layout` 提供 row/grid/circle/curve/seeded scatter 的一次性布置；`object.attach` 写入持久 design 关系。
`design.parameter.set` 修改驱动参数。受绑定字段通过通用 object.patch 或 JSON Patch 也不能绕过：
必须先明确解除绑定或编辑对应参数。

`model.node.patch` 按稳定 nodeId 编辑，`model.parameter.set` 改图参数，均校验 model baseRevision。
`points.sampleCurve` 按折线弧长采样；`points.scatterMesh` 以三角形面积加权、固定 seed 散布，返回面法线和面号。
它们可接 `points.instance → instances.realize`，不必让 AI 写重复顶点。当前采样参考后端为 CPU，不声称 GPU 加速。
显式最终坐标、控制网格、模型图和注册自定义算子继续并存。

Domain/宿主可给已有 `registerEventAction(type, executor, contract)` 补 `inputSchema` 和 targets，
即可被 `action.discover` 查到。未提供契约的事件不自动暴露；不会把任意点击处理器猜成 Agent 工具。

## 视觉反馈

`scene.capture` 的 kind=scene 截取实际 compositor 输出，不额外打光，记录相机、灯光、环境、曝光与资源错误。
零尺寸画布或失效的 image data URL 不能通过。画面有图像并不等于纹理都已就绪，资源状态仍单独报告。
kind=diagnostic 使用宿主多角度模型预览，明确 `diagnosticRelighting:true`；不能拿其证明原场景灯光正常。

## Node CLI、MCP 与编辑器桥

安装与完整用法见 [scene-tools](../../packages/scene-tools/README.md)。开发仓库：

```powershell
npm install
npm run scene-tools -- discover
npm run scene-tools -- query --file scene.json
npm run scene-tools -- preflight --file scene.json --commands edits.json
npm run scene-tools -- apply --file scene.json --commands edits.json --output edited.json
npm run mcp
```

普通命令不需要 API Key，不调用模型，不打开浏览器。文件保存使用临时文件、协作锁、SHA-256 版本检查；
外部程序不遵守锁时无法获得操作系统级 CAS 保证。文件变化后拒绝覆盖，先重读或另存。
长操作可用 job.start/get/cancel；已提交操作不因取消而回滚。

真实浏览器检查显式运行 `browser-check --file ... --browser <已安装浏览器路径>`，需要可选 playwright。
不会自动安装/下载浏览器；明确失败或不可用。未启用 optional capability 时仍沿用按需加载。

编辑器【设置 → 连接本机场景工具】：先运行 `editor-bridge --origin <编辑器的准确 origin>`，
输入 CLI 输出的一次性 pairingUrl。桥仅监听 127.0.0.1、校验 origin、30 分钟过期、凭据仅在内存中。
外部工具先 discover，再携带 sessionId 操作；更换场景须重配。`editor.call` 返回排队 ID，
`editor.result` 确认执行结果，超时或断联不能自动当成失败并换 ID 重发。
远程 HTTPS 页面可能还需要浏览器允许本地网络访问；不能通过引擎规避浏览器权限。

## 可选 AI

`threejson/ai` 新增 `runSceneOperationAgent`，JSONL 和可选原生 function calling 共享相同服务/契约。
需显式选择 native，并确认提供商支持；默认 JSONL。不限制总质量轮数，重复无进展、供应商失败、用户取消或
显式预算结束会停止并返回真实 stopReason。可提供确定性 assertions；失败不会冒充完成。
普通 ThreeBox/Editor 流程仍使用原有交互编排，但其命令执行与反馈已进入统一服务；不会为了新增工具强制更换供应商。

## 退役与下一期

旧 Python/Gradio CLI、旧 MCP server 和多层 Node→Python bridge 已从源码退役。配置、历史与用户文件不删除；
旧代码在 Git 历史可恢复。纹理、显式 AI 和素材服务迁移到新 Node 包；默认网页爬取退役，改为明确 URL/服务。
桌面只更新纹理入口；完整桌面体验、多 Agent 合并、物理/CAD 精确约束和更强可视化工具留在二期。
