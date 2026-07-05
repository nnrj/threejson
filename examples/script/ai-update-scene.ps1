param(
  [Parameter(Mandatory = $true)]
  [string]$Prompt,
  [string]$Provider = "chatgpt",
  [string]$Model = "",
  [string]$ApiKey = "",
  [string]$Source = "./assets/json/tutorial/track-05/05-01-ai-scene.json",
  [string]$Output = "./assets/json/aiDemoOutputScene.json"
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptDir "..\..")
$nodeScript = Join-Path $scriptDir "ai-update-scene.mjs"

if (!(Test-Path $nodeScript)) {
  Write-Error "Cannot find script: $nodeScript"
  exit 1
}

$argsList = @(
  $nodeScript,
  "--prompt=$Prompt",
  "--provider=$Provider",
  "--source=$Source",
  "--output=$Output"
)

if ($Model) {
  $argsList += "--model=$Model"
}
if ($ApiKey) {
  $argsList += "--apiKey=$ApiKey"
}

Push-Location $projectRoot
try {
  node @argsList
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
