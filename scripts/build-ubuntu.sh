#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd -P)"

usage() {
  cat <<'USAGE'
Build and verify the unsigned Ubuntu/Linux x64 Desktop packages.

Usage:
  ./scripts/build-ubuntu.sh [--help]

Optional:
  DSH_NODE_BIN=/path/to/node/bin  Use a specific Node/Corepack installation.

Outputs:
  dsh-plugin-desktop/dist/DSH-Desktop-<version>-x86_64.AppImage
  dsh-plugin-desktop/dist/DSH-Desktop-<version>-amd64.deb
USAGE
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi
if [[ "$#" -ne 0 ]]; then
  usage >&2
  exit 2
fi

# This repo's Linux packager expects native Linux x64 and Node 22.19+ or 24.x.
[[ "$(uname -s)" == "Linux" ]] || fail 'Run this script on a native Linux host.'

if [[ -n "${DSH_NODE_BIN:-}" ]]; then
  [[ -x "${DSH_NODE_BIN}/node" && -x "${DSH_NODE_BIN}/corepack" ]] \
    || fail "DSH_NODE_BIN must contain executable node and corepack: ${DSH_NODE_BIN}"
  export PATH="${DSH_NODE_BIN}:${PATH}"
elif ! command -v node >/dev/null 2>&1 || ! command -v corepack >/dev/null 2>&1; then
  # Common local Node installation used by this development workstation.
  fallback_node_bin="${HOME}/Tools/node-v24.21.0-linux-x64/bin"
  if [[ -x "${fallback_node_bin}/node" && -x "${fallback_node_bin}/corepack" ]]; then
    export PATH="${fallback_node_bin}:${PATH}"
  fi
fi

command -v node >/dev/null 2>&1 || fail 'Node.js is missing. Install Node 22.19+ or 24.x, or set DSH_NODE_BIN.'
command -v corepack >/dev/null 2>&1 || fail 'Corepack is missing. Use a Node installation that includes Corepack, or set DSH_NODE_BIN.'

NODE_VERSION="$(node -p 'process.versions.node')"
NODE_ARCH="$(node -p 'process.arch')"
node -e '
  const [major, minor] = process.versions.node.split(".").map(Number)
  if (!((major === 22 && minor >= 19) || major === 24)) {
    console.error(`Linux packaging requires Node 22.19+ or 24.x; found ${process.versions.node}`)
    process.exit(1)
  }
  if (process.platform !== "linux" || process.arch !== "x64") {
    console.error(`Linux packaging requires Linux x64; found ${process.platform}/${process.arch}`)
    process.exit(1)
  }
' || exit 1

YARN_VERSION="$(corepack yarn --version)"
[[ "${YARN_VERSION}" == "4.18.0" ]] \
  || fail "This repository requires Yarn 4.18.0; Corepack selected ${YARN_VERSION}."

# Avoid Yarn 4.18.0's intermittent Fetch-step cancellation race on this network.
# Callers may override this when their network is stable and higher parallelism helps.
export YARN_NETWORK_CONCURRENCY="${YARN_NETWORK_CONCURRENCY:-1}"

UPSTREAM_DIR="${REPO_ROOT}/deepseek-harness"
if ! git -C "${UPSTREAM_DIR}" rev-parse --show-toplevel >/dev/null 2>&1; then
  fail 'The deepseek-harness submodule is not initialized. Run: git submodule update --init --recursive'
fi
UPSTREAM_PIN="$(git -C "${REPO_ROOT}" rev-parse 'HEAD:deepseek-harness')"
UPSTREAM_HEAD="$(git -C "${UPSTREAM_DIR}" rev-parse HEAD)"
UPSTREAM_DIRTY="$(git -C "${UPSTREAM_DIR}" status --porcelain --untracked-files=all)"
if [[ "${UPSTREAM_HEAD}" != "${UPSTREAM_PIN}" || -n "${UPSTREAM_DIRTY}" ]]; then
  printf '\nWARNING: deepseek-harness is not clean at the recorded pin.\n'
  printf 'This build may include a local upstream overlay and is for local verification only; do not publish it as a release.\n\n'
fi

cd "${REPO_ROOT}"
printf 'Repository: %s\n' "${REPO_ROOT}"
printf 'Node: %s (%s)\n' "${NODE_VERSION}" "${NODE_ARCH}"
printf 'Yarn: %s\n' "${YARN_VERSION}"
printf '\n[1/3] Install locked dependencies\n'
corepack yarn install --immutable

printf '\n[2/3] Verify Stable/Beta shared-source alignment\n'
corepack yarn check:desktop-variants

printf '\n[3/3] Run Linux package checks and build AppImage + .deb\n'
corepack yarn workspace dsh-plugin-desktop dist:linux

PACKAGE_VERSION="$(node -e 'console.log(require(process.argv[1]).version)' "${REPO_ROOT}/dsh-plugin-desktop/package.json")"
APPIMAGE="${REPO_ROOT}/dsh-plugin-desktop/dist/DSH-Desktop-${PACKAGE_VERSION}-x86_64.AppImage"
DEB="${REPO_ROOT}/dsh-plugin-desktop/dist/DSH-Desktop-${PACKAGE_VERSION}-amd64.deb"
[[ -f "${APPIMAGE}" ]] || fail "Expected AppImage was not found: ${APPIMAGE}"
[[ -f "${DEB}" ]] || fail "Expected Debian package was not found: ${DEB}"
printf '\nBuild and packaged-artifact verification succeeded.\n'
printf 'AppImage: %s\n' "${APPIMAGE}"
printf 'Debian:   %s\n' "${DEB}"
printf '\nNote: this package-local command does not refresh dshmarket or Agents Anywhere release inputs.\n'
printf 'For an official release build, follow AGENTS.md and use the root release workflow.\n'
