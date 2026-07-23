# Nasmedia Meta Ads Service

Internal Next.js dashboard for read-only Meta advertising-account operations and OpenRouter-powered analysis.

## Run locally

1. Create a local `.env.local` with server-only variable names listed in [Meta integration](docs/META_ADS_INTEGRATION.md). Never commit it.
2. Install dependencies with `npm ci`.
3. Start the application with `npm run dev` and open `http://localhost:3000`.

## Commands

```bash
npm run lint
npm run build
npm run start
```

## Deployment

Deploy behind the company identity-aware proxy or add a real application session before exposing it to users. This repository does not provide a fake sign-in state. Configure all Meta and OpenRouter values in the host's server-side secret store; do not create `NEXT_PUBLIC_` copies.

See [Meta integration](docs/META_ADS_INTEGRATION.md) for architecture, security boundaries, and required environment variable names, and [dashboard implementation](docs/DASHBOARD_IMPLEMENTATION.md) for UI/data behavior and verification.
