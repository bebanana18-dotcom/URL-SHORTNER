# ─── Stage 1: build ──────────────────────────────────────────────────────────
# Node is only needed to BUILD the React app (npm run build).
# The final image doesn't need Node at all — just the static files.
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
#RUN npm ci
RUN npm install --legacy-peer-deps --only=production

COPY . .

# Inject the backend API URL at build time
# docker-compose passes this via build args
ARG VITE_API_URL=http://localhost:5000
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build
# Output is in /app/dist — just HTML, CSS, JS. No Node needed anymore.

# ─── Stage 2: serve ──────────────────────────────────────────────────────────
# Nginx Alpine is ~25MB. A Node server to serve static files is wasteful.
FROM nginx:1.25-alpine AS runner

# Remove the default nginx page (nobody wants to see "Welcome to nginx")
RUN rm -rf /usr/share/nginx/html/*

# Copy our built React app into nginx's serve folder
COPY --from=builder /app/build /usr/share/nginx/html

# Our custom nginx config — handles React Router and proxies /api to backend
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:80 || exit 1

CMD ["nginx", "-g", "daemon off;"]
