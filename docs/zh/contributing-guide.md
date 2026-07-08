[中文](./contributing-guide.md) | [English](../en/contributing-guide.md)

# 如何贡献

ThreeJSON 的贡献应保持运行时数据驱动、模块化，并且容易检查和验证。

相关参考：

- [开发说明](./development.md)
- [设计原则](./design-principles.md)
- [API](./api.md)

## 实用规则

- 保持核心行为独立于 demo 页面和工具页面。
- 优先使用类型化 JSON 记录和已文档化的 handler，避免临时字段。
- 非核心必需能力尽量放在 domains 或 extensions 中。
- 为新的 JSON 能力添加聚焦示例。
- 避免破坏既有场景 JSON；确需变更时提供迁移路径。
