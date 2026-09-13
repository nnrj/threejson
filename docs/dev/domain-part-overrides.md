# Domain parameters and editable parts

A Domain remains a parameterized factory, not a snapshot of its expanded children.
Edits that cannot be expressed by its parameters can be stored in `domainOverrides`:

```json
{
  "objType": "domain",
  "domain": "port",
  "handler": "dockCrane",
  "geometry": { "width": 70, "length": 90, "height": 280 },
  "domainOverrides": {
    "partSchemaVersion": 1,
    "parts": [
      {
        "id": "port:dockCrane/%E5%90%8A%E5%85%B7",
        "transform": { "position": [0, 130, 50] },
        "operations": [{ "op": "replace", "path": "/material/color", "value": "#ffaa00" }]
      }
    ]
  }
}
```

Use the actual factory-generated `domainPartId`; do not guess a runtime UUID.
The ID is scoped to the Domain instance. Factories prefer explicit semantic IDs
and stable names; unnamed parts use deterministic construction slots. Changing
that addressing contract requires a part-schema version migration. Changing a
cabinet's dimensions does not change the door's part address.

The generic engine helpers have no knowledge of cabinet, port or door internals:

- `assignDomainPartIds` assigns addresses after descriptor-tree construction.
- `applyDomainPartDescriptorOverrides` validates a private batch before geometry
  compilation; nested factories are routed through an injected predicate.
- `finalizeDomainDeployRoot` initializes the runtime part baseline after children
  are attached. A factory that compiled descriptor overrides explicitly passes
  `descriptorOverridesApplied: true`.
- `captureDomainPartOverrides` captures explicit authoring changes. Transform
  values are local position/quaternion/scale, so hinge/pivot wrappers are retained.
  An edit-entry transform baseline avoids capturing earlier playback as editing.

Unknown parts, incompatible part versions, reparenting, deleted/replaced parts and
edits to unaddressed generated objects report a conflict. They never silently save
only the old factory parameters. The host can let the user revert, adjust factory
parameters, or explicitly bake to a normal group. Failed binding does not bake.
Successful local part edits retain the Domain and its business interactions.

In generated descriptions, `objType` identifies the concrete runtime builder
(`box`, `group`, etc.). `semanticType` retains a Domain's business role. This avoids
depending on permissive unknown-type fallback to render statistics or port parts.

Existing standard/friendly JSON and Domain parameter shapes remain accepted.
Overrides are an additive field, not a replacement scene format. Legacy reverse
capture remains supported during host migration; immutable SceneDocument remains
the target for authored state, distinct from animation and viewport state.
