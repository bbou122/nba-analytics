#!/usr/bin/env bash
# Render (or any container host) entrypoint: downloads the demo warehouse on
# first boot if it isn't already present, then starts the API.
#
# Env vars used:
#   NBA_WAREHOUSE_PATH  - where to store/read the warehouse file (required)
#   WAREHOUSE_URL         - a direct download URL for the demo warehouse
#                          (a GitHub Release asset URL); required unless the
#                          file already exists at NBA_WAREHOUSE_PATH
#   PORT                 - port to bind (most hosts set this for you)
set -e

if [ ! -f "$NBA_WAREHOUSE_PATH" ]; then
  if [ -z "$WAREHOUSE_URL" ]; then
    echo "ERROR: $NBA_WAREHOUSE_PATH does not exist and WAREHOUSE_URL is not set." >&2
    echo "Set WAREHOUSE_URL in this service's Environment tab to a direct download" >&2
    echo "URL for demo_warehouse.duckdb (e.g. a GitHub Release asset URL), then redeploy." >&2
    exit 1
  fi
  echo "Downloading warehouse from $WAREHOUSE_URL to $NBA_WAREHOUSE_PATH ..."
  mkdir -p "$(dirname "$NBA_WAREHOUSE_PATH")"
  curl -L --fail --retry 3 -o "$NBA_WAREHOUSE_PATH" "$WAREHOUSE_URL"
  echo "Download complete: $(du -h "$NBA_WAREHOUSE_PATH" | cut -f1)"
fi

exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8000}"
