# AI 测试夹具

供 [`../ai-manual-verification.md`](../ai-manual-verification.md) 与自动化测试使用。

| 文件 | 用途 |
|------|------|
| `base-scene-friendly.json` | 增量 update、Agent 调整（C4/C5/C14） |
| `scene-with-texture-slots.json` | `planTextures` / `fillTextureUrls`（C6/C7） |
| `invalid-scene.json` | `validateSceneJson` 负例（C1/D6） |

CLI 输出请写入 `tests/fixtures/ai-test/out/`（该目录 gitignore，勿提交 API 输出或密钥）。
