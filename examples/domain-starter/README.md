# Domain starter

Minimal example layout for a custom ThreeJSON business domain.

1. Copy `domains/demo/` into your app or into this repo's `domains/<name>/`.
2. In this repo, run `npm run generate:business-domain-manifest` (maintainers only).
3. In your app entry: `import { createJsonScene } from "threejson"` (or `threejson/core` + `import "threejson/builtins/register"`).
4. For npm-published domains, use `npx threejson add-domain <package>` — see [docs/zh/domains.md](../../docs/zh/domains.md).
