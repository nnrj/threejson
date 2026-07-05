/**
 * Extract Chinese settings labels into zh-CN locale catalog.
 * Usage: node tools/dev/gen-host-settings-zh-cn.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(__dirname, "../scene-host/shared/js/editorSettingsSchema.js");
const outPath = path.join(__dirname, "../scene-host/shared/i18n/locales/zh-CN.json");

const source = fs.readFileSync(schemaPath, "utf8");
const transformed = source
  .replace(/^export /gm, "")
  .replace(/import .+ from .+;\n/gm, "");
const sandbox = {};
vm.runInNewContext(transformed + "\nthis.EDITOR_SETTINGS_SECTIONS = EDITOR_SETTINGS_SECTIONS;\nthis.EDITOR_SETTINGS_FIELDS = EDITOR_SETTINGS_FIELDS;", sandbox);

const catalog = {
  "settings.modal.title": "编辑器设置",
  "settings.modal.save": "保存",
  "settings.modal.cancel": "取消",
  "settings.modal.reset": "恢复默认"
};

for (const section of sandbox.EDITOR_SETTINGS_SECTIONS) {
  catalog[`settings.sections.${section.id}`] = section.title;
}
for (const field of sandbox.EDITOR_SETTINGS_FIELDS) {
  catalog[`settings.fields.${field.path}`] = field.label;
  if (field.hint) {
    catalog[`settings.hints.${field.path}`] = field.hint;
  }
  if (Array.isArray(field.options)) {
    for (const opt of field.options) {
      catalog[`settings.options.${field.path}.${opt.value}`] = opt.label;
    }
  }
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(catalog, null, 2) + "\n");
console.log("Wrote", Object.keys(catalog).length, "keys to", outPath);
