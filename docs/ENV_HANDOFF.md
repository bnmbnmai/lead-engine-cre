# Env & credentials handoff for new project

Use this when opening a **new session** or **new project folder** so you can reuse the same hosting (Render, Vercel, GitHub, etc.) and credentials.

---

## 1. Copy this whole folder (or just this doc)

**Option A – New project reuses same stack**  
Copy this file into the new project, e.g. `docs/ENV_HANDOFF.md`. In the new session, say: “Use docs/ENV_HANDOFF.md and set up env like the handoff.”

**Option B – Copy actual env files (local only, never commit)**  
From this project folder:

```text
backend\.env          → copy to new-project\backend\.env
frontend\.env.local   → copy to new-project\frontend\.env.local
```

Then in the new project, replace app-specific values (e.g. API_URL, FRONTEND_URL, DB name).

---

## 2. Where the real values live

| Source | What to copy |
|--------|------------------|
| **This repo (local)** | `backend\.env` and `frontend\.env.local` (if present) |
| **Render** | Dashboard → Your Service → Environment → copy vars |
| **Vercel** | Project → Settings → Environment Variables → copy vars |
| **GitHub** | Repo URL: `https://github.com/bnmbnmai/adcre` (or new repo) |

---

## 3. Backend (Render / local backend)

Get values from **this project’s `backend\.env`** or **Render → Environment**.

| Variable | Example / note |
|----------|-----------------|
| `NODE_ENV` | production |
| `PORT` | 3001 |
| `API_URL` | https://your-api.onrender.com |
| `FRONTEND_URL` | https://your-app.vercel.app |
| `DATABASE_URL` | postgresql://user:pass@host:port/db?schema=public |
| `REDIS_URL` | redis://... (from Render Redis) |
| `JWT_SECRET` | 64-char hex (e.g. `openssl rand -hex 32`) |
| `ALCHEMY_API_KEY` | From Alchemy dashboard |
| `RPC_URL_SEPOLIA` | https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY |
| `RPC_URL_BASE_SEPOLIA` | https://sepolia.base.org |
| `PAYMENT_RECIPIENT_ADDRESS` | 0x... |
| (Optional) `SENTRY_DSN`, `SENDGRID_API_KEY`, etc. | Same as this project if reusing |

---

## 4. Frontend (Vercel / local frontend)

Get values from **this project’s `frontend\.env.local`** or **Vercel → Environment Variables**.

| Variable | Example / note |
|----------|-----------------|
| `NEXT_PUBLIC_API_URL` | https://your-api.onrender.com/api/v1 |
| `NEXT_PUBLIC_APP_URL` | https://your-app.vercel.app |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | From WalletConnect Cloud |
| `NEXT_PUBLIC_ALCHEMY_API_KEY` | Same as backend or separate key |
| `NEXT_PUBLIC_DEFAULT_CHAIN_ID` | 11155111 (Sepolia) or 8453 (Base) |
| `NEXT_PUBLIC_ENABLE_TESTNET` | true |
| `NEXT_PUBLIC_TESTNET_MODE` | true for testnet |

---

## 5. Hosting checklist for new project

1. **GitHub** – Create new repo (e.g. under `bnmbnmai`), clone into new folder.
2. **Render** – New Web Service + PostgreSQL (+ Redis if needed). Connect new repo, add env vars from §3.
3. **Vercel** – New project, import same repo, set root to `frontend` (or your app dir). Add env vars from §4.
4. **CORS** – In new backend, set `FRONTEND_URL` (and allowed origins) to the new Vercel URL.

---

## 6. One-liner for the new session

Paste this in the new chat when you start the new project:

```text
Use the same hosting as CRE Airdrops: Render (backend + Postgres + Redis), Vercel (frontend), GitHub bnmbnmai. I’ll create a new repo. Set up env from docs/ENV_HANDOFF.md in that project (or I’ll paste my .env from the CRE Airdrops project).
```

If you already copied `ENV_HANDOFF.md` into the new project, add: “Env reference is in docs/ENV_HANDOFF.md.”
