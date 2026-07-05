"""Invoke Node bridge/texture-fill.mjs for fillTextureUrls."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any


def bridge_script_path() -> Path:
    from .config import bridge_dir

    return bridge_dir() / "texture-fill.mjs"


def fill_textures_node(
    *,
    project_root: Path,
    scene_path: Path,
    setting: dict[str, Any],
    user_hint: str = "",
    dry_run: bool = False,
) -> dict[str, Any]:
    script = bridge_script_path()
    if not script.is_file():
        raise FileNotFoundError(f"Node bridge not found: {script}")

    payload = {
        "projectRoot": str(project_root),
        "scenePath": str(scene_path.resolve()),
        "setting": setting,
        "userHint": user_hint,
        "dryRun": dry_run,
    }
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
        raise RuntimeError(proc.stderr or proc.stdout or "texture-fill bridge failed")
    return json.loads(proc.stdout)


def plan_textures_node(**kwargs: Any) -> dict[str, Any]:
    kwargs.pop("dry_run", None)
    return fill_textures_node(dry_run=True, **kwargs)
