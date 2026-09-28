# Retired Python/Gradio agent shell

The alpha CLI and MCP implementation now lives in [@threejson/scene-tools](../../packages/scene-tools/README.md).
Use `npm run scene-tools -- help` or `npm run mcp` from the repository root.

普通操作不再需要 Python、Gradio 或模型密钥。原纹理流程迁移到新包的显式 `texture` 入口；
显式 `ai` 入口保留生成、图片生成与场景调整；素材导入/查询使用 Node API。
旧版默认网页爬取与自动选择平台二进制不再启用：可传入明确 URL 或配置 JSON 搜索服务。

用户现有的 `setting.json`、场景和下载文件未删除、未自动转换。按新文档显式指定配置；不要提交密钥。
需要查阅旧实现时，可从 Git 历史恢复。桌面编辑器产品级重构留在二期，本期只更新纹理入口。
