"""OpenAI-compatible chat completions."""
from __future__ import annotations

import json
from typing import Any

import httpx

PROVIDER_DEFAULTS = {
    "deepseek": {
        "baseUrl": "https://api.deepseek.com/v1",
        "model": "deepseek-chat",
    },
    "chatgpt": {
        "baseUrl": "https://api.openai.com/v1",
        "model": "gpt-4o-mini",
    },
}


def resolve_llm_options(llm: dict[str, Any]) -> dict[str, Any]:
    provider = (llm.get("provider") or "chatgpt").strip().lower()
    defaults = PROVIDER_DEFAULTS.get(provider, {})
    base_url = (llm.get("baseUrl") or defaults.get("baseUrl") or "").rstrip("/")
    model = llm.get("model") or defaults.get("model") or "gpt-4o-mini"
    api_key = llm.get("apiKey") or ""
    if not api_key:
        raise ValueError("llm.apiKey is required in setting.json or CLI override.")
    return {
        "provider": provider,
        "baseUrl": base_url,
        "model": model,
        "apiKey": api_key,
        "temperature": float(llm.get("temperature", 0.2)),
        "maxTokens": int(llm.get("maxTokens", 4000)),
    }


def chat_completion(
    messages: list[dict[str, Any]],
    *,
    base_url: str,
    api_key: str,
    model: str,
    temperature: float = 0.2,
    max_tokens: int = 4000,
    timeout: float = 120.0,
) -> str:
    url = f"{base_url.rstrip('/')}/chat/completions"
    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    with httpx.Client(timeout=timeout) as client:
        resp = client.post(url, headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()
    choices = data.get("choices") or []
    if not choices:
        raise RuntimeError("Empty choices from chat API.")
    content = choices[0].get("message", {}).get("content")
    if not content:
        raise RuntimeError("Empty message content from chat API.")
    return str(content).strip()


def extract_json_text(text: str) -> str:
    s = text.strip()
    if s.startswith("```"):
        lines = s.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        s = "\n".join(lines).strip()
    start = s.find("{")
    end = s.rfind("}")
    if start >= 0 and end > start:
        return s[start : end + 1]
    return s
