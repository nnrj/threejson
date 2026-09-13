/** Host UI for optional scene parameters. Runtime/core never depend on this panel. */
export function createSceneTreeDesignPanel(host) {
  const section = document.getElementById("sceneTreeDesignSection"), summary = document.getElementById("sceneTreeDesignSummary");
  const fields = document.getElementById("sceneTreeDesignParameters"), detach = document.getElementById("sceneTreeDesignDetach");
  let selectedId = "";
  const refresh = () => {
    const scene = host.getScene(); let selected = null;
    scene?.traverse((object) => { if (object.userData?.objJson?.threeJsonId === selectedId) selected = object; });
    host.setSelectedObject?.(selected);
    host.getSceneTree?.()?.render?.(); host.getSceneTree?.()?.syncPropInputs?.(selected);
  };
  const submit = async (action) => {
    try { await action(); refresh(); host.showMessage?.("设计已更新，可撤销。", "success"); }
    catch (error) { host.showMessage?.(`设计未更新：${error.message}`, "error"); refresh(); }
  };
  detach?.addEventListener("click", () => submit(() => host.getAuthoringSession().detachDesignObject(selectedId)));
  return {
    sync(model) {
      if (!section || !fields) return;
      selectedId = model?.userData?.objJson?.threeJsonId || "";
      const design = host.getAuthoringSession?.()?.session?.document?.root?.design;
      section.hidden = !design;
      fields.replaceChildren();
      for (const name of ["Position", "Rotation", "Scale"]) {
        const input = document.getElementById(`sceneTreeProp${name}`);
        if (input) { input.readOnly = false; input.removeAttribute("aria-description"); }
      }
      if (!design) return;
      const bindings = (design.bindings || []).filter((binding) => binding.object === selectedId);
      const relations = (design.relations || []).filter((relation) => relation.object === selectedId);
      const controlled = new Set(bindings.map((binding) => binding.path.split("/")[1]));
      for (const relation of relations) {
        if (relation.type === "attach") controlled.add("position");
        if (relation.type === "lookAt" || relation.orientation === "target") { controlled.add("rotation"); controlled.add("quaternion"); }
      }
      if (controlled.has("quaternion")) controlled.add("rotation");
      for (const name of ["Position", "Rotation", "Scale"]) {
        const input = document.getElementById(`sceneTreeProp${name}`);
        if (input && controlled.has(name.toLowerCase())) {
          input.readOnly = true; input.setAttribute("aria-description", "由设计参数或关系驱动。修改下方参数，或解除所选对象绑定后编辑。");
        }
      }
      summary.textContent = controlled.size ? `所选对象由设计驱动：${[...controlled].join("、")}。修改参数，或保留当前外观并解除绑定。` : "场景参数（全场景共享）。表达式及对象关系可在 JSON 的 design 中编辑。";
      detach.hidden = !controlled.size;
      for (const [id, definition] of Object.entries(design.parameters || {})) {
        const editable = typeof definition === "number" || (definition && typeof definition.value === "number" && !definition.expr && !definition.op);
        const label = document.createElement("label"), input = document.createElement("input");
        input.id = `scene-design-parameter-${fields.childElementCount}`; label.htmlFor = input.id;
        label.textContent = `${id}${definition?.unit ? ` (${definition.unit})` : ""}`;
        input.type = editable ? "number" : "text"; input.step = "any";
        input.readOnly = !editable;
        input.value = editable ? String(typeof definition === "number" ? definition : definition.value) : JSON.stringify(definition);
        input.title = editable ? "修改后更新所有依赖对象；可撤销。" : "派生表达式，请在场景 JSON 中编辑。";
        if (editable) input.addEventListener("change", () => {
          if (!input.value.trim() || !input.checkValidity()) { refresh(); return; }
          return submit(() => host.getAuthoringSession().setDesignParameter(id, Number(input.value)));
        });
        fields.append(label, input);
      }
    }
  };
}
