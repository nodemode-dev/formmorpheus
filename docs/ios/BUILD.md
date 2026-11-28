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

## Check on the iPad (0.38.0)

Device: iPad Pro 13-inch (M5), Apple Pencil Pro, iPadOS 26.3. Build with `./formmorpheus ios`, then Run. This version adds Swift files to the iPad engine (`ScenesRoutes.swift`, `VoiceRoutes.swift`, `VoiceRemote.swift`, `VoiceKeychain.swift`, `VoiceListen.swift`) and changes `TrashRoutes.swift` and the Info.plist strings. None of it has been compiled, and the interface changes have not been run on an iPad; they were checked only in a desktop browser made to behave like an iPad, with the native side stubbed. So step 1 matters most, and every step below is a first run. For steps 5 and 6 you need a speech server (a voice app that answers the common speech API) running on a computer on the same Wi-Fi network, its address, and, if you want to try a name, the computer's `.local` name. For step 4 you need an online voice key of your own. Write what happened under each step, in your own words.

1. The Xcode build: run `./formmorpheus ios`, then Run. Expected: the build finishes with no error and the app opens. If it stops, send back the file, the line and the message of the first error, and the same for any warning in a new Swift file.
   Result:
2. The Scenes folder: open the Files app, On My iPad > FormMorpheus. Expected: a Scenes folder is there beside Characters once the app has run (open Content, Add, or the Scenes tab of the Build panel once if it is not).
   Result:
3. Save as Scene: open a movie with a prop or a picture on a track, choose Movie, Save as Scene..., name it, tick the tracks and tap Save Scene with a finger. Expected: every row and button in the card is easy to hit, the scene shows under My scenes in the Scenes tab with its picture, and the Scenes folder in Files holds a file for it. Open another movie and tap the scene: it lies behind everything. Then rename it and delete it from the three dots on its tile. Expected: the new name shows. The deleted scene is gone from the tab and listed by name in Recently Deleted on Home, and Restore puts it back in My scenes.
   Result:
4. AI Voice online: open Content, Add, AI Voice..., go to the Online tab, paste your key, type a sentence and tap Speak. Expected: the spoken sound lands on a sound track at the Playhead and plays. Close the app from the app switcher, open it again and open the card: the key is still there (shown as kept, not in plain text). Clear the key and check that it is gone.
   Result:
5. AI Voice with a speech server on a computer: on the Offline tab choose Voice app, type the address of the computer such as `http://192.168.1.20:8080`, and tap Check. Expected: the first time, the iPad asks to allow FormMorpheus to find and connect to devices on your local network; allow it. The card lists the server's models and voices, and Speak places a sound. Then do the same with the computer's name, such as `http://my-computer.local:8080`. If you refused the local network question, expected: the check fails with a message, and turning it on under Settings > Privacy & Security > Local Network makes it work.
   Result:
6. An address on the open internet: type `http://example.com` or any public address as the voice app's address and tap Check. Expected: it is refused, with a sentence that only an address on the same network is allowed, and nothing is sent.
   Result:
7. The built-in voice: on the Offline tab choose the built-in voice. Expected: the card says in one sentence that the built-in voice needs a computer, and there is no setup button.
   Result:
8. Subtitles from this sound, in English: put a short recording or a sound file with English speech on a track, select its block, open Content, Add, Subtitles..., set Language to English and tap Subtitles from this sound. Expected: the first time, the iPad asks for permission to use speech recognition; allow it. The lines land in the card, timed to the block, with no model download. Then pick another language (German, for example) with a sound in that language. Expected: its lines land the same way. If the iPad says it cannot recognize that language on the device, expected: the card says so and nothing is sent anywhere. Last, turn Speech Recognition off for the app in Settings > Privacy & Security > Speech Recognition and try again. Expected: the card tells you to allow it in the Settings app. Cancelling a listen from the card does not stop the recognition that is running; it ends by itself, so note anything that looks different.
   Result:
9. The Build panel by finger and Pencil: open View > Build Panel. Expected: all seven tabs (Characters, Actions, Scenes, Props, Effects, Create, Camera) can be tapped with a finger and with the Pencil, nothing overlaps, and each tile or button is big enough to hit.
   Result:
10. A prop, an effect and a camera move: add a prop from Props, lay Rain from Effects and set its strength, then in Camera choose Push In. Expected: the prop stands on the Stage, the rain is drawn over the movie, and the camera move plays once, each with one tap and one undo step.
   Result:
11. The scene strip: with a movie that has two scenes, tap a card of the strip above the Timeline, then double-tap to rename it, then open its menu. Expected: the card selects, the name can be typed, and the menu rows can be tapped.
   Result:
12. Character views and walking: add a built starter character (Karl) from the Characters tab. In the builder or on its menu turn it to the side view and back. Then, with Karl selected, touch and hold a spot on the Stage. Expected: after the hold, Karl walks to the spot, even though touching the empty Stage normally deselects. Then choose Content, Walk, Walk In from Left. Expected: Karl walks in from the left edge and the walk plays once.
   Result:
13. The Timeline and the AI Voice card, upright: hold the iPad upright and look at the Timeline's top row. Expected: nothing overlaps, the level meter is not shown and the frame readout is small. Then open the AI Voice card on a short screen, tap the text field and watch the keyboard. Expected: the card scrolls inside the window, stands above the on-screen keyboard, and does not bring the keyboard up before you tap the field. Also open the Character Builder and check its view switch is easy to tap.
   Result:
14. The Help pictures and other languages: open Help (the manual) and scroll through the Walk, My scenes, AI Voice and Subtitles sections. Expected: the pictures show and the iPad notes read right. Then Preferences > Interface > Language, choose Deutsch, then Arabic, and open the Build panel, the AI Voice card and the Subtitles card. Expected: every label is translated, nothing is cut off, and in Arabic the layout is mirrored with nothing overlapping.
   Result:

## Check on the iPad (0.31.0)

Device: iPad Pro 13-inch (M5), Apple Pencil Pro, iPadOS 26.3. Build with `./formmorpheus ios`, then Run. The Character Builder, the built characters and the new actions are all in the interface, so this build has no Swift change of its own; check them on the device all the same, with a finger and with the Pencil. For step 7 put a short sound with speech in the Files app. Write what happened under each step, in your own words.

1. Open the builder: open a movie, View > Characters, then Build a character. Expected: the Character Builder fills the window in three columns (presets, preview, Look, Hair and Outfit), nothing is cut off in portrait or landscape, and the preview shows the first preset standing on its floor.
   Result:
2. Sliders with a finger and with the Pencil: on Look, drag Height, Build, Shoulders and Head size with a finger, then with the Pencil. Expected: each slider follows the touch from where it lands, the preview changes as you drag, the page does not scroll or zoom while a slider moves, and the value beside it updates. Hovering the Pencil over a slider does not move it.
   Result:
3. Swatches and tiles: tap skin and eye color swatches, then a custom color swatch (the system color picker opens; pick a color), then hair style tiles on Hair and outfit tiles on Outfit, with a finger and with the Pencil. Expected: one tap picks, the picked one is outlined, the preview redraws once, and a long press does not open a menu. Choose the kind Fox, then Dino: the dimmed face options and hair styles do not respond, and the note beside the last hair style appears without moving the tiles.
   Result:
4. Add a built starter: in View > Characters, Starter, tap Add to Movie on Karl, then on Pip. Expected: both stand on the Stage at the playhead side by side without overlapping, each on its own track with the person glyph, and their posters show in the panel. Then Open in Character Builder on Sprig's row, change her outfit and tap Add to Movie: a third character is added in one undo step.
   Result:
5. Edit in Character Builder: select Karl, choose Edit in Character Builder... on his menu, change his hair to None and his outfit, then Apply. Expected: Karl changes in place, a notice names the hidden parts, and Undo brings the old look back in one step.
   Result:
6. The new actions: apply Run, then Dance, Talk and Cheer to Pip (Content > Actions > Apply Action..., or a strip). Expected: each plays in place with the forearms, shins and tail moving, Talk moves the mouth through its shapes, the looping ones ease in and out at the ends of their strip, and Clear Action puts the mouth back to rest.
   Result:
7. Lip-sync on a built character: put the speech sound on a track, then Lip-sync from Sound... and choose Karl at the top of the list. Expected: Karl's mouth changes shape while the voice speaks and rests outside it, with no setup.
   Result:
8. Save and reopen: Save to Characters from the builder, close the app from the app switcher and open it again. Expected: the character is under Mine and in On My iPad > FormMorpheus > Characters, and Edit in Character Builder on a copy added from Mine opens with its recipe.
   Result:
9. Another language: Preferences > Interface > Language, choose Deutsch, then العربية (Arabic), and open the builder each time. Expected: every label is translated (Sundress's colors read Kleid, Besatz, Schuhe), and in Arabic the builder is mirrored with the presets on the right and nothing overlapping.
   Result:

## Check on the iPad (0.25.0)

Device: iPad Pro 13-inch (M5), Apple Pencil Pro, iPadOS 26.3. Build with `./formmorpheus ios`, then Run. For step 1 put an SVG in the Files app that has one group per body part (`head`, `body`, `arm-l`, `arm-r`, `leg-l`, `leg-r`, with a `mouth` group inside `head` and an `arm-l` that holds a `hand-l` group), and for step 5 a short sound with speech. Write what happened under each step, in your own words.

1. SVG character from Files: open a movie, then in the Files app tap the SVG (or long-press it, Share, FormMorpheus). Expected: FormMorpheus comes forward and the Timeline shows one Group named after the file with 8 parts; rotating `arm-l` turns `hand-l` with it.
   Result:
2. Save to Characters: choose Save to Characters on the character's menu. Close the app from the app switcher and open it again. Expected: View > Characters lists it under Mine, the same file is in On My iPad > FormMorpheus > Characters, and Add to Movie twice gives two copies that move on their own. Delete it from the panel: it shows in Recently Deleted and Restore puts it back under Mine.
   Result:
3. A Starter Character and a Starter Scene: File > New from Starter Scene..., pick one, then add a Starter Character from View > Characters, Starter. Expected: a new untitled movie with the scene's background and props, and the character on the Stage at the playhead with its poster in the panel.
   Result:
4. Wave Hello then swap to Nod: apply Wave Hello to the starter character at frame 0, select its strip on the Timeline and choose Nod. Expected: the strip reads Nod, the character nods in playback, and Undo brings Wave Hello back with the same motion. Nothing flashes while the strip changes.
   Result:
5. Lip-sync from Sound: put the speech sound on a track, then Lip-sync from Sound... and choose the character's mouth at the top of the list. Expected: the mouth changes shape while the voice speaks and rests outside it.
   Result:
6. Update from Source...: apply Wave Hello to the step 1 character first. Then change the color of one part of the step 1 SVG in a vector app and save it to Files. On the character's menu choose Update from Source... and pick the file again. Expected: the part has the new color and keeps its keys and its action. There is no automatic update on iPad, and no message about one.
   Result:
7. Draw on a Flipbook with Apple Pencil Pro: add a Flipbook, draw a few frames. Squeeze and double tap do what Settings > Apple Pencil (or Preferences) says, as in 0.23.0, and barrel roll turns a brush that follows the Pencil's angle. Expected: pressure and tilt shape the stroke, the squeeze palette or the chosen action appears, and the haptic plays.
   Result:
8. Export MP4: export the movie from step 3 to 5 as MP4. Expected: the export finishes, plays in the Photos app or the Files app with the sound, and shows the character, its action and the lip-sync as on the Stage.
   Result:
9. Action file from Files: on a character that has Wave Hello, choose Export Action... from its action menu and pick Wave Hello, then put the Wave Hello.fmact file in the Files app. Select a different character, then open the file from Files (tap it, or long-press it, Share, FormMorpheus). Expected: Wave Hello is added to that character. Then select nothing, or a block that is not a character, and open the file again. Expected: a notice in the window says "Select a character, then import the action onto it." and nothing is added.
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
- `ios/Engine`: the iPad's own engine in Swift, one file of routes for each part (`ScenesRoutes.swift` for My scenes, `VoiceRoutes.swift`, `VoiceRemote.swift`, `VoiceKeychain.swift` and `VoiceListen.swift` for AI Voice and listening for subtitles, `TrashRoutes.swift` for Recently Deleted, and others).
- Info.plist usage sentences for speech recognition and the local network are in `ios/App`, as `InfoPlist.strings` in each `*.lproj` folder (English and 29 other languages); plain http to a speech server is allowed there too.
- What the iPad app leaves out: the built-in AI voice (it needs a computer), Save to a chosen folder in Export (the share sheet decides), outside agents and the terminal panel, and Pen Link.
- Files you create appear in the Files app under On My iPad > FormMorpheus, saved characters in its Characters folder and your own scenes in its Scenes folder. A movie opened from anywhere else in Files is copied into the Library there; the original is never changed.
