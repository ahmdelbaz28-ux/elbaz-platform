---
title: AHMDRTAP
emoji: ⚡
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# Elbaz LMS — Professional Electrical Engineering Platform

A modern educational platform built with Hono, tRPC, React 19, and Vite 7.

## Architecture

- **Backend**: Hono + tRPC + Drizzle ORM
- **Frontend**: React 19 + TypeScript + Tailwind CSS
- **Database**: MySQL (Aiven)
- **Storage**: Cloudflare R2 (S3-compatible)
- **Deployment**: Docker on HuggingFace Spaces

## Required Secrets (HF Space Variables)

Configure these in **Settings → Variables and secrets**:

| Variable | Required | Description |
|---|---|---|
| `APP_SECRET` | ✅ | 64-char random string for JWT signing |
| `DATABASE_URL` | ✅ | MySQL connection string (Aiven) |
| `R2_ACCOUNT_ID` | ✅ | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | ✅ | R2 access key |
| `R2_SECRET_ACCESS_KEY` | ✅ | R2 secret key |
| `R2_ENDPOINT` | ✅ | R2 endpoint URL |
| `R2_BUCKET` | Optional | Bucket name (default: elbaz-videos) |
| `WATERMARK_SECRET` | ✅ | 32+ char secret for video protection |
| `PAYMOB_API_KEY` | Optional | Paymob payment gateway key |
| `PAYMOB_HMAC_SECRET` | Optional | Paymob HMAC verification secret |
| `PAYMOB_INTEGRATION_ID` | Optional | Paymob integration ID |
| `OPENROUTER_API_KEY` | Optional | OpenRouter API key for AI chatbot |
| `RESEND_API_KEY` | Optional | Resend email API key |
| `EMAIL_FROM` | Optional | Sender email address |
| `FRONTEND_URL` | Optional | Public URL (default: auto-detect) |
| `SENTRY_DSN` | Optional | Sentry error tracking DSN |
| `CLARITY_ID` | Optional | Microsoft Clarity analytics ID |
| `CORS_ORIGINS` | Optional | Allowed CORS origins (comma-separated) |

## HF Space Configuration

- **SDK**: Docker
- **App Port**: 7860
- **Hardware**: CPU basic (recommended for LMS traffic)
- **Sleep Timeout**: Keep awake for best UX
