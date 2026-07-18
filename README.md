---
title: Elbaz Platform
emoji: ⚡
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: true
license: other
short_description: Production-grade LMS for Electrical Engineering
tags:
  - docker
  - education
  - lms
  - react
  - typescript
  - hono
  - trpc
  - mysql
---

<div align="center">

# ⚡ Elbaz Platform

**Production-grade LMS for Electrical Engineering** — Courses, AI Chatbot, Certificates & File Management

[![Deploy to HF Spaces](https://github.com/ahmdelbaz28-ux/elbaz-platform/actions/workflows/deploy-hf.yml/badge.svg)](https://github.com/ahmdelbaz28-ux/elbaz-platform/actions/workflows/deploy-hf.yml)
[![Hugging Face Space](https://huggingface.co/spaces/ahmdelbaz28/AHMDRTAP/badge.svg)](https://huggingface.co/spaces/ahmdelbaz28/AHMDRTAP)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev/)

---

Built by **Eng. Ahmed Elbaz** — Power Systems & Protection Engineer

</div>

## 📋 Overview

Elbaz Platform is a full-stack learning management system that delivers premium electrical engineering courses (ETAP, SKM Power\*Tools, PowerFactory, PVsyst, Protection & Renewable Energy).

**Production URL:** [https://ahmedelbaz.qzz.io](https://ahmedelbaz.qzz.io)

## 🚀 Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 19, TypeScript 5.9, Tailwind CSS 4, Vite 7, tRPC 11 |
| **Backend** | Hono 4 (Cloudflare Workers-compatible), tRPC server |
| **Database** | MySQL + Drizzle ORM (auto-migration via `api/lib/db-init.ts`) |
| **AI Chatbot** | Multi-tier orchestration: GLM-5.1 → OpenRouter → Groq → Modal |
| **Payments** | Paymob integration (card, wallet, bank transfers) |
| **Auth** | JWT + 2FA + Google OAuth |
| **Deployment** | Docker (HuggingFace Spaces), Cloudflare Workers |
| **CI/CD** | GitHub Actions — test → type-check → build → deploy to HF Spaces |

## 🧠 AI Chatbot Architecture

The platform features a sophisticated AI assistant (`Elbaz Bot`) with:

- **Multi-tier provider fallback**: Modal → Groq → OpenRouter with smart retries
- **Streaming responses** via SSE (Server-Sent Events)
- **Typewriter effect**: smooth character/word appearance with auto-scroll
- **Thinking & Instant modes** for different response quality/velocity tradeoffs
- **Animated typing indicators** with enter/exit transitions
- **Chat history persistence** to localStorage
- **Arabic/English bilingual support**

## 🛠️ Development

```bash
# Install dependencies
npm ci

# Start development server
npm run dev

# Run tests
npm test

# Type-check
npx tsc --noEmit

# Build
npm run build
```

The database auto-migrates on first boot via `api/lib/db-init.ts`. Configure your `.env` file using `.env.example` as a template.

## 🌐 Deployment

### Docker (HuggingFace Spaces)

```bash
docker build -t elbaz-platform .
docker run -p 7860:7860 elbaz-platform
```

The `Dockerfile` is optimized for HF Spaces (uses port 7860). Environment variables are configured through HF Space Secrets.

### CI/CD Pipeline

On every push to `main`, GitHub Actions automatically:

1. Runs unit tests (vitest)
2. Performs TypeScript type-checking (`tsc --noEmit`)
3. Builds the frontend (`vite build`)
4. Deploys to HuggingFace Spaces (if all checks pass)

## 📄 License

All rights reserved — Eng. Ahmed Elbaz (last sync: 2026-07-19T00:17:00Z)
