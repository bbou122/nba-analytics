#!/usr/bin/env bash
# Render (or any container host) entrypoint: downloads the demo warehouse on
# first boot if it isn't already present, then starts the API.
#
# Env vars used:
#   NBA_WAREHOUSE_PATH  - where to store/read the warehouse file (required)
#   WAREHOUSE_URL        - a direct download URL for the demo warehouse
#                          (a GitHub Release asset URL); skipped if unset or
#                          if the file already exists at NBA_WAREHOUSE_PATH
#   PORT                 - port to bind (most hosts set this for you)
set -e

if [ -n "$WAREHOUSE_URL" ] && [ ! -f "$NBA_WAREHOUSE_PATH" ]; then
  echo "Downloading warehouse from \$WAREHOUSE_URL to $NBA_WAREHOUSE_PATH ..."
  mkdir -p "$(dirname "$NBA_WAREHOUSE_PATH")"
  curl -L --fail --retry 3 -o "$NBA_WAREHOUSE_PATH" "$WAREHOUSE_URL"
  echo "Download complete: $(du -h "$NBA_WAREHOUSE_PATH" | cut -f1)"
fi

exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8000}"
