[中文](./mcp-cursor.md) | [English](../en/mcp-cursor.md)

# ThreeJSON MCP（Cursor 等客户端）

MCP 现在是 `@threejson/scene-tools` 的薄适配层，直接操作持久场景会话。
普通查询、修改、校验、撤销和保存不调用内置 AI，不需要供应商密钥。

## 使用源码

仓库根运行 `npm install`，然后在 MCP 客户端配置绝对路径：

```json
{
  "mcpServers": {
    "threejson": {
      "command": "node",
      "args": ["E:/WORKSPACE/AgentWork/Three/ThreeJSON/packages/scene-tools/bin/threejson-mcp.mjs"]
    }
  }
}
```

发布新版本后也可安装 `@threejson/scene-tools`，使用其 `threejson-mcp` 命令。
不要把源码的新协议与尚未发布的旧 npm 版本混用。无需 Python、Gradio 或旧 setting.json。

## 工作流程

1. `session.open` 用 `json` 或绝对 `file` 路径打开场景，记录 sessionId、revision。
2. `scene.discover` 查看输入 schema、目标类型、前置条件和运行时可用性。
3. `op.scene.query` 获取对象标识、精确变换、紧凑摘要及设计绑定。
4. `scene.preflight` 预构建；逐项读取检查覆盖，未检查不等于通过。
5. `scene.apply` 提交命令批次，携带 baseRevision 和稳定 requestId。
6. 用 `op.scene.check` 检查确定性后置条件，必要时 `scene.undo`。
7. `scene.save` 显式保存；目标文件版本变化时拒绝覆盖。

支持 `job.start/get/cancel`。重复同一 requestId 不会在会话存续期间重复提交；
进程重启后不保证持久幂等。MCP 标准输入输出只用于协议，不输出调试日志。

## 图像和编辑器

普通 Node 会话没有浏览器画布，截图明确返回不可用。可选 `browser-check` 使用显式安装的
Playwright 和本机浏览器；不会自动下载浏览器。实际场景图与补光诊断图分别标注。

编辑器通过“设置 → 连接本机场景工具…”与显式启动的 `editor-bridge` 配对。
MCP `editor.call` 提交请求，`editor.result` 查询结果；连接中断时先核对结果，不盲目重发写操作。
编辑器只依赖操作协议，不依赖 MCP。参阅 [场景操作协议](./scene-operations.md) 和
[CLI 用法](../../packages/scene-tools/README.md)。

旧 Python/MCP 外壳源码已退役；用户配置、场景和缓存保留。显式 AI、纹理、资产工具位于新包的
可选入口，只有主动调用才访问相应服务。
