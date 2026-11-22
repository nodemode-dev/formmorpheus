#!/usr/bin/env bash
FM_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export FM_ROOT
fm_say() { printf '[formmorpheus] %s\n' "$*"; }
fm_die() { printf '[formmorpheus] error: %s\n' "$*" >&2; exit 1; }
fm_os() {
  case "$(uname -s 2>/dev/null)" in
    Darwin) echo macos ;;
    Linux) echo linux ;;
    MINGW*|MSYS*|CYGWIN*) echo windows ;;
    *) echo unknown ;;
  esac
}
fm_venv() {
  local act="$FM_ROOT/backend/venv/bin/activate"
  [ -f "$act" ] || act="$FM_ROOT/backend/venv/Scripts/activate"
  [ -f "$act" ] || fm_die "backend venv missing, run ./formmorpheus install"
  source "$act"
}
fm_python() {
  local c
  for c in python3.12 python3.13 python3.14 python3; do
    if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 12) else 1)' 2>/dev/null; then echo "$c"; return 0; fi
  done
  return 1
}
fm_native_path() {
  if [ "$(fm_os)" = windows ] && command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s\n' "$1"; fi
}
fm_version() { sed -n "s/^export const VERSION = '\(.*\)';$/\1/p" "$FM_ROOT/frontend/src/version.ts" 2>/dev/null; }
