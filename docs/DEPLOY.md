# Deploying MatchCall

MatchCall is **two long-lived processes plus a local file**:

- **`app/`** — the Next.js server. It reads/writes a **SQLite** database
  (`better-sqlite3`, a native module + a local `.db` file) and serves the UI +
  API on port **3000**.
- **`keeper/`** — a persistent process that watches TxLINE's live score stream
  and triggers trustless on-chain settlement. It calls the app over HTTP.

Because there is a **native module** and a **local database file**, and because
the keeper is a **persistent** process, the natural target is a **container host
with a persistent volume** — Railway, Render, or Fly.io — **not** serverless.
See [Why not Vercel](#why-not-vercel) at the end.

The chain (Solana devnet) is the source of truth for pools and outcomes; the
SQLite DB is only an index/cache, but it must **persist** so the app can map
`marketId -> PDA`, list markets, and serve receipts across restarts.

---

## What you deploy

| Image (Dockerfile target) | Command | Port | Needs volume |
|---|---|---|---|
| `app` | `next start` | 3000 | yes — `/data` (SQLite) |
| `keeper` | `tsx src/index.ts` | — (outbound only) | no |

Both are defined in the root **`Dockerfile`** (`--target app` / `--target keeper`)
and wired together in **`docker-compose.yml`**.

---

## Environment variables

Copy `app/.env.example` and fill it in. The **same env** feeds both the app and
the keeper (the keeper just adds `KEEPER_API_BASE`). Everything except the
secrets has a safe devnet default baked into the code.

### Required (secrets — set these before markets can be created/settled)

| Var | What it is |
|---|---|
| `MARKET_AUTHORITY_SECRET` | Backend signer as a JSON byte array, e.g. `[12,34,…]`. Pays fees; creates/settles markets; runs the faucet. Use the deployer keypair: `MARKET_AUTHORITY_SECRET=$(cat .keys/deployer.json)`. **Never commit it.** |
| `TXLINE_AUTH_JWT` | TxLINE guest JWT. Obtained by running the activate script (below). |
| `TXLINE_API_TOKEN` | TxLINE API token. From the same activate script. |

### Solana (safe devnet defaults, override for other clusters)

| Var | Default |
|---|---|
| `SOLANA_RPC_URL` | `https://api.devnet.solana.com` |
| `PREDICTION_ESCROW_PROGRAM_ID` | `DuB3yJQMPWCESJoEzShBWt1Jc3Q6j6DXLyi1XpAB6EQ2` |
| `MUSDC_MINT` | `EgkrEEpXKn61tdWDTJj9bDd68oW4ifiUC4M5uqiAhv9j` |

### TxLINE feed (defaults point at the devnet TxLINE)

`TXLINE_BASE_URL` (`https://txline-dev.txodds.com/api/`), `TXLINE_ORIGIN`,
`TXLINE_GUEST_URL`, optional `TXLINE_COMPETITION_ID`.

### Storage

| Var | Value in containers |
|---|---|
| `DATABASE_PATH` | `/data/matchcall.db` — the mounted volume path. |

### Public (inlined into the browser bundle at BUILD time — non-secret)

`NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_PROGRAM_ID`, `NEXT_PUBLIC_MUSDC_MINT`.
They default to devnet in code; for another cluster pass them as Docker
`--build-arg`s (the Dockerfile exposes matching `ARG`s) so they get baked in.

### Keeper-only

| Var | Value |
|---|---|
| `KEEPER_API_BASE` | The app's base URL. `http://app:3000` under compose; the app's public/private URL on a PaaS. |
| `KEEPER_POLL_INTERVAL_MS` | optional, default `15000`. |

### Getting the TxLINE credentials

`TXLINE_AUTH_JWT` / `TXLINE_API_TOKEN` are **not** long-lived config — mint them
by running the activate script against the devnet TxLINE, then paste the printed
values into your host's env:

```bash
cd app && npm run txline:activate   # prints a guest JWT + API token
```

---

## Option A — Railway (recommended)

Railway runs persistent containers, attaches volumes, and builds straight from
your `Dockerfile`. You create **two services** from the same repo.

1. **Create a project** and connect the GitHub repo.

2. **Service 1 — `app`:**
   - New service -> Deploy from repo.
   - Settings -> Build: Dockerfile, and set the **build target** to `app`
     (Railway: "Docker build target" / equivalently a build arg — or add a
     `railway.json` with `"dockerfile": "Dockerfile"` and target `app`).
   - **Variables:** add every var from the [Environment](#environment-variables)
     section. Set `DATABASE_PATH=/data/matchcall.db`.
   - **Volume:** add a volume mounted at **`/data`** (this is where the SQLite
     file lives — without it the DB is wiped on every redeploy).
   - Networking: expose port **3000** and generate a public domain. Note the
     resulting URL, e.g. `https://matchcall-app.up.railway.app`.

3. **Service 2 — `keeper`:**
   - New service from the **same repo**, Dockerfile **build target `keeper`**.
   - **Variables:** the same env as the app (so it shares the Solana + TxLINE
     config and the authority secret), **plus**
     `KEEPER_API_BASE=https://<your-app-domain>` pointing at Service 1.
   - No public port and no volume — the keeper only makes outbound calls.

4. **Deploy.** The app comes up on its domain; the keeper starts polling
   `GET {KEEPER_API_BASE}/api/markets`, watches the TxLINE stream, and settles
   finished fixtures automatically.

5. **One-time init** (if this is a brand-new deployment/DB): from a machine with
   the repo + funded keypairs, or a Railway one-off shell, run
   `cd app && npm run market:init` (initializes the on-chain config PDA — a no-op
   if it already exists) and optionally `npm run demo:seed`.

### Render / Fly.io (equivalent)

- **Render:** two services from the same repo (**Web Service** for `app` with a
  Dockerfile and a **Disk** mounted at `/data`; **Background Worker** for
  `keeper`). Set env on both; set `KEEPER_API_BASE` to the app's Render URL.
- **Fly.io:** `fly launch` for the app, attach a **volume** at `/data`
  (`fly volumes create matchcall_data`), and run the keeper as a second process
  or a second app with `KEEPER_API_BASE` set to the app's `.fly.dev` URL. Set
  the build target with `[build] target = "app"` / `"keeper"` in `fly.toml`.

---

## Option B — any VPS with Docker (simplest)

On any box with Docker + Compose (a $5 VPS is plenty):

```bash
git clone <repo> && cd matchcall
cp app/.env.example .env          # fill in the REQUIRED secrets (see above)
docker compose up --build -d      # builds both images, starts app + keeper
```

- App is served on `http://<host>:3000`; put nginx/Caddy in front for TLS.
- The keeper reaches the app in-network at `http://app:3000` (already wired in
  `docker-compose.yml`).
- SQLite persists in the named volume `matchcall-data` (`/data` in the app
  container). `docker compose down` keeps it; only `down -v` deletes it.

Logs / lifecycle:

```bash
docker compose logs -f app        # or: keeper
docker compose restart keeper
```

---

## Verifying the build locally

```bash
docker build --target app    -t matchcall-app    .   # Next build + native better-sqlite3
docker build --target keeper -t matchcall-keeper .
docker compose up --build
```

Both targets build on `node:20-bookworm-slim`; the app image was verified to
boot (`next start`, "Ready", HTTP 200) with the compiled `better-sqlite3`.

---

## Why not Vercel

Vercel is serverless: no persistent local disk and no always-on worker. That
breaks MatchCall two ways:

1. **SQLite** — `better-sqlite3` writes a local file. On Vercel the filesystem is
   ephemeral/read-only per invocation, so state would vanish. You'd have to swap
   the DB layer for a hosted one (**Turso/libSQL**, **Neon Postgres**, etc.) and
   rewrite `app/lib/db.ts` accordingly.
2. **The keeper** is a long-running process that watches an SSE stream — there is
   no place for it on Vercel. You'd have to re-architect it into a cron/queue
   worker hosted elsewhere.

It's doable, but it's a real porting effort. For this project the recommended,
faithful deployment is a **persistent container host with a `/data` volume**
(Railway/Render/Fly) or **`docker compose up` on a VPS**.
