#!/usr/bin/env bash
# Regenerates src/generated/openapi.d.ts from the committed openapi.json snapshot.
# To pull a fresh spec first: curl -fsS https://api.simmit.com/openapi.json -o openapi.json
# CI runs this and fails on drift (git diff --exit-code src/generated/).
set -euo pipefail
cd "$(dirname "$0")/.."
npx openapi-typescript openapi.json -o src/generated/openapi.d.ts
