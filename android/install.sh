#!/usr/bin/env bash
set -euo pipefail
export DSH_TAVERN_RUNTIME_HOST=android
export DSH_TAVERN_START_TIMEOUT="${DSH_TAVERN_START_TIMEOUT:-120}"

export npm_config_registry="${DSH_TAVERN_NPM_REGISTRY:-https://registry.npmmirror.com}"
# pnpm 11 reads pnpm_config_* instead of npm_config_*.
export pnpm_config_registry="$npm_config_registry"

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
DSH_ROOT="${DSH_HOME:-${HOME}/.dsh}"
TAVERN_PROFILE_DIR="${DSH_ROOT}/profiles/tavern"
TAVERN_PORT=3088
PNPM_VERSION=11.25.0

fail() {
  printf '安装失败：%s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "缺少命令 $1。请先在 DSHA 中安装对应依赖。"
}

find_web_profile() {
  if [ -n "${DSH_ANDROID_WEB_PROFILE:-}" ]; then
    printf '%s\n' "${DSH_ANDROID_WEB_PROFILE}"
  elif [ -f "${DSH_ROOT}/profiles/web/package.json" ]; then
    printf '%s\n' web
  elif [ -f "${DSH_ROOT}/profiles/user/package.json" ]; then
    printf '%s\n' user
  else
    fail "找不到 DSHA 的 web 或 user Profile。请先启动一次 DSHA，或设置 DSH_ANDROID_WEB_PROFILE。"
  fi
}

probe_port() {
  node - "$1" <<'NODE'
const net = require('node:net')
const port = Number(process.argv[2])
const socket = net.createConnection({ host: '127.0.0.1', port })
const done = (ok) => {
  socket.destroy()
  process.exit(ok ? 0 : 1)
}
socket.setTimeout(1500)
socket.once('connect', () => done(true))
socket.once('timeout', () => done(false))
socket.once('error', () => done(false))
NODE
}

require_command node
require_command dsh
# Keep Tavern's package manager independent of DSHA's bundled pnpm and PATH.
PNPM_ROOT="${DSH_ROOT}/runtime/tavern-pnpm/${PNPM_VERSION}"
PNPM_COMMAND="${PNPM_ROOT}/bin/pnpm"
INSTALLED_PNPM_VERSION=$("${PNPM_COMMAND}" --version 2>/dev/null || :)
if [ "${INSTALLED_PNPM_VERSION}" != "${PNPM_VERSION}" ]; then
  require_command npm
  printf '\n正在安装 Tavern 专用 pnpm %s……\n' "${PNPM_VERSION}"
  # Restored backups can contain ordinary bin files without node_modules.
  # Build and verify a fresh prefix before replacing the version-owned runtime.
  (
    mkdir -p "$(dirname -- "${PNPM_ROOT}")"
    pnpm_stage=$(mktemp -d "${PNPM_ROOT}.install.XXXXXX")
    pnpm_backup="${pnpm_stage}.previous"
    pnpm_committed=0
    cleanup_pnpm_install() {
      rm -rf -- "${pnpm_stage}"
      if [ -e "${pnpm_backup}" ] || [ -L "${pnpm_backup}" ]; then
        if [ "${pnpm_committed}" = 1 ]; then
          rm -rf -- "${pnpm_backup}"
        elif [ ! -e "${PNPM_ROOT}" ] && [ ! -L "${PNPM_ROOT}" ]; then
          mv -- "${pnpm_backup}" "${PNPM_ROOT}"
        fi
      fi
    }
    trap cleanup_pnpm_install EXIT
    npm install --global --prefix "${pnpm_stage}" "pnpm@${PNPM_VERSION}"
    staged_version=$("${pnpm_stage}/bin/pnpm" --version 2>/dev/null || :)
    [ "${staged_version}" = "${PNPM_VERSION}" ] || fail "新 pnpm 安装后校验失败，原目录未修改。"
    if [ -e "${PNPM_ROOT}" ] || [ -L "${PNPM_ROOT}" ]; then
      mv -- "${PNPM_ROOT}" "${pnpm_backup}"
    fi
    mv -- "${pnpm_stage}" "${PNPM_ROOT}"
    pnpm_committed=1
  )
fi
INSTALLED_PNPM_VERSION=$("${PNPM_COMMAND}" --version 2>/dev/null || :)
[ "${INSTALLED_PNPM_VERSION}" = "${PNPM_VERSION}" ] || fail "Tavern 专用 pnpm ${PNPM_VERSION} 安装后校验失败（当前：${INSTALLED_PNPM_VERSION:-不可用}）。"
# Node/DSH child processes also invoke pnpm by name. Scope their resolution and
# version-check policy to this installer; do not alter the user's system PATH.
export PATH="${PNPM_ROOT}/bin:${PATH}"
export pnpm_config_update_notifier=false
# All dependency and Profile installs below use this exact executable.
pnpm() {
  "${PNPM_COMMAND}" --config.update-notifier=false "$@"
}
# Android 的 proot 会把硬链接模拟成符号链接，pnpm 默认导入方式可能因此
# 生成无法进行相对 require 的包目录。DSHA 中的所有后续安装也必须沿用复制模式。
pnpm config set package-import-method copy --location=user
pnpm config set side-effects-cache false --location=user

run_dsh() {
  node --expose-internals "$(command -v dsh)" "$@"
}
[ -f "${REPO_ROOT}/package.json" ] || fail "脚本必须位于完整的 dsh-tavern 仓库中。"
[ -f "${SCRIPT_DIR}/dsh-tavern-entry/package.json" ] || fail "缺少 dsh-tavern-entry。"

WEB_PROFILE_NAME="$(find_web_profile)"
WEB_PROFILE_DIR="${DSH_ROOT}/profiles/${WEB_PROFILE_NAME}"

printf '\n正在安装 dsh-tavern 核心依赖……\n'
pnpm --dir "${REPO_ROOT}" install --frozen-lockfile

if [ "${DSH_TAVERN_ANDROID_STANDALONE:-0}" != 1 ] && [ -f "${TAVERN_PROFILE_DIR}/package.json" ]; then
  printf '\n正在停止旧版酒馆服务……\n'
  DSH_HOME="${DSH_ROOT}" DSH_TAVERN_PORT="${TAVERN_PORT}" \
    node "${REPO_ROOT}/bin/dsh-tavern.mjs" stop
fi

DSH_HOME="${DSH_ROOT}" node "${REPO_ROOT}/bin/dsh-tavern.mjs" install --host android

printf '\n正在把安卓插件加入 tavern 与 %s Profile……\n' "${WEB_PROFILE_NAME}"
node "${SCRIPT_DIR}/configure-profiles.mjs" "${REPO_ROOT}" "${TAVERN_PROFILE_DIR}" "${WEB_PROFILE_DIR}"

pnpm --dir "${TAVERN_PROFILE_DIR}" install
pnpm --dir "${WEB_PROFILE_DIR}" install
# pnpm 处理 link: 依赖时可能重新生成绝对链接。最后再规范化一次，确保
# DSHA 从 Android 宿主 rootfs 检查 bundle 时也能解析酒馆入口。
node "${SCRIPT_DIR}/configure-profiles.mjs" "${REPO_ROOT}" "${TAVERN_PROFILE_DIR}" "${WEB_PROFILE_DIR}"
run_dsh --profile tavern --dump-config >/dev/null
run_dsh --profile "${WEB_PROFILE_NAME}" --dump-config >/dev/null
# --dump-config never imports the plugin. Fail (and let setup.sh roll back) when the
# Profile installs above left the plugin without one of its runtime packages.
node "${REPO_ROOT}/bin/runtime-dependencies.mjs" "${REPO_ROOT}"

if [ "${DSH_TAVERN_ANDROID_STANDALONE:-0}" = 1 ]; then
  printf '\n安装完成。请返回 DSH Tavern 应用并重新启动酒馆。\n'
  exit 0
fi

printf '\n正在启动 3088 酒馆服务……\n'
DSH_HOME="${DSH_ROOT}" DSH_TAVERN_PORT="${TAVERN_PORT}" \
  DSH_TAVERN_RUNTIME_HOST="android" \
  node "${REPO_ROOT}/bin/dsh-tavern.mjs" start

probe_port "${TAVERN_PORT}" || fail "3088 端口未能启动，请查看 ${DSH_ROOT}/logs/tavern.log。"

printf '\n安装完成。\n'
printf '酒馆地址：http://127.0.0.1:%s\n' "${TAVERN_PORT}"
if probe_port 3080; then
  printf 'DSHA Web：http://127.0.0.1:3080（当前可访问）\n'
else
  printf '提示：3080 当前未监听；重启 DSHA 后再检查。\n'
fi
printf '请重启一次 DSHA，使自动拉起和移动端界面正式加载。\n'
