"""Invoke Node bridge/scene-agent.mjs (canonical runSceneAgent)."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any, Callable


def bridge_script_path() -> Path:
    from .config import bridge_dir

    return bridge_dir() / "scene-agent.mjs"


def _normalize_mode(mode: str) -> str:
    m = (mode or "generate").strip().lower().replace("-", "_")
    if m in ("from_image", "fromimage"):
        return "fromImage"
    if m == "update":
        return "update"
    return "generate"


def run_scene_agent_node(
    *,
    mode: str,
    prompt: str,
    setting: dict[str, Any],
    project_root: Path,
    current_scene: str | None = None,
    image: str | None = None,
    scene_path: Path | None = None,
    agent_enabled: bool | None = None,
    depth: str | None = None,
    fill_textures: bool = False,
    update_mode: str | None = None,
    output_mode: str | None = None,
    prefer_commands: bool | None = None,
    include_full_json: bool | None = None,
    stream: bool = False,
    stream_preview: bool = False,
    on_progress: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    script = bridge_script_path()
    if not script.is_file():
        raise FileNotFoundError(f"Node bridge not found: {script}")

    ag = setting.get("agent", {})
    payload: dict[str, Any] = {
        "projectRoot": str(project_root),
        "mode": _normalize_mode(mode),
        "prompt": prompt,
        "setting": setting,
        "fillTextures": fill_textures,
        "agentEnabled": ag.get("enabled", False) if agent_enabled is None else agent_enabled,
        "depth": depth or ag.get("depth", "simple"),
    }
    if current_scene is not None:
        payload["currentSceneJsonString"] = current_scene
    if image:
        payload["image"] = image
    if scene_path is not None:
        payload["scenePath"] = str(scene_path.resolve())
    if update_mode:
        payload["updateMode"] = update_mode
    if output_mode:
        payload["outputMode"] = output_mode
    if prefer_commands is True:
        payload["preferCommands"] = True
    if include_full_json is True:
        payload["includeFullJson"] = True
    if stream:
        payload["stream"] = True
    if stream_preview:
        payload["streamPreview"] = True

    proc = subprocess.run(
        ["node", str(script)],
        input=json.dumps(payload),
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        cwd=str(project_root),
        check=False,
    )
    if proc.stderr and on_progress:
        for line in proc.stderr.splitlines():
            line = line.strip()
            if line:
                on_progress(line)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr or proc.stdout or "scene-agent bridge failed")
    data = json.loads(proc.stdout)
    if not data.get("ok"):
        raise RuntimeError(data.get("error") or "scene-agent bridge returned not ok")
    return {
        "sceneJsonString": data.get("sceneJsonString"),
        "commandScript": data.get("commandScript"),
        "commands": data.get("commands"),
        "outputMode": data.get("outputMode"),
        "fallbackUsed": data.get("fallbackUsed"),
        "fallbackReason": data.get("fallbackReason"),
        "agentUsed": data.get("agentUsed", False),
        "steps": data.get("steps"),
        "tokenHint": data.get("tokenHint"),
    }


def run_scene_update_commands_node(
    *,
    prompt: str,
    setting: dict[str, Any],
    project_root: Path,
    current_scene: str | None = None,
    scene_path: Path | None = None,
    output_mode: str = "commands",
    update_mode: str | None = None,
    include_full_json: bool | None = None,
    apply_document: bool = False,
) -> dict[str, Any]:
    from .config import bridge_dir

    script = bridge_dir() / "scene-update-commands.mjs"
    if not script.is_file():
        raise FileNotFoundError(f"Node bridge not found: {script}")

    payload: dict[str, Any] = {
        "projectRoot": str(project_root),
        "prompt": prompt,
        "setting": setting,
        "outputMode": output_mode,
        "applyDocument": apply_document,
    }
    if current_scene is not None:
        payload["currentSceneJsonString"] = current_scene
    if scene_path is not None:
        payload["scenePath"] = str(scene_path.resolve())
    if update_mode:
        payload["updateMode"] = update_mode
    if include_full_json is True:
        payload["includeFullJson"] = True

    proc = subprocess.run(
        ["node", str(script)],
        input=json.dumps(payload),
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        cwd=str(project_root),
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr or proc.stdout or "scene-update-commands bridge failed")
    data = json.loads(proc.stdout)
    if not data.get("ok"):
        raise RuntimeError(data.get("error") or "scene-update-commands bridge returned not ok")
    return data
