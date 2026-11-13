#!/usr/bin/env bash
# Actual source; isolated PostgreSQL and local stubs only, with no Docker network.
set -euo pipefail
node_bin="${HKIS_NODE_BIN:-$(command -v node)}"
node_bin="$(readlink -f "$node_bin")"
"$node_bin" -e 'const [a,b,c]=process.versions.node.split(".").map(Number);if(a<24||(a===24&&(b<22||(b===22&&c<1))))process.exit(1)'
repo_dir="$(cd "$(dirname "$0")/.." && pwd -P)"
if [[ -L "$repo_dir/.data" ]]; then echo 'isolated_data_path_symlink' >&2; exit 1; fi
mkdir -p "$repo_dir/.data"
container_name="hkis-pg-isolated-$$"
docker_cmd=(env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH docker --host=unix:///var/run/docker.sock)
"${docker_cmd[@]}" info --format '{{.ServerVersion}}' >/dev/null
cleanup(){ "${docker_cmd[@]}" rm -f "$container_name" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM
"${docker_cmd[@]}" run -d --network none --name "$container_name" \
 --mount "type=bind,src=$repo_dir,dst=/work,readonly" \
 --tmpfs /work/.data:rw,nosuid,nodev \
 --mount "type=bind,src=$node_bin,dst=/usr/local/bin/node,readonly" \
 -e POSTGRES_USER=hkistest -e POSTGRES_PASSWORD=localtest -e POSTGRES_DB=hkis_test postgres:17 >/dev/null
network_mode="$("${docker_cmd[@]}" inspect --format '{{.HostConfig.NetworkMode}}' "$container_name")"
if [[ "$network_mode" != none ]]; then echo 'isolated_network_not_none' >&2; exit 1; fi
ready=false
for i in {1..30}; do if "${docker_cmd[@]}" exec "$container_name" pg_isready -q -U hkistest -d hkis_test; then ready=true; break; fi; sleep 1; done
if [[ "$ready" != true ]]; then echo 'isolated_postgres_not_ready' >&2; exit 1; fi
suite="${HKIS_PG_SUITE:-full}"
simulation_env=()
node_options="--import=/work/tests/fixtures/closed-safety-valves.mjs"
case "$suite" in
 full) ;;
 translation-simulation|receipts-simulation|core-simulation|child-simulation|notification-simulation|full-simulation) simulation_env=(-e HKIS_TRANSLATION_SIMULATION=1); node_options="$node_options --import=/work/tests/fixtures/translation-simulation-loader.mjs" ;;
 *) echo 'unknown_isolated_suite' >&2; exit 2 ;;
esac
exec_cmd=("${docker_cmd[@]}" exec -w /work -e DATABASE_URL=postgres://hkistest:localtest@127.0.0.1:5432/hkis_test -e MODEL_CALLS_ENABLED=false -e COLLECT_ENABLED=false -e FEISHU_CONTENT_PUSH_ENABLED=false -e FEISHU_INTERNAL_ENABLED=false -e INDEXNOW_SUBMIT_ENABLED=false -e AIHOT_CREDENTIALS_DIR=/nonexistent-test-credentials -e AIHOT_DATA_DIR=/tmp/hkis-test-data -e "NODE_OPTIONS=$node_options" "${simulation_env[@]}" "$container_name" node)
"${exec_cmd[@]}" --input-type=module -e 'import assert from "node:assert/strict";import {networkInterfaces} from "node:os";assert.deepEqual(Object.keys(networkInterfaces()),["lo"]);console.log("isolated_network=loopback_only")'
"${exec_cmd[@]}" scripts/migrate.ts
if [[ "$suite" == translation-simulation ]]; then
 echo 'translation_simulation=in_memory_model_double_not_production_provider'
 "${exec_cmd[@]}" --test tests/translate.test.ts tests/model-valve-isolation.test.ts
elif [[ "$suite" == receipts-simulation ]]; then
 echo 'receipts_simulation=in_memory_model_double_not_production_provider'
 "${exec_cmd[@]}" --test tests/receipts.test.ts tests/model-valve-isolation.test.ts
elif [[ "$suite" == core-simulation ]]; then
 echo 'core_simulation=in_memory_model_double_not_production_provider'
 "${exec_cmd[@]}" --test --test-concurrency=1 tests/analyze.test.ts tests/default-model.test.ts tests/events.test.ts tests/signals.test.ts tests/report-candidates.test.ts tests/receipts.test.ts tests/translate.test.ts tests/model-valve-isolation.test.ts
elif [[ "$suite" == child-simulation ]]; then
 echo 'child_simulation=loopback_stub_not_production_provider'
 "${exec_cmd[@]}" --test --test-concurrency=1 tests/analyze-shutdown.test.ts tests/translate-shutdown.test.ts tests/relation-eval-runtime.test.ts tests/selection-eval-runtime.test.ts tests/model-valve-isolation.test.ts
elif [[ "$suite" == notification-simulation ]]; then
 echo 'notification_simulation=test_only_configuration_double'
 "${exec_cmd[@]}" --test --test-concurrency=1 tests/deliveries.test.ts tests/feedback.test.ts tests/feedback-upload.test.ts tests/alerts.test.ts tests/model-valve-isolation.test.ts
elif [[ "$suite" == full-simulation ]]; then
 echo 'full_simulation=selective_test_doubles_not_production_providers'
 "${exec_cmd[@]}" --test --test-concurrency=1 --test-timeout=120000 'tests/*.test.ts'
else
 "${exec_cmd[@]}" --test --test-concurrency=1 --test-timeout=120000 'tests/*.test.ts'
fi
