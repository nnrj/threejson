[中文](./demos.md) | [English](../en/demos.md)

# 演示页面说明

[中文](./demos.md) | [English](../en/demos.md)

演示分为两类：

1. **教程示例**（推荐）：`examples/html-demo/track-*`，按学习轨组织，数据在 `assets/json/tutorial/`。索引入口：[demo.html](../../demo.html)，课表：[tutorial.md](./tutorial.md)。
2. **根目录整合页**：机房、编辑器、播放器、港口等业务大屏（非教程必修）。

## 运行

```bash
python -m http.server 8080
```

推荐入口：

```text
http://localhost:8080/demo.html
http://localhost:8080/index.html
```

## 教程目录结构

```text
examples/html-demo/
  track-00-runtime/       # JSON 契约与 createJsonScene
  track-01-geometry/      # group / line / plane / CSG / helpers / native
  track-02-visual-fx/     # heat / wind / points / weather / sprite / 背景 / 音频
  track-03-assets/        # glTF / nativeThree / OBJ
  track-04-interaction/   # 注册表 / 物理插件 / FPS / 信息面板 Gallery / CSS3D / 事件机制
  track-05-tooling/       # AI、嵌套 domain
  track-06-stat/          # stat.bar / grid / panel / chart / line / pie / ring
  track-07-text/          # objType:text（sdf / texture / mesh）
```

## 根目录整合页

| 页面 | 默认 JSON | 说明 |
|------|-----------|------|
| [room-show.html](../../room-show.html) | `roomShow.json` | 核心网络机房 A 区：冷热通道、UPS 分区、18 机柜运维大屏 |
| [scene-editor.html](../../scene-editor.html) | `portShow.json` | 通用场景编辑器 |
| [scene-player.html](../../scene-player.html) | `portShow.json` | 播放列表与巡检 |
| [port-show.html](../../port-show.html) | `portShow.json` | 智慧港口 |

## 编写新 demo

见 [tutorial.md § 编写新课](./tutorial.md#编写新课) 与 [quick-start.md](./quick-start.md)。

- 优先 `createJsonScene` / `createSceneRuntimeAsync`（异步背景时）
- 不在页面内手写 `requestAnimationFrame` / `renderer.render`
- 纹理与模型路径以 `/assets/...` 为根
- catalog 的 `path` 必须指向 `track-*` 或根目录整合页

## 外置 Agent / MCP

- [tools/threejson-agent/](../../tools/threejson-agent/README.md)
- [docs/mcp-cursor.md](./mcp-cursor.md)
- [tools/threejson-agent-desktop/](../../tools/threejson-agent-desktop/README.md)
