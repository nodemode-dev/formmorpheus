---
name: ipad-build
description: "Building and running FormMorpheus on an iPad: the Mac it needs, XcodeGen, signing, ./formmorpheus ios, Web Inspector, diagnostics, and where the iPad project's files live. Use when someone builds the iPad app, a build stops, or a change touches ios/."
---

# The iPad build

The guide for a person is `docs/ios/BUILD.md`; TestFlight and App Store steps are `docs/ios/TESTFLIGHT.md` and `docs/ios/APP_STORE.md`. Read them before answering; this file is the short form.

## What it needs

A Mac with the Xcode and iPadOS SDK versions `docs/ios/BUILD.md` names, an Apple developer account signed in to Xcode, Node.js, XcodeGen (`brew install xcodegen`), and an iPad with Developer Mode on.

## Signing

Copy `ios/Config/Local.xcconfig.example` to `ios/Config/Local.xcconfig` and set `DEVELOPMENT_TEAM` (and `PRODUCT_BUNDLE_IDENTIFIER` when the default is not available to the account), or pick the team in Xcode under the FormMorpheus target. `Local.xcconfig` is not committed.

## Build and run

1. `./formmorpheus ios` (the script is `setup/ios`, macOS only; `formmorpheus.bat ios` says so and stops): builds the interface, copies it to `ios/Resources/web`, generates `ios/FormMorpheus.xcodeproj` with XcodeGen and opens Xcode. `--no-open` skips the last step.
2. In Xcode choose the FormMorpheus scheme and the iPad, then Run. The first run needs the developer trusted on the iPad (Settings, General, VPN & Device Management).
3. After any change to the interface or the Swift code, run `./formmorpheus ios` again. Never edit the generated Xcode project.

"ios/Resources/web/index.html is missing" means the interface was not copied: run `./formmorpheus ios` again.

## Where things are

- `ios/project.yml`: the project spec (its `MARKETING_VERSION` is a version site; see the `releasing` sub-skill). `ios/Config/Base.xcconfig`: shared settings.
- `ios/App`, `ios/Web`: the app, the web view host, the `fm://` scheme handler and the bridge.
- `ios/Engine`, `ios/Export`: the Swift engine that answers the interface's `/api/` calls on iPad. `setup/api_contract_check` compares the routes it serves with `docs/api-contract.json` and prints the ones it lacks, required and desktop-only.
- Movies made on the iPad are in the Files app under On My iPad, FormMorpheus.

## Not on iPad

No ffmpeg, no socket server and no folder dialog: the routes that need them are `DESKTOP_ONLY` in `setup/api_contract_check`. The MCP server and the dock's terminals are engine features of the desktop and source builds.

## Debugging

Debug builds allow Safari's Web Inspector (turn it on in the iPad's Safari settings, then Safari's Develop menu on the Mac). Help, About, Diagnostics writes `diagnostics-[date].json` to share; the steps are in `docs/ios/BUILD.md`.
