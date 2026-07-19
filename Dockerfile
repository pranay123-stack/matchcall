# MatchCall — container images for the Next.js app and the settlement keeper.
#
# Build context is the REPO ROOT (docker build -f Dockerfile .).
# The web app is the LAST (default) stage, so platforms like Railway that build
# the final stage automatically deploy the app. Build the keeper explicitly with
#   docker build --target keeper .
#
# The app uses better-sqlite3, a NATIVE module compiled against a specific libc,
# so every stage shares node:20-bookworm-slim: the prebuilt .node binary from the
# builder is ABI-compatible with the runner. The SQLite file lives on a mounted
# volume at /data (DATABASE_PATH), so it survives container restarts/redeploys.

# ---------------------------------------------------------------------------
# 1) App build stage — install deps (with C++ toolchain for better-sqlite3),
#    then produce the Next.js production build.
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS app-builder
WORKDIR /app

# Toolchain required to compile better-sqlite3 from source during `npm ci`.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies from the committed lockfile first (better layer caching).
COPY app/package.json app/package-lock.json ./
RUN npm ci

# NEXT_PUBLIC_* values are inlined into the client bundle at BUILD time. They are
# non-secret (they default to devnet in code); override via build args for other
# clusters. e.g. --build-arg NEXT_PUBLIC_RPC_URL=...
ARG NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com
ARG NEXT_PUBLIC_PROGRAM_ID=DuB3yJQMPWCESJoEzShBWt1Jc3Q6j6DXLyi1XpAB6EQ2
ARG NEXT_PUBLIC_MUSDC_MINT=EgkrEEpXKn61tdWDTJj9bDd68oW4ifiUC4M5uqiAhv9j
ENV NEXT_PUBLIC_RPC_URL=$NEXT_PUBLIC_RPC_URL \
    NEXT_PUBLIC_PROGRAM_ID=$NEXT_PUBLIC_PROGRAM_ID \
    NEXT_PUBLIC_MUSDC_MINT=$NEXT_PUBLIC_MUSDC_MINT

COPY app/ ./
RUN npm run build

# ---------------------------------------------------------------------------
# 2) Keeper stage — the standalone settlement process (tsx runtime, no build).
#    Build explicitly with `--target keeper`. It talks to the app over HTTP via
#    KEEPER_API_BASE.
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS keeper
WORKDIR /keeper
ENV NODE_ENV=production

COPY keeper/package.json keeper/package-lock.json ./
RUN npm ci

# Keeper source + the committed IDL it reads for the direct-settle fallback.
# The keeper resolves its IDL at <repoRoot>/target/idl/prediction_escrow.json
# (repoRoot is "/" here). target/ is gitignored, so we place the COMMITTED
# idl/ there to keep a clean checkout self-contained.
COPY keeper/ ./
COPY idl/ /target/idl/

CMD ["npm", "run", "start"]

# ---------------------------------------------------------------------------
# 3) App runtime stage (LAST = default target) — carry the built app +
#    node_modules (incl. the compiled native better-sqlite3) and serve.
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS app
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/data/matchcall.db

COPY --from=app-builder /app ./
# The reindex script lives at repo-root scripts/ and is invoked as
# `tsx ../scripts/...` from /app, so it must sit at /scripts in the image.
COPY scripts/ /scripts/

# SQLite lives on a mounted volume so data persists across restarts/redeploys.
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 3000
# Rebuild the DB index from on-chain truth on boot (idempotent; non-fatal if the
# RPC is briefly unreachable), then serve. This makes a fresh/ephemeral DB show
# every real market with live pools.
CMD ["sh", "-c", "npm run reindex || true; npm run start"]
