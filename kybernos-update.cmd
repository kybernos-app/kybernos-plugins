@echo off
rem -- Kybernos: update (Windows) --------------------------------------------
rem   Open a console IN the folder of the NEW extracted archive, then:
rem     kybernos-update
rem     kybernos-update 0.1.7-alpha.2
setlocal
set "ICI=%~dp0"
if "%ICI:~-1%"=="\" set "ICI=%ICI:~0,-1%"
rem  %~dp0 ends with a backslash: `--source "%ICI%"` would become `"...\"` and the
rem  closing quote would be swallowed by the backslash. Measured on 23/09/2026 on a
rem  new Windows runner: "source not found: D:\a\_temp\kb-ci-windows"".

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is missing -- see https://nodejs.org/en/download
  exit /b 1
)
for /f "delims=" %%v in ('node --version 2^>nul') do set "VNOEUD=%%v"
node --input-type=module -e "await import('node:child_process')" >nul 2>&1
if errorlevel 1 (
  echo Node %VNOEUD% cannot run the robot ^(ES modules unavailable^).
  exit /b 1
)
echo Node %VNOEUD%

node "%ICI%\scripts\dsh-lifecycle.mjs" upgrade %* --source "%ICI%"
