# syntax=docker/dockerfile:1
# Pocket Master Editor web server.
# Web MIDI runs in the visitor's browser, so this container never needs USB access.
#
# Hardening:
# - Base images pinned by multi-arch index digest; Dependabot bumps them.
# - Runtime is Alpine with only Alpine's own nodejs package (Node 24.22.3 on 3.23, built
#   against Alpine's shared libraries, about half the size of the official binary): no npm,
#   no yarn, and the apk package manager is removed, so nothing can be installed at run time.
# - The server has no native modules (sharp is dropped below), so building on Debian and
#   running on Alpine (musl) is safe; the smoke test runs the real image to prove it.
# - App files are owned by root and read-only to the runtime user.
# - Runs as the unprivileged user 65532 and works with a read-only root filesystem.

ARG BUILD_IMAGE=node:24-trixie-slim@sha256:af02d57b57719b9657a45199a79264a9437940cd55b3c7b3fc99615654f124a0
ARG RUNTIME_IMAGE=alpine:3.23@sha256:469c9ea410b9215eaee7976ba6c0639039b444be8e5d638f7abbada189971eb2

FROM ${BUILD_IMAGE} AS deps
WORKDIR /app
ENV NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/web/package.json apps/web/
COPY apps/mcp/package.json apps/mcp/
# --ignore-scripts: no dependency lifecycle scripts run during the build.
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts

FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY packages ./packages
COPY apps ./apps
COPY tsconfig.base.json ./
# The image is only produced when the test suite passes.
RUN npm test && npm run build -w @pocket-master/web
# Image optimisation is off (next.config.ts), so sharp and its ~19 MB of native binaries are dead weight.
RUN rm -rf apps/web/.next/standalone/node_modules/sharp apps/web/.next/standalone/node_modules/@img

FROM ${RUNTIME_IMAGE} AS runtime
# Pinned to the Node major the app is built and tested with; the build fails if 3.23 moves off it.
# hadolint ignore=DL3018
RUN apk add --no-cache 'nodejs>=24' 'nodejs<25' \
 && addgroup -S -g 65532 app && adduser -S -D -H -u 65532 -G app app \
 && apk --purge del apk-tools \
 && rm -rf /var/cache/apk /etc/apk /lib/apk
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
# The health check uses Node itself, so no curl or wget is needed.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "apps/web/server.js"]
