/**
 * Phase 1 core/command demo (Node).
 * Run: node examples/script/command-demo.mjs
 */
import {
  createCommandContext,
  executeCommands,
  getCommandSpec
} from "../../core/command/index.js";

const spec = getCommandSpec();
console.log("Registered commands:", spec.commands.map((item) => item.op).join(", "));

// Mixed JSONL + micro DSL (human-readable lines)
const script = `
scene.validate json={"worldInfo":{"boxModelList":[{"objType":"box","name":"demo","geometry":{"width":1,"height":1,"depth":1}}]}}
{"v":1,"op":"scene.load","args":{"sync":true,"json":{"worldInfo":{"boxModelList":[{"objType":"box","name":"demo","geometry":{"width":1,"height":1,"depth":1},"position":{"x":0,"y":0,"z":0}}]}}}}
scene.list
`;

const ctx = createCommandContext();
const result = await executeCommands(ctx, script);
console.log(JSON.stringify(result, null, 2));
