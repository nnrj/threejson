"""Load and merge setting.json for threejson-agent (CLI/GUI)."""
from __future__ import annotations

import json
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from typing import Any

# tools/threejson-agent/shell/py/threejson_agent/config.py
SHELL_PY_DIR = Path(__file__).resolve().parents[1]
# parents[2]=shell, parents[3]=threejson-agent (bridge/, setting.json live here)
PRODUCT_DIR = Path(__file__).resolve().parents[3]
AGENT_DIR = PRODUCT_DIR

DEFAULT_SETTING: dict[str, Any] = {
    "llm": {
        "provider": "chatgpt",
        "apiKey": "",
        "baseUrl": "",
        "model": "",
        "imageModel": "dall-e-3",
        "temperature": 0.2,
        "maxTokens": 4000,
    },
    "agent": {"enabled": False, "depth": "medium"},
    "texture": {
        "mode": "node_bridge",
        "localOutputDir": "assets/textures/ai-generated",
        "preferRemoteUrl": False,
        "overwriteExisting": False,
        "concurrency": 2,
    },
    "paths": {"redirectRelative": False},
    "asset": {
        "mode": "crawl",
        "searchApiKey": "",
        "searchEngine": "bing",
        "unsplashAccessKey": "",
        "allowlistDomains": [],
        "respectRobots": True,
        "maxConcurrent": 4,
        "htmlSearchTemplate": "https://duckduckgo.com/?q={query}&iax=images&ia=images",
    },
}


@dataclass(frozen=True)
class PathSettings:
    """Workspace for Node bridges; CLI relative -i/-o base when redirect is active."""

    workspace_root: Path
    redirect_active: bool
    relativet_root_raw: str
    warn_on_redirect: bool


def default_setting_path() -> Path:
    return PRODUCT_DIR / "setting.json"


def bridge_dir() -> Path:
    return PRODUCT_DIR / "bridge"


def shell_py_dir() -> Path:
    """Python CLI/GUI package root (threejson_agent module)."""
    return PRODUCT_DIR / "shell" / "py"


def _deep_merge(base: dict, override: dict) -> dict:
    out = deepcopy(base)
    for key, val in override.items():
        if isinstance(val, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], val)
        else:
            out[key] = val
    return out


def find_setting_path(start: Path | None = None) -> Path | None:
    """Resolve tools/threejson-agent/setting.json from *start* or cwd, then packaged default."""
    cur = (start or Path.cwd()).resolve()
    for _ in range(12):
        candidate = cur / "tools" / "threejson-agent" / "setting.json"
        if candidate.is_file():
            return candidate
        if cur.parent == cur:
            break
        cur = cur.parent
    product_file = PRODUCT_DIR / "setting.json"
    if product_file.is_file():
        return product_file
    return None


def load_setting(config_path: Path | str | None = None) -> tuple[dict[str, Any], Path]:
    if config_path:
        path = Path(config_path).resolve()
        if not path.is_file():
            raise FileNotFoundError(f"Config not found: {path}")
    else:
        found = find_setting_path(Path.cwd())
        if not found:
            return deepcopy(DEFAULT_SETTING), default_setting_path()
        path = found
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("setting.json root must be an object.")
    return _deep_merge(DEFAULT_SETTING, raw), path


def save_setting(data: dict[str, Any], config_path: Path) -> None:
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def path_settings_from_config(setting: dict[str, Any], config_path: Path) -> PathSettings:
    """
    Effective workspace: cwd unless paths.relativetRoot is non-empty AND paths.redirectRelative is true.
    relativetRoot is resolved relative to the setting file's directory.
    """
    paths = setting.get("paths") or {}
    rel = str(paths.get("relativetRoot") or "").strip()
    redirect = paths.get("redirectRelative") is True
    warn = paths.get("redirectRelativeWarn") is not False
    if rel and redirect:
        root = (config_path.parent / rel).resolve()
        return PathSettings(root, True, rel, warn)
    return PathSettings(Path.cwd().resolve(), False, rel, warn)


def project_root_from_setting(setting: dict[str, Any], config_path: Path) -> Path:
    """Backward-compatible alias for workspace_root."""
    return path_settings_from_config(setting, config_path).workspace_root
