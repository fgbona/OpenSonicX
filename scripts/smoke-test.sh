#!/usr/bin/env sh
# Smoke test for a container image. Starts it with the same restrictions as
# compose.yaml (read-only root, no capabilities, no-new-privileges, init),
# waits until the editor answers over HTTP, then checks the page title, one
# static asset, the non-root user, the health check and a clean stop.
# Usage: scripts/smoke-test.sh <image> [port]
set -eu

image="${1:?usage: smoke-test.sh <image> [port]}"
port="${2:-3300}"
name="pme-smoke-$$"
url="http://127.0.0.1:${port}"

fail() { echo "FAIL: $*" >&2; docker logs "$name" >&2 2>/dev/null || true; exit 1; }
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "$name" -p "127.0.0.1:${port}:3000" \
  --init --read-only --tmpfs /tmp:size=16m \
  --cap-drop ALL --security-opt no-new-privileges:true \
  --pids-limit 128 --memory 256m \
  "$image" >/dev/null

i=0
until curl -sf -o /dev/null "$url/"; do
  i=$((i + 1))
  [ "$i" -lt 30 ] || fail "editor did not answer on $url within 30 s"
  sleep 1
done

page="$(curl -sf "$url/")"
echo "$page" | grep -q '<title>OpenSonicX[^<]*</title>' || fail "page title missing"

asset="$(echo "$page" | grep -o '/_next/static/[^"]*\.js' | head -n 1)"
[ -n "$asset" ] || fail "no static script referenced by the page"
curl -sf -o /dev/null "$url$asset" || fail "static asset $asset not served"

user="$(docker inspect --format '{{.Config.User}}' "$name")"
case "$user" in ""|0|0:*|root|root:*) fail "image runs as root (User='$user')";; esac

i=0
until [ "$(docker inspect --format '{{.State.Health.Status}}' "$name")" = "healthy" ]; do
  i=$((i + 1))
  [ "$i" -lt 40 ] || fail "health check did not report healthy within 40 s"
  sleep 1
done

start=$(date +%s)
docker stop -t 10 "$name" >/dev/null
elapsed=$(( $(date +%s) - start ))
[ "$elapsed" -lt 8 ] || fail "container took ${elapsed}s to stop; SIGTERM is not handled"

echo "OK: $image serves the editor (user $user, asset $asset, healthy, stopped in ${elapsed}s)"
