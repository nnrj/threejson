# Language shells

Hosts that drive the external ThreeJSON agent product. Each subdirectory is one language/runtime shell.

| Path | Role |
|------|------|
| [`py/`](py/README.md) | Python Click CLI + Gradio GUI (`python -m threejson_agent`) |

Shared Node IPC and config live in the **parent** [`../`](../README.md): `bridge/`, `components/`, `setting.json`.

Scene AI logic is implemented in repository [`core/ai`](../../../core/ai/), not in this folder.
