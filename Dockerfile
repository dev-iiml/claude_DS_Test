# syntax=docker/dockerfile:1.7
#
# CreatorCo web app image (Stage 17). One image per commit, promoted unchanged from staging to production.
# Runtime configuration comes from the environment: Cloud Run sets plain settings as env vars and mounts the
# environment's secrets as a dotenv file at /secrets/app.env (read with Node's --env-file-if-exists).
# No secrets, .env files or test fixtures are copied into the image.

# Pin the base by version (and, in the deploy workflow, by digest).
ARG NODE_IMAGE=node:22.23.4-bookworm-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The git SHA: Next.js version-skew protection (next.config.ts deploymentId).
ARG DEPLOYMENT_VERSION=""
ENV DEPLOYMENT_VERSION=${DEPLOYMENT_VERSION}
RUN npm run build

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0
# App files are root-owned and read-only to the app user; only Next's cache directory is writable.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
RUN mkdir -p .next/cache && chown node:node .next/cache
USER node
EXPOSE 8080
# Node is PID 1 and receives SIGTERM directly: Next.js finishes in-flight requests and pending after() work.
CMD ["node", "--env-file-if-exists=/secrets/app.env", "server.js"]
