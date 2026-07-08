[中文](./scope.md) | [English](../en/scope.md)

# ThreeJSON 能力范围与数据契约

本文描述 **core** 提供的能力边界，以及「规范真源 JSON」与「运行时 Object3D 叠加层」的关系，便于上游与贡献者对齐预期。

## Core 承诺（概要）

- 从 JSON 归一化、部署场景、对象注册表索引（`threeJsonId` / `uuid` / `name` / `refName`）。
- 声明式 `animations`（如 `rotate`）与渲染循环集成。
- 对已加载 **且含 clips 的 glTF**，可选注册 `AnimationMixer` 并在每帧更新（与声明式动画的协调见 `animationMode`）。
- `sceneRuntimeApi`：对 `Object3D` 的受控命令式变换（见 `core/handler/sceneRuntimeApi.js`）。
- `descriptorSync`：描述符局部合并、从对象写回变换到 `objJson`、与描述符绑定脏标记协作（见 `core/handler/descriptorSync.js`）。
- **L3 JSON Patch**：通过包入口 `threejson/patch` 按需引入，对白名单路径应用 RFC 6902 式操作并触发绑定脏标记（不进入默认帧循环）。
- `PluginHost`：极小的插件生命周期钩子（见 `core/plugin/pluginHost.js`）；具体物理等实现在 `extensions/`。

## 规范真源（Canonical）与运行时叠加层（Runtime）

- **规范真源**：持久化、再加载、以及与 `descriptorSync` / Patch 交互时，以 `userData.objJson`（及 `worldInfo` 中对应条目）为准。
- **运行时叠加层**：游戏循环、物理、脚本直接修改 `Object3D` 的状态；**不必**每帧与 JSON 一致。
- **再进入 JSON 侧流程前**：应调用 `reconcileTransformToDescriptor`（或等价批量提交），否则依赖描述符的接口可能读到陈旧值。

`core/` 源码目录（`builder` / `handler` / `runtime`）的理想职责划分见 [设计原则 · core 源码目录](./design-principles.md#core-源码目录builder--handler--runtime理想参照非强制)（**倾向性说明，非强制搬迁**）；远期备忘见 [lab/core-layering-memo.md](../../lab/core-layering-memo.md)。

## 三档同步策略（与 `worldInfo.descriptorBinding` 配合）

在 `sceneDescriptorBinding` 文档中描述的 **RuntimeOnly / AuthoringOnly / Hybrid** 等模式，与上述「真源 / 叠加层」一致：高频只写对象、低频或显式点写回 JSON。

## 默认扩展（仓库内 `extensions/`）

示例插件、简易物理演示等：**不保证**与 core 同步 semver，以各目录 README 为准。接入步骤见 **[extensions.md](./extensions.md)**。

## Lab（[`lab/README.md`](../../lab/README.md)）

未来能力草案与实验索引（**非发布承诺**），与 `docs/` 中正式契约区分。

## 明确不纳入 Core

完整网络同步、ECS、关卡编辑器产品化 UI、防作弊与不可信输入校验（见 `docs/design-principles.md` 中的可选安全占位）等，由上游或可选扩展实现。
