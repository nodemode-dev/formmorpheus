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
  [ -f "$FM_ROOT/backend/venv/bin/activate" ] || fm_die "backend venv missing, run ./formmorpheus install"
  source "$FM_ROOT/backend/venv/bin/activate"
}
fm_version() { sed -n "s/^export const VERSION = '\(.*\)';$/\1/p" "$FM_ROOT/frontend/src/version.ts" 2>/dev/null; }
