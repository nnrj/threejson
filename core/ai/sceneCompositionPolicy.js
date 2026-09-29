/** Shared composition guidance for planning, generation, editing and review. */
export const SCENE_SUPPORT_SURFACE_POLICY = `
Support-surface composition policy:
- Floors, ground planes, stages, plinths and display bases are optional scene content, not required rendering scaffolding. Absence of a support surface is not by itself a scene defect.
- Add a support surface when the user requests it or it is intrinsic to the depicted environment/action: a room interior's floor, a street's road, or walkable terrain in an outdoor environment. A physical object alone does not imply an extra floor; an object on a table does not also need a ground plane.
- Default to no extra support surface for isolated objects/product renders, scientific explainers/diagrams, text effects, space/abstract scenes, data graphics, and videos without a depicted ground-based environment. Use background, lighting, framing and negative space for composition instead of an unsolicited stage.
- Particle effects follow the same composition rule; an emitter does not need a floor or display base.
- Words such as realistic, complete, cinematic, 3D, showcase or video are not requests for a floor or pedestal. Example scenes demonstrate syntax, not mandatory scene dressing.
- Preserve structural parts of the subject (a lamp's foot, a building's own floor, a machine's chassis); those are not unrelated display platforms. Size any chosen environmental surface to the actual layout without adding duplicate support geometry.
- During edits/refinement/review, preserve existing authored surfaces unless the request changes them. Honor no-floor/transparent-background requests and never re-add a surface the user removed merely to make the scene look complete.
`;
