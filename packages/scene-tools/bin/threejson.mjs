#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createSceneToolHost } from "../js/index.js";
import { reserveStdoutForProtocol } from "../js/stdio.js";

reserveStdoutForProtocol();

const [command = "help", ...tokens] = process.argv.slice(2);
const flags = {};
const host = createSceneToolHost();
let result;
try {
  for (let i = 0; i < tokens.length; i++) {
    if (!tokens[i].startsWith("--")) throw new Error(`Expected --option, received ${tokens[i]}`);
    const key = tokens[i].slice(2); flags[key] = tokens[i + 1] && !tokens[i + 1].startsWith("--") ? tokens[++i] : true;
  }
  if (command === "help") result = { ok: true, usage: ["threejson discover", "threejson query --file scene.json [--args '{...}']", "threejson preflight --file scene.json --commands edits.json", "threejson apply --file scene.json --commands edits.json [--output edited.json | --write]", "threejson check --file scene.json --args '{\"assertions\":[...]}'", "threejson browser-check --file scene.json", "threejson media-export --file scene.json --output movie.mp4 --browser PATH [--config media.json --fps 30 --end 8]", "threejson mcp"], note: "No AI calls or browser downloads by default. Media export refuses to overwrite outputs. Scene writes require --expected-version HASH or --write with the opened source version." };
  else if (command === "mcp") { const { createSceneMcpServer } = await import("../js/mcp.js"); await createSceneMcpServer().start(); }
  else if (command === "discover") result = host.discover();
  else if (command === "browser-check") { const { verifySceneInBrowser } = await import("../js/browser.js"); result = await verifySceneInBrowser({ file: flags.file, executablePath: flags.browser, capabilities: flags.capabilities ? flags.capabilities.split(",") : [] }); }
  else if (command === "media-export") {
    const { renderSceneMedia } = await import("../js/media.js");
    const configuration = flags.config || flags.options;
    const options = configuration ? JSON.parse(await readFile(configuration, "utf8")) : {};
    if(configuration)for(const key of ["file","output","executablePath"])if(options[key])options[key]=path.resolve(path.dirname(path.resolve(configuration)),options[key]);
    const controller = new AbortController(), cancel = () => controller.abort(); process.once("SIGINT", cancel);
    try {
      result = await renderSceneMedia({ ...options, file: flags.file || options.file, output: flags.output || options.output, format: flags.format || options.format, executablePath: flags.browser || options.executablePath, signal: controller.signal,
        mediaOptions: { ...options.mediaOptions, ...Object.fromEntries(["width", "height", "fps", "start", "end", "time"].filter((key) => flags[key] !== undefined).map((key) => [key, Number(flags[key])])) } });
    } finally { process.removeListener("SIGINT", cancel); }
  }
  else if (command === "editor-bridge") {
    const { startEditorBridge } = await import("../js/editor-bridge.js");
    const bridge = await startEditorBridge({ origin: flags.origin, port: Number(flags.port) || 0 });
    result = { ok: true, url: bridge.url, pairingUrl: bridge.pairingUrl, agentToken: bridge.agentToken, expiresAt: bridge.expiresAt, note: "Enter pairingUrl in Editor Settings > Connect local scene tools. Treat both tokens as secrets; neither is saved. Ctrl+C closes the relay." };
    process.once("SIGINT", () => void bridge.close()); process.once("SIGTERM", () => void bridge.close());
  }
  else if (command === "editor-call" || command === "editor-result") {
    const { callEditorBridge } = await import("../js/editor-bridge.js");
    if (!flags.options) throw new Error("--options FILE with relay credentials is required (avoid tokens in shell arguments).");
    result = await callEditorBridge(JSON.parse(await readFile(flags.options, "utf8")));
  }
  else if (["ai", "texture", "asset-search", "asset-import"].includes(command)) {
    const options = flags.options ? JSON.parse(await readFile(flags.options, "utf8")) : {};
    if (flags.config) options.setting = JSON.parse(await readFile(flags.config, "utf8"));
    if (flags.file) options.scenePath = flags.file;
    if (flags.prompt) options.prompt = flags.prompt;
    if (flags.mode) options.mode = flags.mode;
    options.writeScene = flags.write === true;
    const controller = new AbortController(), cancel = () => controller.abort(); process.once("SIGINT", cancel);
    try {
      options.signal = controller.signal;
      if (command === "ai") result = await (await import("../js/ai.js")).runSceneAi(options);
      if (command === "texture") result = await (await import("../js/texture-fill.mjs")).runTextureFill(options);
      if (command === "asset-search") result = await (await import("../js/assets.js")).searchAssets(options);
      if (command === "asset-import") result = await (await import("../js/assets.js")).importAsset(options);
    } finally { process.removeListener("SIGINT", cancel); }
  }
  else {
    const opened = await host.open({ file: flags.file, runtime: flags.runtime === true });
    const sessionId = opened.sessionId, args = flags.args ? JSON.parse(flags.args) : {};
    const controller = new AbortController(); const cancel = () => controller.abort(); process.once("SIGINT", cancel);
    try {
      if (command === "apply" || command === "preflight") {
        if (!flags.commands) throw new Error("--commands FILE is required.");
        const text = await readFile(flags.commands, "utf8");
        let commands; try { commands = JSON.parse(text); } catch { commands = text; }
        result = await host[command]({ sessionId, commands, requestId: flags["request-id"], baseRevision: opened.revision, signal: controller.signal });
      } else if (["query", "observe", "check", "capture"].includes(command)) result = await host[command]({ sessionId, ...args });
      else if (command === "export") result = await host.export({ sessionId, format: flags.format || "standard" });
      else throw new Error(`Unknown command: ${command}`);
      if (result.ok && (flags.output || flags.write) && command !== "preflight") result = { ...result, saved: await host.export({ sessionId, file: flags.output || flags.file, expectedFileVersion: flags["expected-version"], format: flags.format || "standard" }) };
      if (!result.ok) process.exitCode = result.status === "cancelled" ? 130 : 1;
      if (command === "check" && result.checks?.postconditions !== "passed") process.exitCode = 1;
    } finally { process.removeListener("SIGINT", cancel); }
  }
  if (command === "help") result.usage.push("threejson editor-bridge --origin https://editor.example.org", "threejson editor-call --options call.local.json", "threejson editor-result --options lookup.local.json", "threejson ai --options ai.local.json [--write]", "threejson texture --options texture.local.json [--write]", "threejson asset-search --options search.local.json", "threejson asset-import --options import.local.json");
} catch (error) { result = { ok: false, code: error.code || "CLI_FAILED", error: error.message }; process.exitCode = 1; }
finally { await host.dispose(); }
if (result) { if (result.ok === false) process.exitCode = 1; process.stdout.write(`${JSON.stringify(result)}\n`); }
