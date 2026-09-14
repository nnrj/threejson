# 场景文档、运行时与本次重构的接入说明

## 保留的输入形式

标准 JSON 与友好 JSON 继续存在；原有场景不需要批量重写才能加载。新版会话在显式保存时
写入 `schemaVersion: 2`。对象、材质、动画、事件、Domain、`assetLibrary`、`lib://`、
原始网格及 `.tjz` 仍是受支持的能力，并未被基础几何子集取代。

`threejson/document` 提供底层不可变文档及两个上层格式的适配器：

```js
import { compileAuthoring, formatAuthoring, inspectAuthoringMigration } from 'threejson/document';

const report = inspectAuthoringMigration(existingJson); // 只检查，不写磁盘、不启动渲染器
const document = compileAuthoring(existingJson);
const standard = formatAuthoring(document, { format: 'standard' });
const friendly = formatAuthoring(document, { format: 'friendly' });
```

文档 envelope 含 `kind/schemaVersion/revision/sourceFormat/root`。从 JSON 反序列化得到的
envelope 会重新取得不可变所有权，不能通过修改外部引用偷偷改变历史快照。`revision` 是
编辑序号，不是格式版本。引擎不会把无法识别的新格式版本静默当成旧格式。

新增表达能力是可选的 `design` 层，包括单位、参数、绑定、局部锚点和静态关系。它可以驱动
既有几何、曲面、控制网格与 Domain 参数，不要求把旧 JSON 改成另一种语言。详见
[设计参数与关系](./scene-design.md)。这是静态编译关系，不是物理求解器或 CAD 约束求解器。

## 四种状态不再混在一起

| 状态 | 所有者与用途 |
| --- | --- |
| 创作文档 | 用户参数、模型拓扑、材质来源、命令结果；保存、同步与撤销的真源 |
| 编译资源 | 已解码纹理、准备好的网格、TSL 资源；按加载/运行时分配并释放 |
| 播放状态 | 动画姿态、相机交互位置、时间；默认不写回创作历史 |
| 视口状态 | 画布尺寸、主题辅助元素、预览截图、活动预算；属于宿主 |

明确请求运行时捕获时仍可导出当前姿态。普通保存不再依靠“把当前 Three.js 场景反向猜回
JSON”；否则辅助灯、动画中间姿态、代理 URL 和不完整加载结果都可能污染历史。

## 会话与事务

`threejson/session` 提供 `createSceneSession`、`createRuntimeSceneSession`、
`executeSceneSessionCommands` 和 `captureSceneSession`。一批命令先在私有文档中规划，再
准备资源，最后提交一个 revision。准备失败时，文档、上一张可用画面和撤销栈均保留。

- 仅变换或兼容的材质/几何修改尽量保留运行时、Object3D、材质、相机及动画身份。
- 拓扑改变先构建新几何再换入；同布局属性修改更新变化范围。
- 必须完整替换时，图形宿主提供 `createViewport` 暂存画布。不得先清空正在显示的画布。
- 一个会话的操作串行化；命令可携带 `baseRevision`，过期编辑明确拒绝。
- 历史以逆向差异和周期性 checkpoint 为主，默认保留 50 个可撤销编辑。宿主可配置历史
  深度；它不是 AI 轮数、顶点数量或生成质量限制。
- JavaScript 模块、副作用事件、外部接口和任意宿主回调不是数据库事务；已发生的外部副作用
  不能承诺自动撤销。文档/渲染事务不等于任意代码沙箱。

保留 `createSceneRuntime`、`createJsonSceneSimple` 及既有部署接口的同步/异步约定。
**`deployJsonScene` / 单对象直接部署仍是低层命令式 API，不承诺部署开始后的整场景回滚。**
它们会在准备阶段失败时释放临时资源，但交互替换、AI 调整、撤销应走 session。直接用一个
既有 renderer/canvas 原地重载，无法同时显示旧画面并准备新画面；这不是加一个 try/catch
可以实现的原子性。

## 宿主如何使用

原生 ThreeBox、React ThreeBox 和 Cloud 使用同一份 `sceneCardSession`；Editor 拥有独立的
文档时间线；Shower 通过同一准备/提交机制切换场景。宿主共享代码以
`tools/scene-host/shared/js` 为基线，发布到 `@threejson/host-kit`，同步命令：

```sh
node tools/dev/syncHostSessionModules.mjs
```

ThreeBox 默认只有一个活动视口；切换旧卡片会保留截图及独立文档，而不是把多个卡片指向
同一个可变场景。可以在设置中开启多活动画布并指定数量。旧记录保持序列化，点击查看、
编辑或下载时才解析；折叠的 JSON 也在展开/复制时才转换格式。

## 资源失败与无 R2 模式

纹理只有成功解码后才绑定；失败保留旧贴图或基础材质。PBR 换图保留 Physical 等原材质
能力。各运行时拥有自己的资源策略、加载管理器与准备结果，不能借用“最后一个画布”的
纹理、URL 前缀或对象索引。

- 场景存权威来源 URL；运行时代理地址、凭据和临时 blob URL 不得成为持久化真源。
- 本地缓存用于加速和兜底，R2 是可选归档，二者都不是所有场景运行的前提。
- 服务端部分贴图归档成功时保留成功结果，不因另一槽位失败而丢弃全部归档。
- `.tjz` 的 `preserve/tryPack` 真正控制打包策略；文件目录、相对模型资源和内嵌二进制
  保留自己的解析基址。
- 源 URL 已失效、缓存不存在且未归档时，无法凭空恢复原始图片。历史中只存过期 blob 的
  老记录同理；本次修复不会声称能恢复已经不存在的字节。
- ThreeBox、Shower 与 Editor 的资源提示可展开，区分纹理、背景、模型和 Worker 回退。
  UI 不显示 URL 凭据、查询参数或未经处理的供应商错误文本。

详见 [资源归档所有权](./archive-resource-ownership.md)。本次服务端修复没有新增强制
R2 配置或数据库迁移。

## Domain、建模与计算边界

Domain 保留参数以及稳定 `domainPartId` 对应的局部覆盖；失效部件与无法表达的结构变更
报告冲突，显式 bake 才脱离参数化 Domain。不会再静默导出原参数、丢掉用户移动的子对象。
详见 [Domain 局部修改](./domain-part-overrides.md)。

自由曲面和可编辑网格继续受支持。Simplify、Bevel、EdgeSplit、凹多边形三角化进行了实质
修正；无法达到简化目标而不破坏边界时，返回实际结果和原因，而不是抽样删面伪装成功。
可选 `threejson/geometry-worker` 将控制网格与程序曲面计算移出主线程。普通立方体不启动
Worker；Worker 初始化不可用时由宿主决定回退，计算错误不会被吞掉或自动换成简化模型。
详见 [几何编译边界](./geometry-compilation.md)。Domain 工厂运行后才生成的几何、CSG 等
不是本期全部迁入 Worker 的承诺。

TSL 图像和模块准备结果按加载隔离。安全节点图与可选源码能力都保留；原始 TSL ESM
仍是页面权限级 JavaScript。远程 URL 在验证与 import 之间变化的精确字节完整性，需要
宿主 `moduleLoader` 连同依赖一起保证，不能用一次哈希检查宣称完全解决。

## 验证与发布

回归基准包括 `room-show.html`、`port-show.html`、html-demo、Shower 粒子/TSL/复杂模型、
Editor 参数修改/撤销，以及 `tests/fixtures/scene-history-browser.html` 的独立快照、刷新、
真实本地纹理和故意失败资源。浏览器 fixture 只在本机创建独立 QA 对话，不调用 AI。

本次已准备 `threejson@0.1.0-alpha.11`、`@threejson/*@0.1.0-alpha.3`、
`@threejson/assets@1.1.6`。**它们尚未发布时，不要先部署引用它们的 Cloud 或新版下载模板。**
版本号已经由统一脚本更新，本次发布无需再执行一次 `release:version`。

```sh
npm run release:test
npm run release:publish
```

发布通过后再由维护者推送/部署 ThreeJSON 官网和 Cloud。Cloud 仍固定 npm 依赖；锁文件
完整性对应本次打包产物。若发布前又改变包内容，需要重新打包并刷新 Cloud 对应锁条目，
不能沿用不匹配的 integrity。不会自动推送 Git、部署站点或修改线上数据库。

完整使用说明见 [npm 发布流程](./npm-release.md)，逐项实现证据见
[重构交付记录](./scene-consistency-refactor.md)。
