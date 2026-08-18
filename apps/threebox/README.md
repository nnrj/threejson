# apps/threebox

React composition of the ThreeBox AI scene workbench. It consumes published-style bare package
entries only: no relative imports into `core/`, `packages/`, sibling apps, or the production
baseline under `tools/scene-host/threebox`.

## Package boundary

- `@threejson/scene-agent-kit` owns unbranded turn routing, complete/incremental generation,
  adjustment, replay, settings defaults and the repository factory.
- `@threejson/react-scene-agent` owns unbranded React conversation and live scene-card primitives.
- `@threejson/host-kit` owns framework-neutral provider, texture, i18n, path and file-IO adapters.
- `@threejson/react` and `@threejson/react-ui` remain general engine/player bindings and UI.
- This app owns ThreeBox branding, provider/privacy policy, settings presentation, navigation,
  notifications, sync/migration adapters, templates and resource-library composition.

`tools/scene-host/threebox` remains the independently deployable behavior oracle and does not import
these packages. The React app must reproduce desired behavior through public package contracts,
never by reaching into that application's source.

## Current scene workflow

- On a new chat, the first message is always generation. `自动` negotiates complete versus
  incremental construction; the other two settings force the construction mode.
- With scene history, automatic routing chooses a new scene or an adjustment. The user can still
  explicitly select `调整当前场景` or `新场景` in the composer.
- Model output remains visibly streamed. Drafts and incremental commands update one live scene card
  instead of adding artificial dialogue rounds or waiting for all refinement to finish.
- Adjustment uses the live runtime where possible and retains the shared commands → JSON Patch →
  full JSON fallback chain.
- Texture completion starts only after a usable scene is visible, updates the same turn, supports
  local caching and optional server search/generation, and never makes scene generation fail.
- Conversation, turn, project and resource data use an app-specific IndexedDB repository created
  by `@threejson/scene-agent-kit`.

## Run

```bash
npm install
npm run dev      # http://localhost:5182
npm run build
```

## Optional live-provider development file

Copy `settings.test.json.example` to the gitignored `settings.test.json`, then enter a temporary
test key. Vite exposes it only through a development middleware and proxy; it is not present in
production output.

```jsonc
{
  "provider": "deepseek",
  "apiKey": "sk-...",
  "model": "",
  "baseUrl": ""
}
```

Do not commit real credentials. Automated tests and normal builds do not call a live model or
consume provider quota.
