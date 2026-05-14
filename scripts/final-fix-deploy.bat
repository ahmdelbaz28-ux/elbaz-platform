@echo off
git add .
git commit -m "fix: resolve duplicate certificates export in schema.ts to fix production runtime error"
git push -f origin main
