"""Click CLI for threejson-agent."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import click

from .config import (
    PRODUCT_DIR,
    PathSettings,
    default_setting_path,
    load_setting,
    path_settings_from_config,
)
from .node_scene_bridge import run_scene_agent_node
from .texture_node import fill_textures_node, plan_textures_node
from .texture_python import fill_textures_python
from .node_asset_bridge import asset_bridge_node

_REDIRECT_PREFIX = "[threejson-agent]"


def _path_settings(ctx: click.Context) -> PathSettings:
    return ctx.obj["path_settings"]


def _emit_redirect_notice(
    ps: PathSettings, kind: str, raw: Path, resolved: Path
) -> None:
    label = "输入" if kind == "input" else "输出"
    click.echo(
        f"{_REDIRECT_PREFIX} paths.redirectRelative 已生效：{label}相对路径 "
        f'"{raw}" → {resolved}（relativetRoot="{ps.relativet_root_raw}"，'
        f"基准目录 {ps.workspace_root}）",
        err=True,
    )


def _resolve_cli_path(
    ctx: click.Context,
    path: Path,
    *,
    must_exist: bool = True,
    kind: str = "input",
) -> Path:
    """Resolve CLI file paths: cwd by default; workspace_root when redirect is active."""
    ps = _path_settings(ctx)
    if path.is_absolute():
        resolved = path.resolve()
    elif ps.redirect_active:
        resolved = (ps.workspace_root / path).resolve()
        if ps.warn_on_redirect:
            _emit_redirect_notice(ps, kind, path, resolved)
    else:
        resolved = path.resolve()
    if must_exist and not resolved.is_file():
        hint = (
            f" (relative paths use cwd; enable paths.redirectRelative + paths.relativetRoot "
            f"to base under {ps.workspace_root})"
            if not ps.redirect_active
            else f" (resolved under workspace {ps.workspace_root})"
        )
        raise click.BadParameter(f"Path '{path}' does not exist at '{resolved}'{hint}")
    return resolved


def _resolve_cli_output_path(ctx: click.Context, path: Path | None) -> Path:
    ps = _path_settings(ctx)
    if path is None:
        base = ps.workspace_root if ps.redirect_active else Path.cwd()
        return (base / "ai-scene-output.json").resolve()
    if path.is_absolute():
        return path.resolve()
    if ps.redirect_active:
        resolved = (ps.workspace_root / path).resolve()
        if ps.warn_on_redirect:
            _emit_redirect_notice(ps, "output", path, resolved)
        return resolved
    return path.resolve()


def _resolve_image_arg(ctx: click.Context, image: str) -> str:
    s = image.strip()
    if not s:
        return s
    lower = s.lower()
    if lower.startswith("http://") or lower.startswith("https://") or lower.startswith(
        "data:image/"
    ):
        return s
    return str(_resolve_cli_path(ctx, Path(s), kind="input"))


def _warn_agent(enabled: bool, depth: str) -> None:
    if enabled:
        click.echo(
            f"Agent enabled (depth={depth}); expect multiple LLM rounds and higher token use.",
            err=True,
        )


@click.group()
@click.option(
    "--config",
    "-c",
    "config_path",
    type=click.Path(exists=True, dir_okay=False, path_type=Path),
    default=None,
    help="Path to setting.json (default: auto-discover under cwd or product dir)",
)
@click.pass_context
def main(ctx: click.Context, config_path: Path | None) -> None:
    setting, path = load_setting(config_path)
    ps = path_settings_from_config(setting, path)
    ctx.ensure_object(dict)
    ctx.obj["setting"] = setting
    ctx.obj["config_path"] = path
    ctx.obj["path_settings"] = ps
    ctx.obj["project_root"] = ps.workspace_root


@main.group("scene")
def scene_group() -> None:
    """Generate or update scene JSON."""


def _write_scene(ctx: click.Context, text: str, output: Path | None) -> Path:
    out = _resolve_cli_output_path(ctx, output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8")
    click.echo(f"Wrote {out}")
    return out


@scene_group.command("generate")
@click.option("--prompt", required=True)
@click.option("--output", "-o", type=click.Path(path_type=Path), default=None)
@click.option("--agent/--no-agent", default=None)
@click.option("--depth", default=None)
@click.option("--stream", is_flag=True, default=False, help="Stream LLM response (Node bridge)")
@click.option("--stream-preview", is_flag=True, default=False, help="Echo stream deltas to stderr")
@click.pass_context
def scene_generate(ctx, prompt, output, agent, depth, stream, stream_preview) -> None:
    setting = ctx.obj["setting"]
    ag = setting.get("agent", {})
    enabled = ag.get("enabled", False) if agent is None else agent
    d = depth or ag.get("depth", "medium")
    _warn_agent(enabled, d)
    result = run_scene_agent_node(
        mode="generate",
        prompt=prompt,
        setting=setting,
        project_root=ctx.obj["project_root"],
        agent_enabled=enabled,
        depth=d,
        stream=stream,
        stream_preview=stream_preview,
        on_progress=click.echo,
    )
    _write_scene(ctx, result["sceneJsonString"], output)


@scene_group.command("update")
@click.option("--prompt", required=True)
@click.option("--input", "-i", "input_path", type=click.Path(path_type=Path, dir_okay=False), required=True)
@click.option("--output", "-o", type=click.Path(path_type=Path), default=None)
@click.option("--update-mode", type=click.Choice(["full", "incremental"]), default="full")
@click.option("--agent/--no-agent", default=None)
@click.option("--depth", default=None)
@click.option("--stream", is_flag=True, default=False)
@click.option("--stream-preview", is_flag=True, default=False)
@click.pass_context
def scene_update(ctx, prompt, input_path, output, update_mode, agent, depth, stream, stream_preview) -> None:
    setting = ctx.obj["setting"]
    input_path = _resolve_cli_path(ctx, input_path)
    ag = setting.get("agent", {})
    enabled = ag.get("enabled", False) if agent is None else agent
    d = depth or ag.get("depth", "medium")
    _warn_agent(enabled, d)
    current = input_path.read_text(encoding="utf-8")
    result = run_scene_agent_node(
        mode="update",
        prompt=prompt,
        setting=setting,
        project_root=ctx.obj["project_root"],
        agent_enabled=enabled,
        depth=d,
        current_scene=current,
        update_mode=update_mode,
        stream=stream,
        stream_preview=stream_preview,
        on_progress=click.echo,
    )
    out = _resolve_cli_output_path(ctx, output) if output is not None else input_path
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(result["sceneJsonString"], encoding="utf-8")
    click.echo(f"Wrote {out}")


@scene_group.command("from-image")
@click.option("--image", required=True, help="Image file path or https URL")
@click.option("--prompt", default="")
@click.option("--output", "-o", type=click.Path(path_type=Path), default=None)
@click.option("--agent/--no-agent", default=None)
@click.option("--depth", default=None)
@click.option("--stream", is_flag=True, default=False)
@click.option("--stream-preview", is_flag=True, default=False)
@click.pass_context
def scene_from_image(
    ctx, image, prompt, output, agent, depth, stream, stream_preview
) -> None:
    setting = ctx.obj["setting"]
    ag = setting.get("agent", {})
    enabled = ag.get("enabled", False) if agent is None else agent
    d = depth or ag.get("depth", "medium")
    result = run_scene_agent_node(
        mode="from_image",
        prompt=prompt,
        image=_resolve_image_arg(ctx, image),
        setting=setting,
        project_root=ctx.obj["project_root"],
        agent_enabled=enabled,
        depth=d,
        stream=stream,
        stream_preview=stream_preview,
        on_progress=click.echo,
    )
    _write_scene(ctx, result["sceneJsonString"], output)


@main.group("asset")
def asset_group() -> None:
    """Search/import third-party assets (see README compliance)."""


@asset_group.command("search")
@click.option("--query", required=True)
@click.option("--mode", type=click.Choice(["crawl", "api", "user", "allowlist"]), default=None)
@click.option("--limit", default=10)
@click.pass_context
def asset_search(ctx, query, mode, limit) -> None:
    setting = ctx.obj["setting"]
    result = asset_bridge_node(
        action="search",
        setting=setting,
        project_root=ctx.obj["project_root"],
        query=query,
        mode=mode,
        limit=limit,
    )
    if result.get("complianceNotice"):
        click.echo(result["complianceNotice"], err=True)
    click.echo(json.dumps(result.get("items", []), ensure_ascii=False, indent=2))


@asset_group.command("import")
@click.option("--url", default=None)
@click.option("--file", "file_path", type=click.Path(path_type=Path, dir_okay=False), default=None)
@click.pass_context
def asset_import(ctx, url, file_path) -> None:
    root = ctx.obj["project_root"]
    setting = ctx.obj["setting"]
    if file_path:
        resolved = _resolve_cli_path(ctx, file_path)
        result = asset_bridge_node(
            action="import",
            setting=setting,
            project_root=root,
            filePath=str(resolved),
        )
    elif url:
        result = asset_bridge_node(
            action="import",
            setting=setting,
            project_root=root,
            url=url,
        )
    else:
        raise click.UsageError("Provide --url or --file")
    click.echo(json.dumps({"textureUrl": result["textureUrl"]}, ensure_ascii=False, indent=2))


@main.group("texture")
def texture_group() -> None:
    """Texture plan/fill."""


@texture_group.command("plan")
@click.option("--input", "-i", "input_path", type=click.Path(path_type=Path, dir_okay=False), required=True)
@click.option("--mode", type=click.Choice(["node_bridge", "python"]), default=None)
@click.pass_context
def texture_plan(ctx, input_path, mode) -> None:
    setting = ctx.obj["setting"]
    root = ctx.obj["project_root"]
    input_path = _resolve_cli_path(ctx, input_path)
    m = mode or setting.get("texture", {}).get("mode", "node_bridge")
    if m == "python":
        result = fill_textures_python(
            scene_path=input_path,
            setting=setting,
            project_root=root,
            dry_run=True,
        )
    else:
        result = plan_textures_node(
            project_root=root,
            scene_path=input_path,
            setting=setting,
            dry_run=True,
        )
    click.echo(json.dumps(result, ensure_ascii=False, indent=2))


@texture_group.command("fill")
@click.option("--input", "-i", "input_path", type=click.Path(path_type=Path, dir_okay=False), required=True)
@click.option("--mode", type=click.Choice(["node_bridge", "python"]), default=None)
@click.option("--hint", default="")
@click.pass_context
def texture_fill(ctx, input_path, mode, hint) -> None:
    setting = ctx.obj["setting"]
    root = ctx.obj["project_root"]
    input_path = _resolve_cli_path(ctx, input_path)
    m = mode or setting.get("texture", {}).get("mode", "node_bridge")
    if m == "python":
        result = fill_textures_python(
            scene_path=input_path,
            setting=setting,
            project_root=root,
            user_hint=hint,
        )
    else:
        result = fill_textures_node(
            project_root=root,
            scene_path=input_path,
            setting=setting,
            user_hint=hint,
        )
    click.echo(json.dumps(result, ensure_ascii=False, indent=2))


@main.command("run")
@click.option("--prompt", required=True)
@click.option("--output", "-o", type=click.Path(path_type=Path), default=None)
@click.option("--fill-textures/--no-fill-textures", default=False)
@click.option("--asset-query", default=None, help="Optional asset search before texture fill")
@click.option("--asset-mode", type=click.Choice(["crawl", "api", "user", "allowlist"]), default=None)
@click.option("--agent/--no-agent", default=None)
@click.option("--depth", default=None)
@click.option("--stream", is_flag=True, default=False)
@click.option("--stream-preview", is_flag=True, default=False)
@click.pass_context
def run_pipeline(
    ctx, prompt, output, fill_textures, asset_query, asset_mode, agent, depth, stream, stream_preview
) -> None:
    """Generate scene then optionally fill textures."""
    setting = ctx.obj["setting"]
    ag = setting.get("agent", {})
    enabled = ag.get("enabled", False) if agent is None else agent
    d = depth or ag.get("depth", "medium")
    tex_mode = setting.get("texture", {}).get("mode", "node_bridge")
    fill_via_bridge = fill_textures and tex_mode != "python"
    result = run_scene_agent_node(
        mode="generate",
        prompt=prompt,
        setting=setting,
        project_root=ctx.obj["project_root"],
        agent_enabled=enabled,
        depth=d,
        fill_textures=fill_via_bridge,
        stream=stream,
        stream_preview=stream_preview,
        on_progress=click.echo,
    )
    path = _write_scene(ctx, result["sceneJsonString"], output)
    if asset_query:
        asset_bridge_node(
            action="download_first",
            setting=setting,
            project_root=ctx.obj["project_root"],
            query=asset_query,
            mode=asset_mode,
            limit=1,
        )
    if fill_textures and tex_mode == "python":
        fill_textures_python(
            scene_path=path, setting=setting, project_root=ctx.obj["project_root"]
        )


@main.command("init-config")
@click.option("--force", is_flag=True)
def init_config(force: bool) -> None:
    """Copy tools/threejson-agent/setting.example.json → setting.json if missing."""
    example = PRODUCT_DIR / "setting.example.json"
    dest = default_setting_path()
    if dest.exists() and not force:
        click.echo(f"Exists: {dest}")
        return
    if not example.is_file():
        click.echo(f"setting.example.json not found: {example}", err=True)
        sys.exit(1)
    dest.write_text(example.read_text(encoding="utf-8"), encoding="utf-8")
    click.echo(f"Created {dest}")


if __name__ == "__main__":
    main()
