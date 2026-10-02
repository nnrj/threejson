// Procedural, self-contained reference shots; no downloaded textures or models.
// These are visual explanations, not claims of physical quantum simulation.
export function createCinematicFilm({ duration = 120, particles = 100000, backend = "webgl", fontUrl = "/assets/fonts/helvetiker_bold.typeface.json" } = {}) {
  const length = duration / 5, scenes = {}, clips = [], shots = {};
  const cloud = (id, color, source, count = particles) => ({ objType: "particleEmitter", threeJsonId: id, source,
    emission: { mode: "static", count, seed: 73 }, particle: { lifetime: 0, colorOverLife: [color], sizeOverLife: [.12] },
    simulation: { backend: "cpu" }, render: { type: "points", blending: "additive", depthWrite: false, opacity: Math.min(.15, .075 * 100000 / count) } });
  const title = (text, color = "#dbf6ff") => ({ objType: "text", threeJsonId: "title", mode: "sdf", content: text,
    fontSize: 2.2, color, align: "center", anchor: { x: .5, y: .5 }, billboard: true, position: { x: 0, y: 17, z: 0 }, sdf: { outlineWidth: .035, outlineColor: "#050919" } });
  const sphere = (id, x, y, z, radius, color) => ({ objType: "sphere", threeJsonId: id, position: { x, y, z }, geometry: { radius, widthSegments: 32, heightSegments: 20 }, material: { type: "basic", color } });
  const effect = (id, target, operator, params, start = 0, span = length) => ({ id, target, operator, params, start, duration: span, backend });
  const orbit = (id, target, center, radius, period, plane = "xz") => ({ id, target, property: "position", duration: length, signal: { type: "orbit", center, radius, duration: period, plane } });
  const base = (id, label, caption, objects, effects = [], tracks = []) => {
    const scene = { version: "next", threeJsonId: id, name: label,
      sceneConfig: { scene: { background: "#020510" }, camera: { position: { x: 0, y: 8, z: 62 }, fov: 46, near: .1, far: 1000, lookAt: { x: 0, y: 0, z: 0 } }, controls: { type: "none" }, renderer: { antialias: true, toneMapping: "aces", exposure: 1 },
        lights: [{ type: "ambient", intensity: .5 }, { type: "directional", intensity: 2, position: { x: 5, y: 12, z: 16 } }] },
      objectList: [title(label), ...objects,
        { objType: "pass", id: "dof", passType: "dof", focus: 62, aperture: .000035, maxblur: .007 },
        { objType: "pass", id: "glow", passType: "selectivebloom", targets: objects.filter(o => o.objType !== "text").map(o => o.threeJsonId), strength: .6, radius: .5, threshold: .65 },
        { objType: "pass", id: "grade", passType: "cinematic", vignette: .22, streak: .2, streakThreshold: .8 },
        { objType: "pass", id: "output", passType: "output" }],
      timeline: { version: 1, duration: length, effects, tracks: [
        { id: "dolly", target: "$camera", property: "position", signal: { type: "path", duration: length, points: [[-4, 8, 66], [4, 10, 61], [0, 8, 57]] } },
        { id: "aim", target: "$camera", property: "lookAt", keyframes: [{ time: 0, value: [0, 0, 0] }] }, ...tracks],
        captions: [{ id: "caption", text: caption, start: 1, duration: length - 2, fontSize: 32, y: .9, fadeIn: .6, fadeOut: .6, maxWidth: .86 }] } };
    const index = Object.keys(scenes).length; scenes[id] = scene; shots[id] = { title: label, intent: caption, stage: "complete" };
    clips.push({ id, source: id, start: index * length, duration: length }); return scene;
  };
  base("cloud", "从一个电子开始", "亮点是视觉示意，而不是电子沿固定轨道运动的实景。",
    [cloud("cloud", "#5ea8ff", { type: "sphere", radius: 16 }), sphere("core", 0, 0, 0, .65, "#ffffff")],
    [effect("swirl", "cloud", "swirl", { speed: .04, twist: .08 }), effect("ripple", "cloud", "wave", { amplitude: 1.1, frequency: .4, speed: .6 })]);
  base("human", "微小，组成宏大", "粒子汇聚成文字：同一组位置可以连续变形，而不必重写每一帧。",
    [cloud("letters", "#a6eaff", { type: "box", width: 46, height: 30, depth: 24 })],
    [{ ...effect("gather", "letters", "morph", { source: { type: "textMask", text: "人", font: "700 120px sans-serif", width: 32, height: 32, depth: .8, resolution: 512 }, seed: 21 }, 1, length * .35), stagger: .22, easing: "smoothstep" },
      { ...effect("scatter", "letters", "scatter", { seed: 33, distance: 28 }, length * .7, length * .28), easing: "smoothstep" }]);
  const rings = Array.from({ length: 5 }, (_, i) => ({ objType: "torus", threeJsonId: `ring-${i}`, geometry: { radius: 5 + i * 3.2, tube: .055, tubularSegments: 160, radialSegments: 5 }, rotation: { x: .9 + i * .12, y: i * .2, z: .1 }, material: { type: "basic", color: "#eeb661" } }));
  base("orbits", "从经典图像到量子描述", "轨道线是帮助理解的图示。量子态需要概率分布，而非确定路径。",
    [...rings, sphere("core", 0, 0, 0, .9, "#fff0b8"), cloud("tail", "#ffe1a2", { type: "sphere", radius: .5 }, 4000), ...Array.from({ length: 5 }, (_, i) => sphere(`electron-${i}`, 0, 0, 0, .22, "#d6eeff"))],
    [effect("orbit-tail", "tail", "flow", { path: { type: "ellipse", radius: 15, plane: "xz" }, speed: .08, length: .18, spread: .5 })],
    Array.from({ length: 5 }, (_, i) => orbit(`orbit-${i}`, `electron-${i}`, [0, 0, 0], 5 + i * 3.2, 5 + i * 2, "xz")));
  const steps = Array.from({ length: 7 }, (_, i) => ({ objType: "box", threeJsonId: `level-${i}`, position: { x: (i - 3) * 4.2, y: (i - 3) * 2, z: 0 }, geometry: { width: 4, height: .3, depth: 7 }, material: { type: "basic", color: "#69d9ff", wireframe: true } }));
  base("energy", "能量的阶梯", "E = hν。能量交换呈离散份额；阶梯是概念图，不是原子的真实结构。",
    [...steps, { objType: "text", threeJsonId: "formula", mode: "sdf", content: "E = hν", fontSize: 3.2, color: "#ffda93", position: { x: -13, y: 9, z: 0 } },
      { objType: "text", threeJsonId: "energy-label", mode: "mesh", content: "ENERGY", fontSize: 1.2, color: "#bf9563", position: { x: -12, y: 6, z: 0 }, mesh: { fontJsonUrl: fontUrl, depth: .2, bevelEnabled: true, bevelThickness: .04, bevelSize: .03 } }, sphere("packet", -13, -4, 0, .5, "#ffffff")], [],
    [{ id: "climb", target: "packet", property: "position", signal: { type: "path", duration: length * .8, interpolation: "linear", points: steps.map(s => [s.position.x, s.position.y + 1, 0]) } }]);
  base("waves", "波、粒子与测量", "传播、干涉和探测共同构成实验；这些程序化波纹只是视觉比喻。",
    [cloud("wave", "#68caff", { type: "box", width: 42, height: .08, depth: 36 }), sphere("emitter", 0, 0, 0, .6, "#ffffff")],
    [{ ...effect("front", "wave", "wavefront", { amplitude: 3, frequency: 1.7, speed: 2.5, width: 10 }, 0, 12), extrapolation: "loop" }]);
  return { documentType: "composition", compositionVersion: 1, name: "程序化科普镜头参考", output: { width: 1920, height: 1080, fps: 30 }, scenes,
    timeline: { version: 1, duration, clips }, production: { version: 1, state: "complete", brief: "五种可编辑的程序化视觉母题；不是物理仿真或自动生成质量承诺。", shots } };
}
