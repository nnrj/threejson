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

## 官网贡献者名单

官网「社区 → 贡献者列表」按需读取 `nnrj/threejson` 的 GitHub 公开贡献者接口，自动获取头像、GitHub 用户名、主页链接和提交贡献数，并处理分页。点击卡片会在新标签页打开该贡献者的 GitHub 主页；不需要逐个手工登记新贡献者。

- 加载期间先显示备用名单；网络错误、限流、8 秒超时或无有效名单时，继续使用 `website/js/contributors.js` 中的 `FALLBACK_CONTRIBUTORS`（原有维护者名单）。
- 成功结果仅在当前页面会话的内存中缓存 5 分钟，切换语言或路由复用同一个请求；过期后再次进入贡献者页会重新获取。未进入此页不请求贡献者接口。
- 这是纯官网功能，无需后端、GitHub Token 或 npm 重新发包。公开 REST API 支持跨域；不要在前端添加访问密钥。
- 展示范围以 GitHub 返回的关联账户为准，匿名提交没有可链接的 GitHub 主页。GitHub 自身也缓存统计，因此刚合并的贡献可能稍后才出现在名单中。

接口说明：[GitHub 贡献者 API](https://docs.github.com/en/rest/repos/repos#list-repository-contributors)、[CORS 支持](https://docs.github.com/en/rest/using-the-rest-api/using-cors-and-jsonp-to-make-cross-origin-requests)。
