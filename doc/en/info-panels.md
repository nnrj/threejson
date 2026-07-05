# Info panels guide

[中文](../info-panels.md) | [English](./info-panels.md)

ThreeJSON offers several ways to show labels and information in 3D. This guide covers selection, JSON authoring, imperative APIs, and host interaction patterns. Field contracts: [json-format § infoPanel](./json-format.md#infopanel) and [§ css3dPanel](./json-format.md#interactive-css3d-panel-css3dpanel-core); APIs: [api.md § infoPanelBuilder](./api.md#corebuilderinfopanelbuilderjs).

## Selection overview

| Capability | objType / list | Billboard | DOM interactive | Typical use | Friendly list |
|------------|----------------|-----------|-----------------|-------------|---------------|
| Box info panel | `infoPanel` + `panelBoxType: "box"` | No | No | Wall signs, 3D boards | `infoPanelList` |
| Sprite info panel | `infoPanel` + `panelBoxType: "sprite"` | Yes | No | Floating tags, nameplates | `infoPanelList` |
| Plane info panel | `infoPanel` + `panelBoxType: "plane"` | No | No | Fixed-orientation flat signs | `infoPanelList` |
| Text texture | `infoPanel` + `type: "text"` | Depends on carrier | No | Plain text hints | `infoPanelList` |
| HTML texture | `infoPanel` + `type: "html"` | Depends on carrier | No (html2canvas snapshot) | Rich text boards | `infoPanelList` |
| Image texture | `infoPanel` + `type: "img"` | Depends on carrier | No | Logos, diagrams | `infoPanelList` |
| CSS3D panel | `css3dPanel` | No | **Yes** | Console, forms, iframe | `css3dPanelList` |
| Scene text | `text` | Optional `billboard` | No | SDF labels, 3D titles | `textList` / `objectList` |
| Icon marker | `sprite` | Yes | No | Map pins, status dots | `spriteList` |

**Division of labor**:

- **`infoPanel`**: content baked to WebGL textures (Canvas or html2canvas); `sprite` carrier always faces the camera.
- **`css3dPanel`**: real DOM over WebGL; see demo [t04-06](../../examples/html-demo/track-04-interaction/04-06-css3d-panel.html).
- **`text`**: text without a mandatory backing panel (SDF / texture / mesh); Track 7.
- **`sprite`**: single-texture marker, not a multi-line text panel.

## Implementation (core)

Static non-CSS3D panels use a **single pipeline** in [`core/builder/infoPanelBuilder.js`](../../core/builder/infoPanelBuilder.js):

1. `normalizeInfoPanelDescriptor` — default fields (`panelBoxType`, `type`, `panel.*`)
2. `resolveInfoPanelTexture` — `text` | `html` | `img` → `Promise<THREE.Texture>`
3. `buildInfoPanelObject` — `box` | `sprite` | `plane` Mesh/Sprite
4. `deployInfoPanel` — optional `scene.add`

`css3dPanel` is deployed separately via [`core/builder/css3d/`](../../core/builder/css3d/) and does **not** use this pipeline.

## Static infoPanel: carrier × content

> **Scale**: html-demo tutorials typically use infoPanel world widths around **12–20** (demo convention ~1 unit ≈ 1 meter). See [html-demo README § tutorial scale](../examples/html-demo/README.md#tutorial-尺度约定).

### Box carrier (`panelBoxType: "box"`)

Has depth (`panelDepth`); `textFace: "full"` applies the same texture to all six faces (thin box).

### Plane carrier (`panelBoxType: "plane"`)

Fixed-orientation `PlaneGeometry` (+Z textured face); no thickness; `textFace: "full"` not supported. Default **`double`** when `panel.material.side` is omitted; optional `front` | `back`.

### Sprite carrier (`panelBoxType: "sprite"`)

Always faces the camera; use `borderRadius` for rounded corners.

### Content types

- **`type: "text"`**: `createStrTextureMultiline`; `font` or `textStyle`; `backColor` in texture.
- **`type: "html"`**: HTML string in `text`, rasterized via **html2canvas** — **not clickable**. Prefer inline CSS.
- **`type: "img"`**: `text` is image URL or base64; `contentScale` supported.

Legacy **`boxType`** equals **`panelBoxType`**; prefer `panelBoxType` in new JSON.

## Field quick reference

| Field | Meaning |
|-------|---------|
| `panelBoxType` | `box` \| `sprite` |
| `type` | `text` \| `html` \| `img` |
| `text` | Text / HTML / image URL |
| `textFace` | `single` (default) \| `full` (six-sided box) |
| **`dismissTrigger`** | Auto-dismiss trigger (infoPanel only): omit / `"none"` = no auto close; `"click"` / `"dblclick"` = hide when picked; `"keydown"` = **Escape** (document-level). Wired by core event mechanism — see [event-mechanism.md](./event-mechanism.md) |
| **`fix`** | **Deprecated**; `true` → same as `dismissTrigger: "none"`; `false` → `"dblclick"`. Still read at load; new JSON should use `dismissTrigger` |
| `visible` | Whether to create (default true) |
| `panel` | `geometry`, `position`, `rotation`, `scale`, `material` |

See [json-format](./json-format.md#infopanel) for `textStyle`, `borderRadius`, `contentScale`, etc.

## Deployment

1. **Friendly JSON**: `worldInfo.infoPanelList[]` — deployed by `createJsonScene`.
2. **Imperative**: `deployInfoPanel` (create); `updateInfoPanel` / `updateInfoPanelContent` (update by `threeJsonId`).
3. **Dismiss (recommended)**: **`fix: false`** for double-click dismiss (core wires automatically); optional `dismissTrigger` when `fix: false` for click / Escape. Demo [t04-08](../../examples/html-demo/track-04-interaction/04-08-info-panel-gallery.html).

## css3dPanel

Use when you need **clickable buttons, inputs, or iframe** — not `infoPanel` + `type: html`.

- [t04-06](../../examples/html-demo/track-04-interaction/04-06-css3d-panel.html), [t04-07](../../examples/html-demo/track-04-interaction/04-07-css3d-curved-browser.html)
- [json-format § css3dPanel](./json-format.md#interactive-css3d-panel-css3dpanel-core)

## Host interaction (advanced)

### Device panel (device domain)

UPS, AC, and other device records can bind panels via **`devicePanelRef`**, **`info`** shorthand, or nested **`infoPanel`** (priority **ref > info > infoPanel**). After deploy, `userData.objJson.devicePanelRef` is the runtime source; `showDevicePanel` / `bindDevicePanelTriggers` read it.

**Important: invalid `devicePanelRef` warns only — no fallback.** If JSON has a non-empty `devicePanelRef`, the resolver uses **external ref only**, even when `infoPanel` is also present; a bad ref **does not** show the inline panel. Fix the ref or remove `devicePanelRef`. See [api.md § domains/device](./api.md#domainsdevice--device-panel).

Nested `infoPanel` on business records should use **`panelShowTrigger` / `panelHideTrigger`** on the host record (see [api.md § domains/device](./api.md#domainsdevice--device-panel)). The event mechanism derives device panel actions and deploys inline panels on first show using `topDistance`; `room-show.html` has been migrated to this model, while `port-show.html` keeps host-page logic for a later pass.

## FAQ

| Issue | Notes |
|-------|-------|
| Blank HTML panel | Ensure `html2canvas-pro` in import map; use inline styles |
| Image missing | `type: img` `text` must be a reachable URL; watch CORS |
| Panel dismiss on double-click | Set **`fix: false`** in JSON (core auto wiring) |
| Panel dismiss on Escape | **`fix: false`** + `dismissTrigger: "keydown"` |
| Legacy menu batch clear | Visibility APIs such as `setAllInfoPanelsVisible`; orthogonal to panel dismiss |
| Need form interaction | Use `css3dPanel` |

## Related demos

| ID | Page | Notes |
|----|------|-------|
| t01-01 | [01-01-group-line-panel.html](../../examples/html-demo/track-01-geometry/01-01-group-line-panel.html) | Minimal `infoPanelList` |
| **t04-08** | [04-08-info-panel-gallery.html](../../examples/html-demo/track-04-interaction/04-08-info-panel-gallery.html) | Static type gallery |
| t04-06 / t04-07 | CSS3D panels | Interactive DOM |
| t02-05 | [02-05-scene-background.html](../../examples/html-demo/track-02-visual-fx/02-05-scene-background.html) | Dynamic sprite panel |
| — | [room-show.html](../../room-show.html) / [port-show.html](../../port-show.html) | Business dashboards |

Sample JSON: [`04-08-info-panel-gallery.json`](../../assets/json/tutorial/track-04/04-08-info-panel-gallery.json).
