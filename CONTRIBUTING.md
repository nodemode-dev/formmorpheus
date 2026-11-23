# Contributing to FormMorpheus

Thank you for helping. FormMorpheus is the Form family's animation studio: drawing,
flipbooks, keyframes, performed motion, sound and export in one window, with no
account, running on your own computer. It gets better through real use and real
contributions.

## Where to start

- **Use it and report what goes wrong.** A clear bug report, with steps, the version
  and your platform, is one of the most useful things you can give.
- **Look at the open issues.** Comment on one before starting larger work, so nobody
  builds the same thing twice.
- **Keep to what FormMorpheus is for.** It animates. Layered image editing (FormVis),
  video editing (formcut), sound editing (formwav), transcoding (FormEncoder) and
  installing apps (FormPortal) stay in those apps.

## Setting up

Clone the repository, run `./formmorpheus_oc_install` once, then `./formmorpheus` (on
Windows, `formmorpheus_oc_install.bat` and `formmorpheus.bat`). The first installs what
the engine and the interface need; the second starts the engine on 127.0.0.1:9494 and
the window at http://localhost:5194. You need Python 3.12 or newer and Node.js 20.19+
or 22.12+; the desktop window (`./formmorpheus desktop dev`) also needs Rust.
`./formmorpheus doctor` checks all of it. The README's "Run it from source" section has
the details.

The code lives in:

| Folder | What is there |
| --- | --- |
| `backend/app` | the engine (Python, FastAPI): the library, files, export jobs, recovery, Pen Link, MCP |
| `frontend/src` | the window (TypeScript, Vite): `engine/` and `paint/` are pure cores, `ui/` is the interface |
| `src-tauri` | the desktop shell (Rust, Tauri 2) |
| `ios` | the iPad app (Swift), with its own engine |
| `setup` | the scripts behind `./formmorpheus`, and the checks CI runs |
| `agents` | what the app offers AI agents: the skill pack and its manifest |
| `docs` | the manual (also the in-app Help), the API contract, the iPad build notes |
| `.docs/wiki` | the wiki pages |

## Before you open a pull request

Run the same checks CI runs:

```sh
(cd frontend && npm ci && npx tsc --noEmit && npm run build)
(cd backend && pip install -r requirements.txt && python -c "import app.main" && python -m compileall -q app)
(cd src-tauri && cargo check --locked)
python3 setup/lint_text
python setup/api_contract_dump --check
python setup/api_contract_check
python setup/window_check
./formmorpheus agents sync --check
```

`setup/window_check` needs Chrome or Chromium; it opens the built page, served by the
engine, and fails on any error the page reports. After adding or changing an engine
route, run `python setup/api_contract_dump` to rewrite `docs/api-contract.json`.

Then run `./formmorpheus` and look at the change in a dark and a light theme, in a
narrow window, and with a movie open.

- Keep each pull request to one change.
- Write commit subjects as Conventional Commits: `type(scope): plain sentence`, for
  example `feat(timeline): ...`, `fix(export): ...`, `docs(manual): ...`.
- Change the interface in place: build it once and update the nodes that changed.
  Nothing flashes, jumps or is rebuilt. Colours, spacing, radii and z-index come from
  `frontend/src/styles/tokens.css`, and icons are inline SVG with `currentColor`.
- Every string a person reads goes through the translator, and all 30 language tables
  in `frontend/src/ui/i18n` get the new entry in the same pull request.
- No emoji anywhere, no em dash in Markdown, and keep code comments to a minimum: the
  context goes in the folder's `HASHOUT_LOG.md`. `setup/lint_text` checks this.
- Tests are written only when the maintainers ask for them.
- Keep `README.md`, `docs/MANUAL.md` and the wiki true to what the app does.

[`.docs/wiki/Contributing.md`](.docs/wiki/Contributing.md) and [`AGENTS.md`](AGENTS.md)
hold the full working rules.

## How changes land

Only the maintainers push to `main`. Everyone else forks the repository and opens a
pull request into `main`. A pull request merges, with a merge commit, when every CI
check passes on an up-to-date branch and a maintainer has approved it after its last
push.

## Releases

A release is a version, and only the maintainers make one: the version bump is the last
commit on `main`, and every build is compiled and released from
[FormCompiler](https://github.com/nodemode-dev/formcompiler), which builds every
platform and publishes them together. This repository holds the source; packaging and
releases stay in FormCompiler.

## Licensing

FormMorpheus is licensed under the Apache License 2.0. By contributing, you agree that
your contribution is licensed under the same terms. Only add code you have the right
to contribute, and name any third-party code and its licence in the pull request.

## Patents and other people's IP

Some features are deliberately not built because they come too close to someone else's
patent, trademark, copyright or design. The maintainers hold that line with counsel;
contributors do not decide it, and nobody here redesigns a feature on their own reading
of a patent. This is engineering diligence, not legal advice.

### Rules for every contribution

- Patents: do not add a feature, or a dependency that provides one, that reproduces a method you know to be patented. If you are unsure, open an issue that describes what the feature does, not which patent it resembles. Patent numbers stay out of code, commits, comments, logs and changelogs.
- Trademarks: other vendors' product and feature names appear only to name a file format or compatibility ("opens <format> files", "for use with"). No command, menu, panel, tool, brush, brush set, preset, template, theme or agent tool takes another product's feature name, and no text says "like X" or "the way X does it". Describe what the feature does.
- Copyright: never copy another product's help, tooltip, dialog or documentation text (link to it instead); never trace or import vendor icons; never bundle vendor templates, themes, presets, brushes, swatches, sample files, sound libraries, stock media or fonts. Example movies and test files come from this repository's own code.
- Licences: give every new dependency, binary, font or data file a row in `NOTICE.md` in the same commit that adds it. GPL stays outside the distributed app, AGPL nowhere, LGPL dynamically linked or a separate process and replaceable, MPL files unedited. CC BY credited, CC BY-SA only unmodified, CC NC and ND never.

## Conduct

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md). Security
problems go through [SECURITY.md](SECURITY.md), never a public issue.
