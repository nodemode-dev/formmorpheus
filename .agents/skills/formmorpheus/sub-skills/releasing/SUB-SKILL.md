---
name: releasing
description: "Cutting a FormMorpheus release: the changelog section, every version site, the order of the commits with the release commit last, merge commits only, and who pushes. Use when bumping the version, writing CHANGELOG.md, or preparing a release branch."
---

# Releasing

## The changelog

`CHANGELOG.md` at the root. Versions are `v*.*.*` with dots and dates are US Eastern. Each section is `## X.Y.Z · YYYY-MM-DD`, one plain sentence that says what the release is for the person, then `### New`, `### Improved`, `### Changed`, `### Fixed`, `### Under the hood` as needed. It is written for the person using FormMorpheus; the reasons go in the `HASHOUT_LOG.md` beside the code (`backend/HASHOUT_LOG.md`, `frontend/HASHOUT_LOG.md`, `src-tauri/HASHOUT_LOG.md`).

## Version sites

Every one of these carries the version; change them all in the release commit and grep for the old number afterwards.

| File | What to change |
| --- | --- |
| `README.md` | the version badge (its alt text and the badge address) |
| `backend/app/__init__.py` | `__version__` |
| `frontend/package.json` | `version` |
| `frontend/package-lock.json` | the two `version` fields of the root package |
| `frontend/src/version.ts` | `VERSION` (the launchers read it: `fm_version` in `setup/lib.sh`, `:read_version` in `formmorpheus.bat`) |
| `ios/Engine/EngineSupport.swift` | the version string the iPad engine reports |
| `ios/project.yml` | `MARKETING_VERSION` |
| `src-tauri/Cargo.toml` | `version` |
| `src-tauri/Cargo.lock` | the `formmorpheus` package's `version` |
| `src-tauri/tauri.conf.json` | `version` |

## Commits

- Conventional Commits, one author and committer, `nodemode-ai`, as `CLAUDE.md` gives it. No attribution trailers of any kind and no "Generated with" line in a pull request.
- The work commits first (`feat(...)`, `fix(...)`, `docs: ...` for the changelog and What's New), then `chore(release): X.Y.Z` last, holding only the version sites.
- Branches come in through merge commits only; no squash, no rebase merges.
- The owner pushes. Never push, and never tag on their behalf.

## Before the release commit

- `cd frontend && npx tsc --noEmit` and `npm run build` clean.
- `./formmorpheus lint` reports 0 hits.
- `./formmorpheus agents sync --check` exits 0 (the skill mirror and `agents/manifest.json` match the code).
- `./formmorpheus doctor` for the toolchain.
