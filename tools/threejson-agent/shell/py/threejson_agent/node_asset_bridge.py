"""Spawn Node bridge/asset.mjs for asset search/import (shell must not import asset_provider)."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any


def bridge_script_path() -> Path:
    from .config import bridge_dir

    return bridge_dir() / "asset.mjs"


def asset_bridge_node(
    *,
    action: str,
    setting: dict[str, Any],
    project_root: Path,
    **kwargs: Any,
) -> dict[str, Any]:
    script = bridge_script_path()
    if not script.is_file():
        raise FileNotFoundError(f"Node asset bridge not found: {script}")

    payload: dict[str, Any] = {
        "action": action,
        "setting": setting,
        "projectRoot": str(project_root),
        **kwargs,
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
        raise RuntimeError(proc.stderr or proc.stdout or "asset bridge failed")
    data = json.loads(proc.stdout)
    if not data.get("ok"):
        raise RuntimeError(data.get("error") or "asset bridge returned not ok")
    return data
