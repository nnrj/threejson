"""Gradio GUI for threejson-agent — reads/writes tools/threejson-agent/setting.json."""
from __future__ import annotations

import json
import sys
from pathlib import Path

SHELL_PY_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SHELL_PY_DIR))

from threejson_agent.config import (  # noqa: E402
    default_setting_path,
    load_setting,
    path_settings_from_config,
    save_setting,
)
from threejson_agent.node_scene_bridge import run_scene_agent_node  # noqa: E402
from threejson_agent.texture_node import fill_textures_node  # noqa: E402
from threejson_agent.texture_python import fill_textures_python  # noqa: E402

try:
    import gradio as gr
except ImportError as exc:
    raise SystemExit("pip install -r tools/threejson-agent/shell/py/requirements.txt") from exc


def _load() -> tuple[dict, Path]:
    return load_setting(default_setting_path())


def _save(data: dict, path: Path) -> str:
    save_setting(data, path)
    return f"Saved {path}"


def ui_save_settings(
    provider,
    api_key,
    base_url,
    model,
    temperature,
    max_tokens,
    agent_enabled,
    agent_depth,
    texture_mode,
    local_output_dir,
) -> str:
    setting, path = _load()
    setting["llm"] = {
        "provider": provider,
        "apiKey": api_key,
        "baseUrl": base_url,
        "model": model,
        "temperature": float(temperature),
        "maxTokens": int(max_tokens),
    }
    setting["agent"] = {"enabled": agent_enabled, "depth": agent_depth}
    setting["texture"]["mode"] = texture_mode
    setting["texture"]["localOutputDir"] = local_output_dir
    return _save(setting, path)


def ui_generate(prompt, agent_enabled, agent_depth) -> str:
    setting, path = _load()
    root = path_settings_from_config(setting, path).workspace_root
    result = run_scene_agent_node(
        mode="generate",
        prompt=prompt,
        setting=setting,
        project_root=root,
        agent_enabled=agent_enabled,
        depth=agent_depth,
    )
    return result["sceneJsonString"]


def ui_texture_fill(scene_json, hint, texture_mode) -> str:
    setting, path = _load()
    ps = path_settings_from_config(setting, path)
    root = ps.workspace_root
    if ps.redirect_active and ps.warn_on_redirect:
        gr.Warning(
            f"paths.redirectRelative 已生效，工作区目录为 {root}（relativetRoot={ps.relativet_root_raw!r}）"
        )
    tmp = root / ".threejson-agent-gui-scene.json"
    tmp.write_text(scene_json, encoding="utf-8")
    if texture_mode == "python":
        result = fill_textures_python(
            scene_path=tmp, setting=setting, project_root=root, user_hint=hint
        )
    else:
        result = fill_textures_node(
            project_root=root, scene_path=tmp, setting=setting, user_hint=hint
        )
    return json.dumps(result, ensure_ascii=False, indent=2)


def build_app() -> gr.Blocks:
    setting, config_path = _load()
    llm = setting.get("llm", {})
    agent = setting.get("agent", {})
    tex = setting.get("texture", {})

    with gr.Blocks(title="ThreeJSON Agent") as demo:
        gr.Markdown(f"# ThreeJSON Agent\nConfig: `{config_path}`")
        with gr.Tab("Settings"):
            provider = gr.Dropdown(
                ["chatgpt", "deepseek", "custom"],
                value=llm.get("provider", "chatgpt"),
                label="Provider",
            )
            api_key = gr.Textbox(value=llm.get("apiKey", ""), label="API Key", type="password")
            base_url = gr.Textbox(value=llm.get("baseUrl", ""), label="Base URL")
            model = gr.Textbox(value=llm.get("model", ""), label="Model")
            temperature = gr.Slider(0, 1, value=float(llm.get("temperature", 0.2)), label="Temperature")
            max_tokens = gr.Number(value=int(llm.get("maxTokens", 4000)), label="Max tokens")
            agent_enabled = gr.Checkbox(value=bool(agent.get("enabled", False)), label="Agent enabled")
            agent_depth = gr.Dropdown(
                ["simple", "medium", "deep", "auto"],
                value=agent.get("depth", "medium"),
                label="Agent depth",
            )
            texture_mode = gr.Dropdown(
                ["node_bridge", "python"],
                value=tex.get("mode", "node_bridge"),
                label="Texture mode",
            )
            local_output_dir = gr.Textbox(
                value=tex.get("localOutputDir", "assets/textures/ai-generated"),
                label="Local output dir",
            )
            save_btn = gr.Button("Save setting.json")
            save_out = gr.Textbox(label="Status")
            save_btn.click(
                ui_save_settings,
                [
                    provider,
                    api_key,
                    base_url,
                    model,
                    temperature,
                    max_tokens,
                    agent_enabled,
                    agent_depth,
                    texture_mode,
                    local_output_dir,
                ],
                save_out,
            )
        with gr.Tab("Scene generate"):
            prompt = gr.Textbox(label="Prompt", lines=4)
            gen_agent = gr.Checkbox(label="Use agent", value=False)
            gen_depth = gr.Dropdown(["simple", "medium", "deep", "auto"], value="medium")
            gen_btn = gr.Button("Generate")
            gen_out = gr.Code(label="Scene JSON", language="json")
            gen_btn.click(ui_generate, [prompt, gen_agent, gen_depth], gen_out)
        with gr.Tab("Texture fill"):
            scene_json = gr.Code(label="Scene JSON", language="json", lines=12)
            hint = gr.Textbox(label="Hint")
            tex_mode = gr.Dropdown(["node_bridge", "python"], value=tex.get("mode", "node_bridge"))
            fill_btn = gr.Button("Fill textures")
            fill_out = gr.Textbox(label="Result")
            fill_btn.click(ui_texture_fill, [scene_json, hint, tex_mode], fill_out)
    return demo


if __name__ == "__main__":
    build_app().launch()
