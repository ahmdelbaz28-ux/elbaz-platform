@echo off
git add .
git commit -m "fix: update JWT tests to match 30-day token policy and ensure production deployment"
git push -f origin main
