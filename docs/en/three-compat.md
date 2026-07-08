[中文](../zh/three-compat.md) | [English](./three-compat.md)

# Three.js Version Compatibility

ThreeJSON core targets the peer Three.js major revision currently used by the project, now r184. Older supported revisions are adapted through `core/compat/` by revision.

## Version Matrix

| Category | Revision | Notes |
|----------|----------|-------|
| native | `184` | Matches core behavior directly. |
| compat | `179` ... `183` | Uses compatibility adapters. |
| unsupported | `<=178` and others | Warns in console; behavior is not guaranteed. |

The formal minimum supported revision is r179, matching `three >= 0.179.0`.

## APIs

Core exports helpers such as:

- `getThreeJsonNativeRevisions()`
- `getThreeJsonCompatRevisions()`
- `getThreeJsonMinSupportedRevision()`
- `getThreeJsonPrimaryRevision()`
- `resolveEffectiveThreeRevision(...)`
- `getThreeRevisionCompatibility(revision)`
- `warnIfUnsupportedThreeRevision(ctx)`

## Effective Revision Resolution

1. `sceneConfig.threeRevision`
2. `worldInfo.threeRevision`
3. Runtime `THREE.REVISION`
4. Default `THREEJSON_PRIMARY_REVISION`

When the declared revision differs from runtime `THREE.REVISION`, ThreeJSON warns and uses the declared value for compatibility selection.

## JSON Lights

In native r184 and compat r179-r183, light intensities should use physical units. Prefer explicit units such as `lux` for directional lights and `candela` for point or spot lights.
