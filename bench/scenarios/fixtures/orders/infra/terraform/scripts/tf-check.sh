#!/usr/bin/env bash
# The checks every change to this folder must pass.
set -euo pipefail
cd "$(dirname "$0")/.."
terraform fmt -check -recursive
terraform init -backend=false -input=false >/dev/null
terraform validate
tflint --recursive
checkov -d . --quiet
