@echo off
git add .
git commit -m "fix: restore Microsoft Clarity analytics via official CDN to resolve 503 load errors and enable user tracking"
git push -f origin main
