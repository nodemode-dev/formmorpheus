# Changelog

Versions are `v*.*.*` with dots. Dates are US Eastern. Each section is written for the person using FormMorpheus; the reasons behind a change are in the `HASHOUT_LOG.md` beside the code.

## 0.38.0 · 2026-11-28

The iPad app gets AI Voice, listening for subtitles and My scenes, and its touch targets and Timeline top row are fixed. The iPad additions are new and wait for their check on the device; the list is in `docs/ios/BUILD.md`.

### New
- iPad: AI Voice is on. The Online tab speaks with your own key, kept in the iPad's Keychain. The Offline tab says the built-in voice needs a computer, and Voice app speaks through a speech server on a computer on the same network, by address or by a `.local` name. Only an address on your own network is accepted, and the iPad asks once for local network access.
- iPad: Subtitles from this sound uses the iPad's own speech recognition, on the iPad only, with no model to download. A language the iPad cannot recognize on the device is refused. The iPad asks for permission the first time.
- iPad: My scenes are kept in the Scenes folder of the FormMorpheus folder in Files, with Save as Scene, rename and delete. A deleted scene is listed by name in Recently Deleted and Restore puts it back.
- iPad: Walk To Here is a touch and hold on the spot on the Stage; the character that was selected when your finger went down walks.

### Improved
- iPad: the Build panel, the scene strip, the AI Voice and Subtitles cards, Save as Scene and the Character Builder's view switch have 44 px touch targets.
- iPad: held upright, the Timeline's top row no longer overlaps, and the AI Voice card scrolls inside the window, stands above the on-screen keyboard and does not open it by itself.
- A track with no name shows the name of its first content in the Camera tab's Depth list.

### Known issues
- iPad: still not there are the built-in voice, Save to a chosen folder in Export, outside agents and the terminal panel, and Pen Link.

## 0.37.0 · 2026-11-27

The Build panel grows to seven tabs, with Props and Effects added, and a character can turn, walk, stand in more scenes, and sit in a scene of your own.

### New
- Props is a new tab in the Build panel, with 49 objects in three styles (Flat, Outline and Stick) and eight categories, and a search box. A click adds one at the Playhead on a new top track, standing on the floor guide when the movie has one. Content, Add Prop... opens it.
- A character made in the Character Builder can face front, three-quarters, side or back, and be flipped. Use the View row in the builder, Content, Character View, the content's right-click menu or the Characters tab. Its keyframes, actions and lip-sync stay, and it is one undo step. The side view is a near profile, and the starter actions are drawn for the front view.
- Right-click the Stage and choose Walk To Here to walk the selected character to that spot, or use Content, Walk for Walk In from Left, Walk In from Right, Walk Off Left and Walk Off Right. It faces the way it goes and plays once. A walk that would run past the end of the character's block is refused with a sentence.
- Effects is a new tab in the Build panel: Rain, Snow, Fog, Blowing Leaves, Dust, Confetti, Fireflies, Bubbles, Sun Rays, Sunset Glow, Night, Spotlight and Lightning. A click lays one over the whole movie, and In this movie sets its strength, where it starts and where it ends. They are drawn under the subtitles, also in every export.
- The Camera tab has Camera moves: Push In, Pull Out, Pan Left, Pan Right, Tilt Up, Tilt Down, Push In on Selection, Whip Pan, Slow Drift, Shake and Reset Camera Here, each for 0.5, 1, 2 or 4 seconds. A click writes camera keys from the Playhead and plays once, in one undo step. The transitions there are tiles with moving diagrams.
- A scene strip above the Timeline cuts the movie into named scenes. Click a card to go to it and double-click to rename it. Its menu has Focus on Scene, Duplicate Scene, Move Scene Earlier and Later, Add Empty Scene After, Delete Cut, Keep Content, and Delete Scene and Content. Content, keys, markers, subtitles and effects go with their scene.
- Movie, Save as Scene... keeps the tracks you tick as a scene of your own. My scenes in the Scenes tab lays one behind everything in a movie with a click, and the three dots rename or delete it. A deleted scene waits in Recently Deleted. They are kept in the Scenes folder of the data folder.
- Depth is easier: the Track menu has Depth with six steps from Far background to Close foreground, and the Camera tab lists the picture tracks with Spread Tracks by Depth and Flatten Depth. The camera moves far things less.

### Improved
- Five more starter scenes join the five: Office, Castle Hall, Space Station, Beach and Living Room. A starter character added to a movie of another size than 1920 by 1080 now stands at the scene's size.
- Walk in place is now a walk with planted feet.
- A character you made in the builder and saved has Edit in Character Builder in the Characters card.

### Fixed
- A double-click now picks a character's part where it is drawn, so lower legs, forearms and brows can be picked.
- Update from Source brings in a part hidden in the vector app as hidden, and shows it again when the file shows it. A part you hid in FormMorpheus stays as you set it unless the file changed.
- Scene effects and subtitles stay visible while you drag content on the Stage.

## 0.36.0 · 2026-11-27

A Build panel beside the Stage puts characters, actions, scenes, Create and Camera in reach, the three modes move into the Timeline's top row, and you choose where exports go.

### New
- View, Build Panel opens a panel beside the Stage with five tabs: Characters, Actions, Scenes, Create and Camera. It remembers whether it is open and which tab you were on, starts closed on a window narrower than 1100 px, and shows only while a movie is open in the editor.
- Characters lists New Character..., your saved characters under Mine and the Starters. A click adds that character to the movie at the Playhead.
- Actions lists the actions for the selected character, and a click applies one, which plays once. Scenes lists the starter scenes, and a click adds one behind everything in the movie, with Background Color... under them.
- Create has the rows of the Create card, and Camera has Camera mode and the transitions.
- A Preview button in the Timeline's top row plays the movie from the first frame, full screen. Escape leaves.
- In Export, a Save to row under the tabs shows where exports go. Choose... picks a folder, Ask every time shows a save dialog for each export, and Forget folder goes back to this browser's download folder. A file in a chosen folder is never overwritten: a taken name becomes "name 2". Every export is still also kept in the Exports folder of the data folder.

### Changed
- Compose, Perform and Keyframe are a compact switch in the Timeline's top row, after the Theater and Camera mode buttons, instead of a large pill over the tracks. On a narrow window only the icons show.
- The Advanced checkbox Choose a folder to save to is now the Save to row.

## 0.35.0 · 2026-11-27

The new cards speak your language, and the manual answers the questions of a first session.

### Improved
- AI Voice, Subtitles and the menus and notices added since 0.31.0 are now in all 27 languages the app has, not in English only.
- The manual says where the data folder is on Windows, macOS and Linux, and that it is not the folder the app is installed in.
- The manual has a short walkthrough, Make a character talk: a voice from a recording, a sound file or AI Voice, then Lip-sync, then subtitles, and which of those steps happen by themselves.
- The manual explains Frame A and Frame B in the Character Builder, how to start a new character from an existing one through an SVG, what Theater is, and how track order decides what is in front.

## 0.34.0 · 2026-11-27

Fixes from a tester's first session with Movie projects: the selection box, the right-click menu, actions, the Character Builder, the SVG round trip and starter scenes.

### New
- Right-click on content on the Stage opens that content's menu. Before, only the Stage's own menu opened.
- The content menu has Apply Action... for a character, which opens the action list where you clicked, and an Arrange group: Bring to Front, Bring Forward, Send Backward and Send to Back. Each moves the content's track and is one undo step.
- After an action is applied or swapped it plays once from its start and the Playhead goes back. A notice and the status line say "{action} applied to {character}".
- An action's strip on the Timeline can be made longer or shorter by dragging either edge, on a selected character block. A loop plays for the new length, a one-shot is cut when shortened and holds its last pose when made longer, and a strip stops at a neighbouring action. One undo step, Action Length.
- Content, Add, Add Starter Scene to This Movie... puts a starter scene's backdrop and props behind everything in the movie that is open, fitted to its size, in one undo step. The floor guide is taken only when the movie has none.

### Improved
- The Character Builder's roster starts with a group, Mine, that lists the characters you saved. Save to Characters shows the new one there at once, marked, and picking one opens it again. Add to Movie now closes the builder.
- In the starter scene chooser a click picks a card and the button (Create, or Add to Movie) takes it. A double click takes it at once.
- The Theater button has a back chevron and says "Theater: back to your movies" with its shortcut.
- A menu is never taller than the window and scrolls inside itself, and long menus use compact rows.

### Fixed
- The selection box of a character, a drawing and other content was nearly as big as the movie frame. It now hugs what is drawn: the character, or the drawing's ink.
- A click on empty Stage inside an old big box selected that content, and a drag on the selected content could select something else instead. A click now picks what is under the pointer, and a drag that starts on the selected content moves it.
- Side nodes on a character or group squeezed it. They now scale it whole and keep its proportions (Alt still stretches one way).
- A character's block on the Timeline showed grey lines instead of the character. It now shows the character's picture along the block, like a drawing or a picture does.
- Block names on the Timeline were hard to read in the light themes. They now sit on a plate in the panel's own colour.
- Choosing a command in the command search with Enter also pressed whatever the command gave focus to, so a card such as Characters opened and closed at once. The Enter now ends at the search.
- Movie settings was cut off at the right edge. Nothing is cut off now, and long labels wrap.
- Character as SVG for Vector App wrote parts in the wrong order, so back hair could land in front of the face, and importing the file back dropped parts and shapes hidden in the vector app. The file now lists the parts back to front as the Stage draws them, and the import keeps that order and keeps hidden parts and shapes hidden.

## 0.33.0 · 2026-11-27

Subtitles: tick one box and the words of your movie are drawn on the Stage and in every export.

### New
- A new Subtitles card (Content, Add, Subtitles..., and under More in the Create card). Tick Show subtitles in the video and the lines are drawn on the Stage and in every export.
- One look for all lines: font, size, position (top, middle or bottom), text color, and a dark band behind the words. Each change is one undo step.
- AI voices add their subtitles by themselves when they speak, from the words and sentence timing each spoken sound already keeps. From AI voices makes them again for sounds spoken earlier.
- Subtitles from a recording or a sound file: select its block on the Timeline and press Subtitles from this sound. Listening runs on this computer in the built-in voice's runtime with a model of its own, a one-time download from the card, and your sound is sent nowhere.
- Lines can be edited in the card (text, start and end), added at the Playhead and deleted, each one an undo step.
- Import a .srt or .vtt file, and export the lines as .srt or .vtt.
- Agents can read a movie's subtitles (`list_subtitles`) and ask you to change them (`set_subtitles`, which asks first in the window).

### Known issues
- The Subtitles card's labels are in English only for now.

## 0.32.0 · 2026-11-27

AI Voice: type what to say, choose a voice and press Speak, and the spoken sound lands on the Timeline.

### New
- A new AI Voice card (Content, Add, AI Voice..., and under More in the Create card, next to Record sound...). Type the words, choose a voice and press Speak: the sound lands on the Timeline at the Playhead on a sound track, like any sound, so fades, pan, Lip-sync onto a character's mouth and export all work on it.
- A built-in voice that works offline. Kokoro runs on this computer with no account and no internet after a one-time setup from the card, which needs Python 3.10 to 3.13 on the computer and downloads the voice model, about 340 MB, checking the download. It has 54 voices with American and British English first, a speed from 0.5 to 2, and the card can remove it again.
- Any voice app on this computer that answers the common speech API can speak, which is how a cloned voice is used: clone the voice in that app, start it, press Check in the card and pick its model and voice. The default address is http://127.0.0.1:8080, and only an address on this computer is accepted.
- An online voice (ElevenLabs) on the card's Online tab, with your own key kept in the system keychain and text of up to 2000 characters. Your text is sent to that service only when you press Speak on this tab.
- Each spoken sound remembers its words and the timing of each sentence inside the movie file, for the subtitles coming in the next version.
- Agents can list the voices that are ready (`list_voices`) and ask you to speak a line onto a movie's Timeline (`add_voice`, which asks first in the window).

### Known issues
- Subtitles in the video are not in this version (they come in 0.33.0), and the new card's labels are in English only for now.

## 0.31.0 · 2026-11-25

The Character Builder in every language, and the finishing touches on characters and actions.

### New
- The Character Builder, the 26 starter characters, the new outfits, hair styles and kinds, and the starter actions Run, Dance, Talk and Cheer are translated into all 27 full languages, with Mexican Spanish and Canadian French words where they differ.
- The manual covers the Character Builder, a built character's parts and what each follows, Edit in Character Builder, the 26 starters and the twelve starter actions, with a section New in 0.31.0. The README lists them, and the iPad build guide has a check for this version.

### Improved
- The Character Builder lays out right to left in Arabic, keeps long slider labels clear of the slider, and shows a character's full tag on its tile.
- Clothing trim, body frame, height and head size each have their own word in every language, apart from trimming a clip, a movie frame, a shape's height and an arrow's head.
- Starter character names stay as written in every language.

### Fixed
- Windows: the app no longer opens to a black window on PCs where another program has changed the file type the system gives to `.js` files. The window's scripts, styles, pictures and fonts are now always served with their own types.
- Characters added to a plain movie at full size stand far enough apart, so two never touch.
- A starter action placed on a built character before 0.30.0 clears and swaps without leaving its old keys.
- A starter action never writes over your lip-sync: it fills only frames that show Rest, and clearing it gives back only the frames it set.
- Laying one action into the middle of a looping one eases the loop out and back in instead of snapping the arms.
- A looping action shortened below its ease plays its moves instead of standing still.
- An action file keeps one mouth shape per frame.

## 0.30.0 · 2026-11-25

Characters made in the Character Builder move the way they were designed to, and four new starter actions.

### New
- Starter actions Run, Dance, Talk and Cheer. Talk moves the head, brows and a hand and steps the mouth through its shapes; Run, Dance, Cheer, Wave Hello and Jump open the mouth too.
- On a character made in the Character Builder, the starter actions use its forearms, shins, feet, eyes, brows, hair and shadow: Idle breathes and blinks, Walk in place lifts each leg, Wave Hello waves from the elbow and wrist, Jump crouches and reaches. A fox's or dino's tail swings with the hips. Sit lowers the character with its feet on the floor, and Nod, Shake head and Point move the head and arms once.
- Looping actions (Idle, Run, Dance, Cheer) ease in from the rest pose at the start of their span and back out at the end.
- An action's ease and its mouth shapes travel with it through Export Action, Import Action and Save as Action.

### Improved
- The starter actions on Kofi, Ines, Marisol, Bram and Noor and on your own SVG characters are unchanged, and a starter no longer notes a part such as a forearm or hair that a character does not have.

## 0.29.0 · 2026-11-25

Eight new starter characters and the pieces they wear, for 26 starters in all.

### New
- Starter characters Dev (the gamer), Walt (the grandpa), Sami (the medic), Amara (the librarian), Jade (the drummer), Pip (a woodland fox), Rex (a little dino) and Sprig (a garden sprite), in View, Characters and in the Character Builder.
- In the Character Builder: three outfits (Varsity Jacket, Cardigan, Scrubs), three hair styles (Short Curls, Long Braid, Mohawk) and three kinds (Fox, Dino, Sprout). The fox and the dino have a tail, a part of its own that follows the hip. For a dino or a sprout the hair colour paints its crest or its leaves; a fox shows a tuft between its ears when you choose a style.
- Each kind dims the face options it does not draw.

## 0.28.0 · 2026-11-25

Thirteen more starter characters, ready to add or to change in the Character Builder.

### New
- Starter characters Maya, Ingrid, Zuri, Mei, Rosa, Leo, Karl, Arjun, Finn, Otto, Bolt (a robot), Zib (a visitor from space) and Moss (a friendly monster) join Kofi, Ines, Marisol, Bram and Noor in View, Characters. Each row shows the character's figure and what they are (The optimist, The executive, ...). Add to Movie, a drag onto the Stage or the Timeline, and a starter scene's floor and spots work for them as for the drawn starters.
- Open in Character Builder on their row starts the builder from that character. A placed one opens in the builder from its menu too.

### Fixed
- Update from Source on a character made in the Character Builder drops its recipe, so the builder no longer offers to paint the recipe over the parts from your file.
- In the Character Builder, Ctrl+Z no longer mixes two looks, a colour change redraws only its own picture, the dialog fits a window 560 tall, and the note after Add to Movie names the character added.

## 0.27.0 · 2026-11-25

The Character Builder: make a character by choosing, not drawing.

### New
- Character Builder... (Characters panel, Build a character; the command palette; the Content menu). Pick a preset, then shape it on a live preview: name, kind (person, robot, alien, monster), skin, height, build, shoulders, head size, frame A or B, eye colour, jaw, lashes, blush, freckles, earrings, glasses, facial hair and lip colour on Look; 13 hair styles and their colour on Hair; 13 outfits with a colour for each of their three parts on Outfit. Randomize makes a new look, and Reset goes back to the preset.
- Add to Movie puts the character in the movie standing on the floor, in one undo step. Save to Characters keeps it in Mine with its recipe.
- Edit in Character Builder... on a built character's menu opens it with its recipe. Apply changes it in one undo step and keeps its keys, actions and lip-sync; pieces the new look no longer has are hidden with their keys and come back when they return.

## 0.26.0 · 2026-11-25

FormMorpheus can make characters from a recipe, the groundwork for the Character Builder.

### New
- Characters built from a recipe of body, face, hair and outfit, drawn in one consistent style: 13 outfits, 13 hair styles, four kinds (person, robot, alien, monster), and sliders for height, build, shoulders and head size. A built character is a real character: a part for each piece (hip, body, head, eyes, brows, mouth, upper arm, forearm and hand, thigh, shin and foot on each side, hair, and the outfit's extra pieces), each following the part it hangs from, with a pivot at every joint.
- A built character's mouth is a mouth chart of the eight shapes, drawn to match its face, so Lip-sync from Sound works on it at once.
- A built character keeps its recipe. Building it again with a change keeps its keys, actions and lip-sync. A piece the new outfit or hair no longer has is hidden with its keys kept, and comes back when it returns.

## 0.25.0 · 2026-11-25

FormMorpheus gets characters: draw the parts in a vector app, animate them with ready actions, and keep the art and the animation in step.

### New
- Characters from SVG. An SVG with one group per body part opens as a character: a Group with a named part for each group, a part inside a part parented to it (turn an arm and its hand follows), and a pivot where you drew a mark with the id `pivot` or at the middle of the part. A part that holds text, pictures, filters or masks opens as a picture, and the notice names it. A character shows a person glyph on its Timeline chip.
- Content, Make Character... turns a Group you built by hand into a character, with its inner blocks as the parts and a mouth chart Flipbook as its mouth.
- View, Characters: a panel with Starter characters and Mine. Save to Characters keeps a character in your Characters folder, Add to Movie (or a drag onto the Stage or the Timeline) puts an independent copy in any movie, and Rename and Delete work on your own. Deleted characters go to Recently Deleted, where they show as characters and restore into Characters.
- Starter characters: Kofi, Ines, Marisol, Bram and Noor, original and drawn for this release, each with its part names, a pivot at every joint and a mouth chart of eight shapes.
- Lip-sync from Sound... lists your characters first, as "Kofi (character)", and writes into the mouth inside the character.
- Actions: apply, swap, clear and save named motions on a character (Content, Actions). An applied action shows as a labelled strip on the character's block; press a strip to swap it or clear it. Keys outside it are never touched, and each change is one undo step.
- Eight starter actions work on any character with the usual part names: Idle, Nod, Shake head, Wave Hello, Point, Walk in place, Jump and Sit. They fit each character's size and facing, and an action starts from each part's rest pose. A part the character lacks is skipped and named in the status line.
- Picking one part: double-click a character on the Stage, or open its block on the Timeline in Compose and press a part, to pick the part. Click another part to pick it, press on the character away from the parts to go back, and Escape to leave. Move, rotate, scale, pivot and keys then apply to that part only, with its lanes under the character in Keyframe mode.
- Content, Use as Mouth Chart... gives any character a mouth from an SVG of the eight mouth shapes. An SVG character with a mouth chart group inside gets its mouth when it opens. A mouth rests on its Rest drawing until Lip-sync from Sound writes shapes.
- `.fmact` files: Export Action... saves an action, and Import Action..., Import or a drop adds it to the selected character.
- Starter scenes: File, New from Starter Scene... opens Corner Street, Park, Kitchen, Classroom or Stage as a new movie, with a track for each layer, the scene's camera and a floor guide. The props are drawn to the starter characters' scale. A starter character added to it stands on the floor at half size, each one at its own spot so two never land on each other. In any other movie, starter characters and your own also each take their own spot across the frame, keeping their size and height.
- The vector link: File, Round Trips, Character as SVG for Vector App... saves the character as an SVG with one group per part and a pivot mark for each, and in the desktop app links it. When the file is saved in your vector app, the character updates by itself, parts matched by name, keeping its keys, parent, bones and actions. New parts are added on top; parts gone from the file stay, marked red, with "Not in the source file" in the status bar, and lose the red when they come back. A highlight you gave a part is kept. A link is followed by itself only when this computer made it, in the desktop app; a link that came in a movie from elsewhere waits for Relink Source... once.
- On a character's menu: Update from Source... (pick the file again), Unlink Source and Relink Source....
- Outside agents: `list_characters` reads your Characters library, and `add_character` puts a copy of a saved character in a movie, after you say yes in the window.
- iPad: a Characters folder in the Files app holds your saved characters, with Recently Deleted. SVG drawings and `.fmact` files open from Files. The iPad has no automatic update from a vector app: Update from Source... picks the file again.

### Improved
- The iPad build guide opens from Help in the app as well as on GitHub, and has a step by step check for this version.

### Changed
- SVG files open. They did not open before; now each one becomes a character. An SVG with no groups opens as one part for each run of loose shapes, not a track for every shape. A drawing with groups named for the mouth shapes opens as a Flipbook that Lip-sync recognises.
- The iPad documents tell what is true: the iPad app is a beta that you build yourself, built and run on an iPad Pro 13-inch (M5) with Apple Pencil Pro on iPadOS 26.3, where drawing, squeeze, barrel roll and hover were checked. The README, the manual and the build guide said it was not built or was coming.
- "Coming from another animation app" in the manual covers scene-based apps: bring the movie over as MP4, WebM, GIF or numbered PNG frames, and your own art as SVG, PNG or PSD. Another app's characters and scenery cannot be brought over.

### Fixed
- The manual had no section on Transitions. It now explains the four kinds, the direction of Wipe and Push, Dip to Color's color, the length and where a transition sits.
- Actions: a swapped action, or one applied over In and Out, stays inside its span. Touching actions keep their own keys, and Walk in place swings each arm against the leg on its own side.
- Save to Characters asks before replacing a name that cleans to a saved one, and closing the question saves nothing. A saved character holds no link to anything outside it, and posters of saved characters show.
- SVG: a group hidden in the file (hidden or not displayed, as many vector apps hide a layer) arrives hidden with its art, and `preserveAspectRatio` places the drawing as the file says.
- Lip-sync lists two copies of one character apart, and a character's mouth rests on Rest instead of cycling through the shapes.
- Recently Deleted keeps a movie and a character of the same name, deleted together, each in its own place.

### Under the hood
- The desktop engine answers `/api/characters` and, for a linked SVG, `/api/files/stat` and `/api/files/source`. The last two take only an absolute path to a regular `.svg` file of at most 20 MB, and need the window's key.

## 0.24.0 · 2026-11-23

FormMorpheus has a test suite. Nothing in the app changes.

### Tests
- Interface: unit tests in `frontend/tests/unit`, run by vitest with happy-dom. They cover the animation engine, its effects and GPU bookkeeping, the paint engine, file input and output, export, media, the platform layer, the agent dock, the app shell, the interface's own logic and the translation tables.
- Engine: tests in `backend/tests`, run by pytest against the FastAPI app in process. They cover the loopback and origin guard, the window key, the page policy, start-up, the library, export jobs, the MCP surface, agents, brushes, fonts, ideas, Pen Link, ffmpeg handling, the remaining routes and the repository's own scripts.
- One test holds every version site to the same version.

### Running them
- `./formmorpheus test` runs both layers; `./formmorpheus test interface` and `./formmorpheus test engine` run one.
- CI runs both on every push and pull request, in a new `tests` job.
- `docs/TESTING.md` says how to run the tests and what a test must do.

### Not covered
- The desktop shell (Rust) and the iPad app (Swift) have no tests yet. Code that needs a real GPU, real codecs or a real browser is left to the window check.

## 0.23.3 · 2026-11-22

The repository has the family's community files. Nothing in the app changes.

### Documents
- `CODE_OF_CONDUCT.md`: how people in the project treat each other, and where to report.
- `CONTRIBUTING.md`: how to set up, the checks to run before a pull request, how changes land, and the rules on licences and other people's IP.
- `SECURITY.md` names the latest release as the supported one, as the other Form apps do, so it does not go stale with each version.
- The README points to all three.

## 0.23.2 · 2026-11-22

A fix release for the builds: the Mac and Linux apps finish building, so this is the version that gets published.

### Fixed
- macOS: Apple accepts the app for notarization. The engine now carries its Python library once, as a plain file signed for where it sits. Before, a second copy inside a framework folder had a signature that did not hold there, and Apple refused the app.
- macOS: a build stops early, with the reason, if a file in the engine would not pass Apple's check where it sits.
- Linux: the build goes on when one of the GStreamer plug-in sets is not installed on the computer that builds it; that set is left out of the AppImage and the build log names it. Before, the build stopped right after freezing the engine, without a message.
- Linux: the AppImage no longer carries GStreamer's two text-art video outputs, nor the S-Lang, GPM and ncurses libraries they brought with them.

## 0.23.1 · 2026-11-22

FormMorpheus is called by its name, in every language, and says plainly what it ships.

### Changed
- Messages, Help, About, the menus and the Pen Link page write the app's name as FormMorpheus. The title bar, Home and the About wordmark keep the lower-case "formmorpheus", as the family writes its wordmarks.
- About says who made it: by nodemode.ai.
- All 30 languages have every string, including the terminal and agents, Video Tools, the new frame rate and brush names and What's New. Nothing falls back to English. What's New says so.
- The installers name the publisher, NodeAgentc, Inc., and the file type "FormMorpheus Movie".
- Two Classic brush sets have names that read right in every language, where the old ones were also the words for other things (a theme, a font weight, the brush size markers): Markers is Pens and markers, Light is Glow. A set you renamed keeps your name.

### Fixed
- The Linux AppImage carries only GStreamer's core, base, good and gl plug-ins (LGPL), whatever else is installed on the computer that builds it.
- The Linux engine no longer carries GNU Readline, which it never used.
- The manual and the wiki said 17 blend modes; there are 26.

### Documents
- `SECURITY.md`: how to report a security problem privately, and what the app guards.
- `NOTICE.md` lists every third-party part the app carries, with its version and licence, including the Rust crates, the Python runtime and the Linux bundle's libraries.
- `docs/api-contract.json` is written from the engine itself, and CI fails when it is stale.
- CI opens the built app in a headless browser and fails if the window does not draw or the page reports an error.

## 0.23.0 · 2026-11-22

The iPad catches up, ffmpeg is one click away, and FormMorpheus uses its own names.

### New
- iPad: ProRes and transparent video come in. The iPad converts them with its own video tools: ProRes 4444 with transparency becomes HEVC with transparency, other video it cannot play becomes H.264. If a converted clip shows no transparency on this iPad, a notice says so.
- iPad: the movie library can live in iCloud Drive. Home's two places are On This iPad and iCloud Drive; a movie saved there opens on your other iPads once it has downloaded.
- iPad: runs from iPadOS 16.4 (it asked for iPadOS 26 before). Pencil squeeze, roll and the hover preview need iPadOS 17.5; before that the Pencil's double tap still works.
- Preferences, Video Tools: where ffmpeg was found and what it can make, and a button that downloads the family's ffmpeg build (LGPL, about 12 MB, from the formai-binaries releases on GitHub) into your data folder, checks every file and can remove it again. An ffmpeg already on your computer is used first.
- Export and Sound only say when ProRes, HEVC or MP3 need ffmpeg, and open Video Tools.
- New Movie: 25 fps (European video) joins the frame rates.
- The README and the manual say what comes over from another animation app: layered `.procreate` artwork with its layers, and a movie as the video, numbered PNG frames or GIF it exports.

### Changed
- Frame rates have FormMorpheus's own labels: 12 Frame by frame is now On twos, 15 Anime is Web and GIF, 24 Cinema is Film, 30 Television is Video, 50 PAL is Smooth (Europe), 60 NTSC is Smooth, 120 Mobile is Extra smooth. The Home size cards follow them. Movies keep their rate.
- Brush sets have FormMorpheus's own names and order. Brushes you chose, sets you renamed and your own order are kept; on disk, a set's folder takes the new name at the next save.
  - Animation: Sketch is Pencil, Chalk is Pastel, Outline is Line art, Monoline is Even line, Wiggle is Boiling line, Ink is Pens, Script is Lettering, Wash is Watercolor, Paint is Thick paint, Bristle is Rough brush, Airbrush is Spray, Sponge is Dabbing, Noise is Grain, Texture is Surfaces, Graphic is Stamps, Pattern is Motifs, Metro is Geometric, Environment is Scenery.
  - Classic: Sketching is Graphite, Charcoals is Charcoal, Drawing is Markers, Inking is Comic ink, Calligraphy is Nibs, Painting is Studio paint, Water is Wet media, Airbrushing is Mist, Spraypaints is Graffiti, Artistic is Mark making, Textures is Grit, Materials is Finishes, Vintage is Printmaking, Industrial is Metalwork, Abstract is Shapes, Luminance is Light, Elements is Atmosphere, Organic is Nature.
- The layered artwork reader's file is now `io/tiled-artwork-import.ts` (it was named after the other app), and the text lint catches other vendors' names in any case.
- New Movie's Screen size follows the way the screen is held.

### Fixed
- The export progress and the Close button no longer move while an export runs.
- The status bar no longer shifts when Draw and Paint opens.

## 0.22.0 · 2026-11-22

AI programs on your computer can work with FormMorpheus, and only as far as you allow.

### New
- A terminal panel beside the Stage and the Timeline: View, Terminal, or Ctrl+` (Cmd+` on a Mac). It runs a shell, and Claude Code, Codex, Cursor and Antigravity when they are installed on your computer. FormMorpheus does not install them or sign you in. Type a request in the line at the bottom and Claude Code opens with it. The panel can sit at the bottom or on the right and keeps its size.
- An MCP server, so an agent can read your library, create, rename, duplicate, delete and restore movies, and export or import. Desktop only.
- Agents ask first. Preferences, Agents has Outside agents: Ask (the default), Allowed or Blocked. Under Ask, a change waits for your yes in a box in the window. An export or an import always asks, whatever you chose.
- Preferences, Agents shows the MCP address and the `./formmorpheus mcp` command for clients that start their own server. `./formmorpheus agents install` sets up Claude Code, Codex, Cursor and Antigravity for you.
- A `formmorpheus` skill for agents, so they know how a movie is made and how to export it.

### Fixed
- The text in the status bar no longer shifts when a movie opens.
- The first-run tour moves its highlight without shifting the page.

## 0.21.0 · 2026-11-22

FormMorpheus looks like the rest of the Form family, in its own violet.

### New
- A violet accent, FormMorpheus's own. An accent you picked yourself is kept; only the old default changes.
- AMOLED Black joins the themes, 29 in all.
- Home opens with a side column: the app's name, Movies, Recent, Start, Exports and Recently Deleted with their counts, the ways to start something new, and Preferences and Help at the foot. The poster wall is still there: Preferences, General, Theater layout, Gallery.

### Improved
- Colours, corner sizes and text sizes are the family's across the whole interface, so every theme recolours every part of it. Before, about 240 colours were fixed and ignored the theme.
- Lists in menus and dropdowns update in place when their contents change, with nothing redrawn around them.

### Changed
- Text is one pixel smaller where it was one pixel larger than the family's, and muted text is a little darker.
- The Italic button shows its "I" in the interface font.

### Fixed
- Chips in dialogs draw their border in the border colour. Before, three colour names they used did not exist.

## 0.20.0 · 2026-11-22

Only the FormMorpheus window can talk to its engine, and a release build carries nothing it does not need.

### Improved
- Your library is the window's alone: the engine answers only requests that carry a key it made for this launch and gave to its own window. Before, another program on the same computer could ask the engine for your movies.
- The engine listens on this computer only, always. The setting that could open it to the network is gone.
- The page the window shows can load code, pictures and sound only from the app itself.
- macOS: the installer asks for macOS 13 or later, which the app has needed since 0.17. Before, it installed on macOS 11 and 12 and then could not start.

### Changed
- From source, the page opens in one browser tab at a time. A second tab says that FormMorpheus is already open.
- `FORMMORPHEUS_HOST` is no longer read.

### Fixed
- Linux: a message about the engine shows web addresses as they are. Before, parts of them came out as digits.

### Under the hood
- Release builds have no web inspector and no source maps.
- The desktop window's permissions are granted to the engine's own address only.
- Two background clean-up jobs write their errors to the engine's log.
- `CLAUDE.md` and the wiki list every configuration variable.

## 0.19.0 · 2026-11-22

FormMorpheus starts and closes dependably on every system: when something goes wrong at the start it says what, and nothing is left running after you close it.

### New
- When the app cannot start, a message says why: the engine program is missing, it could not be started, it stopped, or another copy already has your movies open. The message shows the engine's last lines and where its log is. Before, the app closed without a word.
- When the engine stops while you work, the app tells you and closes, in place of a window that no longer answers.
- The engine keeps a log in the app's data folder, in `Logs/formmorpheus-engine.log`.

### Improved
- Your theme, language and preferences are kept from one launch to the next on every system.
- A window in a light theme opens in that theme's colour from its first frame.
- Linux: the window appears whole when the splash closes, as it does on macOS.

### Fixed
- Windows: closing the app, or ending it in Task Manager, also ends its engine. Before, the engine could stay behind.
- Windows: no console window opens beside the app.
- If the app crashed and left its engine running, the next start replaces it. Before, two engines could run.
- Opening the engine program by itself opens FormMorpheus.

### Changed
- Windows: a portable copy keeps everything in `FormmorpheusData` beside the app.

### Under the hood
- For the people who build it: the Windows launcher `formmorpheus.bat` has the same commands as `./formmorpheus`, both have `install-desktop`, and `build_app` and `build_app.bat` take `--config`. The Windows engine is built as a folder; set `FORMMORPHEUS_ENGINE_WINDOWED=0` to build it with a console. `setup/desktop_build` is removed; `./build_app` is the one build.

## 0.18.4 · 2026-11-22

A small release that makes the first public build dependable: Help has no dead links, a Mac finds ffmpeg, and every build uses the same packages.

### Fixed
- Help: every button in the Help Center opens something. Manual and Send an idea open inside the app, and "FormMorpheus on the web" opens `https://formai.studio/formmorpheus/` in your browser. Before, five buttons and three Help menu items pointed at web pages that did not load.
- macOS: FormMorpheus opened from Finder or the Dock finds an ffmpeg installed with Homebrew or MacPorts, so ProRes, HEVC and MP3 export are offered. Before, they were offered only when the app was started from a terminal.
- macOS: the last lines of a build name the app that was built.

### Changed
- Help menu: "Handbook on the Web", "Community" and "Video Tutorials" are replaced by one item, "FormMorpheus on the Web". The handbook is the Manual, which is inside the app and works offline.

### Under the hood
- Every build installs exactly the packages recorded in the repository: the interface from its lock file, the engine from a list that pins every package, and Rust 1.97.0.
- A Windows build signs its files one way only.

## 0.18.3 · 2026-11-22

A small release that prepares the first builds for macOS, Windows and Linux.

### Fixed
- Windows: Pen Link's page for the tablet is part of the app. Before, a Windows build left it out and the tablet got an empty page.

### Under the hood
- The interface's Tauri packages are the same version line as the desktop shell, which the build requires.
- The installer prefers Python 3.12, the version the engine is built and checked with.
