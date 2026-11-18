# syntax=docker/dockerfile:1
# Pocket Master Editor web server.
# Web MIDI runs in the visitor's browser, so this container never needs USB access.
#
# Hardening:
# - Base images pinned by multi-arch index digest; Renovate/Dependabot can bump them.
# - Build and runtime share Debian 13 and Node 24, so native modules match.
# - Runtime is distroless: no shell, no package manager, no npm.
# - App files are owned by root and read-only to the runtime user.
# - Runs as the unprivileged user 65532 and works with a read-only root filesystem.

ARG BUILD_IMAGE=node:24-trixie-slim@sha256:af02d57b57719b9657a45199a79264a9437940cd55b3c7b3fc99615654f124a0
ARG RUNTIME_IMAGE=gcr.io/distroless/nodejs24-debian13:nonroot@sha256:6abfcb367ebc291572c774c1592a986be2ab26a2486f73093401327495a5962a

FROM ${BUILD_IMAGE} AS deps
WORKDIR /app
ENV NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/web/package.json apps/web/
# --ignore-scripts: no dependency lifecycle scripts run during the build.
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts

FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY packages ./packages
COPY apps ./apps
COPY tsconfig.base.json ./
# The image is only produced when the test suite passes.
RUN npm test && npm run build

FROM ${RUNTIME_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
# Root-owned copies: the server can read but not modify its own code.
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
USER 65532:65532
EXPOSE 3000
STOPSIGNAL SIGTERM
# distroless has no curl or wget; the health check uses the bundled Node runtime.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# The distroless entrypoint is the node binary.
CMD ["apps/web/server.js"]
