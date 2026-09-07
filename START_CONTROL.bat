@echo off
cd /d "%~dp0"
if not exist ".env" (
 echo Missing .env. Follow the local setup in README.md first.
 goto fail
)
if not exist "node_modules\vite\bin\vite.js" (
 echo Dependencies are missing. Run pnpm install first.
 goto fail
)
node --env-file=.env node_modules/drizzle-kit/bin.cjs migrate
if errorlevel 1 goto fail
node --env-file=.env node_modules/vite/bin/vite.js --host 0.0.0.0 --port 5173 --strictPort --open /admin/post-game
:fail
pause
