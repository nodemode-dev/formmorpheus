# Build FormMorpheus for iPad

The iPad app is a beta that you build yourself. It has been built and run on an iPad Pro 13-inch (M5) with Apple Pencil Pro on iPadOS 26.3, where drawing, squeeze, barrel roll and hover were checked with the Pencil Pro.

This is the first-run guide for the Mac that builds the iPad app. You need a Mac with Xcode 26 or later (iPadOS 26 SDK), an Apple developer account signed in to Xcode, Node.js, and an iPad on iPadOS 16.4 or later.

The app runs from iPadOS 16.4 because its interface decodes video with the web view's video decoder (Web Codecs) and draws with 2D OffscreenCanvas, which WebKit has from Safari 16.4, the version iPadOS 16.4 carries. On iPadOS 16.4 to 17.4 squeeze, barrel roll, the Pencil's position sent with a double tap and the canvas haptics are not there (they came with iPadOS 17.5); double tap and hover still work. Before iPadOS 17 the Stage draws without the GPU compositor (WebGL in OffscreenCanvas came with Safari 17), so large movies play slower. ProRes 4444 XQ export needs iPadOS 18; before that it falls back to ProRes 4444 with a note.

## One-time setup

1. Install XcodeGen: `brew install xcodegen`.
2. Set your team. Either copy `ios/Config/Local.xcconfig.example` to `ios/Config/Local.xcconfig` and put your Team ID in `DEVELOPMENT_TEAM`, or leave it empty and pick the team in Xcode under the FormMorpheus target, Signing & Capabilities. `Local.xcconfig` is not committed. If `ai.nodemode.formmorpheus` is not available to your account, set `PRODUCT_BUNDLE_IDENTIFIER` there too.
3. Connect the iPad with a cable the first time. On the iPad, turn on Developer Mode (Settings > Privacy & Security > Developer Mode), then restart when asked.
4. Turn on iCloud for the app, so the library can live in iCloud Drive. The entitlements are in `ios/App/FormMorpheus.entitlements` (wired through `CODE_SIGN_ENTITLEMENTS` in `ios/Config/Base.xcconfig`) and ask for iCloud Documents with the container `iCloud.<bundle id>`, which is `iCloud.ai.nodemode.formmorpheus` for the default bundle id. In your Apple developer account, under Certificates, Identifiers & Profiles: create the iCloud container `iCloud.ai.nodemode.formmorpheus` (Identifiers, iCloud Containers), then open the App ID `ai.nodemode.formmorpheus`, turn on iCloud, choose Edit and tick that container. With automatic signing, Xcode may offer to do the same from Signing & Capabilities; check that iCloud shows there with iCloud Documents and the container ticked. A personal (free) team cannot sign iCloud: put `CODE_SIGN_ENTITLEMENTS =` in `Local.xcconfig` to build without it, and the library then stays on the iPad.

## Build and run

1. From the repository root run `./formmorpheus ios`. It builds the interface, copies it to `ios/Resources/web`, generates `ios/FormMorpheus.xcodeproj` and opens it in Xcode. `./formmorpheus ios --no-open` does everything except opening Xcode.
2. In Xcode choose the FormMorpheus scheme and your iPad as the run destination, then press Run.
3. The first time, the iPad says the developer is not trusted. On the iPad open Settings > General > VPN & Device Management, choose your developer account and tap Trust. Run again.
4. Each time the interface or the Swift code changes, run `./formmorpheus ios` again, then Run. The Xcode project is regenerated, so never edit it by hand.

If the build stops with "ios/Resources/web/index.html is missing", the interface was not copied: run `./formmorpheus ios` rather than building from an old project.

## Web Inspector

Debug builds let Safari inspect the web view. On the iPad turn on Settings > Apps > Safari > Advanced > Web Inspector. On the Mac open Safari, Settings > Advanced, tick Show features for web developers, then use the Develop menu to pick the iPad and the FormMorpheus page.

## Run Diagnostics and send the file

1. In the app open Help > About FormMorpheus, then Diagnostics... . Do the Pencil test first (draw, hover and twist the Pencil on the pad), then Run Diagnostics.
2. The app saves one file, `diagnostics-[date].json`, and shows the share sheet. Send it with AirDrop, Mail or Messages.
3. The same file stays in the Files app under On My iPad > FormMorpheus > Diagnostics.
4. Send that file together with any Xcode build errors.

## Check on the iPad (0.25.0)

Device: iPad Pro 13-inch (M5), Apple Pencil Pro, iPadOS 26.3. Build with `./formmorpheus ios`, then Run. For step 1 put an SVG in the Files app that has one group per body part (`head`, `body`, `arm-l`, `arm-r`, `leg-l`, `leg-r`, with a `mouth` group inside `head` and an `arm-l` that holds a `hand-l` group), and for step 5 a short sound with speech. Write what happened under each step, in your own words.

1. SVG character from Files: open a movie, then in the Files app tap the SVG (or long-press it, Share, FormMorpheus). Expected: FormMorpheus comes forward and the Timeline shows one Group named after the file with 8 parts; rotating `arm-l` turns `hand-l` with it.
   Result:
2. Save to Characters: choose Save to Characters on the character's menu. Close the app from the app switcher and open it again. Expected: View > Characters lists it under Mine, the same file is in On My iPad > FormMorpheus > Characters, and Add to Movie twice gives two copies that move on their own. Delete it from the panel: it shows in Recently Deleted and Restore puts it back under Mine.
   Result:
3. A Starter Character and a Starter Scene: File > New from Starter Scene..., pick one, then add a Starter Character from View > Characters, Starter. Expected: a new untitled movie with the scene's background and props, and the character on the Stage at the playhead with its poster in the panel.
   Result:
4. Wave then swap to Nod: apply Wave to the starter character at frame 0, select its strip on the Timeline and choose Nod. Expected: the strip reads Nod, the character nods in playback, and Undo brings Wave back with the same motion. Nothing flashes while the strip changes.
   Result:
5. Lip-sync from Sound: put the speech sound on a track, then Lip-sync from Sound... and choose the character's mouth at the top of the list. Expected: the mouth changes shape while the voice speaks and rests outside it.
   Result:
6. Update from Source...: apply Wave to the step 1 character first. Then change the color of one part of the step 1 SVG in a vector app and save it to Files. On the character's menu choose Update from Source... and pick the file again. Expected: the part has the new color and keeps its keys and its action. There is no automatic update on iPad, and no message about one.
   Result:
7. Draw on a Flipbook with Apple Pencil Pro: add a Flipbook, draw a few frames. Squeeze and double tap do what Settings > Apple Pencil (or Preferences) says, as in 0.23.0, and barrel roll turns a brush that follows the Pencil's angle. Expected: pressure and tilt shape the stroke, the squeeze palette or the chosen action appears, and the haptic plays.
   Result:
8. Export MP4: export the movie from step 3 to 5 as MP4. Expected: the export finishes, plays in the Photos app or the Files app with the sound, and shows the character, its action and the lip-sync as on the Stage.
   Result:
9. Action file from Files: on a character that has Wave, choose Export Action... from its action menu and pick Wave, then put the Wave.fmact file in the Files app. Select a different character, then open the file from Files (tap it, or long-press it, Share, FormMorpheus). Expected: Wave is added to that character. Then select nothing, or a block that is not a character, and open the file again. Expected: a notice in the window says "Select a character, then import the action onto it." and nothing is added.
   Result:

## Check on the iPad (0.23.0)

Not yet run on a device; the app itself is built and runs (see the top of this guide).

1. ProRes 4444 with transparency: import a ProRes 4444 .mov that has an alpha channel into an open movie. A progress line says "Converting ..."; the clip lands on the Stage. Put a color under it and check that the see-through parts stay see-through. If a notice says the first frame shows no transparency, the iPad's video decoder drops it: note the iPad model and iPadOS version.
2. ProRes 422 without transparency: import a ProRes 422 .mov. It should be converted and play.
3. HEVC with transparency: import an HEVC .mov with alpha (for example one exported from FormMorpheus on the iPad with HEVC and transparency). It should open without converting. Check the same see-through parts over a color.
4. iCloud Drive library on two iPads signed in to the same Apple Account: on the first iPad, on Home, tap iCloud Drive, make a movie and save it. In the Files app it is under iCloud Drive > FormMorpheus > Library. On the second iPad, tap iCloud Drive on Home: the movie appears once iCloud has brought it over (reopen Home if it is not there yet); open it, change it, save. Back on the first iPad, open it again and check the change. Also try iCloud Drive with iCloud signed out and check the message.
5. Handwriting in the text card: add a text, open its card and write into the text field with the Pencil (the iPad's handwriting-to-text, Settings > Apple Pencil). Also try writing on the Stage while editing a text in place.

## Where things are

- `ios/project.yml`: the project spec. `ios/Config/Base.xcconfig`: shared build settings. `ios/App/FormMorpheus.entitlements`: iCloud Documents.
- `ios/App`, `ios/Web`: the app, the web view host, the `fm://` scheme handler and the bridge.
- `ios/Resources/web`: the built interface (generated, not committed).
- Files you create appear in the Files app under On My iPad > FormMorpheus, saved characters in its Characters folder. A movie opened from anywhere else in Files is copied into the Library there; the original is never changed.
