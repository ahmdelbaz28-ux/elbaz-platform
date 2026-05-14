@echo off
git add .
git commit -m "fix: install tini in production Docker stage to resolve startup failure"
git push -f origin main
