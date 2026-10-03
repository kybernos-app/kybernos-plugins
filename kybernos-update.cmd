@echo off
rem ── Kybernos : mise a jour (Windows) ──────────────────────────────────────
rem   Ouvre une console DANS le dossier de la NOUVELLE archive extraite, puis :
rem     kybernos-update
rem     kybernos-update 0.1.7-alpha.2
setlocal
set "ICI=%~dp0"
if "%ICI:~-1%"=="\" set "ICI=%ICI:~0,-1%"
rem  %~dp0 finit par un antislash : `--source "%ICI%"` deviendrait `"...\"` et la
rem  quote fermante serait avalee par l'antislash. Mesure du 23/09/2026 sur un
rem  coureur Windows neuf : « source introuvable : D:\a\_temp\kb-ci-windows" ».

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js est absent — voir https://nodejs.org/fr/download
  exit /b 1
)
for /f "delims=" %%v in ('node --version 2^>nul') do set "VNOEUD=%%v"
node --input-type=module -e "await import('node:child_process')" >nul 2>&1
if errorlevel 1 (
  echo Node %VNOEUD% ne sait pas executer le robot ^(modules ESM indisponibles^).
  exit /b 1
)
echo Node %VNOEUD%

node "%ICI%\scripts\dsh-lifecycle.mjs" upgrade %* --source "%ICI%"
