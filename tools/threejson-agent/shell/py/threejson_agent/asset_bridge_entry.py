"""Stdio JSON entry for Node bridge/asset.mjs — not for direct CLI use."""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from .asset_provider import COMPLIANCE_NOTICE, get_provider
from .asset_provider.user_urls import UserUrlProvider


def _run(payload: dict[str, Any]) -> dict[str, Any]:
    action = payload.get("action")
    setting = payload.get("setting") or {}
    project_root = Path(payload.get("projectRoot") or ".").resolve()
    mode = payload.get("mode")

    if action == "search":
        provider = get_provider(mode, setting)
        items = provider.search(str(payload.get("query") or ""), limit=int(payload.get("limit") or 10))
        out: dict[str, Any] = {"ok": True, "items": items}
        if (mode or setting.get("asset", {}).get("mode", "crawl")) == "crawl":
            out["complianceNotice"] = COMPLIANCE_NOTICE
        return out

    if action == "import":
        importer = UserUrlProvider(setting)
        if payload.get("filePath"):
            path = importer.import_file(Path(payload["filePath"]), project_root)
        elif payload.get("url"):
            path = importer.import_url(str(payload["url"]), project_root)
        else:
            raise ValueError("import requires url or filePath")
        return {"ok": True, "textureUrl": path}

    if action == "download_first":
        provider = get_provider(mode, setting)
        if not hasattr(provider, "download_first"):
            raise ValueError(f"provider does not support download_first: {mode}")
        paths = provider.download_first(
            str(payload.get("query") or ""),
            project_root,
            limit=int(payload.get("limit") or 1),
        )
        out: dict[str, Any] = {"ok": True, "paths": paths}
        if (mode or setting.get("asset", {}).get("mode", "crawl")) == "crawl":
            out["complianceNotice"] = COMPLIANCE_NOTICE
        return out

    raise ValueError(f"unknown action: {action}")


def main() -> None:
    raw = sys.stdin.buffer.read().decode("utf-8")
    payload = json.loads(raw or "{}")
    try:
        result = _run(payload)
    except Exception as exc:
        result = {"ok": False, "error": str(exc)}
    out = json.dumps(result, ensure_ascii=False)
    sys.stdout.buffer.write(out.encode("utf-8"))
    sys.stdout.buffer.flush()


if __name__ == "__main__":
    main()
