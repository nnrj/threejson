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
