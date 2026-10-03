@echo off
rem ── Kybernos : installation (Windows) ─────────────────────────────────────
rem   Ouvre une console DANS le dossier de l'archive extraite, puis :
rem     kybernos-install
rem     kybernos-install --dry
setlocal
set "ICI=%~dp0"
if "%ICI:~-1%"=="\" set "ICI=%ICI:~0,-1%"
rem  %~dp0 finit par un antislash : `--source "%ICI%"` deviendrait `"...\"` et la
rem  quote fermante serait avalee par l'antislash. Mesure du 23/09/2026 sur un
rem  coureur Windows neuf : « source introuvable : D:\a\_temp\kb-ci-windows" ».

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js est absent. Kybernos tourne sur Node :
  echo   https://nodejs.org/fr/download
  exit /b 1
)

rem Pas de version minimale inventee : DSH n'en declare aucune (engines absent).
rem On eprouve ce dont le robot a besoin — les modules ESM — et on affiche la version.
for /f "delims=" %%v in ('node --version 2^>nul') do set "VNOEUD=%%v"
node --input-type=module -e "await import('node:child_process')" >nul 2>&1
if errorlevel 1 (
  echo Node %VNOEUD% ne sait pas executer le robot ^(modules ESM indisponibles^).
  echo Installe une version recente : https://nodejs.org/fr/download
  exit /b 1
)
echo Node %VNOEUD%

node "%ICI%\scripts\dsh-lifecycle.mjs" bootstrap %* --source "%ICI%"
