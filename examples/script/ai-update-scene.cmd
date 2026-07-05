@echo off
setlocal

if "%~1"=="" (
  echo Usage:
  echo   examples\script\ai-update-scene.cmd "your prompt" [provider] [model]
  echo Example:
  echo   examples\script\ai-update-scene.cmd "增加两栋仓库并添加信息面板" chatgpt
  exit /b 1
)

set "PROMPT=%~1"
set "PROVIDER=%~2"
set "MODEL=%~3"

if "%PROVIDER%"=="" set "PROVIDER=chatgpt"

if "%MODEL%"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ai-update-scene.ps1" -Prompt "%PROMPT%" -Provider "%PROVIDER%"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ai-update-scene.ps1" -Prompt "%PROMPT%" -Provider "%PROVIDER%" -Model "%MODEL%"
)

exit /b %ERRORLEVEL%
