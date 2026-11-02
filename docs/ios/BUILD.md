# Build formmorpheus for iPad

This is the first-run guide for the Mac that builds the iPad app. You need a Mac with Xcode 26 or later (iPadOS 26 SDK), an Apple developer account signed in to Xcode, Node.js, and an iPad on iPadOS 26.

## One-time setup

1. Install XcodeGen: `brew install xcodegen`.
2. Set your team. Either copy `ios/Config/Local.xcconfig.example` to `ios/Config/Local.xcconfig` and put your Team ID in `DEVELOPMENT_TEAM`, or leave it empty and pick the team in Xcode under the FormMorpheus target, Signing & Capabilities. `Local.xcconfig` is not committed. If `ai.nodemode.formmorpheus` is not available to your account, set `PRODUCT_BUNDLE_IDENTIFIER` there too.
3. Connect the iPad with a cable the first time. On the iPad, turn on Developer Mode (Settings > Privacy & Security > Developer Mode), then restart when asked.

## Build and run

1. From the repository root run `./formmorpheus ios`. It builds the interface, copies it to `ios/Resources/web`, generates `ios/FormMorpheus.xcodeproj` and opens it in Xcode. `./formmorpheus ios --no-open` does everything except opening Xcode.
2. In Xcode choose the FormMorpheus scheme and your iPad as the run destination, then press Run.
3. The first time, the iPad says the developer is not trusted. On the iPad open Settings > General > VPN & Device Management, choose your developer account and tap Trust. Run again.
4. Each time the interface or the Swift code changes, run `./formmorpheus ios` again, then Run. The Xcode project is regenerated, so never edit it by hand.

If the build stops with "ios/Resources/web/index.html is missing", the interface was not copied: run `./formmorpheus ios` rather than building from an old project.

## Web Inspector

Debug builds let Safari inspect the web view. On the iPad turn on Settings > Apps > Safari > Advanced > Web Inspector. On the Mac open Safari, Settings > Advanced, tick Show features for web developers, then use the Develop menu to pick the iPad and the formmorpheus page.

## Run Diagnostics and send the file

1. In the app open Help > About formmorpheus, then Diagnostics... . Do the Pencil test first (draw, hover and twist the Pencil on the pad), then Run Diagnostics.
2. The app saves one file, `diagnostics-[date].json`, and shows the share sheet. Send it with AirDrop, Mail or Messages.
3. The same file stays in the Files app under On My iPad > FormMorpheus > Diagnostics.
4. Send that file together with any Xcode build errors.

## Where things are

- `ios/project.yml`: the project spec. `ios/Config/Base.xcconfig`: shared build settings.
- `ios/App`, `ios/Web`: the app, the web view host, the `fm://` scheme handler and the bridge.
- `ios/Resources/web`: the built interface (generated, not committed).
- Files you create appear in the Files app under On My iPad > FormMorpheus. A movie opened from anywhere else in Files is copied into the Library there; the original is never changed.
