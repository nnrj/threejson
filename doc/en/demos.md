# Demo Pages

[中文](../demos.md) | [English](./demos.md)

- **Tutorial demos**: `examples/html-demo/track-*` with JSON under `assets/json/tutorial/`. Index: [demo.html](../../demo.html), catalog: [tutorial.md](../tutorial.md).
- **Root integration pages**: `room-show.html`, `scene-editor.html`, `scene-player.html`, `port-show.html`.

```bash
python -m http.server 8080
```

```text
http://localhost:8080/demo.html
```

See [quick-start.md](../quick-start.md) for minimal `createJsonScene` setup. Full lesson list: [tutorial.md](../tutorial.md).

## Root integration pages

| Page | Default JSON | Notes |
|------|--------------|-------|
| [room-show.html](../../room-show.html) | `roomShow.json` | Core network room zone A: cold/hot aisle, UPS partition, 18-rack ops dashboard |
| [scene-editor.html](../../scene-editor.html) | `portShow.json` | General scene editor |
| [scene-player.html](../../scene-player.html) | `portShow.json` | Playlists and walkthrough |
| [port-show.html](../../port-show.html) | `portShow.json` | Smart port dashboard |

## Tutorial directory layout

```text
examples/html-demo/
  track-00-runtime/       # JSON contracts and createJsonScene
  track-01-geometry/      # group / line / plane / CSG / helpers / native
  track-02-visual-fx/     # heat / wind / points / weather / sprite / background / audio
  track-03-assets/        # glTF / nativeThree / OBJ
  track-04-interaction/   # registry / physics plugins / FPS / info panel gallery / CSS3D
  track-05-tooling/       # AI, nested domains
  track-06-stat/          # stat.bar / grid / panel / chart / line / pie / ring
  track-07-text/          # objType:text (sdf / texture / mesh)
```

Tracks **0–7** include folded series (FPS, stat domain, text modes, CSS3D curved screen) where each sub-item loads a different HTML file.
