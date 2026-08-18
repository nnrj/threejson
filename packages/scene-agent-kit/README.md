# @threejson/scene-agent-kit

Framework-neutral building blocks for a conversational ThreeJSON scene workbench. The package owns
scene-turn routing, generation/adjustment orchestration, settings normalization, turn state and a
namespaced IndexedDB repository factory. It does not contain product branding, fixed service URLs,
login, quota, billing, or UI code.

```js
import { createSceneAgentRepository } from "@threejson/scene-agent-kit/repository";
import { runSceneAgentGenerateTurn } from "@threejson/scene-agent-kit/controller";

const repository = createSceneAgentRepository({ dbName: "my-scene-workbench" });
```

Applications inject provider, texture, storage, navigation and product-service adapters. Importing
`threejson` or `threejson/core` never loads this optional package.

Use capability subpaths (`/controller`, `/settings`, `/repository`, `/turn-state`, `/contracts`)
when only one layer is needed. Settings default to automatic complete-versus-incremental
construction and do not impose an output-token ceiling; hosts may opt into their own limit.
