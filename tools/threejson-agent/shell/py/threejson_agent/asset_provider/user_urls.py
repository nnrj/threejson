"""Mode B: user-supplied URLs or local files."""
from __future__ import annotations

import hashlib
import shutil
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

from .base import AssetProvider


class UserUrlProvider(AssetProvider):
    def search(self, query: str, limit: int = 10) -> list[dict[str, Any]]:
        return []

    def import_url(self, url: str, project_root: Path) -> str:
        with httpx.Client(timeout=60.0, follow_redirects=True) as client:
            resp = client.get(url)
            resp.raise_for_status()
            data = resp.content
        ext = _guess_ext(url, resp.headers.get("content-type", ""))
        return self._write_bytes(data, project_root, "url", ext)

    def import_file(self, file_path: Path, project_root: Path) -> str:
        data = file_path.read_bytes()
        ext = file_path.suffix.lstrip(".") or "png"
        dest_name = file_path.name
        out_dir = project_root / "assets/textures/imported/local"
        out_dir.mkdir(parents=True, exist_ok=True)
        dest = out_dir / dest_name
        shutil.copy2(file_path, dest)
        rel = dest.relative_to(project_root).as_posix()
        return f"/{rel}"

    def _write_bytes(self, data: bytes, project_root: Path, source: str, ext: str) -> str:
        h = hashlib.sha256(data).hexdigest()[:16]
        out_dir = project_root / "assets/textures/imported" / source
        out_dir.mkdir(parents=True, exist_ok=True)
        dest = out_dir / f"{h}.{ext}"
        dest.write_bytes(data)
        rel = dest.relative_to(project_root).as_posix()
        return f"/{rel}"


def _guess_ext(url: str, content_type: str) -> str:
    path = urlparse(url).path.lower()
    if path.endswith(".jpg") or path.endswith(".jpeg"):
        return "jpg"
    if path.endswith(".webp"):
        return "webp"
    if "jpeg" in content_type:
        return "jpg"
    if "webp" in content_type:
        return "webp"
    return "png"
