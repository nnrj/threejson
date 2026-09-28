/** Optional modeling inspector. It sends ordinary authoring transactions, never edits Three.js buffers. */
export function createSceneTreeModelingPanel(host) {
  const anchor = document.getElementById("sceneTreePropMeshSection");
  if (!anchor) return { sync() {} };
  const section = document.createElement("section"); section.className = "sceneTreePropSection"; section.hidden = true;
  const heading = document.createElement("div"); heading.className = "sceneTreePropSectionTitle"; heading.textContent = "参数化建模 · Modeling";
  const summary = document.createElement("p"); summary.className = "hint";
  const parameters = document.createElement("div"); parameters.className = "sceneTreePropGrid";
  const nodeLabel = document.createElement("label"); nodeLabel.textContent = "建模节点";
  const select = document.createElement("select"); select.id = "sceneTreeModelingNode"; nodeLabel.htmlFor = select.id;
  const nodeGrid = document.createElement("div"); nodeGrid.className = "sceneTreePropGrid"; nodeGrid.append(nodeLabel, select);
  const help = document.createElement("p"); help.className = "hint";
  const input = document.createElement("textarea"); input.rows = 7; input.setAttribute("aria-label", "节点参数 JSON");
  Object.assign(input.style, { width: "100%", maxWidth: "100%", boxSizing: "border-box", resize: "vertical" });
  const actions = document.createElement("div"); Object.assign(actions.style, { display: "flex", gap: "6px", flexWrap: "wrap" });
  const button = (label, callback) => { const b = document.createElement("button"); b.type = "button"; b.className = "miniBtn"; b.textContent = label; b.addEventListener("click", callback); actions.append(b); return b; };
  let current = null, generation = 0, busy = false;
  const pointer = (text) => String(text).replace(/~/g, "~0").replace(/\//g, "~1");
  const refresh = () => { host.getSceneTree()?.render?.(); host.getSceneTree()?.syncPropInputs?.(host.getSelectedObject()); };
  const disable = (value) => section.querySelectorAll("input, select, textarea, button").forEach((control) => { control.disabled = value; });
  async function run(op, args) {
    if (busy || !current) return;
    busy = true; disable(true);
    try {
      const batch = await host.getCommandLayer().runBatch([{ op, args: { id: current.threeJsonId, baseRevision: current.modelRevision || 0, ...args } }], { label: "更新参数化模型" });
      if (batch?.ok === false || batch?.results?.some((r) => !r.ok)) throw new Error(batch.results?.find((r) => !r.ok)?.error || "建模更新失败");
      host.showMessage?.("模型已更新，可撤销。", "success"); refresh();
    } catch (error) { host.showMessage?.(`模型未更新：${error.message}`, "error"); refresh(); }
    finally { busy = false; disable(false); }
  }
  const apply = button("应用节点参数", () => {
    if (!current) return;
    try {
      const params = JSON.parse(input.value);
      if (!params || typeof params !== "object" || Array.isArray(params)) throw new Error("节点参数必须是 JSON 对象");
      const i = current.modeling.nodes.findIndex((n) => n.id === select.value);
      if (i < 0) return;
      run("model.patch", { patch: [{ op: current.modeling.nodes[i].params ? "replace" : "add", path: `/nodes/${i}/params`, value: params }] });
    } catch (error) { host.showMessage?.(error.message, "error"); }
  });
  const bake = button("烘焙为普通网格（可撤销）", () => run("model.bake", {}));
  async function showNode() {
    const token = ++generation, node = current?.modeling.nodes.find((n) => n.id === select.value);
    input.value = JSON.stringify(node?.params || {}, null, 2); help.textContent = "参数中可引用 {\"param\":\"参数名\"}。连接和完整建模图可在场景 JSON 中编辑。";
    if (!node) return;
    try {
      const batch = await host.getCommandLayer().runBatch([{ op: "model.operators", args: { id: node.operator } }]);
      const contract = batch?.results?.[0]?.data?.operators?.find((op) => op.version === (node.version || 1));
      if (token === generation && contract) help.textContent = `${node.operator}@${contract.version} · ${contract.description} · ${contract.backends.join(" / ") || "子图组合"}`;
    } catch { /* the graph is still editable if registry help is unavailable */ }
  }
  select.addEventListener("change", showNode);
  section.append(heading, summary, parameters, nodeGrid, help, input, actions); anchor.before(section);
  return {
    sync(object) {
      const descriptor = object?.userData?.objJson;
      current = String(descriptor?.objType || "").toLowerCase() === "modeledmesh" ? descriptor : null;
      section.hidden = !current; ++generation;
      if (!current) return;
      const selectedNode = select.value; select.replaceChildren(); parameters.replaceChildren();
      const triangles = (object.geometry?.index?.count ?? object.geometry?.attributes.position?.count ?? 0) / 3;
      summary.textContent = `${current.modeling.nodes.length} 个节点 · ${Math.round(triangles)} 个三角面 · revision ${current.modelRevision || 0}。保存的是建模过程；烘焙后才转为完整坐标。`;
      for (const [name, value] of Object.entries(current.modeling.parameters || {})) {
        const label = document.createElement("label"), control = document.createElement("input");
        control.id = `modeling-param-${parameters.childElementCount}`; label.htmlFor = control.id; label.textContent = name;
        control.type = typeof value === "number" ? "number" : "text"; control.step = "any";
        control.value = JSON.stringify(value); control.setAttribute("aria-label", name);
        control.addEventListener("change", () => {
          try { const next = JSON.parse(control.value); run("model.patch", { patch: [{ op: "replace", path: `/parameters/${pointer(name)}`, value: next }] }); }
          catch { host.showMessage?.("请输入有效的数值或 JSON 参数。", "error"); }
        });
        parameters.append(label, control);
      }
      for (const node of current.modeling.nodes) { const option = document.createElement("option"); option.value = node.id; option.textContent = `${node.id} · ${node.operator}${node.part ? ` · ${node.part}` : ""}`; select.append(option); }
      if (current.modeling.nodes.some((n) => n.id === selectedNode)) select.value = selectedNode;
      showNode();
      disable(busy);
    }
  };
}
