"""Pure Python texture pointer walk + optional image API (no Node)."""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import httpx

from .llm_client import chat_completion, extract_json_text, resolve_llm_options


def list_texture_pointers(root: dict[str, Any]) -> list[str]:
    out: list[str] = []

    def walk_models(models: list, base: str) -> None:
        if not isinstance(models, list):
            return
        for i, model in enumerate(models):
            if not isinstance(model, dict):
                continue
            p = f"{base}/{i}"
            mat = model.get("material")
            if isinstance(mat, dict):
                out.append(f"{p}/material/textureUrl")
            children = model.get("children")
            if isinstance(children, list):
                walk_models(children, p)

    wi = root.get("worldInfo") or {}
    for key, val in wi.items():
        if key.endswith("List") and isinstance(val, list):
            walk_models(val, f"/worldInfo/{key}")
    return out


def fill_textures_python(
    *,
    scene_path: Path,
    setting: dict[str, Any],
    project_root: Path,
    user_hint: str = "",
    dry_run: bool = False,
) -> dict[str, Any]:
    scene_text = scene_path.read_text(encoding="utf-8")
    root = json.loads(scene_text)
    pointers = list_texture_pointers(root)
    llm = setting.get("llm", {})
    texture_cfg = setting.get("texture", {})
    local_dir = project_root / texture_cfg.get(
        "localOutputDir", "assets/textures/ai-generated"
    )

    if dry_run:
        return {"ok": True, "dryRun": True, "pointerCount": len(pointers), "pointers": pointers}

    if not pointers:
        return {"ok": True, "updated": False, "pointerCount": 0}

    opts = resolve_llm_options(llm)
    plan_prompt = (
        f"List texture generation tasks as JSON array: "
        f'[{{"pointer":"/worldInfo/boxModelList/0/material/textureUrl","prompt":"..."}}]. '
        f"Slots: {json.dumps(pointers)}. Hint: {user_hint}"
    )
    plan_raw = chat_completion(
        [{"role": "user", "content": plan_prompt}],
        base_url=opts["baseUrl"],
        api_key=opts["apiKey"],
        model=opts["model"],
        temperature=0.2,
        max_tokens=1500,
    )
    tasks = json.loads(extract_json_text(plan_raw))
    if not isinstance(tasks, list):
        raise ValueError("Texture plan must be a JSON array.")

    llm_cfg = setting.get("llm", {})
    img_key = opts["apiKey"]
    img_base = (llm_cfg.get("baseUrl") or "https://api.openai.com/v1").rstrip("/")
    img_model = llm_cfg.get("imageModel") or "dall-e-3"
    prefer_remote = bool(texture_cfg.get("preferRemoteUrl", False))
    local_dir.mkdir(parents=True, exist_ok=True)

    applied = 0
    for task in tasks:
        if not isinstance(task, dict):
            continue
        pointer = task.get("pointer")
        t_prompt = task.get("prompt") or user_hint or "seamless texture"
        if pointer not in pointers:
            continue
        url = _generate_image_url(img_base, img_key, img_model, t_prompt)
        value = url
        if not (prefer_remote and url.startswith("https://")):
            value = _download_to_local(url, local_dir, project_root, applied)
        _set_pointer(root, pointer, value)
        applied += 1

    out_path = scene_path
    out_path.write_text(json.dumps(root, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "updated": True, "pointerCount": len(pointers), "applied": applied}


def _generate_image_url(base: str, api_key: str, model: str, prompt: str) -> str:
    url = f"{base}/images/generations"
    payload = {"model": model, "prompt": prompt, "n": 1, "size": "1024x1024"}
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    with httpx.Client(timeout=120.0) as client:
        resp = client.post(url, headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()
    items = data.get("data") or []
    if not items:
        raise RuntimeError("No image data returned.")
    item = items[0]
    if item.get("url"):
        return str(item["url"])
    b64 = item.get("b64_json")
    if b64:
        return f"data:image/png;base64,{b64}"
    raise RuntimeError("Image response missing url/b64_json.")


def _download_to_local(url: str, local_dir: Path, project_root: Path, index: int) -> str:
    if url.startswith("data:image"):
        import base64

        header, _, data = url.partition(",")
        ext = "png"
        m = re.search(r"image/(\w+)", header)
        if m:
            ext = m.group(1).replace("jpeg", "jpg")
        raw = base64.b64decode(data)
    else:
        with httpx.Client(timeout=60.0) as client:
            resp = client.get(url)
            resp.raise_for_status()
            raw = resp.content
            ext = "png"
    name = f"ai-gen-{index}.{ext}"
    dest = local_dir / name
    dest.write_bytes(raw)
    rel = dest.relative_to(project_root).as_posix()
    return f"/{rel}" if not rel.startswith("/") else rel


def _set_pointer(root: dict, pointer: str, value: str) -> None:
    parts = [p for p in pointer.strip("/").split("/") if p]
    cur: Any = root
    for part in parts[:-1]:
        cur = cur[int(part)] if part.isdigit() else cur[part]
    leaf = parts[-1]
    if isinstance(cur, list):
        cur[int(leaf)] = value
    else:
        cur[leaf] = value
