#!/usr/bin/env bash
# Push claw image (linux/amd64). Loads doppel-sdk/.env when present.
# Usage:
#   pnpm docker:push              — push GCP_CLAW_DOCKER_IMAGE and REPO:stage
#   pnpm docker:push -- --stage  — push only REPO:stage (does not update primary tag, e.g. :latest)
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
  set -a
  # shellcheck source=/dev/null
  source ./.env
  set +a
fi

ref="${GCP_CLAW_DOCKER_IMAGE:-}"
if [[ -z "$ref" ]]; then
  echo "docker:push: set GCP_CLAW_DOCKER_IMAGE in doppel-sdk/.env or export it in the shell" >&2
  exit 1
fi

stage_only=false
for arg in "$@"; do
  case "$arg" in
    --) ;; # pnpm run docker:push -- --stage forwards this separator
    --stage) stage_only=true ;;
    *)
      echo "docker:push: unknown option: ${arg} (supported: --stage)" >&2
      exit 1
      ;;
  esac
done

repo="${ref%:*}"
if $stage_only; then
  if [[ "$repo" == "$ref" ]]; then
    echo "docker:push --stage: GCP_CLAW_DOCKER_IMAGE must include a tag (e.g. ...:latest) so :stage can be derived" >&2
    exit 1
  fi
  stage_ref="${repo}:stage"
  docker buildx build --platform=linux/amd64 --push -t "$stage_ref" .
else
  if [[ "$repo" != "$ref" ]]; then
    docker buildx build --platform=linux/amd64 --push -t "$ref" -t "${repo}:stage" .
  else
    docker buildx build --platform=linux/amd64 --push -t "$ref" .
  fi
fi
