# 场景操作 / Scene operations

此例使用规则几何作布局示意，不调用 AI、不申请网络资源，也不宣称是写实家具。
This blockout demonstrates operations, not photorealistic modeling. No AI or network call is needed.

在仓库根运行 / Run at the repository root:

```sh
node packages/scene-tools/bin/threejson.mjs query --file examples/scene-operations/scene.json
node packages/scene-tools/bin/threejson.mjs preflight --file examples/scene-operations/scene.json --commands examples/scene-operations/edits.json
node packages/scene-tools/bin/threejson.mjs apply --file examples/scene-operations/scene.json --commands examples/scene-operations/edits.json
```

默认不写文件。显式追加 `--output new-scene.json` 保存到新文件，`--write` 用版本检查更新输入文件。
No file is written by default. Use `--output new-scene.json` or explicit version-checked `--write`.

CLI 每次启动是新会话；MCP `session.open` 后可持续 query/apply/undo/redo。
CLI invocations are independent; MCP sessions keep revisions and undo across calls.

结果中的 `scene.check` 描述候选场景；提交是否成功须看最外层 receipt。
Read the outer receipt for commit status; an in-batch check describes a candidate.
