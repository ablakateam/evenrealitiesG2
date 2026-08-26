# VOX server — container image.
#
# Exists mainly for NAS and homelab installs (Unraid, Synology, TrueNAS), where
# the two native modules are the usual stumbling block: `argon2` and
# `better-sqlite3` compile against the local Node ABI, so a bare install needs a
# build toolchain. This builds them once in a stage that has one, then copies
# the result into a slim runtime image that does not.
#
# Build:  docker build -t vox-server .
# Run:    see docker-compose.yml, or docs/DEPLOYMENT.md → Alternative deployments

# ---------------------------------------------------------------- build stage
FROM node:20-bookworm-slim AS build

# node-gyp needs python3 + a C/C++ toolchain to compile argon2 and
# better-sqlite3. None of this survives into the runtime image.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app/server

# Copy manifests first so the dependency layer caches independently of source.
COPY server/package.json server/package-lock.json ./
RUN npm ci

COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build

# Drop devDependencies now that dist/ exists. The compiled native modules in
# node_modules/ are kept — that is the whole point of this stage.
RUN npm prune --omit=dev

# -------------------------------------------------------------- runtime stage
FROM node:20-bookworm-slim AS runtime

# dumb-init gives us a real PID 1, so SIGTERM reaches Node and the graceful
# shutdown path (closing IMAP workers and the database) actually runs.
RUN apt-get update \
 && apt-get install -y --no-install-recommends dumb-init ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3000 \
    # Containers MUST bind all interfaces — loopback inside a container is not
    # reachable from outside it. The application defaults to 127.0.0.1, which is
    # right for the VPS setup where Nginx is the only permitted caller.
    HOST=0.0.0.0 \
    DB_PATH=/data/vox.db

WORKDIR /app/server
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/package.json ./package.json

# SQLite lives on a volume so the database survives image upgrades. `node` is an
# unprivileged user that the base image already provides.
RUN mkdir -p /data && chown -R node:node /data /app
VOLUME ["/data"]

USER node
EXPOSE 3000

# No shell form: this keeps dumb-init as PID 1 rather than a shell.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
