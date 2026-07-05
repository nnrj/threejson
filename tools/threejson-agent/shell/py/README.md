# Python shell (`shell/py`)

Click CLI, Gradio GUI, and the `threejson_agent` package. Spawns parent [`bridge/`](../../bridge/) Node scripts to run [`core/ai`](../../../../core/ai/).

## Setup

```bash
cd tools/threejson-agent
cp setting.example.json setting.json
pip install -r shell/py/requirements.txt
```

## CLI

From `tools/threejson-agent/shell/py` (or set `PYTHONPATH` to this directory):

```bash
python -m threejson_agent init-config
python -m threejson_agent scene generate --prompt "..." -o ./out/scene.json
python -m threejson_agent scene update --prompt "..." -i ./out/scene.json
```

Relative `-i` / `-o` paths are resolved against **the current working directory** unless `setting.json` sets `paths.relativetRoot` (relative to the config file) **and** `paths.redirectRelative: true`.

Optional global flags (before the subcommand):

```bash
python -m threejson_agent --config /path/to/setting.json scene generate --prompt "..."
python -m threejson_agent -c ../../setting.json scene generate --prompt "..."
```

Repo-root workflow example in `setting.json`:

```json
"paths": {
  "relativetRoot": "../..",
  "redirectRelative": true,
  "redirectRelativeWarn": false
}
```

(`redirectRelativeWarn: false` suppresses stderr notices when automating.)

## GUI

```bash
npm run threejson-agent:gui
```

## Tests

```bash
cd tools/threejson-agent/shell/py
python -m unittest discover -s tests
```
