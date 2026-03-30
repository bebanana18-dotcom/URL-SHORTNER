# ─── Stage 1: deps ───────────────────────────────────────────────────────────
# Use Alpine — full Node image is 900MB, Alpine is 180MB.
# Nobody wants to push a 900MB image every deploy.
FROM node:20-alpine AS deps

WORKDIR /app

# Copy package files first — Docker caches this layer.
# If you only change src code, npm install is NOT re-run. Saves 2 minutes per build.
COPY package.json package-lock.json ./

#RUN npm ci --only=production
RUN npm install --legacy-peer-deps --only=production

# ─── Stage 2: runner ─────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# Don't run as root inside the container.
# If someone exploits your app, they get "node" user, not root. Small win, free.
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy only what's needed — not node_modules from host, not .env, not your secrets
COPY --from=deps /app/node_modules ./node_modules
COPY src/ ./src/
COPY package.json ./

# Switch to non-root user
USER appuser

# Document which port this app uses (doesn't actually expose it — compose does that)
EXPOSE 5000

# Healthcheck — Kubernetes and Docker both use this to know if the app is alive
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:5000/health || exit 1

CMD ["node", "src/app.js"]
