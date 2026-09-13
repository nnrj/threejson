[中文](../zh/contributing-guide.md) | [English](./contributing-guide.md)

# How To Contribute

ThreeJSON contributions should keep the runtime data-driven, modular, and easy to inspect.

Useful references:

- [Development](./development.md)
- [Design Principles](./design-principles.md)
- [API](./api.md)

## Practical Rules

- Keep core behavior independent from demo pages and tools.
- Prefer typed JSON records and documented handlers over ad hoc fields.
- Keep optional capabilities in domains or extensions when they are not required by the runtime core.
- Add focused examples for new JSON capabilities.
- Avoid breaking existing scene JSON unless a migration path is provided.

## Website Contributors List

The website's Community → Contributors page loads avatars, GitHub usernames, profile links, and commit counts from the public contributors API for `nnrj/threejson`, including subsequent pages. Each card opens the contributor's GitHub profile in a new tab; new contributors do not need to be added manually.

- The original maintainer list is shown while loading. Network errors, rate limits, an 8-second timeout, or an empty/invalid list use `FALLBACK_CONTRIBUTORS` in `website/js/contributors.js`.
- Successful results are cached in memory for 5 minutes within the current page session. Route/language changes share the request; revisiting after expiry fetches again. Other website routes do not request contributors.
- This is website-only: no backend, GitHub token, or npm release is needed. The public REST API supports CORS; do not embed access tokens in frontend code.
- Only contributor accounts returned by GitHub are listed; anonymous commits have no GitHub profile link. GitHub also caches contributor statistics, so newly merged contributions may take time to appear.

References: [GitHub contributors API](https://docs.github.com/en/rest/repos/repos#list-repository-contributors), [CORS support](https://docs.github.com/en/rest/using-the-rest-api/using-cors-and-jsonp-to-make-cross-origin-requests).
