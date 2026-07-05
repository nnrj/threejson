import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import click

from threejson_agent.cli import _resolve_cli_path
from threejson_agent.config import (
    PRODUCT_DIR,
    PathSettings,
    bridge_dir,
    default_setting_path,
    find_setting_path,
    load_setting,
    path_settings_from_config,
    save_setting,
    shell_py_dir,
    _deep_merge,
    DEFAULT_SETTING,
    project_root_from_setting,
)
from threejson_agent.node_scene_bridge import bridge_script_path


class ConfigTests(unittest.TestCase):
    def test_deep_merge(self):
        merged = _deep_merge(DEFAULT_SETTING, {"llm": {"apiKey": "x"}})
        self.assertEqual(merged["llm"]["apiKey"], "x")
        self.assertEqual(merged["llm"]["provider"], "chatgpt")
        self.assertEqual(merged["paths"]["redirectRelative"], False)

    def test_load_save_roundtrip(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "setting.json"
            save_setting({"llm": {"apiKey": "secret"}}, path)
            data, loaded = load_setting(path)
            self.assertEqual(loaded, path)
            self.assertEqual(data["llm"]["apiKey"], "secret")
            self.assertIn("texture", data)
            self.assertEqual(data["texture"]["mode"], "node_bridge")

    def test_default_setting_path_under_product_dir(self):
        self.assertEqual(default_setting_path(), PRODUCT_DIR / "setting.json")

    def test_product_dir_points_at_threejson_agent_root(self):
        self.assertEqual(PRODUCT_DIR.name, "threejson-agent")
        self.assertTrue((PRODUCT_DIR / "setting.example.json").is_file())

    def test_bridge_script_exists(self):
        self.assertTrue(bridge_script_path().is_file())
        self.assertEqual(bridge_dir(), PRODUCT_DIR / "bridge")

    def test_shell_py_asset_entry_exists(self):
        entry = shell_py_dir() / "threejson_agent" / "asset_bridge_entry.py"
        self.assertTrue(entry.is_file())

    def test_path_settings_default_is_cwd(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Path(tmp) / "setting.json"
            save_setting({}, cfg)
            data, path = load_setting(cfg)
            ps = path_settings_from_config(data, path)
            self.assertFalse(ps.redirect_active)
            self.assertEqual(ps.workspace_root, Path.cwd().resolve())

    def test_path_settings_redirect_to_relativet_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            agent_home = repo / "tools" / "threejson-agent"
            agent_home.mkdir(parents=True)
            cfg = agent_home / "setting.json"
            save_setting(
                {"paths": {"relativetRoot": "../..", "redirectRelative": True}},
                cfg,
            )
            data, path = load_setting(cfg)
            ps = path_settings_from_config(data, path)
            self.assertTrue(ps.redirect_active)
            self.assertEqual(ps.workspace_root, repo.resolve())
            self.assertEqual(project_root_from_setting(data, path), repo.resolve())

    def test_path_settings_relativet_without_redirect_uses_cwd(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Path(tmp) / "setting.json"
            save_setting({"paths": {"relativetRoot": "..", "redirectRelative": False}}, cfg)
            data, path = load_setting(cfg)
            ps = path_settings_from_config(data, path)
            self.assertFalse(ps.redirect_active)
            self.assertEqual(ps.workspace_root, Path.cwd().resolve())

    def test_resolve_cli_path_redirect_vs_cwd(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            scene = root / "tmp" / "scene.json"
            scene.parent.mkdir(parents=True)
            scene.write_text("{}", encoding="utf-8")
            sub = root / "work"
            sub.mkdir()
            orig = os.getcwd()
            try:
                os.chdir(sub)
                ctx_redirect = MagicMock()
                ctx_redirect.obj = {
                    "path_settings": PathSettings(root, True, "../..", True)
                }
                resolved = _resolve_cli_path(ctx_redirect, Path("tmp/scene.json"))
                self.assertEqual(resolved, scene.resolve())
                ctx_cwd = MagicMock()
                ctx_cwd.obj = {
                    "path_settings": PathSettings(Path.cwd().resolve(), False, "", True)
                }
                with self.assertRaises(click.BadParameter):
                    _resolve_cli_path(ctx_cwd, Path("tmp/scene.json"))
            finally:
                os.chdir(orig)

    def test_load_setting_explicit_config_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Path(tmp) / "custom-setting.json"
            save_setting({"llm": {"apiKey": "from-custom"}}, cfg)
            data, loaded = load_setting(cfg)
            self.assertEqual(loaded, cfg.resolve())
            self.assertEqual(data["llm"]["apiKey"], "from-custom")

    def test_find_setting_path_skips_repo_root_only_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            (tmp_path / "setting.json").write_text("{}", encoding="utf-8")
            agent_home = tmp_path / "tools" / "threejson-agent"
            agent_home.mkdir(parents=True)
            agent_cfg = agent_home / "setting.json"
            save_setting({"llm": {"apiKey": "from-agent"}}, agent_cfg)
            found = find_setting_path(tmp_path)
            self.assertEqual(found, agent_cfg)

    def test_redirect_warn_can_be_disabled(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            scene = root / "a.json"
            scene.write_text("{}", encoding="utf-8")
            ctx = MagicMock()
            ctx.obj = {"path_settings": PathSettings(root, True, ".", False)}
            with patch("threejson_agent.cli.click.echo") as mock_echo:
                _resolve_cli_path(ctx, Path("a.json"))
                mock_echo.assert_not_called()


if __name__ == "__main__":
    unittest.main()
