#!/usr/bin/env sh
# Smoke test for a container image: starts it, waits until the editor answers
# over HTTP, checks the page title, the static assets and the non-root user.
# Usage: scripts/smoke-test.sh <image> [port]
set -eu

image="${1:?usage: smoke-test.sh <image> [port]}"
port="${2:-3300}"
name="pme-smoke-$$"
url="http://127.0.0.1:${port}"

cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "$name" -p "${port}:3000" "$image" >/dev/null

i=0
until curl -sf -o /dev/null "$url/"; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    echo "FAIL: editor did not answer on $url within 30 s" >&2
    docker logs "$name" >&2 || true
    exit 1
  fi
  sleep 1
done

page="$(curl -sf "$url/")"
echo "$page" | grep -q '<title>Pocket Master Editor</title>' || { echo "FAIL: page title missing" >&2; exit 1; }

asset="$(echo "$page" | grep -o '/_next/static/[^"]*\.js' | head -n 1)"
[ -n "$asset" ] || { echo "FAIL: no static script referenced by the page" >&2; exit 1; }
curl -sf -o /dev/null "$url$asset" || { echo "FAIL: static asset $asset not served" >&2; exit 1; }

user="$(docker exec "$name" id -u)"
[ "$user" != "0" ] || { echo "FAIL: container runs as root" >&2; exit 1; }

echo "OK: $image serves the editor on $url (uid $user, asset $asset)"
