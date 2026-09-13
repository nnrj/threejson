# Optional units, parameters and relationships

`design` augments both standard and friendly JSON. It does not replace their
object/material/Domain forms, change bare legacy numbers, or introduce an external
service. The document is authoring data; evaluated fields and constraint poses
belong to a compiled runtime, not the saved source.

```json
{
  "objectList": [
    {"objType":"box","threeJsonId":"table","geometry":{"width":1,"height":0.1,"depth":0.8}},
    {"objType":"sphere","threeJsonId":"lamp","geometry":{"radius":0.12}}
  ],
  "design": {
    "version": 1,
    "units": {"length":"m"},
    "parameters": {
      "width": {"value":180,"unit":"cm"},
      "halfWidth": {"op":"div","args":[{"param":"width"},2]}
    },
    "bindings": [{"object":"table","path":"/geometry/width","value":{"param":"width"}}],
    "relations": [{"type":"attach","object":"lamp","anchor":"bottom","target":"table","targetAnchor":"top","offset":[0,0.02,0],"offsetSpace":"world"}]
  }
}
```

## Expressions and units

- Literals are finite numbers; `{value,unit}` declares a quantity; `{param:id}`
  refers to a parameter. `{expr:...}` optionally wraps a definition with metadata.
- Units: m/cm/mm/km/in/ft, rad/deg, s/ms. An explicit length converts to the scene's
  declared length unit (m by default); output angles are radians and time seconds.
  Merely adding `units.length:"mm"` never rescales pre-existing coordinates.
- Operators: add, sub, mul, div, min, max, clamp, abs, neg, sin, cos, pow, sqrt.
  Binary operators have two arguments, clamp three, other unary operators one.
  Addition and comparison require equal dimensions. Products and powers retain
  compound dimensions. Nonfinite results, unknown parameters and cycles fail with
  structured `DESIGN_*` diagnostics. There is no artificial graph-size limit.
- Bindings contain object ID, relative JSON Pointer and a numeric expression or
  array of expressions. Create the intended structural arrays in the descriptor
  first. Bindings cannot change identity/hierarchy or overlap each other.

Use `evaluateSceneDesign(document)` from `threejson/document` for pure inspection.
Normal async and synchronous scene loading compile the layer automatically.
`SceneSession.dispatch` accepts JSON Patch on `/design/parameters/...`; undo stores
the parameter delta. Parameter-only primitive mesh edits update geometry in-place.
Anchor-affecting edits prepare a complete scene off-screen in graphical sessions;
unrelated material edits keep the existing runtime. This is a conservative rebuild
boundary, not an incremental physics/dependency solver.

## Anchors and static relationships

Origin and `{anchors:{name:{position:[x,y,z]}}}` are model-local. Bounds-based
center/top/bottom/left/right/front/back use local axes (+Z front), not world AABB
faces. Instancing and active morph positions are included; runtime helpers are
excluded. A supplied coordinate triple is also a valid explicit anchor.

`attach` aligns an object's anchor with a target anchor. Offset defaults to the
target coordinate system, or `offsetSpace:"world"`. `orientation:"target"` inherits
target rotation; otherwise retain the source's orientation. `lookAt` aims +Z for
ordinary objects and -Z for cameras/lights, through the parent coordinate system.
Singular transforms cannot be inverted and are errors. Under sheared transforms,
aiming direction is defined in parent space; a rigid orthonormal world frame cannot
in general be represented by rotation alone.

One relationship owns a source transform. To compose relationships, use nested
groups. Dependencies include hierarchy and constrained descendants participating
in computed bounds. Do not attach a child to an enclosing parent's computed bounds
that include that child; an explicit parent anchor avoids the self-reference.
`targetPart` may address a stable generated Domain part; parameter changes that
remove that part are explicit conflicts, never silently retargeted.

Relationships run after geometry preparation, before the scene is exposed. They
are not reevaluated every animation frame and do not model rigid-body dynamics,
collision response or simultaneous nonlinear constraints. A failing batch rolls
back every pose changed by that batch.

## Authoring and hosts

- Authoring save/reload retains original fields, parameters, bindings and relations.
  `state:"runtime"` is an explicit pose capture, not the default document save.
- Editor shows scene parameters and a selected object's bindings. Simple numeric
  parameters are editable with undo; expression structure stays editable as JSON.
  Derived transform inputs are read-only. **Detach selected object (keep appearance)**
  captures its compiled descriptor/pose and removes only its own bindings/relations.
- AI's `sceneDesign` capability teaches this schema only when selected. Ordinary
  placement does not require it, and complex geometry is not forced by this feature.
- Procedural modeling remains independent: a parameter can drive a primitive,
  control cage, surface, or Domain input that already accepts numeric data.

Regression coverage: `tests/sceneDesign.test.mjs`, Editor authoring tests, and the
[parameterized table example](../../assets/json/demo-show/design/parameterized-table.json).
