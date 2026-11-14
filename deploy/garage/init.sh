#!/bin/sh
# Idempotent setup of a single-node Garage through its admin API:
# layout, bucket, access key and its read/write grant on the bucket.
set -eu

ADMIN="${GARAGE_ADMIN_URL:-http://garage:3903}"
BUCKET="${CANONICO_S3_BUCKET:-canonico-library}"
KEY_ID="${CANONICO_S3_ACCESS_KEY:?CANONICO_S3_ACCESS_KEY is required}"
KEY_SECRET="${CANONICO_S3_SECRET_KEY:?CANONICO_S3_SECRET_KEY is required}"
: "${GARAGE_ADMIN_TOKEN:?GARAGE_ADMIN_TOKEN is required}"

api() { curl -fsS -H "Authorization: Bearer $GARAGE_ADMIN_TOKEN" -H "Content-Type: application/json" "$@"; }
field() { tr -d '\n ' | sed -n "s/.*\"$1\":\([^,}]*\).*/\1/p" | head -n 1 | tr -d '"'; }

i=0
until api "$ADMIN/v1/status" >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -ge 60 ] && { echo "garage admin API not reachable"; exit 1; }
  sleep 1
done

node=$(api "$ADMIN/v1/status" | tr -d '\n ' | sed -n 's/.*"node":"\([0-9a-f]*\)".*/\1/p')
version=$(api "$ADMIN/v1/layout" | field version)
if [ "$version" = "0" ]; then
  api -X POST "$ADMIN/v1/layout" -d "[{\"id\":\"$node\",\"zone\":\"dc1\",\"capacity\":1073741824,\"tags\":[]}]" >/dev/null
  api -X POST "$ADMIN/v1/layout/apply" -d '{"version":1}' >/dev/null
  echo "layout applied"
fi

if ! api "$ADMIN/v1/key?id=$KEY_ID" >/dev/null 2>&1; then
  api -X POST "$ADMIN/v1/key/import" -d "{\"name\":\"canonico\",\"accessKeyId\":\"$KEY_ID\",\"secretAccessKey\":\"$KEY_SECRET\"}" >/dev/null
  echo "access key imported"
fi

if ! bucket=$(api "$ADMIN/v1/bucket?globalAlias=$BUCKET" 2>/dev/null); then
  bucket=$(api -X POST "$ADMIN/v1/bucket" -d "{\"globalAlias\":\"$BUCKET\"}")
  echo "bucket $BUCKET created"
fi
bucket_id=$(printf '%s' "$bucket" | field id)

api -X POST "$ADMIN/v1/bucket/allow" -d "{\"bucketId\":\"$bucket_id\",\"accessKeyId\":\"$KEY_ID\",\"permissions\":{\"read\":true,\"write\":true,\"owner\":true}}" >/dev/null
echo "garage ready: bucket $BUCKET"
