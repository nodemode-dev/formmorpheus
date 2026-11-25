# HASHOUT_LOG · frontend · formmorpheus

Living log of all comment content, explainers, rationale, TODOs, & removed code for the interface. Source files stay comment-free; everything they would have said lives here, indexed. Read this first, then edit code surgically.

Current build version: v0.29.0
Last updated: 2026-11-25 · eight new characters

---

## v0.29.0 · the eight new characters as starters and in the Character Builder

- refers-to: engine/cast/presets.ts :: CAST_PRESETS (new); engine/cast/index.ts; ui/characters-panel.ts :: paint, add; ui/character-builder.ts :: SPECIES_LABEL, FLAGS, HAIR_NOTE (new), STYLE_FREE (new), faceOnly (was humanOnly), hairNote (new), sync, randomize; styles/character-builder.css :: .fm-cb-seg.is-wrap, .fm-cb-tc:disabled, .fm-cb-note; ui/i18n/* (27 tables)
- kind: decision
- logged: v0.29.0 · 2026-11-25

- **One list.** `CAST_PRESETS` is the studio's 13 then the 8 new, and both the Characters panel and the builder read it, so the Starter section is the 5 drawn, the 13 and the 8 (26), each built starter with its poster, tag and Open in Character Builder, and the builder's roster shows Amara and Jade after the studio's women, Dev, Walt and Sami after its men, and Pip, Rex and Sprig after Bolt, Zib and Moss.
- **Species chips.** All seven, labelled Human, Robot, Alien, Monster, Fox, Dino, Sprout; the row wraps to two lines in the 356 wide column rather than overflow.
- **Dimmed by what the face draws.** `humanOnly` became `faceOnly`, each control with the species whose face draws it, read from `headBuild`: jaw, earrings, facial hair and lip color stay human only (the new heads have a fixed jaw and their own mouth line); lashes for human, fox and sprout; blush for human, fox, dino and sprout; freckles for human and sprout; glasses for all. Robot, alien and monster get exactly the 0.27.0 dimming.
- **Hair tab and `speciesHair`.** For dino and sprout the style is never drawn, so the style tiles are dimmed and the color stays live (it paints the dino's crest and tail spikes, the sprout's leaves and petals). For a fox the tiles stay live: any style but None gives the tuft. A note says so for the three species; it sits in the empty cells of the style grid's last row beside Mohawk, so showing or hiding it moves nothing.
- **Randomize.** The studio's logic, whose ranges are `HAIRS.length` and `OUTFITS.length`, so it already reaches the new hairs and outfits for every species the studio would randomize. For fox, dino and sprout it leaves the hair style and color alone: the color is the species' accent and a random one gave brown leaves or a black tuft. Skin stays the studio's (human tones for humans only).
- **Labels.** The species names, the new outfit and channel names (Varsity Jacket, Cardigan, Scrubs, Sleeves, Slacks, Badge), the new hair names, the eight tags and the three notes are in the 27 full tables in English; es-MX and fr-CA are left out as in 0.27.0.
- **Tails and actions.** The tail follows `hip`. The 0.25.0 starters on this branch (Idle, Nod, Shake head, Wave Hello, Point, Walk in place, Jump, Sit) never key `hip`, so the tail stays on the pelvis in every frame (contact sheets for Pip and Rex). The built versions of Idle, Walk, Run and Dance belong to 0.30.0 and are not on this branch, so no `tail` lane was added here.

## v0.28.0 · Character Builder review fixes

- refers-to: ui/character-builder.ts :: CharacterBuilder constructor (Ctrl+Z listener), thumbs, thumbsFor, add; styles/character-builder.css :: .fm-cb
- kind: fix
- logged: v0.28.0 · 2026-11-25

- **No field undo in the builder.** The dialog's field undo records only settled input changes, so Ctrl+Z there gave mixed recipes. A capture listener on the builder's scrim takes Ctrl or Cmd+Z first: in the name field it lets the browser's own text undo run and stops the dialog's; anywhere else it does nothing at all. The app's undo was already kept off by the dialog guard (`anyDialogOpen`) and the scrim stopping the key; checked: Ctrl+Z and Cmd+Z in the builder leave the movie's tracks as they were.
- **Tiles keyed one by one.** Each hair and outfit tile keeps the key of what it draws: the recipe with that tile's choice, without id, name and tag, with only the colors of the outfit it shows. A color change on the Outfit tab now redraws the one tile it touches (was all 13); a name change redraws none. Opening the builder clears the keys so a theme change shows.
- **Fits small windows.** The body's fixed `min-height: 420px` pushed the footer off a 560 tall window; it is `min(420px, 100vh - 160px)` now. Checked at 1024 by 560 (dialog 32 to 528), 1180 by 640 and 1600 by 1000.
- **Add to Movie's toast** names the character as it was when Add was pressed, not after the build.
- The `// Look`, `// Hair`, `// Outfit` markers were removed: the pane variables say it.

## v0.28.0 · Update from Source drops the recipe

- refers-to: engine/source-merge.ts :: mergeFromSource
- kind: fix
- logged: v0.28.0 · 2026-11-25

- **A source merge is not a build.** Update from Source over a built character kept `character.build`, so Edit in Character Builder stayed offered and Apply would paint the recipe over the SVG's parts. `mergeFromSource` now drops `build` and `builtHidden` with `missing` and `missingWas`. `mergeRebuild` reads the old `builtHidden` before it calls `mergeFromSource` and writes `build` back after, so a rebuild keeps both (checked in the browser: Karl after an Update from Source has neither; after `mergeRebuild` his build is back).

## v0.28.0 · the studio's cast as starters

- refers-to: ui/characters-panel.ts :: castStarter (new), castPoster (new), onOpenPreset (new), CharactersPanel.paint, updateRow, act, add; ui/character-builder.ts :: CharacterBuilder.openPreset (new); app/app.ts; ui/i18n/* (27 tables)
- kind: decision
- logged: v0.28.0 · 2026-11-25

- **A code list, not manifest entries.** The Starter section is the manifest's drawn starters, then `STUDIO_PRESETS` as built starters, keyed `cast:<id>`. The presets already carry id, name and tag and are the list the Character Builder shows, so one list feeds both and the 0.29.0 originals appear in both when added there. Manifest entries with `cast` would have repeated each name and tag, mixed recipes into a file whose conventions describe SVG drawings, and needed a fetch for data the bundle already has. The 0.25.0 starters and the manifest are unchanged; the studio's Kofi is Karl in the presets, so both appear.
- **Posters at runtime.** A built starter's poster is `rigToSvg(build(mkSpec(p)), { mode: 'full' })` as an SVG data URL, the full figure like the drawn posters, made once per session in `castPosters` and only from the first open of the panel (not at startup): 13 take about 46 ms cold at 4x CPU, 13 ms warm. The image is set once; the thumb box is the bin's fixed 56 by 42, so nothing moves while it decodes, and the person glyph is hidden for those rows so the box is empty for that frame rather than showing the glyph.
- **Placing.** Add to Movie and a drop on the Stage or the Timeline go through the same `add`: `castStarter` builds with `castToCharacterGroup` on a clone of the recipe for the open movie, then `placeCharacter` with the floor guide exactly as a drawn starter, so starter scenes' floor and spots apply. The group keeps `character.build`, so Edit in Character Builder works on it.
- **Open in Character Builder.** A row button shown only on built starters; `openPreset(id)` opens the builder on that preset as if its tile were picked (when the builder is already open on a new recipe, it picks the preset).
- **Meta text.** A built starter's row shows its tag through `t()` (The optimist, The executive...); the tags are in the 27 full tables in English until the release pass. The panel has no search, so none was added.
- **Agents and iPad.** `list_characters` and `add_character` read only the saved Characters library; starters are not exposed to agents today, so nothing changed there. No iPad route serves the starters manifest (the files ship in the bundle), so `ios/Engine` needs nothing.

## v0.27.0 · the Character Builder

- refers-to: ui/character-builder.ts (new) :: CharacterBuilder, prepareApply; styles/character-builder.css (new); ui/character-commands.ts :: character.builder, character.builder-edit, selectedBuilt (new); ui/characters-panel.ts :: packCharacter, CharactersPanel.save, onBuild, Build a character; ui/content-menu.ts :: Edit in Character Builder; app/app.ts; ui/i18n/* (27 tables)
- kind: decision
- logged: v0.27.0 · 2026-11-25

- **A dialog, not a panel.** The builder is a modal `Dialog` 1120 wide, the shape Export uses for the app's other large editor: it gets Escape, focus return, the drag spot, and the modal guard that keeps the app's shortcuts off while sliders and the name field have the keys. A dock panel would leave the Stage live under a recipe that is not in the movie yet. It is made on first use, not at startup.
- **Three fixed columns, fixed height.** Presets (196), preview (the rest), options (356), the body `min(660px, 100vh - 200px)`. Each tab pane scrolls on its own, so switching tabs or scrolling never moves the preview or the footer. Controls that only a human face uses (jaw, lashes, blush, freckles, earrings, facial hair, lip color) are disabled for robots, aliens and monsters instead of hidden as the studio hides them, so nothing below them jumps.
- **Canvas, not SVG.** The preview is one canvas: `build(spec)` and `solveRest` once per change on the next animation frame, each prim a `Path2D` (paths straight from their `d`, ellipses with their rotation, rects with clamped corners) drawn under its slot's matrix, at the studio's stage (600 by 640, feet at 300, 588, scale 1.08). Nothing is rebuilt per slider tick except the paths; no DOM changes. The canvas backing size follows its box through a ResizeObserver and redraws in the same task. The floor ellipse takes `--fm-cb-floor` (a token) so it follows the theme; the stage behind is `--canvas-bg`. Opacity is applied to fill and stroke apart (the SVG groups them), which differs only where a prim both fills and strokes with `op`.
- **Tiles.** Preset heads, the 14 hair heads and the 13 outfit figures are canvases of fixed backing size inside the buttons. Preset tiles are drawn when the list is set; the open tab's tiles redraw 140 ms after the last change, and only when the recipe differs from what they show.
- **Presets.** `STUDIO_PRESETS` by default; `setPresets(list)` takes any `CastInput[]` and patches the roster by id under Women, Men and Specials, so 0.28.0 and 0.29.0 can pass a longer list.
- **The studio's controls.** Name (14 characters), species (added: the studio fixes it per preset), skin, height, build, shoulders, head size, frame A or B, eye color, jaw, the five face toggles, facial hair, lip color (added: the studio has none; five lip swatches and a custom color), hair style with None, hair color, outfit, and its three channel colors labelled by the outfit's own labels, with Reset colors. Randomize is the studio's: hair, hair color and outfit at random, a human's skin from the ten human tones, and each outfit channel kept or turned round (r g b to g b r or b r g). Reset goes back to the preset, or to the build the character had when Edit opened it. No head width control: the studio has none, and `headWide` stays what the preset sets.
- **Actions.** Add to Movie builds with `castToCharacterGroup` and places it with `placeCharacter` and the movie's floor guide, one undo step, as a starter is placed. Save to Characters builds it for the open movie's size (1920 by 1080 when none is open) and goes through `CharactersPanel.save` with the built pictures, so the name check, Replace or Keep Both and the poster are the panel's own; `packCharacter` takes the built group's pictures and size when given. Apply (shown only when editing) runs `prepareRebuild` first, stores and preloads its pictures, then `mergeRebuild` inside one `engine.run` against the movie as it is then ('Apply Character Builder'); the one function `prepareApply` holds both calls. A rebuild is never run per change: only Apply runs one.
- **Busy, not disabled.** While a build runs the footer buttons are marked `aria-disabled` and dimmed instead of disabled, so the button that was pressed keeps focus and Escape still reaches the dialog.
- **Opening.** The Characters panel's Build a character button, the command palette and the Content menu (Character Builder..., Edit in Character Builder...), and Edit in Character Builder... in the content menu when the one selected character has a `build`.
- **Labels.** Every new label goes through `t()`, including the outfit, channel and hair names from the engine. The full tables carry them in English until the release pass translates them; the regional tables (es-MX, fr-CA) do not, since they hold only words that differ and an English entry there would hide the parent's translation.
- **iPad.** No route was added; Save uses the existing Characters routes, so `ios/Engine` needs nothing.

## v0.26.0 · rebuild review fixes

- refers-to: engine/cast/to-character.ts :: prepareRebuild, mergeRebuild (new), CastPrepared (new), CastRebuild; rebuildCharacter and rebuildFromSpec (removed); engine/cast/index.ts
- kind: decision
- logged: v0.26.0 · 2026-11-25

- **Prepare, then merge.** A rebuild awaited its mouth PNGs and then merged into the movie it was handed, so an edit made while the pictures were encoding was lost when the caller stored the result. It is now split as Update from Source splits it (app/source-link.ts): `prepareRebuild(spec, movie, rig?, mouthShapes?)` is async and builds against an empty copy of the movie (its size only), answering `{ fresh, assets, spec }`; `mergeRebuild(movie, charId, prepared)` is synchronous and runs inside the caller's `engine.run` against the current movie. The caller stores the asset blobs (and preloads them) before the edit. `rebuildCharacter` and `rebuildFromSpec` are removed: as one async call they invite the stale merge. `CastRebuild` no longer carries assets.
- **New parts in draw order.** `mergeFromSource` puts every new part on the top track, so a first cape, hair back or hair sway covered the face. After the merge `placeAdded` walks the fresh build's draw order bottom first and moves each added part's track directly above the track of the nearest part below it in that order (to the bottom when none is). Matched parts and the person's own parts are not moved. Checked: Leo in outfit 10 changing to hair 3, 4, 5, 6, 7, 9 and 12 for the first time keeps hair back under the head and hair front over it, and the drawn parts follow the fresh order exactly; a first cape lands just over the shadow.
- **The person's own parts.** A part named outside the cast part map is something the person added; a cast rebuild leaves it completely alone: its track stays where it is, its highlight is put back to what it was before the merge (not red), and it is not listed in `missing` (always empty for a cast rebuild) nor added to `character.missing`. `character.missing` and `missingWas` keep what they held before (an earlier Update from Source), less the names the build draws or hides.
- **Only what the build hid comes back.** The show-again rule judged by the old recipe's parts, so a part the person hid could be shown again by a later rebuild. `CharacterInfo.builtHidden` (optional, checked on load like `missing`) now lists the cast parts a rebuild hid; a rebuild shows again only those it draws, and drops them from the list. A part already hidden before the rebuild (the person's) is hidden still but not listed, so no rebuild shows it.
- **Locked tracks.** A cast part on a locked track is neither hidden nor shown by a rebuild (and keeps its highlight); it stays in or out of `builtHidden` as it was. A drawn part on a locked track still stops the whole rebuild, as `mergeFromSource` refuses to change it.
- **A mouth with the person's own drawings.** Each chart drawing named for a shape takes the new art, but the Flipbook's canvas is shared by every frame, so a frame with pixels and no shape name (drawn by the person) would be stretched or shifted by the new canvas. When any row has such a frame the mouth is left exactly as it was: old rows, old canvas, old pivot; the rest of the rebuild goes ahead. Fitting the new shapes into the old canvas was the other choice, but it needs new pictures painted inside the synchronous merge (or a second prepare), and it would still change the shape drawings around the person's frame; leaving it untouched is the safer.

## v0.26.0 · cast comments moved here

- refers-to: engine/cast/to-character.ts (file head, primDefs, rebuild, builtParts); engine/cast/build.ts :: build (eyes slot)
- kind: removed
- logged: v0.26.0 · 2026-11-25

- to-character.ts head: "A built rig as a FormMorpheus character: one Group, one inner track per drawn slot in the rig's draw order, each part following its parent part, the mouth a mouth chart Flipbook. Placed as an SVG starter of the 1080 convention is. No DOM."
- primDefs: "an open run that is filled and stroked: the fill closes it, the stroke does not."
- rebuild: "a cast part this build does not draw is hidden with its keys, not marked missing; one drawn again by a later build shows."
- builtParts: "the mouth chart is made from the recipe's mouth shapes whatever its slots hold."
- build.ts, after the slots: "Eye prims sit on the eye line already, so the slot takes no offset." (the studio sets the eyes slot's oy back to 0 after `SL` gave it H * .44).

## v0.26.0 · a built rig becomes a character

- refers-to: engine/cast/to-character.ts :: rigToCharacterGroup, rebuildCharacter, castPartName, CAST_UNIT (all new)
- kind: decision
- logged: v0.26.0 · 2026-11-25

- **Same result as an SVG import.** `rigToCharacterGroup` answers the importer's `ImportResult` (one character Group, the mouth pictures as assets with their blobs), so whatever places an imported or starter character places a built one. It is async for the same reason the importer is: the mouth drawings are pictures, and a picture's PNG is only made asynchronously. Without an OffscreenCanvas (a test run) the mouth frames keep empty layers, as a chart drawing that fails to draw does in the importer. No notice is written: that text is the interface's, and the engine has no translations.
- **Parts.** One part per slot with prims, in the rig's slot order (first slot on the bottom track), named by the contract's part map (`_L` is the character's right, so `-r`). A part with one shape is a Shape, with more a Group of Shapes top first, as the importer does. Pivot is the slot's bone origin in rest pose. Parents follow the map and climb past a missing part (no `head` part: its children follow `body`); the links are made with `setParent`, as the importer makes them.
- **Prims.** Every prim becomes a path Shape in movie pixels from the centre: the slot's matrix is its bone's rest world matrix times `translate(ox, oy)` when `oy` is set (the studio's own rule, which ignores `ox` alone). Ellipses are four cubic arcs turned by `rot` about their centre, rects get cubic corners of `min(r, w/2, h/2)`, `Q` becomes a cubic. Caps are the prim's (round by default) and joins round, as the studio writes them; `op` multiplies the fill and stroke alpha, as the importer reads `opacity`. An open path that is filled and stroked becomes two shapes (the fill closed, the stroke open), since one Shape fills only a closed outline.
- **Scale.** Rig units go into the 1080 character space at `CAST_UNIT` 2.25 per unit, x on 540 and the rig's floor (y 0) on 1012; that space is then fitted to the movie as the importer fits a 1080 viewBox (`k = min(1, W / 1080, H / 1080)`, centred on whole pixels). One constant rather than one per character, so the cast keeps the studio's relative heights: the studio's adults at body h 1 are 401 to 414 units, 902 to 932 tall.
- **Mouth.** A Flipbook named `mouth` of eight drawings named by `VISEME_NAMES` in `VISEMES` order, resting on Rest through `restingChart`, its canvas the union of the eight shapes, painted with the Stage's own shape painter. Given no mouth shapes, the mouth slot is Rest, the open mouth slot (its bone is folded to scale 0 at rest, read unfolded) is AI, and Rest stands in for the rest. The open mouth slot never becomes a part.
- **Rebuild.** `rebuildCharacter` builds afresh in the same movie and lays it over the character with `mergeFromSource`, so parts keep their ids, keys, parents and actions and new parts are added; then the recipe is written as `character.build`. The merge would hand the mouth the fresh resting chart and drop what lip-sync wrote, so the old mouth rows are kept and each drawing named for a shape takes the new art of that name. A part named in the cast part map that the new build does not draw (a skirt after an outfit without one) is kept hidden with its keys and its own highlight, left out of `missing` and reported in `hidden`; when a later build draws it again it is shown with the fresh art. "Drawn again" is judged against the parts the old recipe built, so a part the person hid while the build drew it stays hidden. Parts with other names (the person's own) are left as the merge leaves them: kept, red, listed in `missing`. Actions with lanes for a hidden part still write its keys and lip-sync never touches it, both without error.
- **From a recipe.** `castToCharacterGroup(spec, movie, at)` and `rebuildFromSpec(movie, charId, spec)` build the rig and its mouth shapes (`visemes`) and call the two above; both are in the cast index. The part map already holds `tail` (a slot on the hip bone, following `hip`) for the builds that will draw one.
- **Not shared with the importer.** Its fit and shape helpers live in `io/`, which reads translations from `ui/`; the engine never imports either, so the few lines of fit and node conversion are written here against engine modules only.
## v0.29.0 · eight new characters and the pieces they wear

- refers-to: engine/cast/outfits.ts :: OUTFITS (varsity, cardigan, scrubs); engine/cast/hair.ts :: HAIRS, hairBuild (curls, braid, mohawk); engine/cast/head.ts :: SPECIES, headBuild (fox, dino, sprout), speciesHair (new), tailBuild (new); engine/cast/build.ts :: build (tail slot, species hair); engine/cast/visemes.ts :: visemes (fox, dino, sprout); engine/cast/presets.ts :: NEW_PRESETS (new); engine/cast/index.ts
- kind: decision
- logged: v0.29.0 · 2026-11-25

- **Appended, never inserted.** Outfits 13 to 15 (Varsity Jacket, Cardigan, Scrubs), hairs 13 to 15 (Short Curls, Long Braid, Mohawk) and the species fox, dino and sprout come after the studio's, so every saved recipe keeps its index and every studio character draws exactly as before.
- **Drawn in the studio's hand.** Flat fills with one `shade` step, the same stroke widths, face sizes in the head unit `M.u`, rounded caps and `blob` for organic outlines. The varsity jacket has a ribbed collar, hem and cuffs striped in the trim colour, snaps and a chenille letter; the cardigan is a V over the shirt with its collar points, a button band with two buttons and patch pockets; the scrubs are a V-neck top over the skin like the tank, a chest pocket with pens and a clip-on badge, darker trousers. Short Curls are two rings of curls over a close buzz cap; Long Braid is the side cap with a braid of alternating lobes in hair-sway, swung out past the shoulder so it reads from the front, with a band and a tuft; Mohawk is a see-through buzz cap in the shade as shaved sides, a crest in front and a taller darker crest in hair-sway.
- **Species.** Fox: pointed ears with a cream inside, orange cheek tufts, a cream muzzle, a black nose and a w mouth. Dino: a head wider at the snout, darker spots, nostrils, brow ridges, a pale belly patch under the mouth, a wide smile with one tooth, and three crest spikes in hair-back. Sprout: no ears, a round face with a highlight like the alien's, a collar of petals behind the head and a stem with two leaves in hair-sway. Brows, lashes, blush, freckles (sprout) and glasses follow the face options; beards and earrings stay human.
- **Species hair** (`speciesHair`). For the three new species the hair colour paints the species' own piece and the hair style is not drawn: the dino's crest and the sprout's leaves are always there; a fox gets a tuft between the ears only when a style is chosen. The studio's four species return null and keep their hair styles.
- **Tail slot** (`tailBuild`). A slot `tail` on the hip bone, drawn right after `cape`, so behind the legs, the body and the arms; its part follows `hip`. The fox's is a bushy curve with a cream tip, the dino's a tapered tail with crest-coloured spikes and a pale underside, both built as a tube along one cubic curve so they scale with leg length. Every other character has no tail prims, so no slot and no part.
- **Mouth shapes.** Each new species has its own eight in its line colour: the fox keeps its w over every open shape, the dino keeps its tooth and opens wide, the sprout uses dark green lines and inside.
- **NEW_PRESETS.** Dev, Walt, Sami, Amara, Jade, Pip, Rex and Sprig, exactly as specified; their outfit colours equal to an outfit's defaults are left out. Rex's and Sprig's hair is -1 with the crest and leaf colour.
- Checked headlessly (a throwaway node script outside the tree running the studio's own functions): all 13 studio presets (and the head close-up and `solveRest`) and 200 random recipes using only the studio's indices still equal the studio's static SVG string for string; the palettes and the first 13 outfits and hairs match. The eight were rendered as a lineup, as mouth charts (Pip, Rex, Sprig) and the new pieces on a plain man, woman and head, and looked at.

## v0.26.0 · the character generator in the engine

- refers-to: engine/cast/ (new) :: palettes, prims, metrics, body, outfits, hair, head, build (build, mkSpec), svg (rigToSvg, solveRest), visemes, presets (STUDIO_PRESETS), index
- kind: decision
- logged: v0.26.0 · 2026-11-25

- **A faithful port.** The owner's character studio generator is ported as typed engine code with the same numbers, shapes, names and draw order: prims, metrics, garments and limbs, the 13 outfits, the 13 hair styles, the four species heads, the bone and slot build, `mkSpec` (the studio's `mkChar`) and the rest-pose SVG. No DOM. Only unused locals were dropped (the sundress and athletic torso length and waist, the head's mouth line), which changes no output. The monster's two fangs moved into `monsterFangs` so the mouth shapes can reuse them; the closed mouth is unchanged.
- **rigToSvg.** The studio's static SVG with no animation: `solveRest` is its solve with no tracks and no deltas, from the identity root, so `W` matches the studio's per bone. `opts.mode` 'head' gives the studio's head close-up box.
- **Mouth shapes** (`visemes`). Eight shapes in the lip-sync VISEMES order, in the mouth bone's space. Rest is the studio's closed mouth exactly. AI is the studio's closed mouth with its open mouth over it, what the studio shows at full open. The other six are drawn in each species' own style and line weight: people use the face's lip colour for strokes and the studio's open-mouth inside and tongue colours, MBP a pressed line, E wide, O and U rounded lips, FV upper teeth on the lower lip, L the tongue raised; robots use eye-coloured rounded bars on the screen, aliens small shapes in the darker skin shade, monsters keep their fangs except on the small round O and U.
- **Presets.** `STUDIO_PRESETS` holds the studio's 13 inputs verbatim, except its Kofi is Karl (id `karl`), for the starters in 0.28.0.
- Checked headlessly (a throwaway node script outside the tree running the studio's own functions): `rigToSvg(build(mkSpec(p)))` equals the studio's static SVG for all 13 presets (Karl compared under the studio's name) and 200 random recipes (every outfit, hair -1 to 12, all species, both frames, random sliders, face options and colour overrides); the head close-up, `solveRest` and the palettes, outfit and hair lists match too. `spec.ts` needed no change.

## v0.30.0 · the character builder's animations as starter actions

- refers-to: engine/actions-builtin.ts :: S_IDLE, S_WALK, S_RUN, S_WAVE, S_JUMP, S_DANCE, S_TALK, S_CHEER, fromStudio, flat, rigSit, chained, RIG_ACTIONS, CHAINED, builtinFor (new); engine/action-ops.ts :: findAction, atRate, sizeOf, mouthChart, speak, blendEnds, restValue, OPTIONAL (new), write, seal, applyAction, clearAction; engine/types.ts :: ActionDef.mouth, ActionDef.blend (new)
- kind: decision
- logged: v0.30.0 · 2026-11-25

- **Two versions behind one id.** A built character's parts follow each other (head on body, body and legs on the hip, forearm on arm), while a 0.25.0 starter's nine parts follow nothing. Today's lanes move every part by the same y (Jump lifts body, head, arms and legs each by about 120 px), so on a built character the offsets would add up down the chain (the head would rise by body plus head) and the legs would leave the hip. Extra lanes for the optional parts alone could not fix that, and the studio's timing differs too (Idle 3.2 s against 48 frames, Wave 2.2 s against 48). So `findAction` asks `builtinFor`: a character with a `hip` and a `forearm-r` or `forearm-l` part gets the studio version of Idle, Walk in place, Run, Wave Hello, Jump, Dance, Talk and Cheer; any other character gets exactly the 0.25.0 definition, object for object. Ids are unchanged, so saved spans keep working; a span's length and channels follow whichever version the character gets.
- **The studio data is copied as written** (ANIMS, blink included) and converted by `fromStudio`: frame = round(t x length), length = round(dur x 24) (Idle 77, Walk 24, Run 13, Wave 53, Jump 31, Dance 38, Talk 58, Cheer 26); keys that round onto one frame are spread one apart (the blinks). Rotation keeps its sign: the engine's matrix is the SVG one, clockwise on screen positive. x and y: studio value x 344 / 173 (its leg, hip to sole at body height 1, is 80 + 78 + 15 rig pixels; ours REF_LEG 344), then action-ops scales by the character's own leg as for every starter. Scale channels as written. Eases: s is Ease in and out (handles 1/3, 2/3 against the studio's 0.37, 0.63), l is Linear, o and i are Custom with the studio's own Bezier handles.
- **Sides.** Studio `_L` is the Stage's left, our `-r`. Wave Hello lifts `arm-r` since 0.25.0 and the studio waves with `arm_R`, so the studio wave plays mirrored (names traded, r and x negated); every other studio action keeps its sides.
- **New starters on nine parts.** Run, Dance, Talk and Cheer have no 0.25.0 version, so `flat` derives one: the lanes for body, head, arms and legs, each also carrying the hip's x and y (nothing follows the hip there). Leg scale with the hip's drop keeps the feet near the floor, as the studio's thigh squash does.
- **Mouth.** `ActionDef.mouth` lists shapes by frame. The studio's mouthO openness is read on twos and mapped: 0.05 or less Rest, below 0.45 E, below 0.75 O, else AI. `speak` writes them into a part named mouth that is a mouth chart through `applyLipsync` (the top shown row, drawings from the hidden chart row a Lip-sync row left), never growing the block; Clear Action and an action laid over a speaking span put Rest back. A mouth that is not a chart is left alone and is not reported as skipped.
- **Leg size.** `sizeOf` measured `leg-r` alone; a built `leg-r` is the thigh only, so it now takes the lowest of `leg-r`, `shin-r` and `foot-r`. Nine-part characters have neither, so they measure as before.
- **Cheer and Dance loop.** One pass (1.1 s, 1.6 s) is too short to read, so both repeat. Their cycles (and Run's and Idle's) start away from the rest pose (Cheer's arms at 146 degrees), so the action carries `blend` (4 frames): `blendEnds` in `write` replaces the keys in a placed span's first and last 4 frames with a key at rest on the span's edge and the loop's own value 4 frames in, and `seal` writes rest at a blended loop's true start and at every end. The loop keeps its phase; a span shorter than 10 frames is not blended. The format has one length per action, so an intro and outro outside the loop was not possible without a new span shape; easing over the span's own ends needs none. The derived nine-part Run, Dance and Cheer blend too.
- **Nod, Shake head, Point on the rig** (`chained`): the 0.25.0 lanes with each following part's x and y made relative to the part it follows (head and arms minus body), sampled at both parts' key frames, so nothing is moved twice. Body turns still carry the head, as on the rig they should.
- **Sit on the rig** (`rigSit`): seen from the front, sitting is the thighs turning toward the viewer. The hip drops by 0.85 of the thigh (80 rig px, x 344 / 173), the thighs squash to 0.15, and each shin is scaled by the inverse so shin and foot keep their size and the feet stay on the floor; arms open as in the 0.25.0 Sit and the forearms turn to the lap. Thigh scale, shin scale and hip drop are keyed every frame from Sit's drop curve, because a key only at the curve's turns lets the two scales drift apart between keys (the feet went through the floor mid-drop in the first try). A knee turn was tried and dropped: a turn between the squashed thigh and the shin shears shin and foot.
- **Optional parts are not reported.** A starter that moves `hip`, a forearm, shin, foot or hand, `eyes`, `brows`, `hair-sway` or `shadow` says nothing when the character lacks it (a bald built character has no `hair-sway`); a character's own actions still name every missing part.
- Checked on real built characters (a throwaway script outside the tree: `castToCharacterGroup` for Maya, Karl and Moss, all twelve starters through `applyAction`, frames drawn by the real `Renderer` into a recording canvas, written as SVG and converted to contact sheets): limbs stay joined, feet stay on the floor line except in the air of Jump, Run and Cheer, Wave Hello lifts the character's own right arm, Dance and Cheer ease in and out.

## v0.25.0 · characters added to any movie each take their own spot

- refers-to: engine/starter-scene.ts :: spotX (new), standOnFloor; ui/characters-panel.ts :: placeCharacter
- kind: decision
- logged: v0.25.0 · 2026-11-25

- **The fault.** In a movie without a floor guide, two starters added one after the other (Add to Movie or a drop) both landed at x 0, y 0, scale 1, so the second hid the first; saved characters from Mine did the same.
- **One spot order.** The spot maths left `standOnFloor` for `spotX`: it counts the characters already in the movie's top-level tracks and answers the x the next one's middle takes (mid-frame, then right, left, further right, further left, 280 px a step scaled by width / 1920, clamped a quarter of a starter's drawn width inside the frame). `standOnFloor` uses it as before. Every other placement (no floor guide, a saved character, a character made in a movie of another size) keeps its scale (shrunk to fit as before) and its vertical position and is moved across by `spotX - width / 2`, so the first character lands where it always did. The agent bridge's `add_character` goes through the same `placeCharacter`, so its characters spread the same way.
- Only the middle is clamped: a character drawn wider than the gap to the edge can still run past it at the outer spots, as on the floor.
- Checked headlessly (a throwaway happy-dom script outside the tree): three starters added to a plain 1920 x 1080 movie land at x 0, 280 and -280, y 0, scale 1; a character made in a 3840 x 2160 movie added fourth lands at x 560, y 0, scale 0.5; five starters in a 400 px wide movie all keep their middle inside the frame.

## v0.25.0 · an SVG part not displayed in the file

- refers-to: io/svg-import.ts :: SvgPart.undisplayed (new), own, makePart, top, markupOf, isMouthChart, svgToMouthChart
- kind: decision
- logged: v0.25.0 · 2026-11-25

- **The fault.** A part group hidden with `display="none"` or `style="display:none"`, how many vector apps hide a layer, was dropped without a word: `own` and `top` skipped every element whose display was none.
- **Hidden with its art, like visibility.** A `g` not displayed now goes on to `makePart`, which marks the part hidden (the earlier fix "A hidden SVG part keeps its art" is the model) and reads its art with the display and inherited visibility dropped. Display is not inherited, so its children are read as usual; its nested parts inherit the hidden flag as a hidden part's do. Its picture markup also says `display:inline`, so a part that must be a picture is drawn and then hidden by its flag. An editor layer not displayed (a layer is not a part) passes `visibility: hidden` down to what it holds, so its parts and loose shapes arrive hidden with their art.
- **What stays skipped.** A shape (not a group) not displayed, loose at the top or inside a visible part, and a pivot marker not displayed, are left out as before. Inside a part whose groups are a mouth chart, a group not displayed is neither a frame nor counted by `chartLike`, as before. A top-level part not displayed (itself or through its layer) is `undisplayed`, and `isMouthChart` and `svgToMouthChart` leave it out, so a chart file reads exactly as it did; a file whose mouths are mostly not displayed is still not a chart, but its groups now arrive as hidden parts.
- Checked headlessly (a throwaway happy-dom script outside the tree, picture path stubbed) with `display="none"`, `style="display:none"` and a mixed style: the part and its nested part arrive hidden with their shapes, the block is hidden in the character, a loose shape not displayed inside a visible part stays out, a picture part's markup is displayed; a nested chart with an extra group not displayed keeps its eight frames; a chart file with an extra group not displayed is still a chart of eight; a layer not displayed gives hidden parts with art.

## v0.25.0 · labels that translate cleanly

- refers-to: engine/actions-builtin.ts :: builtin:wave; engine/source-merge.ts :: mergeFromSource
- kind: decision
- logged: v0.25.0 · 2026-11-25

- **Wave Hello.** The starter action was named "Wave", a key the tables already hold for the wave shape and brush ("Welle", "Onda"), so every language would have shown the wrong sense. It is "Wave Hello"; its id `builtin:wave` is unchanged, so saved spans still find it.
- **Locked part.** The refusal named the part through a template literal, which no table key can match. It is one fixed sentence now, so the page translator finds it; the part is the one the person just tried to update.

## v0.25.0 · a part picked inside a character

- refers-to: engine/engine.ts :: select, pick, pruneSelection; engine/group-ctx.ts :: picked; engine/group-inner-ops.ts :: outerGroup, updateAny; ui/inner-pick.ts (new) :: pickedPart, stageTargets, stageFind, partAt, partBox; ui/stage-view.ts :: find, patchT, boxOf, pick, dblclick, down, writeKeys, nudge; ui/path-view.ts :: target, pivot and path edits; ui/timeline.ts :: innerSel, laneItem, laneContent, laneHit, laneDown, keySpot, doubleClick; ui/action-menu.ts :: setLaneShown; app/app.ts :: deselect
- kind: decision
- logged: v0.25.0 · 2026-11-25

- **The fault.** A part of a character could not be edited alone, so "rotate an arm in Keyframe mode" could not be done: the Stage picked only top-level blocks, a click on a part's bar in an opened group outlined it on the Timeline but the Stage kept the whole group's box, and `engine.select([partId])` was dropped because `locate` reads only the top tracks.
- **One inner selection, the one groups already had.** The Timeline's in-place group expand already kept `groupCtx.picked`, a block picked inside an opened group while the group stays the engine's selection. That is now the inner selection everywhere, not a second system: `engine.pick(id)` sets it and tells the views (a `selection` event), the Timeline's picks go through it, and `engine.select([id])` with an id inside a group selects its outermost group and picks the id. Selecting anything else, or nothing, drops the pick; a pick whose content is gone is dropped with the selection. `engine.selected` stays top-level, so every command that acts on the selection is unchanged.
- **Getting in and out.** On the Stage a double-click on a group (a character) picks the part under the pointer; while a part is picked, a click picks another part of the same group, a press on the picked part's box keeps it, and a press on the group away from every part goes back to the whole group. Escape (the Deselect command) first leaves the part, keeping the group selected, then deselects. On the Timeline a double-click on a character's block opens it in place (Compose; Alt still zooms), and a click on a part's bar picks it as before. A part is the content on the group's own tracks (an arm, the head); a part's own shapes are not picked one by one. Perform keeps the whole selection.
- **What the Stage edits** (`ui/inner-pick.ts`). `stageTargets` is the picked part while its group shows, else the selection; `stageFind` finds either. The part is handed over as a copy whose `start` is moved so `engine.frame - start` is the part's own frame (the group's start, offset and speed counted through `levelFrameOf`), so `animate`, `isOver`, the box, the handles, Move keys and the HUD read it like a top-level block; the parent space comes from `screenMat`, which already follows parents and groups. Writes go through `updateAny` (top-level `updateContent`, else `updateInner`), keeping the copy's start out of the movie. A part on a locked track, or in a group on one, is not grabbed.
- **Picking and the box.** A part is hit where one of its drawn pieces is (`partAt`: each shape, picture or canvas box of the part at the frame, through its world matrix), not by its box, since a group's box is the whole movie. A picked part that is a group gets a box round what it draws (`partBox`, in its own picture space), also used for its anchor sectors; a top-level group keeps the movie's box, as before.
- **Pivot and paths.** The path view finds its content through `stageTargets` and `stageFind` and writes through `updateAny`, so Edit anchor, the pivot drag (Move lane px and py keys in Keyframe), path nodes and handles act on the part; a picked part does not stop Edit anchor.
- **Its lanes** (Keyframe and Perform). Under the group's block the Timeline shows the picked part's lanes in place of the group's (`laneItem`, a copy with its start in movie frames, kept while the part is unchanged so its lane pictures are not remade), drawn and hit like any lanes; a key drag writes through `updateAny` and keeps the part's own start; a lane's expand toggle works. The Playhead pill, the key value card and the Graph button are left out for a part, since they act on the selected block.
- **Left.** The box menu's Flip and Reset, Warp, Bones, the effect tools on the Stage, multi-key choice on the lanes and the lane menu act on top-level blocks only.

## v0.25.0 · a mouth rests until lip-sync

- refers-to: engine/lipsync-ops.ts :: restingChart; io/svg-import.ts :: chartBook; engine/character-ops.ts :: attachMouthChart
- kind: decision
- logged: v0.25.0 · 2026-11-25

- **The fault.** A chart's eight drawings each had hold 1 and the Flipbook ran the movie's length, and a Flipbook row loops, so a starter character (and any SVG character with a mouth chart inside, and Use as Mouth Chart) mouthed all eight shapes over and over before any lip-sync.
- **Rest's hold covers the block** (`restingChart`). The chart row's Rest drawing (the frame named Rest, else the first, the one `guessMapping` takes for rest) is moved to the front and held for the block's length; the other seven follow it with hold 1, past the block's end, where they are never shown but stay in the row. `chartBook` builds every chart that way for its block (a mouth chart file, the chart inside an SVG character), and `attachMouthChart` holds Rest for the length of the block the chart is placed in (the old mouth part's, or the character's), on a one-row Flipbook only.
- **Why not a library row.** A hidden chart row under a drawn row holding Rest was the other way, but the dialog takes the first row that looks like a mouth as the chart and its "A new track (keeps the chart)" hides only that row, so the drawn Rest row would stay visible under the written shapes, and `applyLipsync` would have to change. With the hold, the chart is still one row of eight named drawings: the dialog picks it, guesses the same mapping, defaults to a new track, copies the drawings by index and hides the chart, the same as before.
- **Left.** The row is seven frames longer than the block, so an edit that grows a Flipbook to its longest row (insert, duplicate or hold change in Draw & Paint) grows the mouth block by those frames; inside a character they lie past the character's end.

## v0.25.0 · Lip-sync targets read apart

- refers-to: ui/lipsync-dialog.ts :: fillBooks
- kind: decision
- logged: v0.25.0 · 2026-11-25

- **Unique labels.** Two copies of one character were both listed as "Marisol (character)", so the Mouth flipbook list could not tell them apart. After the labels are made, a label already used in the list gets a number through the template `{name} {n}` (translated whole), from 2 up until it is free, in list order: the first copy keeps its plain label. Flipbooks of the same name are numbered the same way. Only the text changes; the values are still the Flipbooks' ids.

## v0.25.0 · the Characters panel opens at its height

- refers-to: ui/characters-panel.ts :: manifest, readManifest, mineRead, opening, show, hide, refresh, paint
- kind: decision
- logged: v0.25.0 · 2026-11-25

- **No jump on open.** The starter manifest was fetched on the first open, after the panel showed, so the Starter section appeared above Mine and pushed it down (y 145 to 450), and Mine said "No characters saved yet" until the library answered. The manifest is now read when the panel is made at startup (`readManifest`, kept as a promise), and the library is listed then too, into the hidden panel, so its rows and posters are ready. `show` waits on that promise (already settled in practice; a close meanwhile cancels the open with `opening`), paints, then unhides, so the panel's first frame has both sections. The empty Mine text stays hidden until a list has been read (`mineRead`, set on success or failure); every open still re-reads the library and patches the rows in place.

## v0.25.0 · saved characters' posters

- refers-to: io/characters-api.ts :: charactersApi.poster (was posterUrl); ui/characters-panel.ts :: posters, loadPoster, paint, updateRow
- kind: decision
- logged: v0.25.0 · 2026-11-25

- **Fetched, not linked.** A saved character's poster was an `<img src>` on `/api/characters/{name}/poster`, which the engine refused (403): an image cannot send the window key, and every `/api/` route asks for it. `posterUrl` is gone; `charactersApi.poster(name, v, row)` fetches it through the low-priority picture queue (`lowFetch`, as movie posters in `io/api.ts` `picture`), so the key rides on it and visible rows go first. Null when there is none or it fails.
- **Shown as an object URL.** The panel keeps one `{want, url}` per saved row. A row asks again only when its name or modified time changes; the answer is decoded off-screen and set with `swapMedia` in one write, the glyph staying until then in the thumb's fixed 56 x 42 box, and the old URL is revoked after the swap. A row that leaves the list has its URL revoked in `paint`; an answer for a row that is gone or newer is revoked unused. Starter posters are plain files outside `/api/` and keep their `src`.

## v0.25.0 · review fixes, characters

- refers-to: ui/characters-panel.ts :: save, packCharacter, useMouthChart; ui/character-commands.ts :: character.mouth; ui/content-menu.ts :: mouthChar; app/app.ts :: Content menu; ui/dialogs.ts :: Confirm, confirmAction, chooseOrCancel; io/svg-import.ts :: makePart, markupOf, parseCss, top, parseSvgParts, partContent, chartLike, chartBook, svgToMouthChart, svgToCharacterGroup, importSvg
- kind: decision
- logged: v0.25.0 · 2026-11-25

- **Save to Characters compares the cleaned name.** The name is cleaned with `freeName(base, [])` first (`A/B` becomes `A B`) and that is what is compared with the saved names and written, so saving `A/B` twice asks before replacing instead of quietly replacing `A B`.
- **The replace question can be cancelled.** There was no three-way question but the Unsaved Changes one, which has fixed words. `Confirm` now reports a close (Escape, the close button, a click outside) as `null` instead of `false`; `confirmAction` turns that back into `false`, so every caller is unchanged. The new `chooseOrCancel` hands the `null` through: Replace is `true`, Keep Both `false`, a close saves nothing. Without the window's own dialogs it asks two system questions, the second one the other answer.
- **Saved characters hold no outside links** (`packCharacter`). Every inner content, at any depth, whose `parent` names an id that is not the group or inside it loses that `parent` in the library copy (a hand parented to a prop on another track, say). Links between the character's own parts stay. The movie itself is not changed.
- **A hidden SVG part keeps its art.** A group with `visibility="hidden"` (or `collapse`, the same for a group) became a hidden part with nothing in it, because its children inherited the hidden and were skipped. The part is marked hidden, then its own art is read with the inherited visibility dropped; a child hidden on its own (relative to the part) is still left out. A nested part that does not set visibility itself stays hidden, as it inherits it. The part's picture markup says `visibility:visible`, so a part that must be a picture is drawn and then hidden by its flag.
- **A style rule the reader cannot apply makes a picture** (`parseCss`, `Ctx.styled`). Only tag, `#id` and `.class` selectors and their joins are applied to shapes; the old comment said the rest went to the picture path, but they were dropped and the shapes kept the wrong paint. Now every other selector is run once with `querySelectorAll` on the parsed file, and a part holding an element it matches (or a part whose own group it matches) is drawn as a picture, noted as "a complex style rule". A selector the parser refuses (a pseudo-element) is ignored, and `:hover` and the like match nothing. Left: the picture carries the file's style sheets but not the part's ancestors, so a rule that names an ancestor outside the part (`#layer1 path`) still does not reach it there.
- **preserveAspectRatio is honoured** (`parseSvgParts`). Every viewBox was centred and fitted (`xMidYMid meet`) unless it said `none`. Now the alignment (`xMin`, `xMid`, `xMax` with `YMin`, `YMid`, `YMax`) places the drawing and `slice` fills the size (the larger scale) instead of fitting it; a leading `defer` is skipped, an empty or unknown word falls back to the middle. With `slice`, art past the size is not cut here: parts keep their full shapes, as they do past the edge of any SVG.
- **Loose shapes make one part** (`top`, `parseSvgParts(text, name)`). Every top-level shape outside a group was a part of its own, so an ungrouped drawing became hundreds of tracks. Now shapes side by side (path, rect, circle, ellipse, line, polyline, polygon, with nothing else drawn between them) are moved into a new `g` (marked `data-fm-loose`) in the parsed document and read as one part; anything else (a group, text, a picture, an editor layer) ends the run. The wrapper gets only the inherited style of where it sits, so the file's own `g` rules are not applied to it while reading shapes (a picture of the run, if it needs one, would see them). One run is named after the file; with several they are `Part N` like any unnamed part. A run of one shape is left as before: its own part, named by its label.
- **A mouth chart inside a character becomes its mouth** (`makePart`, `SvgPart.frames`, `chartLike`, `chartBook`, `partContent`). A part whose child groups pass the same test as a mouth chart file (`chartLike`: at least six of them named for the mouth shapes by label, `data-name` or id, and no more than ten) no longer makes each mouth a part drawn on top of the others. Each child group is read as a whole drawing (`frames`, kept out of `doc.parts`, its picture with nothing cut), and the part becomes one Flipbook with a frame per shape in chart order, keeping the part's name, pivot, opacity and parent. `characterInfoOf` already picks a Flipbook that looks like a mouth, so the character's `mouth` is set and Lip-sync from Sound writes into it. `chartBook` is the old body of `svgToMouthChart`, which now calls it too, so there is one way a chart is drawn. A mouth group hidden with `display:none` is still skipped, as in a chart file; one hidden with `visibility` is drawn.
- **The file is read once** (`importSvg`). It parsed the SVG to ask whether it is a mouth chart and then each importer parsed it again. `svgToCharacterGroup` and `svgToMouthChart` now take the text or the parsed `SvgDoc`, and `importSvg` hands them the one it read.
- **Use as Mouth Chart...** (`character.mouth` in `character-commands.ts`, `CharactersPanel.useMouthChart`, a row in the block menu beside Save to Characters, built the same way, and in Content in the menu bar). On one selected character it opens the platform's file chooser for an SVG, reads it with `svgToMouthChart` (any SVG: one frame per top-level group), adds the pictures to the movie and puts the Flipbook in with `attachMouthChart` (in place of a `mouth` part, else on a new top inner track following `head`) in one `engine.run` step, which sets the character's mouth. So any character, an SVG one included, can be lip-synced from sound. A file that cannot be read says so and changes nothing; closing the chooser does nothing.

## v0.25.0 · actions: files and saved movies are bounded

## v0.25.0 · actions: Walk in place swings its arms against each other

- refers-to: engine/actions-builtin.ts :: walkArm, neg, BUILTIN_ACTIONS (builtin:walk)
- kind: decision
- logged: v0.25.0 · 2026-11-25

- **The bug.** Both arms took the same rotation keys, so both hands swung to the same side at once. `arm-l` now plays `neg(walkArm)`: the same frames and eases with every value negated, so the pair is opposite at every frame, frame 0 is still rest (0 stays 0) and the loop still closes exactly.
- **Which way each arm goes.** `arm-r` is back (negative) when `leg-r` lifts at frame 6 and forward when `leg-l` lifts at frame 18, two frames behind each leg; `arm-l` is the reverse, so each arm is against the leg on its own side. Forward is read from the lift, not from the leg's rotation sign: `leg-l` lifts with -3 (its splay mirrors `leg-r`'s +3), so the legs were left as they were.
- **Mirroring.** Actions are kept for arm-r on the Stage's left and a character drawn the other way round negates every rotation, arms and legs together; the pair stays opposite and each arm stays against its leg, so one set of keys serves both orientations.
- **Idle, Jump and Sit left alone.** Their `arm-l` is already the negation of `arm-r` (Idle 1.5 and -1.5, `neg(jumpArm)`, `neg(sitArm)`): both arms rise or settle outward together, which is right for a pose that is the same on both sides. Only a walk wants the arms against each other.

- refers-to: io/fmact.ts :: lane, key, parseFmact, BAD_IDS; engine/normalize.ts :: characterDef, actionLane, BAD_IDS; engine/types.ts :: ACTION_MAX_FRAMES; engine/action-ops.ts :: eachChannel
- kind: decision
- logged: v0.25.0 · 2026-11-25

- **Bounds.** An action read from an `.fmact` file or a saved movie has its `length` rounded and kept between 1 and `ACTION_MAX_FRAMES` (14400, ten minutes at 24 fps), its `fps` kept between 1 and 240, and only keys from frame 0 to `length`; a key before 0 is dropped, not moved to 0. A lane left with no channel is dropped. `eachChannel` skips any key outside 0 to `length` too, as a backstop for an action that reached the movie another way, so a stray key can never be written thousands of frames down a part.
- **No prototype writes.** Channel maps (and an `.fmact` lane's options) are built with `Object.create(null)` and never take the ids `__proto__`, `constructor` or `prototype`: `JSON.parse` makes `__proto__` an ordinary own key, and copying it into a plain object would have set that object's prototype.

## v0.25.0 · actions: review fixes (spans, boundaries, size, mirroring)

- refers-to: engine/action-ops.ts :: loopPasses, findAction, clearRange, moves, mirrored, reach, sizeOf, fitFor, eachChannel, write, keyAt, seal, applyAction, clearAction, swapAction, actionFromKeys; engine/types.ts :: ActSpan.start, ACTION_MAX_FRAMES; engine/actions-builtin.ts :: cyc, cycle, anchor, jumpLegY, sitLegY; app/action-commands.ts :: apply, the history listener
- kind: decision
- logged: v0.25.0 · 2026-11-25

- **A span never writes past its end.** `applyAction` and `write` take an optional `limit` (a frame of the character's tracks, inclusive): no key is written past it and the span's `to` is the smaller of its natural end and the limit. Swap Action passes the old span's `to`, so Nod [0,26] swapped for the 48-frame Wave gives Wave [0,26] and the Walk after it keeps every key (26, 32, 38 and on). Apply over the loop range passes Out the same way. A loop over a span takes `loopPasses`: whole passes (at least one) and, when frames are left, one more pass cut at the limit; it replaces the rounding that could run a pass past the end or stop short of it.
- **The cut end.** Where a span ends at a frame its action has no key at, it gets a key there with the action's own value at that frame (the ease that was running carries on), so the motion stops cleanly instead of sliding toward whatever key comes next. This is `seal`, the same code that writes shared boundary keys below.
- **Touching spans share one frame, owned by the later span.** A span owns its first frame and its last frame only on channels no span starting there moves (half-open for writing). After an apply or a clear, `seal` writes, for each span starting or ending at the frames involved, that span's own key there on the channels it owns. Clearing keeps a key inside the cleared range only when another span covers its frame and that span's action moves the same part and channel; before, any key at a frame some other span covered was kept, so clearing Walk [48,96] after Wave [0,48] left Walk's leg keys at 48 and Walk's value as Wave's ending. Now no Walk key stays on the legs and Wave ends at 48 on its own value.
- **`ActSpan.start`.** A span cut from the left by a later apply keeps where its action's first pass began, so its boundary key (and a later clear's rewrite of it) is the action's value at the right moment of the pass. Absent for every span that was not cut that way; `normalize.ts` keeps it only when it is a number before `from`.
- **Starter actions fit the character.** Their pixel channels (x, y, px, py) are drawn for a leg 344 px from hip to sole (the tallest starter) and are multiplied by the character's own size: its `leg-r` from pivot to the lowest point it draws, times its scale, over 344; else the height of everything it draws over 900; else 1 (a character drawn on Drawings with no canvas has no measurable size). Kept between 0.05 and 20. Measured on the redrawn cast, legs are 344, 322, 312, 300 and 222 (the girl), so Sit and Jump no longer push the smaller characters' feet through the floor. A person's own actions are not scaled: they were made on a character and keep its pixels.
- **Feet stay down.** Sit's and Jump's leg keys are now exact for a scaled leg: wherever the leg squashes, its y is 344 times (1 minus its scaleY) at the same frames and eases, so the sole stays on the floor at every frame for any leg length. Sit lost its 2 px lift at frame 4; Jump's crouch and landing are 24.08 and 20.64 and its settle no longer lifts the feet.
- **Cyclic lanes start at rest.** `cyc` shifts each lane so its frame 0 value is rest (0, or 1 for a scale) and its shape and timing stay. A loop placed later then starts from the pose before it instead of pulling the curve leading into it. The lanes keep their closing key equal to their first.
- **Mirroring.** All actions are kept in the standard orientation (arm-r on the Stage's left). Save Action on a character drawn the other way round negates x, rotation, pivot x and bone turns as it saves, and every action (not only the starters) is mirrored again when it is applied to such a character, so a saved action plays the same way on a normal character and on its own.
- **No closures per draw.** `findAction` is two plain loops; the Timeline calls it for every strip's label on each redraw.
- **The picked strip goes on undo and redo.** The action commands watch the engine's `history` event and let go of `actPick` when the redo list changes length (an undo, a redo, or the first edit after an undo), since the same index may then name another span or none. Edits that leave the redo list empty keep it.
- **An action starts from each part's unkeyed rest pose.** Values are offsets from the part's transform and pivot as set, not from whatever keys the part shows at the span's first frame. For the release notes.
- **Removed.** `mirrored(g, a)` returned false for anything but a starter action; it now takes the character only. The old `write` loop moved into `eachChannel`, shared with `seal`.

## v0.25.0 · Starter characters redrawn: necks, hands, mouths and a family look

- refers-to: public/starters/characters (five character SVGs, five mouth charts, posters, manifest.json :: conventions.joints, conventions.style, mouthCenter)
- kind: decision
- logged: v0.25.0 · 2026-11-25
- refers-to (checks): io/svg-import.ts :: parseSvgParts, svgToCharacterGroup, svgToMouthChart; engine/lipsync-ops.ts :: looksLikeMouth

- **Necks.** The neck in `body` is short and wide (60 to 80 units wide, about 30 visible) and reaches well up inside the head; the head's pivot is at the neck base under the collar (Kofi 374, Ines 430, Marisol 568, Bram 444, Noor 436), a collar, scarf, shirt points or beard covering the joint. Checked by drawing every head turned 15 degrees each way, dropped 14 px (Nod) and lifted 8 px (Jump): no gap, no long thin neck. The old necks were up to 130 units long and about 50 wide, so a tilt showed a stick.
- **Hands and arms.** Same parts, same pivots by role. Each arm is drawn as an upper arm and a forearm meeting at a slightly bent elbow, the sleeve ending at the wrist; each hand is a flat mitten with a thumb on the inner side and two finger lines, drawn from just above the wrist so it turns without a gap.
- **Mouths.** Each chart is fitted to its face: width (Kofi 22, Ines 19, Marisol 18, Bram 24, Noor 19 units half-width), lip color, lip weight, how far the mouth opens (Ines least, Marisol most), and a cupid's bow on Marisol and Noor; Marisol's E shows her tongue, not lower teeth. Bram's mouths sit under his moustache (drawn after the `mouth` group in `head`), his Rest a small lower lip on the beard. Rest is never wider than MBP, so the width does not jump between them. FV is the upper teeth resting on the lower lip tucked up under them, with no dark gap and no lower teeth, so it reads apart from E. Ids and `data-name` values are unchanged; `mouthCenter` follows the new mouths.
- **A family look.** A softened-square head, rounded-rectangle eyes with a square catch-light, one highlight shape everywhere (a short pill leaning up to the right), flat shading lit from the upper left, and the family's violet as one detail per character (Kofi's pouch clasp, Ines's earrings, Marisol's hair ties and star, Bram's pocket square, Noor's belt) plus a stripe on every sole. Written into the manifest as `conventions.style` for whoever draws the final art.
- **Checks.** The S1 check (throwaway, outside the tree) passes again: 9 parts with exact names and nesting, a pivot per part at its joint, no part a picture, 8 mouth frames named as `VISEME_NAMES`, `looksLikeMouth` true, every mouth within 40 px of `mouthCenter`. Posters redrawn from the new art.

## v0.25.0 · Starter scenes redrawn to the characters' scale

- refers-to: public/starters/scenes (every background and prop SVG, manifest.json :: conventions.size, layers x y scale)
- kind: decision
- logged: v0.25.0 · 2026-11-25

- **One scale.** An adult starter at scale 0.5 is about 450 px, 1.7 m, so the props are drawn at 265 px to the metre at the floor: bench seats 0.45 m with backs at 0.86 m, the kitchen table 0.75 m, the chair seat 0.45 m with its back at 0.94 m, the classroom desk 0.75 m, the bookshelf 1.5 m, the bar stool 0.76 m, the microphone head at 1.5 m (mouth height), the speaker 1.0 m, the post box 1.1 m, the lamp post 3.4 m, the street's planter tree 2.9 m and the park's tree 3.6 m.
- **Depth in the backgrounds.** Each background is drawn in perspective with the horizon 1.5 m above the floor line (an adult's eye), and what stands at the back is drawn at the scale of its distance. The street's buildings stand across the road behind a kerb and a far pavement, at about 72 px to the metre, so their 2.1 m doors are about 150 px. The kitchen counter (0.9 m), wall cabinets, window and fridge stand at the back wall, about 200 px to the metre; the classroom's board, windows and dado likewise. Floors and ceilings have boards running to the vanishing point.
- **On the floor.** Every standing prop's feet are on the centre line of its own contact shadow at the bottom of its SVG, and its layer y puts that line on the scene's floorY (the street's was 930 with props ending at 920 to 940, the classroom desk ended 10 px below the floor, the stage's stool and speaker 2 and 10 px above). The kettle stands on the table top and the globe on the desk. The kite flies.
- **Removed.** The five `scene.json` files, copies of the manifest entries that nothing read, and the sentence about them in the manifest conventions.
- The gradient ids (`sky`, `win`, `back`, `spot`, `curtain`) and file names are the same as before; the family's violet comes back as one small detail per scene, the same way the characters carry it.

## v0.25.0 · Starter scenes: review fixes

- refers-to: app/app.ts :: starterScenes, prepareOpen; engine/starter-scene.ts :: rasterScale, standOnFloor, SPOTS, STEP; ui/starter-scene-dialog.ts :: StarterSceneDialog.load, show, thumb, choose; engine/guides.ts :: tidyGuides; engine/normalize.ts :: normalizeMovie
- kind: decision
- logged: v0.25.0 · 2026-11-25

- **Opening a scene is a normal open.** New from Starter Scene goes through `prepareOpen` like a library or file open, so playback stops, fonts and first frames are ready before the switch, and the previous movie's pictures, video, sound and fonts are let go. `prepareOpen` now takes only `movie` and `assets`, all it ever read. When the person stays with the current movie (`askToKeep` false) the dialog stays open; `make` answers whether it opened.
- **Sharp under a zoom.** A scene layer is drawn at twice its own size whenever twice fits within `MAX_SIDE` on both sides (before: only when twice fitted the movie, so a 1920 x 1080 background was drawn at 1x and went soft under a camera zoom). A 1920 x 1080 background is 3840 x 2160, about 33 MB decoded; props are small. Whole steps only, as before.
- **No empty-then-filled dialog.** The manifest is read when the dialog is made (at start-up), and `show` waits for it before opening, so the cards are there when it appears. A read that failed (an empty list) is tried again on the next show. Each thumbnail is drawn off screen into an `OffscreenCanvas` and copied to the card's canvas once all its layers are in. The second `paint()` after a first read is gone. The cards are plain buttons in a plain grid: the list roles are dropped (`role="listitem"` on a button hid it as a button).
- **Spots along the floor.** `standOnFloor` counts the characters already in the movie's top-level tracks and moves the next one along: mid-frame, then 280 px right, 280 left, 560 right, 560 left (scaled by width / 1920), round again after five, clamped to a quarter of a starter's drawn width inside the frame. Feet stay on the floor.
- **Guide roles.** `tidyGuides` writes each line as `{axis, at}` and keeps `role` only when it is `'floor'`; it also keeps `squareFrame` and `portraitFrame`, which it dropped (the 1:1 and 4:5 frame switches did not stay on). `normalizeMovie` now tidies `guides` on load, so a file's line roles are checked on open like the rest of the movie.
- **Scene layers are pictures (removed plan).** The DEV_PLAN said starter scenes would reuse the SVG importer. They do not: each layer is rasterized into a picture block. The backgrounds use linear and radial gradients in `defs` and soft shadows, which the part importer does not keep, and the props are scenery, not rigged parts, so there is nothing to pose. A person edits one by opening the layer's SVG in their vector app (or bringing it in as a character, when it should move in parts) and putting the result in with Replace the picture or video....

## v0.25.0 · the source link is followed only where this computer made it

- refers-to: ui/prefs.ts :: Prefs.linkedSources, LINKED_SOURCES_MAX, LINKED_SOURCE_LEN, loadPrefs; io/source-api.ts :: trustSource, isTrusted, canLinkPaths (canWatchSources removed); app/source-link.ts :: tick, check, fromPath, start, Unlink Source; ui/content-menu.ts :: srcUnlink; app/app.ts :: openFromPath, characterOut; ../SECURITY.md (Files)
- kind: decision
- logged: v0.25.0 · 2026-11-25

- **Why.** A movie, a saved character or a paste carries `character.source.path` from wherever it was made. Followed as it was, a movie from someone else made this window hash and read whatever `.svg` sat at a path they chose, every 2 seconds, and lay it into the movie.
- **The rule (orchestrator decision).** Only links made on this computer are followed automatically. `Prefs.linkedSources` (per computer, in the prefs store; newest first, at most 200 paths of at most 4096 characters, cleaned by `strings` like the other lists) holds the paths this computer produced. `trustSource(path)` puts a path first; `isTrusted(path)` is an exact match. Written only by: `openFromPath` for an `.svg` the desktop app handed over, `fromPath` after a successful read (Update from Source... and Relink Source... in the dialog), and `characterOut` after the desktop save is linked. Never on movie open, Characters Add to Movie, paste, `.fmo` import or `add_character`: those copy the movie data only.
- **Polling.** `tick` skips an untrusted path with no request at all, and `check` asks `isTrusted` again right before reading the text. The first untrusted link of a movie (by `movie.id`, once per session) shows "{file} was linked on another computer: choose Relink Source... to follow it."; Relink Source... picks the file in the dialog, which makes it trusted.
- **One request in flight in all.** `tick` is async and guarded by `running`: it walks the trusted linked paths one after another, awaiting each stat (and read), so a slow engine never has several requests from the poll at once. The per-path `busy` set is gone.
- **Desktop app only.** Polling and Unlink Source are gated on `canLinkPaths()` (the desktop app, where a dialog gives a real path); `canWatchSources()` (any desktop engine, a browser included) is removed, since a browser can never make a trusted link. Update from Source... (pick the file again) stays everywhere.
- **Character as SVG.** The stat-and-link step has its own `try`: when it fails the export still says saved, with the platform-neutral sentence, and adds "Saved, not linked: larger than 20 MB." for 413 or "Saved, not linked: {reason}" otherwise. Its texts, the job label and the note "Written without their art: {names}." (`io/svg-export.ts`) go through `t` and `tf`. The local `selectedCharacter` (first selected group that is a character) is replaced by the shared one in `ui/character-commands.ts` (exactly one selected character).

## v0.25.0 · a part's own highlight survives going missing from the source

- refers-to: engine/source-merge.ts :: mergeFromSource; engine/types.ts :: CharacterInfo.missingWas; engine/normalize.ts :: character
- kind: decision
- logged: v0.25.0 · 2026-11-25

- **Before.** A part gone from the file was set red, overwriting a highlight the person gave it, and stayed red after it came back.
- **Now.** Going missing (not on a locked track): a highlight other than none and red is kept in `character.missingWas[name]`, then the part is set red; entries of parts still missing carry over. Coming back: a part that was in `missing` and is still red gets `missingWas[name]`, or none. A part the person gave another highlight while missing keeps it. `missingWas` is written only beside `missing`, and `normalize.ts` keeps only entries for names in `missing` with a known highlight.

## v0.25.0 · characters in Recently Deleted

- refers-to: ui/home-trash.ts :: restore, render, fill; io/api.ts :: TrashItem; styles/trash.css :: .fm-trash-glyph svg
- kind: decision
- logged: v0.25.0 · 2026-11-25

- **Shown as characters.** An item of kind `character` has the person glyph (`PERSON_SVG`, sized by `.fm-trash-glyph svg`), the kind "Character" and its name without `.fmo`, which the engine already strips. Movies and exports are as before.
- **Restore.** A character's restore always says where it went: "{name} is back in Characters.", or "Restored to Characters as {name}" when the engine had to give it a free name. The engine answers `{restored, kind: "character"}`; `restored` is the file name, so `.fmo` is taken off as for a movie.

## v0.25.0 · an outside agent adds a character

- refers-to: app/agent-bridge.ts :: addCharacter, take; ui/characters-panel.ts :: placeCharacter, unpackCharacter; io/characters-api.ts :: charactersApi.read
- kind: decision
- logged: v0.25.0 · 2026-11-25

- **The window's half of `add_character`.** The bridge item `add_character` (`{character, movie?, at?}`) opens `movie` through the same `front` as an import, or uses the open movie when none is named (no movie open: "FormMorpheus could not open that movie."). It reads the character with `charactersApi.read`, unpacks it with `unpackCharacter` and places it with `placeCharacter`, the code behind the panel's Add to Movie, so the copy has fresh ids and is one undo step. Then it saves as an import does and answers `{ok, content, movie, saved}`, `content` being the character's name.
- **Where.** No `at`: the Playhead, on a new track at the selected track, as Add to Movie. With `at`: that frame, on a new top track, the way a drop on the Stage places it; the Playhead is not moved.

## v0.25.0 · Starter characters read by the SVG importer (S1 check)

- refers-to: io/svg-import.ts :: parseSvgParts, svgToCharacterGroup, svgToMouthChart, isMouthChart; engine/lipsync-ops.ts :: looksLikeMouth; public/starters/characters
- kind: explainer
- logged: v0.25.0 · 2026-11-25

- Every starter character and mouth chart was run through the importer headlessly (a throwaway script outside the tree, happy-dom, the picture path stubbed). Each character reads as 9 parts with the exact names, `hand-l` in `arm-l`, `hand-r` in `arm-r`, `mouth` in `head`, the rest at the top; no part becomes a picture (no assets made); every part has its pivot: legs at the top of the leg, arms at the shoulder, hands at the wrist, body at the pelvis on the centre line, the mouth within 2 px of the manifest's `mouthCenter`, and the -l parts on the viewer's right. Each mouth chart reads as 8 frames named exactly as `VISEME_NAMES` in order, `looksLikeMouth` true, no shape a picture, every mouth centred near `mouthCenter`.
- The head's pivot sits below the head's own shapes (at the neck base, inside the body's neck) by the starter conventions, so the head turns on its neck; that is intended, not a fault.
- Nothing failed: neither the importer nor the art was changed.

## v0.25.0 · Starter characters stand on a starter scene's floor

- refers-to: engine/starter-scene.ts :: STARTER_ART, standOnFloor; ui/characters-panel.ts :: placeCharacter, CharactersPanel.add
- kind: decision
- logged: v0.25.0 · 2026-11-25

- A starter character added (Add to Movie, or a drag onto the Stage or the Timeline) to a movie with a floor guide (`floorOf`, only a starter scene makes one) gets scale 0.5 in the SVG's own units (0.5 over the importer's fit, which is 1 in a 1920 x 1080 scene) and a move that puts the SVG's centre at x = the frame's middle, y = floorY - 236 (the starter conventions: feet at 1012 in a 1080 drawing, so (1012 - 540) x 0.5), turning about the group's own pivot. Without a floor guide, and for a saved character from Mine, the placement is as before. A character made in a movie of another size than the open one also keeps the old placement (the stand-on maths assumes the drawing was fitted to this movie).
- Checked headlessly for all five characters in all five scenes: feet land on floorY, the drawing is 506 px tall, centred across.

## v0.25.0 · New from Starter Scene

- refers-to: engine/starter-scene.ts :: isSceneEntry, rasterScale, sceneMovie; io/starter-scenes.ts :: readSceneManifest, withSvgImage, rasterize, buildSceneMovie; ui/starter-scene-dialog.ts :: StarterSceneDialog; engine/guides.ts :: GuideLine.role, floorOf; app/app.ts :: starterScenes, new-from-scene
- kind: decision
- logged: v0.25.0 · 2026-11-25

- **What opens.** File, New from Starter Scene... (beside New Movie...) reads `/starters/scenes/manifest.json` and shows each scene as a card: its name, its prop count and a small picture drawn once per card (every layer SVG decoded as an image and drawn at its place into a 320 x 180 canvas; a layer that fails is left out). Choosing a card builds a new movie of the scene's width, height, fps, duration (frames) and background, named "Untitled Movie", and opens it the way New does (no library name, so the library adopts it under a free "Untitled Movie" name); the open movie is written first with the same quiet save leaving a movie always does. The starter files are only fetched.
- **Layers.** One track per layer, the first layer of the manifest at the bottom (so the last track), each holding one picture block named for the layer and spanning the whole movie. A layer SVG is drawn into a PNG picture asset (kind `image`, as picture imports store them) at twice its own size when that still fits inside the movie, else at its own size. Only whole steps: a fractional step rounded the sides differently and the Microphone Stand came out 1 px taller than its shape. The block's scale is `scale x svg width / picture width`, its move puts the picture's centre at the layer's x, y from the top-left.
- **Camera.** The scene's preset (panX, panY, zoom) is written as the movie camera's keys at frame 0 with `setCameraKeys`, so it holds for the whole movie and shows on the camera lane like any key.
- **Floor.** `floorY` becomes a horizontal guide line marked `role: 'floor'` (a new optional field on `GuideLine`; moving the line keeps it, removing it removes it). `floorOf` finds it. It is shown and snapped to like any guide and is never exported.
- Not done: no starter `.fmo` files (DEV_PLAN Decisions: manifest plus SVG layers built on open); the Home screen's Start list was left as it was.

## v0.25.0 · the source link in the window

- refers-to: app/source-link.ts (new) :: setupSourceLink, apply, check, tick, fromPath; io/source-api.ts (new) :: sourceApi, canWatchSources, canLinkPaths, pickSvgPath; engine/source-merge.ts :: setSourceLink, linkedCharacters, isMissingPart, mergeFromSource (missing); engine/types.ts :: CharacterInfo.missing; engine/normalize.ts :: character; app/import-flow.ts :: ImportOptions.link; app/app.ts :: openFromPath, setupSourceLink; ui/content-menu.ts :: srcUpdate, srcUnlink, srcRelink; ui/status.ts :: syncDims
- kind: decision
- logged: v0.25.0 · 2026-11-25

- **Polling.** Every 2 seconds while the window has focus (started on `focus`, and at once if the page already has it; stopped on `blur`; the first check runs on focus, so coming back from the vector app updates at once). Each check walks the open movie for every character with `source`, nested ones included, and asks `/api/files/stat` once per path with at most one request in flight per path. A hash that differs from a character's stored `sha256` reads the text from `/api/files/source`, runs `svgToCharacterGroup` on a scratch movie of the movie's size (no tracks, no assets), stores and preloads the pictures as `import-flow.ts` place does, and makes one `engine.run('Update from Source')` that calls `mergeFromSource` for each character on that path (a second character gets `ops.cloneContent` of the fresh group, so no id is shared) and writes the stat of the bytes read into `source` in the same step. A toast names the file and lists new parts and parts not in the file.
- **Undo is not undone by the poll.** After an undo the stored hash is the old one while the file has the new one; a per-character map of the hash already applied this session keeps the next poll from putting the update back. A later save of the file, Update from Source... or Redo brings it back.
- **Where it runs.** Decided by the platform, not by an answer: `platform.kind === 'desktop'` means the Python engine, which serves both routes (in the desktop app and in a browser alike), so the window polls; the iPad's engine has neither route, so the window never asks there and offers Update from Source... only (no Unlink, no Relink). A 404 on the desktop therefore means the file is gone: "Source file not found" once per path per session, the link is kept, and checking goes on so the file is picked up when it is back. Another refusal (400, 403, 413) is shown once and that path is not asked again this session. An engine that is not answering is skipped quietly.
- **Missing parts.** `mergeFromSource` now writes the names it did not find into `character.missing` (removed when none). The status bar's selection text adds "Not in the source file" for such a part: it is where the window describes the selected block, and the Timeline chip is drawn on a canvas with no per-block hint. The red highlight from the merge stays as before.
- **Menu.** On a selected character, beside Save to Characters: Update from Source... (always), Unlink Source (linked, desktop engine), Relink Source... (desktop app only, where a dialog gives a path). Update from Source... in the desktop app opens the system dialog (`plugin:dialog|open`, SVG filter, starting at the linked file) and links the chosen path with the stat of what was read; elsewhere it uses the platform picker, which gives no path, and keeps the link as it was. Relink Source... links and reads the file in one step named "Relink Source"; Unlink Source drops `source` as an undo step.
- **Opened by path.** Paths the desktop app hands the window (Open With, a second launch, the command line: `formmorpheus://open-paths` and `take_pending_opens`) reached only `.fmo` before. An `.svg` path now reads the file through `/api/files/source` and imports it into the open movie with `ImportOptions.link`, so the character it makes is linked at import. `.svg` is not a declared document type of the app, so double-clicking an SVG does not offer FormMorpheus; Open With and the command line do. The Import command and drops use the browser's file chooser, which gives no path: those characters are linked with Relink Source...
- **Files.** `normalize.ts` keeps `source` only with a string path ending in `.svg`, finite `size` and `mtime` and a string `sha256`, and keeps `missing` to names that are parts. Only links made on this computer are followed: a path is followed only when it is in `Prefs.linkedSources`, written where this computer produced the path (an `.svg` opened by a path the desktop app handed over, Update from Source... and Relink Source... through the dialog, the desktop save of Character as SVG). A link that arrived inside a movie, a saved character, a paste, an `.fmo` import or an agent's `add_character` is never asked for until the person chooses Relink Source... once (see "the source link is followed only where this computer made it").

## v0.25.0 · Lip-sync onto a character's mouth

- refers-to: ui/lipsync-dialog.ts :: targets, fillBooks, span, overlap, cur, pickSound, limit, show, show2; engine/lipsync-ops.ts :: applyLipsync, groupHolding; ui/content-menu.ts :: lipOk; engine/character-ops.ts :: findDeep, movieStart, listCharacters
- kind: decision
- logged: v0.25.0 · 2026-11-25

- **Targets.** The Mouth flipbook list starts with every character whose `mouth` is a Flipbook, as "{name} (character)", then the other Flipbooks; a character's mouth is listed once, as its character. The default is the selected character's mouth, else the selected Flipbook, else the first character's, else as before. The block menu offers Lip-sync from Sound... on a character with a mouth.
- **Nested mouths.** A character's mouth sits inside its group, where `locate` and `updateContent` do not reach. `applyLipsync` now, when the Flipbook is not at the top, takes the top-level group that holds it, runs itself on that group's tracks as a movie with the start frame moved into the group's frames (start and offset; a group's speed is not counted), and writes the tracks back in one edit, so it stays one undo step and still refuses a locked track. The dialog reads the block's place with `findDeep` and works its range in movie frames, cut to the room on the mouth's own track and to the end of its character. `media/lipsync.ts` is unchanged.

## v0.25.0 · the Characters panel and library

- refers-to: io/characters-api.ts (new) :: charactersApi, freeName; ui/characters-panel.ts (new) :: CharactersPanel, packCharacter, unpackCharacter, starterCharacter, placeCharacter; styles/characters.css (new); ui/character-commands.ts :: characters-panel, character.save; ui/content-menu.ts :: saveChar; app/app.ts :: charactersPanel, View and Content menus
- kind: decision
- logged: v0.25.0 · 2026-11-25

- **Client.** `/api/characters` as the engine and the iPad answer it: list (`{folder, items}`, newest first), read, write (an `.fmo`), rename (`{to}`, 409 when taken), delete (to Recently Deleted), poster. Its own small `call` beside `io/api.ts`'s, with the same not-running sentence and error detail; the window key rides on every `/api` fetch already (`io/window-key.ts`).
- **What is saved.** A movie the size of the current one holding one track with the character group (its own `parent` link dropped, start 0) and only the pictures it uses, packed by `packMovie` with no history and a 320 px poster drawn by `renderer.thumb` at the Playhead. The engine replaces a name silently, so Save to Characters asks when the name is taken: Replace, or Keep Both, which saves as "Name 2" (Escape keeps both, never losing one).
- **Placing.** Add to Movie, or a drag of a row onto the Stage or a Timeline row (the media bin's way: a private drag type, window drop listeners, `timeline.dropTarget`), puts `ops.cloneContent` of the group at the Playhead or the dropped frame on a new track named for it: every inner id is new and `parts`, `mouth` and `parent` follow through the paste remap, so two copies move apart. One undo step. A character made in a larger movie is scaled down to fit about the movie centre. Its pictures go into the blob store and the renderer's preload before the run, as an import does.
- **Starter.** Reads `/starters/characters/manifest.json` once (`{format, characters: [{id, name, file, poster?, mouths?}]}`, files beside it). No manifest or no entries: the Starter section stays hidden. Adding one fetches its SVG, runs the SVG importer, names the character after the entry, and with `mouths` runs the mouth chart importer and `attachMouthChart`. Starter rows have no Rename or Delete.
- **Built once.** The panel is the media bin's frame and rows (`fm-bin` classes) placed on the left so both can be open; two section lists patched with `patchList`. A poster `<img>` changes `src` only when the address changes (the modified time is in it), keeps the person glyph until the picture loads, and goes back to the glyph when there is none (204).

## v0.25.0 · Make Character

- refers-to: ui/character-commands.ts (new) :: characterCommands, makeCharacterFlow, selectedGroup, selectedCharacter; ui/character-glyph.ts (new) :: PERSON_D, PERSON_SVG, drawPerson; ui/icons-morph.ts :: character; ui/action-menu.ts :: charBtn; ui/content-menu.ts :: makeChar; ui/timeline.ts :: PERSON_ROOM, block chip, chipWidth; app/app.ts :: commands, Content menu; engine/character-ops.ts :: makeCharacter, characterInfoOf
- kind: decision
- logged: v0.25.0 · 2026-11-25

- **Command.** `character.make` (Make Character...) asks for a name (the group's or the character's own as the default) and runs `makeCharacter` through `engine.run`, one undo step. Parts are the group's inner contents by name, top track first, a repeated name numbered; the mouth is the first inner Flipbook with a row that `looksLikeMouth`. On a character it names the parts again and keeps any other field the character has. It is offered in the Action menu (a Character button beside Shape, shown for a group), the Content menu bar (after Ungroup) and the block's own menu.
- **The chip glyph.** The Timeline is one canvas, so there is no element to give a class: the glyph is one outline (`PERSON_D`) shared by the inline SVG icon and a `Path2D` made once and stroked in the chip's ink, after the name and before the chevron, when the block's `character` is set. The chip grows by `PERSON_ROOM` (14 px) in the paint and in `chipWidth`, so the Edit pill and hits stay beside it. Nothing is allocated per frame.

## v0.25.0 · SVG parts become a character

- refers-to: io/svg-import.ts (new) :: parseSvgParts, pathRuns, svgToCharacterGroup, svgToMouthChart, isMouthChart, isSvgFile, importSvg; engine/character-ops.ts (new); engine/model.ts :: relinkCharacter; engine/ops.ts :: cloneContent; engine/track-ops.ts :: cloneTrack; engine/normalize.ts :: character; media/import.ts :: Sniff, EXT, sniff, importMedia; app/app.ts :: MEDIA_ACCEPT
- kind: decision
- logged: v0.25.0 · 2026-11-25

- **One entry point.** Every way a file arrives (Import, a drop, the iPad's Files, the MCP `import_file`) goes through `importMedia`, so `.svg` is routed there: `svg` in the extension table and a text sniff (`<svg`, or `<?xml` with an `.svg` name). `drop-files.ts` only lists files and needed no change. SVG used to fail as an unknown file.
- **Parts.** Each top-level `<g>` is a part; a loose top-level element is a part of its own; a nested `<g>` is its own part, linked with `setParent` to the part it sits in, so turning an arm turns its hand. An editor's layer group (`inkscape:groupmode="layer"`) and a lone wrapper group holding only groups are opened, not made parts. Name: the editor's label, then `data-name` (what other vector apps write when an id had to be cleaned), then `id`, then `Part N`; a repeated name gets a number.
- **Coordinates.** Every part sits at rest with no Move: shape nodes and pictures are placed in movie pixels from the movie centre, so a parent's transform does not shift its children. The SVG keeps its pixel size and is shrunk only when larger than the movie, centred on whole pixels, like layered artwork.
- **Shapes.** A Shape holds one outline, so each subpath of an element is its own Shape; a part with one outline is that Shape, a part with several is a Group of them. Paths read every command, relative and absolute; arcs become cubic pieces of at most 90 degrees. Transforms (matrix, translate, scale, rotate with a centre, skew) compose down the tree with the viewBox and `preserveAspectRatio` (none or centred meet). Paint comes from attributes, simple `<style>` rules (tag, id, class), then `style`; linear and radial gradients with their href chain map onto the Shape gradient (stop offsets moved onto the run the renderer draws across the box); more than 8 stops are sampled down. A stroke's width, dashes and offset scale with the transform.
- **Pictures.** Text, images, reused elements, filters, masks, clipping, patterns, markers and a filled subpath inside another that cuts a hole (even-odd, or wound the other way) make that whole part a picture: a standalone SVG of the part alone (nested parts and the pivot cut out, every definition carried, the inherited paint and the file's namespaces kept) drawn by the browser at the movie's scale, cropped to what it covers, and placed as a Drawing with its own canvas, so it can be touched up in Draw & Paint. The notice names each such part and why.
- **Pivots.** An element inside the part's own art (not a nested part's) with `id="pivot"`, an id starting `pivot-`, or `data-role="pivot"` gives the pivot at its centre and is left out of the art. Without one, the part's box centre.
- **Opened as a character.** The new Group carries `character` at once (named after the file, parts by name), so an SVG opens ready to animate; Make Character is for groups built by hand.
- **Mouth charts.** An SVG whose top-level groups are named for the mouth shapes (6 or more of Rest, MBP, AI, E, O, U, FV, L / th, matched ignoring case and punctuation, so `L-th` and `data-name="L / th"` both read) opens as one Flipbook with its drawings in chart order and named as `VISEME_NAMES`, so lip-sync recognises it. `attachMouthChart` (engine) puts such a Flipbook in place of a character's `mouth` part, keeping its id, parent, pivot, Move and keys.
- **Copies.** The id remap that Paste, Duplicate and Split use (`ops.cloneContent`) and the one Duplicate Track uses (`track-ops.cloneTrack`) now also map `character.parts` and `mouth` through `relinkCharacter` in `model.ts` (kept there so `ops.ts` does not import the character code, which imports `ops.ts`).
- **Files.** `character` is a plain field, so `.fmo` and the history pack keep it as they keep any field. `normalize.ts` checks it on open: dropped on anything but a group, `parts` kept to string ids, `mouth` dropped when not a string; fields a newer build adds are left in place and written back.

## v0.25.0 · action files (.fmact)

- refers-to: io/fmact.ts (new) :: fmactBlob, fmactName, parseFmact, readFmact, FMACT_MAX_BYTES; app/action-commands.ts :: importActionFile, action-export, action-import; app/import-flow.ts :: ImportDeps.importAction, importFiles; app/app.ts :: MEDIA_ACCEPT, createImporter, actionCommands deps
- kind: decision
- logged: v0.25.0 · 2026-11-25

- **The file** is `[name].fmact`, JSON `{format: 1, action: ActionDef}`, written with one space of indent so it reads in a text editor. The name is the action's, with the characters no file system takes turned into `_`.
- **Export** is Content, Actions, Export Action...: the picker lists the character's own and the starter actions; the chosen one is handed over through the platform's download (the share sheet on iPad). A starter action exports like any other; imported, it becomes one of the character's own.
- **Import** is Import Action... (the file picker for `.fmact`), Import with any `.fmact` among the files, or a drop: `importFiles` takes `.fmact` files out first and adds each to the selected character under a fresh id, one undo step each, then imports the rest as before. With no character selected it says "Select a character, then import the action onto it."
- **The 1 MB refusal is in the window**, checked on `File.size` before the text is read, since no engine route ever sees an action file. A real action is a few kilobytes.
- **Read checks every field** (name, length, loop, lanes, each key's frame, value and ease, custom handles) and keeps only Move and Bones lanes; anything else is "That is not an action file.", a format above 1 is "This action file was made by a newer version of FormMorpheus." `.fmact` joined `MEDIA_ACCEPT`.

## v0.25.0 · actions on the Timeline: commands, strips, the picker

- refers-to: app/action-commands.ts (new) :: actionCommands, selectedCharacter, ACTION_MENU_ITEMS; ui/action-picker.ts (new) :: ActionPicker; ui/act-strips.ts (new) :: actPick, drawActStrips, actStripAt, actLabel; ui/timeline.ts :: TimelineHooks.actStrip, drawBlock, tracksDown; ui/status.ts :: StatusBar.note; app/app.ts (commands, Content menu, Timeline hook)
- kind: decision
- logged: v0.25.0 · 2026-11-25

- **Command ids** are `action-apply`, `action-swap`, `action-clear`, `action-save` and `action-delete`, in the repository's hyphen style (the plan wrote `action.save`). They sit in Content, Actions, and in the command palette. Each change runs through `engine.run`, so each is one undo step; a swap is one step (its clear and apply happen inside one run).
- **Strips are drawn on the Timeline's canvas**, not as elements. The plan asked for elements patched in place, but every block, chip and mark of the Timeline is canvas drawing redrawn on change; elements laid over a scrolling, zooming canvas would have to follow it on every frame of a drag. Drawn with the block, a strip cannot flash or lag and nothing is rebuilt. They lie along the block's lower edge, labelled with the action's name (a starter action's in the interface language), the pressed one in the accent color. No allocation per draw: one scratch pair for the edges.
- **Pressing a strip** selects the block, marks the strip (`actPick`) and opens the picker for that span: another action swaps it, Clear Action removes it. A press anywhere else on a block unmarks it. Strips of a character inside an open group are drawn but answer as the inner block they sit on; Swap and Clear reach them from the menu after a strip of the group's own block is pressed.
- **Where Apply puts an action.** With a loop range set (In and Out), from its In, and a loop repeats as many passes as fit; without one, one pass from the Playhead. Save Action takes the loop range, else the whole block.
- **Skipped parts** are named in the status line ("This character has no {parts}, so that part of the action was skipped."). The status bar's error flash gained a plain variant, `note`, so a skipped part is not shown as an error.
- **The picker** is one card built once: the character's own actions (pooled rows relabelled in place, marked `data-no-i18n` since they are the person's words), then Starter actions (built once from the data). Loops say Loop. Delete Action lists only the character's own.

## v0.25.0 · starter actions

- refers-to: engine/actions-builtin.ts (new) :: BUILTIN_ACTIONS, seq, cyc; engine/action-ops.ts :: findAction, mirrored
- kind: decision
- logged: v0.25.0 · 2026-11-25

- **Eight actions as data**, written at 24 fps (`fps: 24`, so a movie at another rate keeps their speed): Idle (a breath, loop of 48), Nod (two dips, 26), Shake head (30), Wave (raise, three swings, lower, 48), Point (36, ends holding the point), Walk in place (two steps, loop of 24), Jump (30), Sit (30, ends seated). Ids start with `builtin:`; a span names one by id, so they are never copied into the movie, and `findAction` looks in the character's own actions first.
- **Parts and sides.** Only `head`, `body`, `arm-l`, `arm-r`, `leg-l`, `leg-r`; `mouth` is never keyed (lip-sync owns it). They assume a character facing the viewer with `arm-r` and `leg-r` on the Stage's left (the character's own right). When a character's `arm-r` pivot sits right of its `arm-l` pivot, a built-in is mirrored as it is applied (x, rotation, pivot x and bone turns negated), so either way of drawing gets the same motion. Saved actions are never mirrored.
- **Rotations** are degrees around each part's pivot (shoulder, hip, neck), positive clockwise on the Stage, so the Stage-left arm rises outward with positive turns. Offsets are in pixels for a character about 1000 px tall (the starter characters' size); a much smaller one moves further for its size.
- **How the motion is made.** Every key carries an ease. Holds and extremes are eased in and out; a fall eases in (leaves slowly, speeds up) into a contact; a launch eases out. The head follows the body two to four frames late and the arms one to five (follow-through), and extremes overshoot and settle (Wave's arm passes rest on the way down, Point overshoots the line, Jump and Sit settle after landing). Arms and head move with the body's rise and fall so the shoulders and neck stay joined, since parts are siblings, not parented.
- **Loops close exactly.** `cyc` places cyclic extremes, shifted for lag; the span that crosses the loop's end is split there at its eased value, the half before leaving slowly and the half after arriving fast, so the first and last key are equal and the curve runs on through the seam. Walk in place applied for 48 frames shows the same values at 0, 24 and 48.

## v0.25.0 · actions: the model and the engine ops

- refers-to: engine/types.ts :: ActionDef, ActSpan, CharacterInfo.actions, CharacterInfo.acts; engine/normalize.ts :: characterDef; engine/action-ops.ts (new)
- kind: decision
- logged: v0.25.0 · 2026-11-25

- **Values are relative to each part's rest.** An action is reused on characters drawn at other places and sizes, so Move keys are stored as offsets: x, y, rotation, px and py are added to the part's transform (and pivot), scaleX and scaleY multiply its scale. Bone channels are degrees from rest already and apply only to a part whose rig has a bone of that id. Other lane kinds are not carried. Applying turns them into the same absolute keys the Keyframe mode writes, on the same `move` and `bones` lanes, so the Graph, the key drag and Perform see ordinary keys.
- **`fps` on ActionDef.** Not in the plan's shape: an action made at 24 fps and applied to a 30 fps movie would otherwise play faster. `atRate` spaces the key frames by the ratio and rounds; a loop's first and last key both scale exactly, so it still closes. Absent means the movie's own rate. A saved action records its movie's rate.
- **Spans count the frames the character's tracks see** (`srcFrame` of the group), not movie frames and not block frames, because that is where the parts' keys live: moving or trimming the block leaves span and keys together. A part's key frame is that frame minus the part's `start`, through any group between the character and the part. `to` is inclusive. `charFrame` turns the Playhead into it; `blockFrame` turns it back for drawing (a Time Remap lane on the character is not inverted).
- **Keys outside the span are never touched.** Applying clears the span on the channels the action keys and on the channels of any span it lands on, then writes. A span it lands on keeps only what lies outside it (cut to one or two pieces). Clearing keeps keys at frames inside the other spans, so two spans that touch at one frame do not take each other's shared key.
- **Repeats** apply to loops only; each pass's first key replaces the last pass's closing key, so the ease that leaves it is the action's own first ease.
- **Keys past the part's block** are dropped; a part block shorter than the action shows the part of it that fits.
- **Saving** (`actionFromKeys`) takes every Move and Bones channel with a key in the range, adds keys at both ends at the values shown there, and marks the action a loop when every channel ends where it starts. It does not place a span; the keys it came from stay plain keys.
- **Removing an action** drops its spans; their keys stay as plain keys.
- **Old files.** A character saved without `actions` is given `[]` on load in `normalize.ts`, so the field is required in the type and no code reads it with a fallback.

## v0.25.0 · a character as SVG for a vector app

- refers-to: io/svg-export.ts (new) :: characterToSvg; app/app.ts :: characterOut, selectedCharacter, command export-char-svg, File > Round Trips; ui/export-where.ts :: pickDestination, saveFileTo; engine/source-merge.ts :: setSourceLink
- kind: decision
- logged: v0.25.0 · 2026-11-25

- **Layout.** One `<g id="part name">` per part, nested by `parent` (a parent that is not a part of the character leaves the part at the top), bottom track first so the painter's order matches the Stage. Inside a part its own art and its child parts are ordered by their tracks; a sibling between a parent and its child cannot sit between them in a nested file, so it ends up above or below both.
- **Space.** Each part's art is written in its own content space at rest (movie pixels, the movie centre is the content centre, as `shape-draw.ts` translates), with no `transform` attribute for the part's own Move transform. Nesting by parent and the pivot circles stay.
- **Round trip with the merge (orchestrator's decision).** The importer bakes every transform it meets into the path coordinates, and Update from Source keeps each part's own transform. A first version wrote each part's rest transform as its group's `transform="matrix(...)"`; a part moved in the app then came back with the move baked into its art and kept in its transform, so it moved twice. Removed: the part's matrix on its `<g>`. Checked with the five starter characters: import, move one part and key another, export, re-import, merge: every part keeps its id, transform, keys and parent, nothing is added or missing, and the outlines, pivots and inner shapes match to 0.002 px.
- **Parts drawn with several shapes.** The importer makes such a part a Group of shapes. Its inner blocks (not parts) are written as its art, bottom track first, each `<path>` with `data-name` set to the block's name so a re-import keeps the names, and an inner block's own transform as that element's `transform` (never a `<g>`, which would read back as a nested part). An open outline's fill is not written (the renderer never draws it), so after a round trip such an outline has no fill.
- **Shapes.** A `path` is written as cubic segments straight from its BezNodes (lossless); an ellipse as two arcs; every other type as the polyline `outline()` gives, the outline the renderer fills. Fill only when the outline is closed, as the renderer does. Linear and radial gradients are `userSpaceOnUse` with the endpoints, centre and radius `shape-draw.ts` computes from the outline's box. Stroke alignment inside and outside, and trim path, have no SVG form: the stroke is centred and the outline whole. Values are the saved ones; Shape lane keys are animation and stay in the app.
- **Pictures.** Embedded as `data:` PNG on `xlink:href` (what vector apps read most widely). A non-PNG picture is redrawn as PNG when the browser can. A Drawing's leaf layers go bottom first, each at the content's canvas, with its own and its layer groups' opacity; blend modes and layer masks are not written. A Flipbook writes the first drawing of each plain row.
- **Pivots.** `<circle id="pivot-<part>" data-role="pivot" r="4">` as the last child of each part's group, in the part's own space, so it sits at the pivot after the transform. Thin outline in a magenta that art rarely uses; the importer removes it from the art.
- **Left out.** Text, video and sound parts are written as empty groups with their pivot, so the part names survive, and the toast names them.
- **Saving.** In the desktop app the folder dialog comes first (`ui/export-where.ts` `pickDestination`, as other exports to a folder), the engine writes the file there without replacing one (`saveFileTo`, `/api/save-to/file`, "Name 2" when taken) and answers its absolute path; the window asks `/api/files/stat` for it and links the character to it as one undo step, "Link Source", so later saves in the vector app update the character. Cancel in the dialog exports nothing. Everywhere else (a browser, iPad) it goes through `platform.files.download` as before: a download or the export picker gives no path, so the character is not linked and Relink Source... (desktop app) or Update from Source... does it. First version: always a download, never linked.

## v0.25.0 · Update from Source: the merge by part name

- refers-to: engine/types.ts :: SourceLink, CharacterInfo.source; engine/source-merge.ts (new) :: mergeFromSource, MISSING_HIGHLIGHT
- kind: decision
- logged: v0.25.0 · 2026-11-25

- **What the merge takes.** A part matched by name takes the fresh part's kind, `shape`, `asset`, `layers`, `canvas` and `pivot` (a field the fresh part lacks is removed, so a part that turned from a shape into a picture drops its outline). Everything else is the part's own: id, keys (Shape lane keys included), parent, rig, transform, opacity, blend, highlight, timing, name. Acts and actions live on the character, which the merge copies whole apart from `parts`.
- **A Flipbook stays.** A matched part that is a Flipbook and comes back as anything else keeps its drawings: the mouth chart is drawn in the app, and the SVG export writes only its first drawing.
- **Parts drawn with several shapes.** Such a part is a Group whose inner blocks are its art, so a matched Group takes the fresh part's inner tracks too (new inner ids; keys on those inner shapes are not kept). A Group that holds other parts keeps everything, as a Flipbook does: taking its tracks would drop those parts.
- **New parts.** Cloned with `ops.cloneContent` (the paste command's re-id), each on its own new inner track at the top of the group, in the file's order, spanning the frames the existing parts span. A new part's parent follows the file: a matched part's own id, another new part's new id, or nothing when the file's parent is not a part.
- **Missing parts.** Kept with the red highlight and returned by name, so the window can show the hint "Not in the source file". A highlight is never cleared when a part comes back: the person may have chosen red themselves.
- **Locks.** A matched part on a locked inner track refuses the whole update with the part's name; a missing part on a locked track is reported but not recoloured. A locked character track is refused by `ops.updateContent`.
- **Assets.** The optional fourth argument is the import's asset table; the records the taken and new parts use are added to `movie.assets`. Blobs stay the caller's (`engine.assets.set` and `renderer.preload`, as `app/import-flow.ts` place does). Old pictures are not removed here: undo needs them, and the engine's sweep of stray pixels lets them go.

## v0.24.0 · the interface's test suite

- refers-to: vitest.config.ts (new); tests/unit/** (new); tests/unit/_support/* (new); tests/unit/version.test.ts (new); package.json :: scripts.test, devDependencies; ../setup/test (new); ../docs/TESTING.md (new)
- kind: decision
- logged: v0.24.0 · 2026-11-23

- **Asked for by the owner.** The rule that tests are written only when the maintainers ask still stands; this version is that ask. `docs/TESTING.md` says what a test must do.
- **Runner.** vitest 5.0.5 with happy-dom 21.0.4, both MIT, both development only and never shipped. `vitest.config.ts` stands alone: it does not load `vite.config.ts`, so no dev server and no proxy are involved, and `npm test` is `vitest run`, which listens on nothing.
- **Layout.** A test mirrors its source path under `tests/unit` and imports through the `@src` alias. Stand-ins shared by several tests of one area live in `tests/unit/_support`, one file per area.
- **No `new URL(x, import.meta.url)` in a test.** Vite treats it as an asset import and refuses a file outside the root (the first run of `version.test.ts` failed that way on `AGENTS.md`). Tests that read a repository file build the path with `node:path` from `fileURLToPath(import.meta.url)`.
- **What happy-dom lacks.** No canvas context, WebGL, WebGPU, AudioContext, OffscreenCanvas, ImageBitmap or codecs. Tests stub only what the code under test touches; code that is only those calls is left to `setup/window_check`.
- **Version sites.** `tests/unit/version.test.ts` reads every site (interface, package and lock files, engine, desktop shell, iPad project, API contract, changelog, README badge) and holds them equal, so a bump that misses one goes red.
- **The lock file** was written with `--legacy-peer-deps`: npm 10.9.9 fails in its peer set loader when vitest is added to this tree without it. `npm ci` from the written lock file was run in an empty folder and installs cleanly.
- **Type check.** `tsconfig.json` still includes `src` only, so `tsc --noEmit` does not read the tests.

## v0.23.1 · the product's name, and every table complete

- refers-to: app/app.ts (Help and About labels); app/capability.ts; export/audio-export.ts, route.ts, engine-jobs.ts; io/api.ts :: NOT_RUNNING; io/fmo.ts (two errors); io/formvis-doc.ts, kra-import.ts, ora-import.ts, pdn-import.ts, psd-import.ts, layered-import.ts, round-trip.ts, tiled-artwork-import.ts, recovery.ts; media/import.ts, transcode.ts, recorder.ts; ui/about-dialog.ts, help-center.ts, help-view.ts, home.ts :: brandRows, library-folder.ts, native-menu.ts, settings-dialog.ts, theater-flip.ts, whats-new-data.ts; ui/i18n/*.ts (all 29 tables beside English)
- kind: decision
- logged: v0.23.1 · 2026-11-22

- **Sentences say FormMorpheus.** Every English source string that named the product in a sentence (errors, notices, Help, About, the native menu, What's New) now writes it the way the family writes product names in prose: FormMorpheus. The keys changed with them, so each table's entry was renamed and its value written with the new name in that language.
- **Wordmarks stay lower case.** The title bar (`cv-tb-app`), the About wordmark (`fm-about-name`) and the Home brand button keep "formmorpheus", the way FormVis writes "formvis" in the same places. They are marked `translate="no"` or carry no key, so no table holds them.
- **About says who made it.** Under the wordmark, "by nodemode.ai" (lower case, `translate="no"`), as FormVis's About does. The copyright and publisher (NodeAgentc, Inc.) are in the bundle metadata, not in the window.
- **What stays lower case on purpose.** The `.fmo` manifest's `app` field is still checked against `formmorpheus`; it is a file format value, not a sentence, and changing it would refuse every movie already saved. The command `./formmorpheus`, the data folder name and the MCP server name are names a person types or a program reads.
- **Two set names that were already other words.** The tables are keyed by the English text, so one English word has one translation. "Markers" (the Classic set id `drawing`) was also the paint HUD's brush size markers, and "Light" (`luminance`) was also the light theme, font weight 300 and a colour group; in several languages the set showed as "labels" or "light colour". They are now "Pens and markers" and "Glow" (`paint/brushes.ts` CLASSIC_SETS). `brush-store.ts` treats a stored `drawing` set still called "Markers" and a `luminance` set still called "Light" as unrenamed, so they take the new names; any other name is the person's and is kept. The other set names were checked against every string the interface translates: Charcoal, Grain and Pencil also name a tip or a setting, with the same meaning, so they stay.
- **Tables.** Before this version each of the 29 tables beside English was missing about 246 entries (the dock and agents strings from v0.22.0, Video Tools, the new frame rate and brush names, What's New, and the renamed sentences); a missing key fell back to English. All are filled now. Rules the translators followed: FormMorpheus, FormVis, FFmpeg, ffmpeg, MCP, ProRes, HEVC, H.264, MP3, GIF, PNG, iCloud Drive, Claude Code, Codex, Cursor, Antigravity and other names stay as written; placeholders such as `{version}` stay exactly; the dock strings already translated in FormVis's tables were taken from there so the family reads the same; Arabic is written for right to left with no direction marks added.

## v0.23.0 · iPad: video conversion and the iCloud Drive library

- refers-to: platform/types.ts :: FeatureFlags.soundConvert, pictureConvert; platform/desktop.ts, ipad.ts (features); media/transcode.ts :: transcodeViaEngine, showsAlpha; media/import.ts :: importTimed; ui/theater-storage.ts :: mountIpadPlace, icloudOff; ui/home.ts (cloud entry mounted on every platform)
- The Swift side and the reasons are in `ios/HASHOUT_LOG.md` under the same version.
- **Conversion on iPad.** The iPad engine now answers `/api/transcode` for video (AVFoundation). Two new flags keep the other kinds off it: `soundConvert` and `pictureConvert` are true on the desktop and false on iPad, and `transcodeViaEngine` throws a plain sentence for them before any upload. A converted file named by its mime: `video/quicktime` (the iPad's HEVC with alpha) gets `.mov`.
- **Transparency check.** When the engine says the result has alpha, `showsAlpha` decodes the first frame at 64 x 64 with mediabunny's `CanvasSink` (`alpha: true`) and looks for any alpha under 250. A clear "no" adds a notice to the import (the iPad's decoder may drop alpha); an error or no frame says nothing. It runs on the desktop too, where VP9 with alpha decodes with alpha, so it stays quiet there unless the first frame of the clip is fully opaque.
- **Home on iPad.** The two storage entries are "On This iPad" and "iCloud Drive" (`mountIpadPlace`); a tap moves the library there through `flipHome` and `flipToCloud`, nothing is copied, and `is-here` follows `GET /api/system/library`. With no iCloud folder the toast picks a sentence from the engine's `icloudState` (signedOut, unavailable, checking). The storage entry starts with `is-here` set, as before, and is patched in place once the engine answers. Preferences keeps its Library button hidden on iPad.


- refers-to: ui/video-tools.ts (new) :: VideoToolsPage, ffmpegChip, openVideoTools, FFMPEG_MISSING, VIDEO_TOOLS_CHANGED; styles/video-tools.css (new); ui/settings-dialog.ts :: SECTION_ORDER, railIcons, Video Tools panel, show; ui/export-dialog.ts :: noFfmpeg, sync, constructor (prefetch, listener); ui/audio-export-dialog.ts :: mp3Chip, mp3Missing, open, readMp3, paintMp3; app/app.ts :: fm:open-settings; index.html (stylesheet link)
- kind: decision
- logged: v0.23.0 · 2026-11-22

**Preferences, Video Tools** (desktop only, left out on iPad the way Agents is). Two groups. ffmpeg: which one is used ("ffmpeg 7.1.5, the downloaded build" or "..., installed on this computer", or "ffmpeg was not found on this computer."), its path, and five marks: ProRes and ProRes 4444, HEVC, HEVC with transparency, H.264 by the engine, MP3. Download ffmpeg: one sentence with the version, the size, the source and the licence filled in from the engine's record ("Downloads ffmpeg {version} (about {size} MB) from the formai-binaries releases on GitHub. Its licence is {licence}. It is a separate program that FormMorpheus runs, not a part of FormMorpheus."), a sentence on what the build cannot do, Download ffmpeg, Cancel or Remove, a bar and one status line. GitHub is named because the owner asked that the source be said plainly. Remove asks first.
**No layout shift.** Everything is built once. The path line keeps a no-break space when empty, the status line has a minimum height, the bar is hidden with `visibility`, each mark holds both icons and a class shows one, the two buttons have one minimum width so Cancel and Remove take the same room, and the sentence starts with the values the engine will send (7.1.5, about 12 MB) so it does not change length when the state arrives. Measured in Chromium at 1440 x 900: the section's box was identical before and after a whole download, and no layout shift without input from opening Preferences at the panel through the end of the download.
**Progress.** The page polls `GET /api/video-tools` every 400 ms only while a download runs, and stops when it ends. When a download ends or the build is removed it sends `fm:video-tools-changed`; the Export dialog listens and reads `/api/jobs/capabilities` again, so its codec list is right the next time it opens with no engine restart.
**The Export dialog.** The codec select still marks ProRes and HEVC unavailable with the engine's reason in the option, which now reads "ffmpeg was not found. Get it in Preferences, Video Tools." Under the codec row, on its own line across the card, a notice built once and hidden: "ProRes and HEVC need ffmpeg, which is not on this computer. Get it in Preferences, Video Tools." The manual uses the same words. It shows for a video format on the desktop when the engine answers with no ffmpeg (not when the engine is not running, which is another problem). Clicking it closes the Export dialog, since it sits above Preferences in the overlay, and sends `fm:open-settings` with the section; `app.ts` opens Preferences there. The dialog reads the capabilities once when it is made, so the notice is already set when the dialog first opens and never appears late. First tried inside the codec row's value column, where it wrapped to seven lines; moved under the row.
**Checked in Chromium** (Playwright, the build served by the engine, PATH without ffmpeg, a fresh data folder): the notice is visible the moment Advanced opens, with the option texts above; clicking it closed Export and opened Preferences with Video Tools marked and its card at the top of the scroller; Download ran to "Installed in the data folder (29 MB)."; Export opened again had no notice and ProRes and HEVC enabled. Not seen in the desktop shell or on macOS or Windows.
**MP3 in Export sound.** The same notice (`ffmpegChip` with a second sentence, `MP3_MISSING`) takes the place of the MP3 note when MP3 is chosen and the engine answers with no ffmpeg that has an MP3 encoder: "MP3 needs an ffmpeg with an MP3 encoder, which is not on this computer. The downloadable build has none, so install your own. See Preferences, Video Tools." It covers both no ffmpeg at all and the downloaded build, since the family build has no MP3 encoder; telling the person to download it would not give them MP3. The manual quotes it. Clicking it closes Export sound and opens Preferences at Video Tools. With the engine not running, the old note stays. To keep the notice from appearing late, the dialog's first opening waits for `/api/jobs/capabilities` (a local call) before it shows; later openings show at once from the last answer and read again. `fm:video-tools-changed` reads again too. Checked in Chromium with MP3 as the kept format and no ffmpeg: the notice was set the moment the dialog showed, no layout shift without input, Export disabled, WAV hid it and MP3 brought it back, and clicking it opened Preferences at Video Tools above the Export dialog. The case of the downloaded build (ffmpeg found, no MP3) follows the same test and was not seen separately in the browser.
**Windows HEVC.** No family repo has argument lists for `hevc_amf`, `hevc_mf`, `h264_amf` or `h264_mf` (see the backend entry), so the engine's encoder choice is unchanged. The build sentence now reads "This build makes ProRes, and HEVC where the computer has a hardware encoder FormMorpheus can use (on Windows, only some graphics cards). It has no MP3 or H.264 encoder; for those, install your own ffmpeg."

## v0.23.0 · FormMorpheus's own names

- refers-to: paint/brushes-animation.ts :: ANIMATION_SETS, set; paint/brushes.ts :: CLASSIC_SETS, OLD_SET_NAMES, classicName, BRUSHES; ui/brush-store.ts :: starterSetId, defaults, adopt; ui/home.ts :: rateName, PRESETS; paint/brush-materials.ts :: SET_GRAIN, withMaterials; paint/dry-media.ts :: dryFloor; ui/paint-size.ts :: defaultSlider; ui/brush-glyphs.ts :: BY_NAME; paint/types.ts :: Brush.set; engine/time.ts :: FPS_PRESETS; ui/fps-label.ts; io/tiled-artwork-import.ts (renamed) :: isTiledArtwork, readTiledArtwork; media/import.ts :: Sniff, sniff, importMedia; ui/i18n/*.ts; setup/lint_text
- kind: decision
- logged: v0.23.0 · 2026-11-22

**Animation brush sets.** The eighteen set names and their order matched another vendor's published set, so they are named for what their brushes are and grouped dry media, lines and inks, wet media, then texture and effect: Pencil (was Sketch), Pastel (Chalk), Line art (Outline), Even line (Monoline), Boiling line (Wiggle), Pens (Ink), Lettering (Script), Watercolor (Wash), Thick paint (Paint), Rough brush (Bristle), Spray (Airbrush), Dabbing (Sponge), Grain (Noise), Surfaces (Texture), Stamps (Graphic), Motifs (Pattern), Geometric (Metro), Scenery (Environment). `set(key, name)` takes the first name's slug as a key that never changes: brush ids stay `an-<key>-<brush>` (so `an-sketch-lead-stub`, the first pen, saved movies, slots and the recent list still resolve) and set ids stay `anim-<key>` (the id in `.order.json` and the saved library). Only the shown name moved.

**Saved libraries.** `adopt` renames an Animation set whose id is `anim-<key>` and whose name still slugs to that key (the first name, read from the folder or the browser copy) to the current name; a set the person renamed keeps its name. The next save moves the folder (`Brushes/Animation/Sketch` to `Brushes/Animation/Pencil`) through `brush-disk.ts`, which matches folders by set id. A starter brush the library has not seen yet joins its set through `starterSetId`, which looks the name up in `ANIMATION_SETS` or `CLASSIC_SETS`. A saved library keeps its own set order; only a fresh library or Reset takes the new order.

**Classic brush sets.** The Classic list was the other vendor's default list in order and wording, so it gets its own names and order too, clear of the Animation names: Graphite (was Sketching), Charcoal (Charcoals), Markers (Drawing, which also holds the folded Touch-ups brushes), Comic ink (Inking), Nibs (Calligraphy), Studio paint (Painting), Wet media (Water), Mist (Airbrushing), Graffiti (Spraypaints), Mark making (Artistic), Grit (Textures), Finishes (Materials), Printmaking (Vintage), Metalwork (Industrial), Shapes (Abstract), Light (Luminance), Atmosphere (Elements), Nature (Organic). Classic brush ids never held a set name and are unchanged. `CLASSIC_SETS` keeps each stored set id as the slug of the full name it shipped under (`sketching`, `drawing`, `spraypaints` ...); the row names in `RAW_BRUSHES` stay as internal keys and `classicName` turns them into the shown name. `OLD_SET_NAMES` now maps the old short names straight to a stored id (Sketch to `sketching`, Touch-ups to `drawing`): `adopt` first moves a set saved under a short name to its id, as before, then the same rename step as the Animation sets gives every starter set whose name still slugs to its id the current name, so a set the person renamed keeps its name and the next save renames its folder. Behaviour kept: `SET_GRAIN` (graphite, charcoal, wet media, grit, finishes), the line-tool range (comic ink, markers, nibs), `dryFloor` (charcoal), the glyph table, and the cloud start size (Mist still matches "mist" where Airbrushing matched "air").

**Home size cards.** The 12 and 15 fps cards took the old preset words; they now read their name from `FPS_PRESETS` (`rateName`), so they show On twos and Web and GIF and follow any later label change. Only the shown name changed; a card creates the same size and rate.

**Behaviour kept.** The starter recipes read the set name once when the library is built: `SET_GRAIN` (pencil, pastel, watercolor, surfaces, grain), the line-tool size range in `withMaterials` (line art, even line, lettering, pens), the pastel floor in `dryFloor`, and the cloud start size in `defaultSlider` (`^spray ` stands for the old "air" match on the set; it does not catch the Classic Spraypaints set). The glyph table follows the new names. Every Animation brush gets the same tip, grain, size range and floors as before.

**Frame rates.** The preset labels were the other vendor's list: 12 On twos (was Frame by frame), 15 Web and GIF (Anime), 24 Film (Cinema), 30 Video (Television), 50 Smooth (Europe) (PAL), 60 Smooth (NTSC), 120 Extra smooth (Mobile). 25 Video (Europe) is new, for European video, so a 25 fps movie shows its preset in Movie Settings instead of Custom. A movie stores only its number, so nothing stored changes; the New Movie dialog and Movie Settings build their options from `FPS_PRESETS` through `fpsText`.

**Translations.** Keys no source string uses any more were removed from the 27 full tables: Monoline, Wiggle, Script, Wash, Graphic, Pattern, Environment, Metro, Cinema, Television, Mobile, then Sketching, Inking, Artistic, Calligraphy, Airbrushing, Textures, Abstract, Charcoals, Elements, Spraypaints, Vintage, Industrial, Organic, Water, Frame by frame and Anime (also from es-MX); Sketch, Chalk, Ink, Paint, Bristle, Sponge, Airbrush, Noise, Texture, Outline, Drawing, Painting, Materials and Luminance stay, other strings use them. The new names have no entries yet and show in English.

**The layered artwork reader.** The reader that was named after its file extension is now `io/tiled-artwork-import.ts` (it reads zipped artwork whose layers are compressed tiles), with `isTiledArtwork`, `readTiledArtwork` and the sniff kind `'tiled-artwork'` (they too carried the product name). The extension `.procreate` stays: it is the format's identifier and what people look for.

**The text lint.** Banned names match whole words in any case. A match spelled all in lower case directly after a dot, or as the whole text of a plist `<string>`, is a file format and passes.

## v0.22.0 · the shared dock and the window side of agents

- refers-to: dock/ (shared module, MANIFEST.json); dock-adapter.ts; app/agent-bridge.ts :: startAgentBridge; app/app.ts (dock creation, commands, bridge start); ui/settings-dialog.ts :: Agents panel, loadAgents; index.html (dock boot, four stylesheet links); styles/dock-tokens.css, terminal.css, dock-host.css; styles/onboarding.css (.fm-tour-ring, .fm-tour-card); styles/shell.css :: .cv-st-dims; ui/status.ts :: syncDims; vite.config.ts (/mcp proxy); package.json (@xterm/xterm 6.0.0, @xterm/addon-fit 0.11.0)
- kind: decision
- logged: v0.22.0 · 2026-11-22

**The module is not ours to edit.** `dock/` is the family's dock, version 2.2.1, copied whole from FormVis (FormDeck's copy is identical) and checked by `./formmorpheus agents sync --check` against its `MANIFEST.json`. Everything FormMorpheus-specific is in `dock-adapter.ts`: the words (app name, noun, example), three sentences replaced (`empty`, `tourChatBody`, `tourPanelBody`, since FormMorpheus has no chat pane), placement, the terminal and agent routes, consent, the stored choice. xterm 6.0.0 and its fit add-on are the versions FormDeck and FormVis pin.

**No flash when the dock opens or at first paint.** An inline script in `index.html` runs before any stylesheet and writes `data-ft-dock`, its side and size, and `--ft-dock-size` onto the root from `localStorage['formmorpheus.dock']`, with the module's own limits (height 140 px to 70% of the window, default 280; width 460 to the smaller of 60% and the window minus 440; the right side only from 900 px). The module computes the same numbers when it mounts, so nothing moves. `.cv-app.fm-app` has four fixed rows and two columns; the dock is mounted once before the status bar while `#app` is still hidden. Opening, closing, moving and resizing change only those root attributes and variables. While the dock is open the Theater ends above it and notices move up out of its way.

**Keys.** The dock opens on Mod+` only: FormDeck's Mod+J is Movie Settings here. `Shift+Mod+~` sits beside ``Shift+Mod+` `` because the app names a key from `e.key`, and Shift+` arrives as ~ on a US keyboard. Seen in Chrome: every letter, digit, punctuation, Space, Delete, Backspace, arrows, Home, Tab, Escape and Enter typed in a shell tab reach the shell with a movie open, and focus stays in the terminal. The other capture listeners were read, not each tried.

**The window bridge** (`app/agent-bridge.ts`). It long-polls `/api/mcp/bridge/next` for as long as the page lives, waiting 3 seconds after an error. A `consent` item goes to the dock's consent box through `outsideAgents.show`; the answer goes to `/api/agents/consent/{id}`, not to the bridge. `export_movie` opens the named movie when another one is in front (refused while an export runs), commits an open Draw and Paint session, then exports with the Export dialog's own paths: an engine job for ProRes, HEVC and H.264, otherwise the routed export, written to Exports under the asked name. The job shows in the status bar and Jobs list and can be cancelled there. `import_file` reads the bytes from `bridge/file/{id}`, places them with the importer as a drop on the Timeline (at the asked frame and on the named track when given), and saves. Only one agent request runs at a time; a second is answered at once with a sentence to try again.

**The stored choice lives in the engine.** The adapter reads `GET /api/agents` and writes `POST /api/agents/choice`; nothing about agents is kept in local storage. Questions still waiting are shown again after a reload from `GET /api/agents/consent`.

**Preferences, Agents.** Outside agents (Ask, Allowed, Blocked), the MCP address built from the page's own port (the Vite server now proxies `/mcp` as well as `/api`, so the address is right from source too), the standard input and output command, and Open the Terminal Panel. The panel is left out on iPad, where there is no dock.

**Two layout jumps found while checking agent work, both fixed.** The first-run tour's ring and card moved with `left` and `top`, which counts as a layout shift; they move with `transform` now. The status bar's movie size field grew with its text, so the hint beside it slid right when a movie opened without a click (an agent's export); the field has a fixed share of the bar now, clipped with an ellipsis and the full text as its tooltip.

## v0.21.0 · the family look

- refers-to: styles/tokens.css and 55 feature sheets; ui/themes.ts; index.html (theme boot); ui/prefs.ts :: applyUiFontSize; ui/home.ts; ui/shell-opts.ts; styles/theater-wall.css; ui/dropdown.ts :: fill; ui/menu.ts :: PopupMenu.setItems, dispose; ui/paint-quick.ts :: menu
- kind: decision
- logged: v0.21.0 · 2026-11-22

The reference is FormVis 2.8.1 `frontend/src/styles/tokens.css` and `ui/themes.ts`, compared by reading (the family's audit script was not available). Counts are greps over `src/styles` leaving out `tokens.css` and `light-mode.css`.

**Counts.** Lines with a colour literal (`#hex`, `rgb()`, `hsl()`): 242 before, 0 after. Raw numeric `z-index`: 32 before, 0 after. `border-radius` in raw px off the radius scale: 90 before, 22 after; the 22 are 2 px or more from any token (14, 16, 20, 22, 26 px and six 1 px hairlines) and stay as they are until a design decision names a token for them.

**Token values now equal FormVis's** for every name both files declare: `--text-muted` #8c8b8d to #717072; `--radius-xl` 18 to 12 px; `--fs-9` to `--fs-18` each one pixel smaller, so each equals its number (`applyUiFontSize` in `prefs.ts` scales from the same numbers); `--glass-bg` 99% to 82%. Added with FormVis's values: `--z-under`, `--z-local-2`, `--z-local-4`, `--z-local-5`, and the `:root[data-oled]` block. `themes.ts` had its own lighter `--text-muted` in 16 profiles; they are FormVis's values again, which is also what the boot table in `index.html` already held, so first paint and the loaded page now agree.

**Names FormVis lacks, kept, and why.** `--dur-pop`, `--dur-dialog`, `--dur-fast`: the popover, dialog and scrim timings. `--glass-menu-bg`, `--glass-menu-filter`, `--glass-pop-border`: the popover and menu glass and its hairline. `--radius-2xl` (24: Stage, Timeline, dialogs), `--radius-pop` (18: popovers, menus, cards), `--radius-row` (12: rows and tabs). `--fs-body`, `--fs-title`, `--fs-ruler`: declared, read by nothing; candidates to remove. New here: `--glass-solid-bg` (99%; the log of FV-210 says dense glass was chosen so that panels over a white canvas read as one piece, so every panel that used `--glass-bg` for that now reads this), `--shadow-color` (black; shadows, scrims and darkening mixes are `color-mix` on it), and one token per content colour, each with the old literal's value: layer labels (`--label-*`), track highlights (`--fm-hl-*`, which were declared three times and are now declared once), guides and safe areas (`--guide-*`, `--safe-*`), the picker (`--picker-*`, `--hue-stops`), paper, ink, matte and checker colours for previews. Content colours are the same in every theme on purpose.

**How a literal was replaced.** An exact token of the same role when there was one; what FormVis writes for the same rule; a white wash as `color-mix(in srgb, var(--text-primary) N%, transparent)` so that it turns dark on a light theme; black with alpha as a mix on `--shadow-color`.

**`--radius-xl` rule by rule.** Stays `--radius-xl` and is now 12 as in FormVis: the welcome card, the Preferences rail and section cards. Rules that meant 18 moved to `--radius-pop` and look as before: the floating panels (sound effects, voice, media bin, bones, paint panels, crop bars, the tour card), the New Movie and export cards, the shortcuts layout, paint settings rows. Raw 12 px rules became `--radius-xl` with no visual change.

**`z-index`.** Each raw number became a layer token that keeps every pairwise order inside its stacking context: -1 to `--z-under`; 2, 4 and 5 to `--z-local-*` where FormVis uses the same numbers; inside the colour panel, the brush library, the layers panel and the exposure sheet the small numbers were shifted up together onto `--z-local-2/4/5` and `--z-raised`, ties resolving by DOM order as before.

**Georgia.** `.fm-tc-i` in `text-card.css` is the "I" on the Italic button, interface chrome and not a preview of the person's text, so it uses `--font-ui`, still italic.

**What looks different in the default dark theme.** Muted text is darker; text set with `--fs-*` is one pixel smaller; the three `--radius-xl` surfaces are 12 px; four rules render glass at 82% (the navigator zoom strip, the two drag ghosts, and the Action menu's arrow, which now matches its card); status colours use the family's `--ok`, `--warn` and `--danger`; chips have a border in `--border-color` (they read undeclared `--border`, `--text` and `--accent` before, so the border fell back to the text colour); 1 px radius roundings (2 to 3, 5 to 4, 7 to 6, 9 to 8).

**To look at on a light theme.** The faint grid and glow around the Stage frame (`stage-box2.css`) and the glow of the Home primary button are now mixes of the text and call-to-action colours, so they are dark on light where they were invisible white.

**Left.** `panels.css` reads `--dyn-track`, which nothing sets (a rule from FormVis that never applies here). Colour words inside data-URI masks stay: they are image content.

**The 29th profile and the accent.** `amoled` is FormVis's profile, in `themes.ts`, in the boot table and as `data-oled` on the root element before first paint (the boot comment said "same 14 ids"; it says 29). `applyTheme` now also removes a custom property the previous profile set and the new one does not, as FormVis's does. The default accent is `#857cf3`, the hue formai.studio, FormPortal and FormTray give this app, in `tokens.css`, `themes.ts` and the boot script, and as the fallback where a canvas reads the accent. Appearance generation 4: a saved choice keeps its theme, intensity and any accent the person picked; an accent that was only the default of its day (lavender, then orange) becomes the violet. Checked in Chrome: a generation-3 choice with the light theme and the orange default opens light, with the violet accent, at first paint with layout shift 0.

**Home.** The Theater had two layouts: Gallery (a poster wall with the nav as a drawer) and Library (a standing nav column). The family's Home (FormVis `ui/home.ts`, FormDeck `ui/home.ts`) is a standing column with the brand at its top, sections with counts, Create, and Preferences and Help at its foot, every page built once and shown or hidden. Library is now the default and the column spans the full height with the brand (`.cv-home-brand`, which opens the same About menu as the wordmark) at its top; the top bar sits over the main area only. Gallery is still in Preferences, General, Theater, and a stored choice is kept. The five pages are five nodes that are only hidden and shown; switching them measured layout shift 0.

**Preferences.** Already the family's node wire dialog (a floating rail of tabs outside the dialog's left edge, one SVG wire from the chosen tab to a port on the dialog, every panel a card in one scroller); checked against FormVis `ui/app-dialogs.ts` and `styles/dialogs.css` and left as it is. Every setting of the app is a panel there; no setting sits on a page of its own.

**Three live rebuilds patched in place.**
- `dropdown.ts` `fill` emptied the list and rebuilt every row on each open and each search keystroke. Rows are now kept in a map by option value (heads by group label) and reconciled against the select's options: reused when the option is still there, created only for new ones, removed only when gone, moved with `insertBefore` only where the order differs. Filtering toggles `hidden` (plus an inline `display: none`, since `.cv-dd-item` sets `display: flex`) and the state classes. No caller passes a search field today, so that path is correct by reading only.
- `paint-quick.ts` `menu` rebuilt its four rows on every open. They are built once; each handler reads `this.last` when clicked.
- `menu.ts` `PopupMenu.setItems` emptied the panel and rebuilt every row, separator and submenu when the items changed. It now matches command rows by id, submenus by label and separators by position, updates what is kept in place, and removes only what is gone (`dispose` also removes nested submenu panels, which leaked before). A kept submenu that is open stays open.
- FormVis's `dropdown.ts` and `menu.ts` rebuild the same way; nothing was taken from them.

## v0.20.0 · the window key in the interface, and the catch blocks

- refers-to: io/window-key.ts; main.ts; app/capability.ts :: showUnsupported, KEY_TAKEN; ui/pen-link.ts :: attach; io/recovery.ts :: hold; ui/perform-ui.ts; ui/paint-settings.ts; platform/ipad-memory.ts; vite.config.ts
- kind: decision
- logged: v0.20.0 · 2026-11-22

- **The key.** `io/window-key.ts` is FormDeck's module with this app's names. `loadWindowKey` runs before anything else in `main.ts`: it takes the key the desktop shell left on `window` (and deletes it from there), else one kept in `sessionStorage` that still works, else claims one from `POST /api/window/key`. With a key it wraps `window.fetch` once so that every same-origin request under `/api/` carries the header; nothing else in the interface had to change, because every engine call already goes through `fetch` on the main thread (checked: no `src` or `href` points at `/api`, and no worker calls it). The two sockets build their address with `socketUrl`, which asks for a one-use ticket first. On iPad the claim gets a 404 from the native engine and the interface runs without a key, as before.
- **A second tab says why.** From source the engine gives its key once. A second tab would have loaded and then failed every call with 403. `keyTaken` asks the open `GET /api/window/key`, and `main.ts` shows one message in the existing cannot-start box ("FormMorpheus is already open in another window") in place of starting the app. `showUnsupported` gained a title and a switch for the system-requirements line. Two new sentences have no translation yet.
- **Catch blocks.** The audit counted 54 silent catches. By grep at this commit there are 0 empty ones, 195 whose body is a comment giving the reason, and 81 that return a fallback. The reasons fall into: storage blocked or full, so the choice lasts the session (about 60); a pointer capture, URL or handle already released (about 30); an answer that is not JSON, so the status text is used (9); the engine not answering, where the caller already shows that (about 10); and one-off fallbacks each named in place. Four said only "ignore": the two storage writes in `perform-ui.ts` and `paint-settings.ts` now say what they are, and the two listener loops in `ipad-memory.ts` now report the failing listener with `console.warn` and carry on, since a listener that throws is a fault worth seeing.
- **No source maps** in a production build (`sourcemap: false`).

## v0.19.0 · the reveal hands over the page's colour

- refers-to: ui/dom.ts :: revealApp; public/splash.html
- kind: explainer
- logged: v0.19.0 · 2026-11-22

`revealApp` told the shell `app_ready` one frame after `app-ready` was set on the body. It now waits for the fonts (at most 1.5 seconds, so a font that never loads cannot hold the window back), then one frame, and passes the body's computed background colour as `bg`. The shell paints the native window with it before showing it, so a light theme opens on a light frame (FormDeck's `revealApp` does the same). In a browser nothing changes: the function returns before any of this when there is no Tauri. The splash's bar gained `role="progressbar"` and a label, as FormVis's and FormDeck's have.

## v0.18.4 · Help links and installs from the lock file

- refers-to: ui/external-link.ts :: SITE_URL; ui/help-center.ts :: buildStart; ui/help-setup.ts :: setupHelpCenter; app/app.ts (Help menu); oc_install, oc_install.bat
- kind: decision
- logged: v0.18.4 · 2026-11-22

**Help links.** `HELP_LINKS` held five addresses under `github.com/nodemode-ai/formmorpheus` (wiki, discussions, issues): the wrong owner, and a repository a signed-out visitor cannot open. The owner's rule: Help opens the manual bundled in the app, one web link goes to `https://formai.studio/formmorpheus/`, and no link points at a private repository. So `HELP_LINKS` is gone and `SITE_URL` is the one address. In the Help Center's "On the web" row, Manual and Send an idea switch to those tabs of the same window (`pick`, no close and reopen), and "FormMorpheus on the web" opens the site in the system browser. The three menu commands `help-web-handbook`, `help-web-community` and `help-web-tutorials` are replaced by one, `help-web`. Removed labels: "Handbook on the web", "Community", "Video tutorials", "Education and learning", "Idea board", "Handbook on the Web", "Video Tutorials"; their rows stay in the language tables until the tables are next gone through. New labels with no translation yet: "FormMorpheus on the web", "FormMorpheus on the Web", and the new lead sentence.
**Lock file.** `oc_install` and `oc_install.bat` ran `npm install`, which may rewrite `package-lock.json` instead of obeying it. Both run `npm ci` now, as CI already did, and so do `../build_app`, `../build_app.bat`, `../setup/desktop_dev` and `../setup/ios`. A lock file that disagrees with `package.json` now stops the install. To change a package: edit `package.json`, run `npm install` once by hand, commit both files.

## v0.18.3 · tauri packages

`src-tauri/Cargo.lock` resolves the `tauri` crate to 2.12.5, and Tauri's build stops when the crate and `@tauri-apps/api` differ in minor version, so `package.json` now pins `@tauri-apps/api` 2.12.5 and `@tauri-apps/cli` 2.12.5 (were 2.11.1 and 2.11.4), the same minor line as the crate. There is no `@tauri-apps/plugin-*` package here: the interface reaches the dialog and shell plugins through `invoke` from `@tauri-apps/api/core`, so only these two needed to move. `package-lock.json` was refreshed by `npm install`. When `Cargo.lock` moves to another minor line, move both packages with it.

## v0.18.0 · review

Files: `platform/bridge.ts`, `platform/index.ts`, `platform/ipad-menu.ts`, `platform/ipad-pencil.ts`, `platform/ipad-shell.ts`, `ui/diagnostics-dialog.ts`, `styles/ipad-window.css`.
- Desktop leak in `styles/ipad-window.css`: the sheet is imported by `ipad-shell.ts`, which `app.ts` imports on every platform, so its `@media (max-width: 719px)` and `559px` rules applied to a narrow desktop window (the Tauri window may be 360 px wide). Every selector now leads with `html.is-ipad`, and the body safe-area padding too. `platform/index.ts` adds `is-ipad` to the root at load (iPad only), so the first paint already has the insets.
- Bridge replay (`platform/bridge.ts`): the shell hands its queued early messages to the first function set on `__fmNative.receive`, which happens while the bridge is created, before any `on()` exists, so they were dropped. Messages that arrive during that replay and have no handler wait per type (at most 200, 8 s) and go to the first handler added for their type.
- Key swallowing (`platform/ipad-menu.ts`): a text field no longer loses Cmd+Arrow (caret to line start or end) and the like. In a text field only the standard edit combos (undo, redo, cut, copy, paste, select all) are swallowed and replayed; for every other owned combo the real key stays with the field, and the `command` message is dropped there.
- `pencilRoll()` returns 0 at once off the iPad (it ran `performance.now()` on every desktop pointer move). `ipad-shell.ts` and `diagnostics-dialog.ts` fill their placeholders through `tf()` (the first used `t().replace`; the second had a literal " samples").
- Checked unchanged on the desktop: every hooked constant against 933957f (gpuTexture 512, pool 64, bitmaps 1024, preload 384, frame store 384, video 768, thumbs 48, lanes 4, paint history 1024, dense 512, mirror 768, tips 96, audio bus 96e6, fx 48e6, flat area 48, gif 1.5 GiB, decode 512 MiB, export ahead 4, ghosts 24, onion cap 12 equal to the slider maximum), undo depth Infinity. Chromium 1440x900 against a 933957f worktree: Home, new Flipbook, stroke, play, Preferences and Pen and Tablet (pixel identical), About (only the icon differs), an MP4 and a GIF export (both saved).
- Noted, not changed: the paint worker (`paint/paint-worker.ts` through `tips.ts`) cannot see `__FM_PLATFORM__`, so on iPad its tip cache keeps the desktop 96 MiB cap. `diagProgress` has no handler in `ios/Web/Diagnostics.swift` (dropped silently). On iPad the Pencil rows and the other new labels are plain literals translated by the page translator, as the existing Pen and Tablet rows are.

## v0.18.0 · paint narrow

Verifier row A22. Files: `ui/paint-narrow.ts` (new), `styles/paint-narrow.css` (new, linked in `index.html` after `paint-tools16.css`), two lines in `ui/paint-view.ts` (import, `mountPaintOverflow(this.root)` after the menu lookup). Decisions: the bar's buttons are not moved or rebuilt. At 800px and below the four words and the frame label hide and a More button (built once, hidden above 800px by CSS) opens a panel whose rows press the hidden originals (Settings, Filters, Select, Transform); at 600px and below the mode pill loses its name and Eyedropper and Fill join the panel, so the four tools and the color well always show. At heights of 760px and below the size and opacity sliders sit under the bar and shrink (`clamp(56px, 14vh, 128px)`), clear of the Play button. Above 800px nothing changes (1440x900 checked). Checked with touch and the iPad flag at 1376x1032, 1032x1032, 688x1032, 516x700, 500x600: no horizontal page scroll, bar never wider than the view. Not touched: the status bar text colliding at 500px (outside Draw & Paint).

## v0.18.0 · pencil

Files: `platform/ipad-pencil.ts` (new), `platform/ipad-pencil-settings.ts` (new); hooks: `paint/pen-device.ts` (type `PenPointer`, interface `PenExtras`, field `PenRuntime.extras`, null by default), `paint/input.ts` (`sample` reads through `extras.pointer`, the predicted loop prefers `extras.predicted`), `ui/pen-settings.ts` (the Apple Pencil group, only when `pencilRows()` is not null), `ui/paint-view.ts` (import, `fm:pencil-action` listener and `pencilAction`, hover outline off, hover roll), `ui/paint-quick.ts` (one `pencilHaptic('pathCompleted')` when a shape snaps).

Decisions:
- Desktop is untouched: `extras` stays null, `ipad-pencil.ts` installs nothing unless `platform.kind === 'ipad'`, `pencilRows()` returns null, `hoverPreviewOff()` is false, `pencilRoll()` is 0, `pencilHaptic` returns at once. Checked in Chromium without the platform flag: same real samples as with it (positions identical, pressure within the smoother's timing noise), no Apple Pencil group, no bridge posts.
- Web pointer events stay the source of every stroke. The native batches only add: barrel roll as `twist` (degrees, 0 to 359), a settled force when an estimate was corrected before the event is read, and the system's predicted touches in place of the engine's. Matching is by time (native uptime plus the ping offset) and, once four pairs are matched, by place (the web view offset is learned from the pairs and averaged).
- A native batch can arrive a frame after the web event it describes, so an event with no match of its own takes the latest roll (if the last batch is under 100 ms old) rather than none. Force is replaced only by an exact match whose update has already arrived, and only under contact (buttons not 0). Predicted points are used only when they are still ahead of the event; otherwise the engine's own are used.
- Squeeze and double tap raise `fm:pencil-action` with `color`, `eraser`, `undo`, `toggle`, `previous` or `brush`. Draw & Paint maps them to the existing commands: `paint-colour-panel`, `setTool('erase')` (no-op when already erasing), the app's `undo`, `paint-tool-erase` (a second press returns to the previous tool), `paint-last-tool`, `paint-tool-paint` (opens the brush panel when paint is active). Under a live stroke or interaction they do nothing; outside Draw & Paint only Undo applies (the app's `undo` command).
- Follow system setting resolves from the shell's `pencilPrefs`: switchEraser to `toggle`, switchPrevious to `previous`, showColorPalette and showContextualPalette to `color`, showInkAttributes to `brush`, ignore and runSystemShortcut to Off. Before the first `pencilPrefs` arrives: double tap `toggle`, squeeze `color`.
- Settings > Pen and Tablet > Apple Pencil (built once with the page, hidden by not existing on desktop): Squeeze action, Double-tap action, Draw with Pencil only, Show the brush outline while the Pencil hovers. "Draw with Pencil only" is the existing `fingerPaints` preference seen the other way round (it calls `setFingerPaints(!v)`), so the Gestures row and this one always agree. The two actions and the hover choice are kept in `localStorage` `formmorpheus.pencil`. The hover choice only hides the outline while the pen hovers (buttons 0); the stroke cursor is unchanged.
- Show color picker opens the Color panel (`paint-colour-panel`), not the press-and-hold eyedropper loupe: the loupe needs a pointer that is down or Alt held, and a squeeze happens with the Pencil in the air.
- Haptics: `pencilHaptic('pathCompleted')` when QuickShape recognizes a shape (the message also reaches `platform.haptic` kinds `snap` and the others, which the shell maps). No haptic setting was added: the system's own vibration setting governs them.
- Brush roll: a brush with "Barrel roll turns the stamp" on (or "Roll" in its name) now rolls with the Pencil Pro, because twist is filled. Hover roll feeds the cursor's stamp angle through `pencilRoll()`.
- Messages (shapes in the iOS log): page to native `pencilClockPing`, `pencilPrefsRequest`, `haptic`; native to page `pencil`, `pencilClock`, `pencilPrefs`, `squeeze`, `doubleTap`, `hoverPose`. `pencilReceive(type, payload)` is exported in case the platform dispatcher wants to route by type; by default the module listens on `platform.bridge`.
- Emulation in Chromium (scratch `w20_pencil/`): `window.__FM_PLATFORM__` and a stub `__fmNative` injected at document start, the stub answers clock pings with `performance.now() + offset`, synthetic `pencil` batches sent just before each CDP pen event. Seen: real samples carry twist 90 (58 of 59) and 171 predicted points all with twist 90; a Chisel marker with barrel roll on draws a thin line at twist 0, a thick one at native roll 90 matching a web twist 90, and a turning one on a 0 to 360 ramp (`twist.png`); squeeze ended runs the chosen action (eraser, color panel, toggle, off, system switchEraser), double tap Undo removes the stroke (2017 ink pixels to 0), fingers paint 0 pixels with Draw with Pencil only on and 1409 with it off, the hover outline is gone with the choice off, QuickShape posts one `haptic pathCompleted`.
- Not verifiable here: real timestamps and coordinate agreement between UITouch and pointer events, whether WebKit already reports Pencil Pro twist, the force scale of estimated updates against web pressure.

## v0.18.0 · ipad ux

Files: `platform/ipad-menu.ts` (new), `platform/ipad-shell.ts` (new), `styles/ipad-window.css` (new), a 3-line hook in `app/app.ts` (two imports, one `if (platform.kind === 'ipad')` block after the Tauri menu block), `viewport-fit=cover` in `index.html`. The Swift side and the file and menu decisions are in `ios/HASHOUT_LOG.md` under the same heading.

- **Menu bar.** `installIpadMenu` builds a tree from the same `menus` array the in-window bar uses (after `trimMenu`, so Edit > Menus still hides items), with labels through `t()`, `enabled`, `checked`, and a native key for each command whose first combo holds Mod (or is F1 to F12) and whose key is a letter, digit, arrow, Escape, Backspace, Delete, Enter or `[ ] = - / , . ; ' \ \``. Space, Tab and a combo ending in `+` never go native. It posts `menu {kind: 'tree', rev, menus}` only when the JSON differs, at most every 150 ms after a pointer-up, key-up, language change or any of the engine's movie, selection, history, mode, playing, projects and saved events. Text focus goes as `menu {kind: 'text', focused}` on focusin and focusout.
- **No double firing.** A capture-phase keydown listener on window, registered when the module loads and only on iPad, calls `stopImmediatePropagation` and `preventDefault` on a trusted keydown whose combo is in the owned set. The set is filled only when native answers `menuReady {rev}` for the tree that was sent, so before the menu exists (or if the shell never builds it) every key still reaches the page. A native `command {id}` whose key is owned is replayed as a synthetic keydown on the focused element (built so `comboOf` reads the same combo; Mod is Meta where `isMac` is true), so Draw & Paint's own keys, the app's guards for dialogs and the Home screen, and text-field exclusions all apply exactly as for a real key. Any other command runs through `commands.run`. A command held by Edit that targets a text field (`undo redo cut copy paste select-all`) goes to `execCommand` when a text field has focus; the shell already sent the standard edit action for cut, copy, paste and select all.
- **Documents.** `installIpadShell` handles `openURL {kind: 'library', name}` (opens through `openFromLibrary`), `{kind: 'restore', name}` (only when no movie is open and the Library still lists the name), `{kind: 'import', path, name}` (reads through `api.readFile`, then `importFiles([file], {preview: true})`; with no movie open it says so) and the older `{url, path}` for `.fmo`. Messages run one after another. It posts `movie {name, id, title}` whenever the open movie's Library name, id or name changes.
- **Keyboard.** `visualViewport` resize and scroll set `--fm-kb-inset` on the root (the part of the window the keyboard covers; 0 when it is below 40 px) and the class `fm-kb-open`; a focused field under the keyboard is scrolled into the free part. `ipad-window.css` centers dialogs above it (`.cv-scrim` bottom padding, `.cv-dialog` max height). Checked by scaling the page (Chromium's page scale factor shrinks `visualViewport` the same way): 516 px inset reported at scale 1.6, 0 after reset; a 700 px inset on the 1032 x 1376 window left the New Movie dialog whole and scrolling inside (`w20_ux/after/kb_dialog.png`).
- **Safe areas.** `html body` is padded by `env(safe-area-inset-*, 0px)` and `box-sizing: border-box`; 0 on the desktop, so no change there.
- **Window sizes** (`ipad-window.css`, selectors lead with `html` so they win whatever the load order; every rule is a width query, so 720 px and wider read as before). Under 720 px: the status bar's size text no longer shrinks under the hint (the hint takes the ellipsis); the Timeline's transport grid becomes `auto 1fr auto` (the 1fr auto 1fr columns made both sides as wide as the wider one) and loses the master meter; the mode switch moves to the right so it clears the zoom buttons; the stage timecode gets a ground so a white picture cannot hide it. Under 560 px: tighter gaps and Theater padding, the two step buttons beside Play are hidden (they did not fit with the frame readout at 44 pt touch size; the arrow keys and the ruler still step), the mode buttons are 60 px wide.
- Measured sizes (Chromium, touch emulation, iPad Pro 13 in points): 1376 x 1032, 1032 x 1376, 688 x 1032 (half), 516 x 1376 (half portrait), 459 x 1032 (third), 640 x 480, 500 x 600, 500 x 420. Before and after: `w20_ux/before/<size>_{home,newdlg,editor,menu,settings}.png` (shots.py, taken before the sheet existed), `before` and `after` `<size>_{viewmenu,create,paint}.png` and `_paintview.png` (the sheet's rule removed in the page for "before"). Desktop at 1440 x 900: home, editor, Create popover and Preferences are pixel-identical with the sheet present and removed (`deskdiff.py`: no difference box).
- Not changed: the paint view's tool row at 459 pt shows the brush and scrolls sideways for the others (it was already a scrolling row); the Home tabs scroll sideways under 516 pt; the in-window menu bar stays on iPad beside the system menu bar (touch has no other way to reach the menus, and Edit > Menus can hide items); a popover placed by `popover.ts` was inside the window at every size tried (Create, View menu).
- **Verifier A21 fix.** The swallow-the-owned-key rule is gone. A press now runs once by a symmetric dedupe (300 ms): a real keydown is recorded and passes to the page untouched; a native `command` whose combo was handled by a real key in that window is dropped; a replayed key is recorded and a real keydown of the same combo right after it is swallowed. So it works whether the system consumes the key, the web view also sees it, or neither. Undo and Redo report `enabled: true` while Draw & Paint is open (`paintOpen` option) and their native command is always replayed as the key, so paint's own handler runs paint undo and redo; other owned combos only count as owned when enabled. Verified with the verifier's `w20_verify/t3c.py`: Ctrl+Z with the menu built took the ink diff from 5209 to 130.
- On iPad the View menu (in-window and tree) leaves out Hide Menu Bar, Hide Status Bar, Menus in Window and Custom Title Bar (the in-window bar stays: touch has no other path). Home: the Library folder entry reads "On This iPad" and does nothing on click (the Library is fixed in Documents), and the Cloud folder entry is hidden (`ui/theater-storage.ts`, `ui/home.ts`, both guarded by `platform.kind`).
- Removed code: none. The `1fr auto 1fr` transport and the centered mode switch are only overridden under 720 px.

## v0.18.0 · ipad memory

- `platform/ipad-memory.ts` (new, pure: no document access at import, loads in workers and the paint core): `memory` holds one limit table per tier (`desktop`, `high`, `mid`, `low`, `floor`) for 23 budget keys. Desktop is today's numbers exactly (unchanged constants, `Infinity` for the three undo caps); no native message, warning or kill can move it (`handle`, `warn`, `noteKill` return at once when `kind` is not 'ipad'). `kind` is 'ipad' when `window.__FM_PLATFORM__.kind` says so, or when the dev switch `localStorage fm-memory-tier` names a tier (that is how the Chromium measurements force a tier; `fm-memory-debug`=1 puts the object on `window.__fmMemory`).
- Tier at start: the Diagnostics ramp (`localStorage fm.diag.ramp`, written by platform/diagnostics.ts) when it stopped early (a warning, a slow step or a kill): under 600 MB reached is `low`, under 1000 MB `mid`, else `mid` as the best; a ramp that reached its cap says nothing more, so physical memory decides (native `memoryInfo.physicalMemory`: 11.5 GiB or more `high`, 7.5 GiB or more `mid`, else `low`; no native value: `navigator.deviceMemory` 8 or more `mid`, else `low`). `os_proc_available_memory` at load only lowers the pick (under 3 GiB at most `mid`, under 1.5 GiB `low`). A recorded kill in the last 24 hours lowers it one step. Memory info can arrive after caches exist: every cache reads its limit where it decides, so a later pick takes effect without a rebuild.
- Live: `memoryWarning` trims every registered cache to the next tier down once (`watch` callbacks get that tier's number), runs the pressure hooks (decoded video frames released except the shown ones, undo and redo cut to `undoFloor` of the current tier (40 / 25 / 15 / 8), newest steps kept; the current step is never in the lists), and a second warning inside 30 s lowers the tier for the session (callbacks get the new tier's numbers). `contentProcessRecovered` counts as a kill: one tier down for the session, remembered 24 hours in `localStorage fm-memory-kill`. After a one-shot trim a cache stays at the lower number until the next tier change (it is not grown back): simpler, and the caches refill lazily anyway.
- Hooks (each reads `memory.get(key)` at the place it decides; ipad-only registration so desktop pays nothing):
  - `engine/gpu/compositor.ts` was `TEXTURE_CAP` 512 MiB (line 125) and `POOL_IDLE_BYTES` 64 MiB (127): now `gpuTexture` / `gpuPoolIdle`; `TextureCache.setCap` evicts at once; the surface pool frees past the new room. `engine/gpu/mesh.ts:12` and `engine/render.ts:71` `FLAT_AREA` 48 Mpx: `flatArea`.
  - `engine/render.ts`: `BITMAP_CAP_BYTES` 1 GiB (47) `bitmaps`, `PRELOAD_BYTES` 384 MiB (52) `preload`; eviction moved into `evictBitmaps(cap)`.
  - `engine/frame-cache.ts:19` `DEFAULT_CAP` 384 MiB: `frameStore` (the constructor override stays); `shrink(cap)` drops frames furthest from the Playhead.
  - `media/video.ts`: `CAP_BYTES` 768 MiB (17) `videoFrames`, `THUMB_CAP_BYTES` 48 MiB (26) `videoThumbs`, `MAX_LANES` 4 (30) `videoLanes`; `shed(cap)` is the old over-budget loop, also run with 0 on a warning.
  - `media/audio.ts`: `BUS_CAP_SAMPLES` 96 M (39) `audioBus`, `FX_CAP_SAMPLES` 48 M (796) `audioFx` (read at the next insert; no immediate shed).
  - `paint/history.ts:31` `PAINT_HISTORY_BUDGET` 1 GiB (constant kept exported, unused): `paintHistory`; depth 200 held under `paintUndoDepth`; `lowerTo`, `shedDepth`. `paint/doc.ts` `DENSE_BUDGET` 512 MiB (57) `paintDense`, `MIRROR_BUDGET` 768 MiB (61) `paintMirror`; `enforce(budget, idleMs)` and `trimMirrors(keep, cap)` take the new limit; a tier change parks idle layers at once. `paint/tips.ts:17` `CACHE_BYTES` 96 MiB: `tipCache`.
  - `engine/history.ts`: depth setting (default 250, 0 is unlimited, menu 10 to 1000) is held under `undoDepth`; `shed(steps)` for warnings (also keeps one recovery point).
  - `ui/paint-view.ts`: onion slider 0 to 12 stays as the person set it, `onionFrames` limits how many are drawn; ghost canvases 24 (971) `onionGhosts`, freed (width 0) when dropped.
  - `export/export-worker.ts:97` frames ahead of the page 4: `exportAhead`; the page sends its tier in `StartMsg.memTier` (iPad only) and the worker calls `memory.adopt`. `export/run.ts:34` `GIF_MEMORY_LIMIT` 1.5 GiB: `gifMemory`. `media/import.ts:162` `MAX_DECODE_BYTES` 512 MiB: `decodeBytes`.
- Listed and not tiered: `media/thumb-cache.ts:8` 64 MiB and `media/peaks-cache.ts:6` 200 entries (IndexedDB on disk); `io/tiled-artwork-import.ts:33` 1.5 GiB, `io/safe-unzip.ts:17-18` 512 MiB / 1.5 GiB, `io/project-sniff.ts:26-29`, `io/abr.ts:57` 36 Mpx, `io/psd-import.ts:9-10` (one-off import guards that refuse, not caches); `export/engine-jobs.ts:17` `UPLOADS` 4 (small PNG blobs); `media/video.ts:36-38` pull caps (counts); `ui/theater-preview.ts:10` strip cache 24 (small bitmaps); `engine/canvas.ts:6-7` 16384 px / 64 Mpx and `engine/types.ts:436` 3840 (movie size limits, not caches); `media/proxy.ts` (proxy 540 px, wanted over 1280 px; needs ffmpeg, which the iPad engine does not report, so no proxy there); audio decode cache (AudioBuffers per asset) has no cap of its own and is not tiered.
- Recovery (`io/recovery.ts`): iPad beat 30 s (was 60 s; the first-edit write after 5 s is unchanged; desktop identical). `appState` with `active` false (inactive or background) writes a snapshot at once past the 5 s minimum gap (`lastAt = 0`). When the page loaded after a killed content process (`contentProcessRecovered`, which the shell queues until a listener exists), `offer('start')` first waits for `memory.afterKill()` (at most 1.5 s, or less when `memoryInfo` arrives first and no kill is known), then `openAfterKill()` opens the newest snapshot of another session (dead or not: the killed page cannot say it is gone) as an unsaved "(Recovered)" movie, snapshots it under this session, deletes the old one and toasts "The web view restarted to free memory, so your last snapshot of "{name}" was opened." Other leftovers still get the usual Recover question. Not done: a snapshot is only written when the movie changed since the last one, so a kill between two edits loses at most the 30 s of edits.
- Measured (Chromium headless, viewport 1376 x 1032, CDP `Emulation.setCPUThrottlingRate` 4, movie "Mem 4K x20": 3840 x 2160, 24 fps, 4 s, 20 tracks = 10 drawings with 4K pictures, 2 clips of a 4K VP9 video, 3 solids, 3 shapes, 2 texts; built through the app's own model and `packMovie`, opened from the Theater; tier forced with `localStorage fm-memory-tier`). The box is an 8 GB cgroup shared with other builders (load average 12 to 14 on 2 cores, ffmpeg jobs of 1.7 GB), the kernel OOM-killed the page several times, so frame times are not device numbers and the run could not finish the scrub, draw and export steps at any tier, desktop included (the crash is at the same step for every tier, right after play: not a tier effect). What did complete, all tiers, 4x throttle: open 3.7 to 8.2 s; play frame intervals p50 100 ms (desktop, p95 2417), 417 to 616 ms (iPad tiers, p95 650 to 1367: load dominated, over 20 ms every time); JS heap after open 25.6 MB (desktop), 26.1 mid and low, 26.4 low; browser process-tree RSS idle / peak during play: desktop 2686 / 2816 MB, mid 1968 / 2165 MB, low 1882 / 2255 MB (about 700 MB lower at idle than desktop; high did not complete). Cache meters against their tier limits during play: low videoFrames 99.5 of 112 MiB, frameStore 2.9 of 64 MiB; mid videoFrames 199.1 of 192 MiB (a lane's protected frames may sit over the cap for a moment, the next trim takes it down), frameStore 5.9 of 112 MiB. The GPU texture cache and the bitmap cache meters were not captured in the UI run (the compositor starts 1.5 s after load, and a probe Renderer's meter replaced the app's), so "GPU cache within budget" is by construction (`setCap` plus `endFrame` eviction), not shown by a number here. Not measured: pen strokes in Draw & Paint (the dialog tour swallowed the first double click twice), the export clip, the desktop-versus-iPad frame times on a quiet machine.
- Logic checked in the page (`__fmMemory`): desktop: warnings, memoryInfo and kill messages change nothing (tier 'desktop', texture cap 512, history 300 kept). Forced `high`: tier high, texture 256 MiB, history capped at 250; first warning: texture callback gets 160 MiB (mid) with reason 'warning', undo and redo cut to 40; second warning inside 30 s: tier `mid`, undo 25; `contentProcessRecovered`: tier `low`, `wasKilled` true, `afterKill()` true.
- Paint worker (`paint/paint-worker.ts`): cannot see `__FM_PLATFORM__`, so it got an optional `{ t: 'memory', tier, warn? }` message. `ui/paint-bridge.ts` sends it on creation, on every tier change and on a warning (iPad only; desktop never sends it); the worker calls `memory.adopt(tier)` and, with `warn`, `memory.handle('memoryWarning')`, so its tip cache (`tipCache`) follows the page's tier.
- Bridge use: `platform/index.ts` calls `memory.attach(platform.bridge)` on iPad, and `attach` listens with `bridge.on` (an earlier draft wrapped `__fmNative.receive`, which would have eaten the shell's replay of early messages from the platform bridge). It posts `memoryInfoRequest`; native answers `memoryInfo {physicalMemory, availableMemory}`. `attach` also returns at once when `window` is undefined, so a worker that imports the module never wires anything.
- Removed (2026-11-17, fix/ipad-memory-merge): main 98fbe0b carried two `attach` bodies interleaved, which broke tsc (TS1109 at line 239). The dropped one was `attach(): void`, which did `import('./index')` on demand and listened on `platform.bridge`, plus the module-level `memory.attach();` call. Why: importing the platform index from this module pulls the page's stylesheets into the paint worker bundle, whose first statement then touches `document` and kills the worker; the index already passes its bridge in. Its `typeof window === 'undefined'` guard was kept in the bridge version.

## v0.18.0 · platform

- `src/platform/` (new): `index.ts` exports `platform` (kind from `window.__FM_PLATFORM__.kind`, 'ipad' or else 'desktop'), `types.ts`, `bridge.ts`, `common.ts` (parts both platforms share), `desktop.ts`, `ipad.ts`, `diagnostics.ts`, `diag-worker.ts`. Every iPad-only path in the interface is behind `platform.kind` or a `platform.features` flag; the desktop adapter is the old code moved, not changed.
- Bridge (`bridge.ts`): page to native `window.webkit.messageHandlers.fm.postMessage({type, payload})`; native to page `window.__fmNative.receive(msg)`, msg an object `{type, payload}` or its JSON string. The shell queues messages that arrive before the page listens and replays them to the first `receive` set, so `createBridge` sets it at module load. Desktop: `available` false, `post` drops.
- Files: opening keeps the plain file input. A WKWebView shows the system sheet (Photo Library, Take Photo, Choose Files) for `<input type=file>` with no help from the shell (the open-panel delegate is optional), so no call site changed. The `pickFiles` / `pickedFiles` route exists in `ipad.ts` behind `USE_NATIVE_PICKER = false` (reads `bytes` or, for big files, `path` through `/api/files/read`). Saving: `io/api.ts downloadBlob` and the two anchor downloads in `app/app.ts` (Share Movie File, round trips) now call `platform.files.download`. Desktop: the same anchor code as before (`common.ts anchorDownload`, 30 s revoke; the app.ts ones had a 4 s revoke and a `hidden` attribute, now the shared version). iPad: `saveFile` as base64 chunks of 3 MB `{id, name, mime, size, index, count, data}`, the shell presents the export picker after the last and answers `fileSaved {id, ok}`; with no shell it falls back to the anchor.
- Share: `platform.share.share({text, url, file})`; iPad posts `share` (chunked the same way for a file), desktop downloads the file or copies the text. Clipboard (`writeText`, `readText`, `writeImage`, `readImage`) is one shared adapter that makes the same calls the interface made inline; the existing call sites (text-edit-menu, paint-clip, sprite-sheet, help-center) were not moved, to leave desktop untouched; new code should use the adapter. Haptics: `platform.haptic.fire(kind)` posts `haptic {kind}` at most every 30 ms on iPad; no call site yet (the pencil and ux builders place them). Pen extras: `platform.penExtras.on('squeeze' | 'doubleTap' | 'hoverPose', fn)` listens for the shell's messages; nothing on desktop. Capabilities: `platform.capabilities.engine()` and `.jobs()` ask io/api and export/engine-jobs (dynamic import, because io/api imports the platform).
- Flags (`platform.features`): desktop all true. iPad: `penLink` false (Pen Link command disabled, its Edit menu entry left out in `app/app.ts`), `liveRecoverySocket` false, `folderPicker` false (`ui/export-where.ts canPickFolder`: the "save to folder" choices stay hidden, so exports go to `downloadBlob`, i.e. the system picker), `mp3Export` false (`ui/audio-export-dialog.ts` leaves MP3 out of the Format list and shows the sentence "MP3 is not offered on this device. Choose WAV, AAC or Opus."; a saved MP3 choice falls back to WAV), `desktopMenus` false (flag only; the menu bar is the ux builder's).
- Recovery on iPad (`io/recovery.ts`): no WebSocket. `keepLive()` returns at once; the 20 s beat also POSTs `/api/recovery/{session}/live` (the lease the engine port added in its RecoveryRoutes) and runs again on the shell's `appState` message; `pagehide` also DELETEs the lease. Desktop keeps the socket and nothing else changes.
- `main.ts` calls `platform.ready()` after `startApp()`: iPad posts `ready {version, build, width, height, dpr}`.
- Diagnostics (`platform/diagnostics.ts`, `ui/diagnostics-dialog.ts`, `styles/diagnostics.css`): probes run in order and report as they go: context (isSecureContext, scheme, bridge, media queries), display refresh (90 frames), pointer features (pressure, tilt, twist, altitude, azimuth, coalesced and predicted, `pointerrawupdate`), Pencil test (a 5 s pad: real sample rate from coalesced time stamps per stroke, pressure range, whether tilt, twist, altitude and azimuth vary, hover moves, raw updates), input latency (pointer time stamp to the next frame, taken from the pad), WebCodecs (VideoEncoder isConfigSupported for avc1, hvc1, vp09, av01 at 1080p and 4K, three hardware preferences each; AudioEncoder opus and aac), a 60 frame 1080p H.264 encode for real speed, workers (a module worker started from the page's own address, `diag-worker.ts`, which tries OffscreenCanvas 2d, WebGL 2, createImageBitmap; a blob worker for comparison), createImageBitmap options and ImageDecoder types, storage (IndexedDB 1 MB round trip, localStorage, a launch id kept so the next run shows persistence, `storage.estimate`, OPFS), WebGL 2 limits and float render targets, and the memory ramp (3840 x 2160 canvases of 33.2 MB each up to the limit, default 1536 MB, field in the panel; it stops on the limit, a `memoryWarning` message, a failed context, a step over 3 s, or Stop, and frees what it holds). The ramp keeps its last step in localStorage (`fm.diag.ramp`) and posts a `diagProgress` note per step, so the next run reports how far a killed web view got. The report goes to the shell as `diag` (the shell adds device facts, writes the file and answers `diagSaved`).
- The panel opens from About: Settings has no About section (About is its own dialog, Help menu), so the "Diagnostics..." button sits in `ui/about-dialog.ts`, added only when `platform.kind === 'ipad'` and the panel loaded on first click (dynamic import, so desktop never carries it). The panel is built once from one template; rows, texts and states are patched in place.
- `docs/api-contract.json`: `app.openapi()` of the engine at v0.17.2, one path per line, plus `x-websockets` for the two routes OpenAPI leaves out (`/api/penlink/desk`, `/api/recovery/{session}/live`). `setup/api_contract_check` (python3, exit 0 always) lists the classification at the top: desktop-only are penlink, transcode, proxy, audio-encode/mp3, save-to, library copy-to, POST system/library, the sockets. Run against the Swift now in the tree: 0 required routes missing, 10 desktop-only not served, 13 served by hand-parsed groups (jobs, exports, audio-encode) found by the heuristic.
- Not done: the Pencil `ipad-pencil.ts` and the memory `ipad-memory.ts` files belong to other builders; clipboard and haptic call sites; native menus.

## v0.18.0 · app icon

The owner supplied a new app icon (glossy coral to violet infinity ribbon on a dark squircle). Source kept at `assets/icon_src/formmorpheus-icon-1024.png`; the squircle is the box (100,100)-(924,924) of that 1024 image (alpha at 250 or more), the rest is shadow.
- Web: `public/favicon.ico` (16, 32, 48), `public/favicon.png` (64), `public/apple-touch-icon.png` (180, full bleed opaque), `public/mark.png` (192, squircle with transparent corners, used by the splash and About). `index.html` links `favicon.png` in place of `favicon.svg`.
- Removed: `public/favicon.svg`, `assets/icon_src/formmorpheus-icon.svg`, `assets/icon_src/formmorpheus-mark.svg` (the old three-shape mark). A glossy raster cannot be an SVG or currentColor, so the SVG favicon was dropped rather than embedding a PNG in it.
- `public/splash.html`: the 72 px inline SVG tile is now `<img src="mark.png" width="72" height="72">`; CSS rule `svg` became `img`. Layout unchanged, so no shift.
- `ui/about-dialog.ts` and `styles/onboarding.css`: the `film` glyph in an accent tile became `<img class="fm-about-mark" src="/mark.png" width="52" height="52">`; the unused `icon` import was dropped.
- `ui/brand.ts` (not used by any caller today): now returns an `<img>` of `mark.png` with width and height; the old inline SVG with its gradients was removed.
- The Home header draws only the wordmark text, and tool icons stay inline currentColor SVG: untouched.
- README header image is `assets/formmorpheus-icon-256.png`; `assets/formmorpheus_folder_icon.png` removed (only README used it).
- The iPad icon is built in `ios/App/Assets.xcassets/AppIcon.appiconset/` (documented in `src-tauri/HASHOUT_LOG.md`).

## v0.17.2 · gpu limits

- engine/gpu/compositor.ts: `init()` reads MAX_TEXTURE_SIZE, MAX_RENDERBUFFER_SIZE and MAX_VIEWPORT_DIMS once into `maxSide` (the smallest). Below 2048 (the GL minimum) there is no GPU. `compose()` returns null (CPU draws that frame) when the view is over `maxSide`. `TextureCache.put` returns null for a source over it and raises a `refused` flag; `compose()` reads the flag after the walk and returns null for the whole frame, because a layer with no texture would otherwise draw as nothing (a blank layer). The flag is also raised when a new texture's upload leaves a GL error (read once per new texture, not per update) or throws.
- makeSurf checks `checkFramebufferStatus`. A half-float surface that is incomplete clears `floatOk` and is made as 8-bit (float effects then take the CPU path); an incomplete 8-bit one throws, which the existing catch turns into "GPU off for the session". `checkFloat()` runs once at init and after a restore with a 4 px half-float surface, so the extension check alone no longer decides. A surface over `maxSide` throws `GpuLimit`: that frame is the CPU's, the pool is emptied, the GPU stays on.
- `gl.getError()` is read on the first frame and every 32nd. OUT_OF_MEMORY fails at once; any other error twice in a row (a persistent one) fails like a non-loss failure (context lost on purpose, CPU for the session). The context start's own errors are drained at init so the first check is clean.
- Memory (A4): texture cache cap 512 MiB (was 1 GiB). Idle pooled surfaces per size are limited by bytes (about 64 MiB, at least 2, at most 10: ten at 1080p, two at 3840 px). Surfaces wider than 2560 px are trimmed after 30 frames idle (others 90). `flatScaleOf(..., maxSide)` in gpu/mesh.ts caps the Warp / Distort flat surface at min(8192, maxSide).
- `resets` counts losses (event, polled `isContextLost` in `ready`, or a forced loss after an error); `Renderer.gpuResets` exposes it. export/run.ts compares it before and after a run and sets `ExportResult.gpuReset` (carried through the worker message); ui/export-dialog.ts adds a t() sentence to the finished export's notes. The export keeps going on the CPU while the context is away (the pin holds the switch) and returns to the GPU after a restore.
- engine/render.ts (B3): the scale kept for a decoded picture is `bmp.width / asset.width` (capped at 1), not the requested one, so a webview that ignores the resize options is not drawn too large; every decode passes `premultiplyAlpha: 'premultiply'` (the GPU ignores the unpack flag for a bitmap and assumes it).
- gpu/probe.ts: a "large surface" scene (4096 x 2304 source, 2048 x 1152 view, a blend and a transform) is compared CPU against GPU before the speed test, so a driver that fails at big sizes is not switched on.
- Not done: raising the cache cap by renderer class (the unmasked renderer string is not read; 512 MiB everywhere), and `powerPreference` stays 'high-performance'.

## v0.17.2 · project files

- io/project-sniff.ts (new): read-only. First bytes tell zip (PK), binary plist (bplist00) or unknown. A zip is walked with io/safe-unzip (entry 256 MB, total 1 GB, whole file 1.5 GB, at most 200 media entries); only entries whose first bytes are a plain PNG, JPEG, HEIC, MP4/MOV, M4A, WAV or MP3 are lifted out. Nothing is ever decoded as a timeline, document plist or tile. The entry names are kept in the result for evidence; no format guess is made. The "older version" case cannot be told from the bytes, so its advice is a sentence of the whole-file refusal.
- media/import.ts `importProjectFile`: replaces the old .drm refusal. Unknown container and plist: refusal with the routes (video, numbered PNG frames with frame rate, animated GIF). Zip with no readable media: the whole-file refusal. Zip with media: assets only go to the media bin (no content is placed, the timeline is not rebuilt) and a notice counts pictures, videos and sounds. Wording is generic ("another animation app"); the vendor is never named.
- media/import.ts `findSequence` and `importSequence`: three or more pictures whose names differ only by a number are one Flipbook at a typed rate (default: the movie's), built through the same flipbookFrom as GIF so the count and memory caps apply. app/import-flow.ts asks first (ui/sequence-dialog.ts: Import as one Flipbook, Import separately, Cancel).
- io/drop-files.ts (new): a dropped folder is walked into its files (cap 2000), so a folder of numbered pictures reaches the same question. The picker accept list gained .drm so the file can be chosen.
- ui/number-fields.ts showPop: the small slider beside modal dialogs was the number-field scrub pop (cv-numpop, z-context), which sat outside the dialog frame at the scrim's right and read as a stray control. In a dialog it now sits inside the frame under the focused field. Before: w19_verify/seq_dialog.png; after: w19_drm/after_seq.png (export and preferences open with no pop, after_export.png, after_prefs.png).
- app/import-flow.ts: a file that places nothing (a project file filling only the media bin) is the undo step "Import from {file name}", not "Add {name}"; the sequence fallback toast goes through t(). ui/sequence-dialog.ts: a spacer under the field gives the scrub slider room (after2_seq.png).
- Checked first-class: animated GIF keeps exact delays (5 frames 100/200/100/300/100 ms = 0.8 s), video and .procreate import were already built.

## v0.17.2 · media fallbacks

- A5 export: new `export/route.ts` (`startExportRouted`, used by the Export dialog's `launch` only; the size-estimate sample still uses `startExportAuto`). For MP4 / MOV it asks `browserEncodesVideo` (no `VideoEncoder`, or no codec config via mediabunny `canEncodeVideo`); when none, it reads `jobCapabilities()` and runs `startEngineExport` with target h264 (container follows the chosen format), adding the warning "This system cannot encode MP4 video itself, so the engine's encoder was used." No engine, no ffmpeg or no libx264: the message names the fix (`engineVideoBlocker`). WebM has no engine target, so it says to choose MP4. `Run.video`'s own throw stays as the backstop.
- A5 import (`media/import.ts`, `importTimed`): with no `VideoDecoder` at all the engine conversion is skipped (its output could not be played either) and the message names the fix (macOS 13+, WebKitGTK 2.44+ with media codec packages). The "converted but still cannot play" text now names the fix too. No frame-sequence route was added: the engine would need a new endpoint and every returned frame still has to be decoded by the window.
- C6 sound: `export/audio-export.ts`: Opus in WebM / OGG (and AAC in M4A) go to the engine when `AudioEncoder` is missing or the config is refused, through the new `POST /api/audio-encode/lossy` (see backend log). M4A without the engine keeps the old Opus-in-M4A fallback with its warning.
- B2 text: `engine/text-layout.ts`: `setLs` / `measureW` / `drawTxt`. With `letterSpacing` on the context the code is the plain native call as before. Without it the spacing is kept on the context (`__sp`), measured widths get `spacing * letters`, and parts are drawn letter by letter at the measured width of the preceding text plus the spacing (pair kerning kept). Pixel check: tracking 200, 80 px "Tracking test" is 691 px of ink wide on both paths, edges within a pixel. `canvasFontKerning()` is exported; the Text card disables Kerning "None" with a reason when `fontKerning` is absent (Font and Optical stay; Optical is measured in script).
- B4 animated pictures (`media/import.ts`, `importAnimated`): no `ImageDecoder` for WebP / APNG / AVIF: the first picture is imported with a notice. Animated is read from the file's own header (`isAnimatedPicture`: WebP VP8X animation flag, APNG `acTL` with more than one frame, AVIF `avis` brand). No engine route: the engine's ffmpeg (6.1 here) cannot decode animated WebP, reads APNG only as video, and no picture library ships with it.
- C1 `export/reframe.ts`: `canFilter` (property present AND a written value reads back, once per module) replaces the try/catch; without it the blur fill shrinks to 1/8, then 1/32, and spreads back up through both sizes.
- C2: `vite.config.ts` `build.cssTarget: ['chrome105', 'safari16', 'firefox110']`. Checked in a scratch build: every `backdrop-filter` rule in the built CSS has its `-webkit-backdrop-filter` twin.
- Open editor and export: an open Drawing or Flipbook frame lives in the editor's `PaintDoc` and reaches the movie only when written, so an export or preview started before "Finish" was white. Chosen: commit, not live render. `ExportDeps.commitOpen` (wired in `app/app.ts` to `paint.done(true)`, which writes the open frame and keeps the editor open) runs before every export (`begin`) and before the Advanced preview (`open`). One undo step "Paint ... frame n" is added, the same one a frame switch makes; no flash because the editor is not closed or rebuilt. Verified: new Flipbook, three frames drawn unfinished, MP4 ffprobe h264 3840x2160 240 frames, decoded frames 0, 1 and 3 hold the strokes (frame 2 was not drawn); the Advanced preview shows the stroke.
- GIF steppy (tester 11): not a rate cap. The "One GIF frame for every movie frame" option (`gif.exactFrames`) defaulted off, so unchanged neighbouring frames were merged into one long hold (96 frames became 24, one hold of 2830 ms); the cumulative rounding in `Run.gif` already gives the 4 and 5 centisecond pattern. Now `exactFrames` defaults on (`DEFAULTS`, the saved-state reader keeps an explicit off, and `fromFormDefaults` for Quick share). Checked with ffprobe on a 4 s, 24 fps still movie: off 3 frames, on 96 frames (80 x 40 ms, 16 x 50 ms), total 4.00 s. Cost: larger files for stills; the person can switch it off in Advanced.
- Waveform on reopen (tester): peaks are cached in IndexedDB (`media/peaks-cache.ts`, key asset id plus byte size, newest 200 kept), loaded in `AudioEngine.decode` before the decode lands and saved after it. A 120 s sound: first load peaks at 2056 ms (decode), second load at 152 ms, the decode still finishing at about 2 s behind it. No storage: no cache, as before.
- Not changed: `willReadFrequently` (no change needed).

---

## v0.17.2 · pen link

- `ui/pen-link.ts`: `release()` (tablet gone mid-stroke) fires `pointerup` at the last sample place, not `pointercancel` at 0,0. New hint line `.fm-pl-hint` in the dialog (Scribble off, page in the foreground); styled with `.fm-pl-intro` in `styles/pen-link.css`.

---

## v0.17.2 · paste

- Cause of the leak: `Engine.paste()` put the clipboard's picture and sound blobs into `engine.assets` before `run('Paste')`. When the paste was refused (locked track, `OpError`) the blobs stayed in memory with no record in the movie, and `collectAssets()` only looks at records of the live movie, so it never let them go. A saved `.fmo` was never affected (`packMovie` writes only assets a saved state records), so this was memory only; and a paste never adds an asset record for a block it leaves out (the filter runs first), so no unused record is added to the movie.
- Fix: `paste()` remembers which blobs it added itself and takes them out again if `run` returns false. After a successful paste they join `pasteBlobs`; `collectAssets()` lets go of a `pasteBlobs` entry once no state (movie, undo, redo, recovery) records it, so a paste that was undone and then dropped (a new edit clears redo) frees its blobs. Undo keeps the blobs while the redo state records them, because redo needs them.
- `undo()` and `redo()` call `restoreBlobs(state)`: a state whose assets are missing from `engine.assets` gets them back from the in-memory clipboard, so redo of a paste shows its pictures and sounds even after a collection.
- Verified in Chromium against the real `Engine` and `packMovie`/`unpackMovie` (movie A: drawing with a picture, video, sound; copy; movie B): paste into a locked track leaves 0 blobs and 0 file assets; paste with the video's clipboard entry missing places the drawing and sound only and the saved file lists exactly those two; undo leaves the saved file with no assets, redo brings both back; a full paste, undo, redo into a third movie lists the three assets only while the paste is applied.

## v0.17.2 · brush libraries

- The dev data folder had 33 libraries named "settings", "settings 2" to "settings 30" (plus "settings 5 2", "settings 27 2"), all written in the same two seconds, each holding the same test brushes ("Arrow angle 30", "Tip huge 700", "Tool options") in sets named after the file. Cause: the brush import dialog (`ui/brush-import-dialog.ts`, `landChoice`) offers "new library named after the file" by default, and `brushStore.addImportedLibrary` -> `addLib(name)` makes the name unique with a numeric suffix. An agent's test imported a brush file called settings over and over. Nothing else in the product creates them: the migration (`brushes.json.migrated`) renames the old file once and is refused after a library has been saved as files, Brush Studio save only adds "New brush" / "copy" brushes (`uniqueName`), and the backend `tree()` slug ids ("settings-3") are only how folders without an id in `.order.json` are listed.
- Decision: no product change. Importing the same file again makes another library by design (the person can choose "add to the current library" in the same dialog), and a name collision gets a suffix instead of overwriting. Dev data tidied: the 33 libraries moved to `fmdata/_to_delete/Brushes/`, `Brushes/.order.json` lists the three stock libraries (Animation, Classic, Classic 2), test movies older than 15 minutes moved to `fmdata/_to_delete/Library/` (the Example movies and the Stack folder stay).

## v0.17.2 · platform

### main.ts, app/capability.ts · startup gate
- refers-to: src/main.ts; src/app/capability.ts
- kind: explainer
- logged: v0.17.2

`main.ts` no longer imports the app statically. It checks the web component first (offscreen 2d surface, `createImageBitmap`, `Worker`, `AudioContext`, CSS `:has()` and `color-mix()`), and only then loads `app/app` through a dynamic import started at once, in parallel with the language table, so a working system starts in the same step as before. A missing piece shows one message (built once, tokens only, `role="alert"`) after `startLanguage()` so the sentences go through `t()`, then `revealApp()` lets the desktop splash close. The dynamic import matters: with a static one a module that touches `OffscreenCanvas` at load would throw before the check could run. Verified in Chromium by deleting `OffscreenCanvas` through CDP (w19_shell/missing.png) and with nothing missing (w19_shell/normal.png, Home as before, no page errors).

### ui/tour.ts, ui/onboarding.ts, ui/prefs.ts · the tour starts once
- refers-to: src/ui/tour.ts :: tourSeen; src/ui/onboarding.ts :: attempt; src/ui/prefs.ts :: tourDone
- kind: fix
- logged: v0.17.2

The first-run tour waited while Draw and Paint was open and then started the moment Finish brought the Timeline back, so it opened over the Timeline. Now it never starts by itself while Draw and Paint is open (Help, Take the Tour still shows it), and it starts only when `tourDone` is false. Finishing or skipping it (button, Esc, last step) sets the new `tourDone` setting; the old browser-storage flag still counts. Verified in Chromium with a fresh profile: the card shows on the first movie, Skip tour sets `tourDone`, and a second run with the saved profile shows no card (w19_shell/tour_2.png). The Finish-from-Flipbook path is covered by the code guard, not run.

## v0.17.1 · fonts

- L-IO-064: the Export dialog shows a note when Text in the export range uses a font that is not available (not bundled, in the library, in the movie or installed): "Text in {fonts} will be drawn in Inter, because that font is not available here." with a "Fix fonts" button. The check is `substitutedFonts(movie, from, to)` in `ui/fonts-missing.ts`, run from `sync()`, so it follows the range and edits. The button calls `askMissingFonts()`, the same Replace / Keep prompt, forced even for fonts the person chose to Keep. The note has its own `fm-ex-fontnote` class: reusing `fm-ex-notes` would hide the run box through its `:has` rule. Verified in Chromium with a movie using "Zorblax Display": note shows after Keep, the button opens the prompt, Replace clears the note.

## v0.17.0 · Fonts, Text and Export

- **Fonts library (L-IO-061/062/063/030/065).** `io/fonts-library.ts` talks to the engine's `/api/fonts` (new `backend/app/routers/fonts.py`, files in `<data>/Fonts`, family names in `.fonts.json`). `media/import.ts` `importFont` also installs every imported font in the library (fire and forget); `app.ts` loads the library once the engine answers and registers each file under the key `lib:<file>`, which `evictFonts` never drops. The Text card lists library fonts under "Fonts library"; picking one (Fonts tab or Spans font) calls `embedLibraryFamily`, which copies the file into the movie as a font asset in one "Embed fonts" undo step, so a shared `.fmo` still carries what it uses. Not done: fonts set by any other route (a paste, a preset) are not embedded until a Text card pick; the library list is re-read only at start and after an import or removal.
- **Remove font (L-IO-062).** Right click (or Delete on the focused row) a library or movie font in the Text card: a confirm, then the library files of that family go (the movie's own embedded copy stays) or the movie's font assets of that family go (Text falls back).
- **Missing font (L-IO-063).** `ui/fonts-missing.ts` watches `projects` events; on a newly opened movie it checks each Text family against bundled, generic, library, the movie's assets and a canvas width probe of the system. "Replace" swaps every use (runs included, locked tracks skipped) as one undo step; "Keep" is remembered per movie id and family in localStorage `formmorpheus.fontkeep`. Cancel/Rasterise of the reference is not built: Keep covers cancel, Rasterise has no equivalent here.
- **TTC (L-IO-030).** `media/fonts-ttc.ts` cuts each face of a collection into a plain sfnt file (table directory rewritten, tables copied); each face is its own font asset and library file with its own family. `.ttc` added to the font and general import pickers.
- **Bundled fonts (L-IO-065).** Anton, Sora, Space Grotesk, Poppins from `@fontsource` 5.3.0 (exact versions, published 2026-07-19, npm `license` OFL-1.1, each package carries its OFL text), loaded on demand through `font-bundle.ts`; NOTICE.md row added. The reference's other new faces (Japanese, Chinese, Arabic, Hindi, Thai) were already covered by the Noto families.
- **Default Text font (L-IO-064).** Kept as Inter: the reference's Helvetica Neue is not redistributable.
- **Text color (L-IO-158).** The Fonts tab swatch opens the shared `ColourPanel` (disc) beside the card, as the Stage background does; the Spans tab color is unchanged.
- **Select (L-IO-154).** `ui/text-edit-menu.ts` gets a Select row: the word at the caret (letters, digits, marks, apostrophe, hyphen).
- **Theater Share (L-IO-079).** The dialog now offers Movie file, Video, Frames as images. Video and Frames dispatch `fm:share-export`; `app.ts` opens the movie (with the unsaved-changes ask) and runs the Export window's quick tile (`mp4` or `png-frames`).
- **Folders (L-IO-074/145/082).** `ui/export-where.ts`: in the desktop app the folder dialog (`plugin:dialog|open`, the JS package is not a dependency, the same invoke the Theater uses) gives the engine a path and `backend/app/routers/save_to.py` (`/api/save-to/file`, `/api/save-to/frames`) writes there without replacing anything, cutting a frames zip into a folder named after the movie by file name only; in a browser with `showDirectoryPicker` the window writes the files itself. Frames default to "A folder of images" with "One zip file" as the other choice; other formats get "Choose a folder to save to" (off). A refused picker (no recent click) falls back to the old download. A zip turned into a folder is not kept again in Exports. Memory note: the zip is unpacked in one piece before writing.
- **Out field (L-IO-100).** Enter in In or Out reads the time, clamps it and writes it back as a timecode; it no longer starts the export.
- **GIF exact frames (L-IO-139).** "One GIF frame for every movie frame": `GifWriter.keepAll` writes an unchanged frame as a one pixel frame instead of lengthening the last. Checked: a still 12 frame range gave 1 GIF frame, 12 with the tick.
- **HEVC alpha (L-IO-111/117).** `jobs.py` reports `hevc.alpha` (true only when `hevc_videotoolbox` is in the ffmpeg build, since that encoder alone writes an alpha layer; `-alpha_quality 0.75`, BGRA) and the job then uses only that encoder. Not testable here (no such encoder); elsewhere the Transparent background row shows with the reason instead of hiding. Command line built from the encoder's documented options, unverified on a Mac.
- **Tester fix: folder export ended "cancelled".** The browser's directory picker rejects at once with AbortError when no dialog can be shown (headless, or no recent click), and that was read as a person cancelling. Now an AbortError under 700 ms counts as unavailable: the export runs as the zip download and the result carries "The folder could not be chosen here, so the file was downloaded instead." A real cancel (slower) still cancels. Checked in Chromium: the folder choice ended with a zip download and that notice.
- **Tester fix: frames estimate.** PNG sequences were estimated at 1.2 bytes a pixel (683 MB for 288 frames at 1080p); flat artwork compresses far better, so PNG and the default are 0.45 (TIFF keeps 1.2). Measure remains the exact figure.
- **Tester fix: Record sound Input.** With no microphone the Input select shows "No microphone found" instead of an empty box (`ui/voice-panel.ts`).
- **Export buttons (L-IO-096).** Close and Export stay on the one bar at the foot of the window on both tabs; Preview stays under the preview picture. `fm-ex-actions` is no longer mounted.

---

## v0.16.0 · brush engine

**Decision.** `Brush.scatter` is now a rotation scatter (0 to 1, 1 = any angle); the old sideways offset is `scatterPos`, and `rotationJitter` is a legacy alias (larger of the two wins). `ver: 2` marks the new meaning; `paint/brush-migrate.ts` converts older brushes (registerBrush, starters, Stroke constructor). Count lays n same-size copies across the stroke width; migrated multi-stamp brushes shrink to look as before.
- New optional Brush fields: `tiltCompress`, `rotFollow`, `grainRotFollow`, `burntMode`, `alphaThreshold`, `tipFilter`, `scatterPos`, `ver`. New blend ids: divide, linear-light, vivid-light, pin-light, hard-mix.
- Bristle: hairs lift off at pen-up (fray, no square end); dry mix is continuous (no 1 px ticks); pressure delivers paint (ramp strengthens). Mouse strokes get no ghost tail.
- Chalk: ceiling on stacked passes keeps tooth showing. Tilt compression lays same-size stamps along the azimuth.
- Speed and pressure smoothing are time-constant based, so they no longer depend on event rate.
- Wash: pen-up works in 160 px column strips inside a band around the stroke, LUT pow, pooled buffers; granulation from `paint/paper.ts` (seamless 512 px height map); bleed only grows alpha and blurs colour over the wash mask, so same-colour joins no longer pale.
- Wet map: marks are recorded as bit-packed masks and exchanged between worker and page (`wetTake`, `wetIngest`); times stored relative to an integer base so both threads read the same wetness. Verified identical hashes main/worker, wet and dry.
- Watercolor re-check: rim pooling 4.2x with a wider rim (0.15 of the size) and pigment 38% deeper at the rim on fresh paint; interior keeps most of its film. A rest bead grows with the rest (2.2 * sqrt(seconds), radius 0.5 to 0.85 of the size), visible from 0.5 s. Bleed now spreads the earlier wash's wetness (a band against a wet one runs into it); the work rectangle reaches 1.3 sizes past the stroke. The Watercolor and Watercolor wash brushes got a higher flow floor (0.55) and wetEdges 0.9.
- Tilt: oil bristle, impasto, thick oil and the Bristle set take tilt 0.6 (width follows the lean). Lead stub: max 20, min 4.5, flow floor 0.6.
- Not engine, left to others: G11, G20, G24 (Studio/cursor), G23 (3D). FB-042 not done. `heavy-blending` kept as an extra mode.

## v0.16.0 · Timeline

**Decision.** A block can be hidden by itself: `Content.hidden` (absent: shown), set by Alt-click on the chip's box (`engine/hide-ops.ts`). The renderer draws `visibleMovie(movie)`, one stripped copy per movie object (the same trick as the camera-less copy), so no draw path tests the flag. Its track stays; a plain click on the box still hides the whole track.
**Decision.** Ruler: seconds are bold with a taller tick and the frame numbers sit dim under them together whenever 3 px a frame or more; below that, seconds alone. Frame numbers near a second's label are left out so nothing overprints.
**Decision.** Blocks: a Drawing, Text or Shape sits on the movie's paper; a Flipbook is a strip of paper cells (peach, white seams) each showing its drawing, its color is the name chip (a pill, white text), new Flipbooks run 2 s (less at the movie's end) and take the next of the seven colors; a Group shows its children as dim bars; anything past the movie's end is dimmed and hatched. `ui/timeline-look.ts`.
**Decision.** Navigation: Space held over the Timeline pans a drag and a tap still plays (the key is held back until it comes up, `timeline-nav.ts`); J, K, L shuttle (`app/shuttle-commands.ts`; K and L are also bound to Add Key and the layers panel, so the shuttle answers them only outside Draw & Paint and K only while shuttling); the Ruler drag scrubs by default (View > Ruler Drag Scales Time flips it, Alt always scales); the eraser end of a pen deletes the block under it; right-click on a track header opens the track menu; a hovered lane row is tinted.
**Decision.** Sound import goes straight onto the Timeline; only a file over about 12 MB (or "Preview Sounds before Import" on) opens the preview. Snap to Seconds is optional (`snapOptions.seconds` in engine/snap.ts); loop range edges are snap targets now. Movie settings > Timeline has an Editing group for the four switches.
**Skipped.** FV-236 (a scrollbar on the lanes when zoomed out): the owner's rule is no scrollbar anywhere. GAP-13 (pink selection): the family keeps the orange accent; only the token `--fm-tl-select` was added, defaulting to the accent. GAP-26 (render cost warning on the ruler): the engine has no per-frame cost to read yet.
**Removed.** The ruler's 600-weight single label set; the always-red record pill (the pill keeps the accent, only the dot is red).
**Decision (tester fixes).** Locks hold in every mode: `ops.updateContent` throws "Track is locked" as the backstop, and the Stage `down()` no longer grabs content on a locked track. The track menu rows name the next action by state (Unlock track, Unmute sound, Unsolo sound). `revealSelected` scrolls the lanes when a selection lands under the mode switch. The heads toast auto-dismisses (1.1 s) and replaces the previous one. `TextStyle.preset` records the applied title preset so the Preset select shows its name. `brush-disk.ts` retries a new brush file with a numbered name when the engine answers 409 "already there", so duplicate names in one set get unique files (cause not reproduced; a name already in the folder is the likely source).

## v0.16.0 · Media, sound and delivery

- Follow-up. Export dialog: Close and Export sit at the top of the option column on Advanced (back in the footer on Quick share); the preview has a play square (about 12 fps over its sampled frames) and refreshes 700 ms after an option changes; 480p is a real choice. New tiles: Sprite sheet (`export/sprite-sheet.ts`: at most 256 frames, a PNG and a JSON of rects; checked 240 frames as 12 x 20 cells of 256 x 144 in a 3072 x 2880 PNG) and Copy current frame (PNG on the clipboard; a GIF cannot be put there, Chrome's ClipboardItem takes image/png only).
- Guides: 1:1 and 4:5 frames (`engine/guides.ts` `aspectRect`, shown and snapped to like the safe areas).
- Sound: master meter reads S, I and TP (estimated true peak by 4x oversampling, `media/loudness.ts`); the sound card shows a gain reduction bar from the ducking curve (`media/duck-meter.ts`); `media/beats.ts` finds onsets (spectral flux, three bands) and "Add Markers on Beats" puts a marker on each as one undo step (synthetic 12-click track: 12 of 12 found).
- Media bin proxies: `media/proxy.ts`, `VideoPool.setProxy/setUseProxies`. Make proxy (engine ffmpeg), Use proxies toggle; only the preview pool reads proxies, export never touches the pool and reads the original blobs. Proxies live in memory for the session (not saved in the movie).
- Theater: Info... (`ui/theater-info.ts`: reads only movie.json out of the .fmo for size, length, frame rate and tracks; file size and dates from the library listing) and Tags... (stored by the engine); a Tag filter in the bar appears once any tag exists, and the filter box also matches tags. A single "-" clears a movie's tags (the name prompt refuses empty).

- MP3: `export/audio-export.ts` `encodeMp3` posts the 16-bit WAV mix to the engine (`/api/audio-encode/mp3`); the Sound only dialog shows a bitrate row for MP3 and says in the dialog that the engine's ffmpeg encodes it, and disables Export with the reason when the engine reports no libmp3lame. No encoder was written in the browser.
- HEVC and ProRes now take Target bitrate and Target file size (`ui/export-extra.ts` `rateOk`); `export/engine-jobs.ts` sends `video_kbps` / `target_bytes` and reports the engine's note and two-pass line in the result warnings. `export/delivery.ts` estimates a ProRes target by its rate. The estimate line says "Two passes by the engine ffmpeg" or "ProRes picks the nearest profile, by the engine ffmpeg".
- Chapters from markers go into engine files only.
- Safe areas (`ui/stage-guides.ts`, `styles/stage-guides.css`): 2 px dashed outlines with a dark edge, a dimmed margin outside the inner of title / action, a tinted margin outside the vertical area, and a name at each outline's corner. The tester could not see the old 1.25 px, 85 percent outlines.
- Re-time chip (`ui/flip-tools.ts`): it was a scope toggle that only worked if pressed before the speed; pressed after Twos it did nothing visible. It now carries the speed already picked in the menu over the whole track in the same click.
- Stale library poster (`app/app.ts`): autosave reuses a poster up to 5 s old, and leaving never refreshed it when the file was already saved. The poster cache now records the engine revision and leaving redraws it when the revision moved.
- Sound import (`ui/import-preview.ts`): a sound under 60 s imports straight away; only a longer one (or one whose length cannot be read in 1.5 s) opens the Preview Sound dialog.
- FV-222 Advanced Export (`ui/export-cards.ts` new, `ui/export-dialog.ts`, `styles/export.css`): preview left, option column right at 72 / 28 in a 1120 px dialog; the rows sit in rounded 14 px cards (Presets, Video, Audio, Quality, Advanced) with label left and value right; a card with no visible row hides by CSS `:has`. All options are kept. Not done: moving Cancel / Share to the column's top right (the dialog footer keeps them) and a filmstrip scrubber with a play square (the preview already has a scrub bar and Play).

## v0.16.0 · Brush Studio and the brush library UI

Files: ui/brush-studio.ts, brush-studio-params.ts, brush-studio-curves.ts, brush-studio-pop.ts (new), brush-card-curves.ts (new), brush-glyphs.ts (new), brush-panel.ts, brush-thumb.ts, io/brush-import.ts (`brushFromParamsEx`), io/brush-export.ts, styles/brush-studio-pop.css (new), styles/paint-panels.css (`.fm-bp-*`).

Decisions: FB-G11. A setting that answers to the pen gets a small graph button (`Param.adv`); it opens one card built once and re-aimed (`SettingPop`): the typed value, that setting's own pressure graph (the same editor as the Pressure curves section, built with `only`), or the tilt trigger angle on a quarter circle (`tiltAngle`), or the barrel roll switch. The Pressure curves section stays as the overview. Pad settings are pad-only and kept raw in the recorded strokes (Pressure minimum and scale, a fixed tilt direction, Wet mix off, eight preview colors), so a setting can change after a stroke was drawn; they live in the pad prefs key. A reset point is `Brush.resetPoint` (a JSON snapshot of the settings without pictures and About text); Reset brush returns to it, else to the brush as opened. Link tip sizes is `Brush.taperLink` (Studio only, the engine ignores it). Use stamp preview is `Brush.stampPreview`: the library row and the exported thumbnail draw one stamp. Scatter (FB-G12): the engine builder's `ver 2` model is followed, so the Studio's Scatter is the random turn per stamp (rotation), Position scatter is `scatterPos`, Jitter lateral stays `pathJitter`, Randomized is gone (the engine takes the larger of scatter and rotationJitter, and old brushes are converted by paint/brush-migrate.ts). Import: files from elsewhere map shapeScatter and shapeRandomise to Scatter and plotJitter to Jitter lateral; our format 3 adds fmScatterPos; format 2 files map their fmScatter to Position scatter and the old Randomized (shapeScatter) to Scatter; format 1 maps plotJitter to Position scatter. Imported brushes carry `ver: 2`. The Studio has rows for the engine's rotFollow, grainRotFollow, tiltCompress, burntMode, alphaThreshold, tipFilter (None, Classic, Improved) and a grain blend list of every blend mode. Brush panel (FV-217): the library name is the title (tap for the library list), the three header tools became one + menu (Create new set, Create new brush, Import from Files) and More, 14 glyphs by set name (`brush-glyphs.ts`), rows 80 px with the name in its own bold strip and the stroke drawn below it (tall tips such as Arrow and Scatter no longer reach the name). The Pressure & Smoothing card (FV-240) gained the pressure graph with tabs for size, opacity and flow and an Advanced button into the Studio.

Removed code: the previous and next library buttons and the Import tool button in the brush panel header (the + menu and the library list replace them); the Smooth / Sharp filter list and the Randomized and Follow stroke rows of the Studio (replaced by the three-way Filter, Scatter and the Follow stroke slider).

Not done: Pressure factor for taper and Tip animation (engine); Hover fill (needs the cursor layer in paint-view); the barrel roll default (relative off) and the tilt angle default 0 stay, because changing a default changes every saved brush.

---

## v0.16.0 · Draw & Paint tools and toolbar

**Decision (GP-015).** The Select bar shows the six reference actions (Add, Remove, Invert, Copy & Paste, Color Fill, Clear), an overflow "..." and Done. The overflow (`PaintTools.openMore`, a `Popover`) holds Sample all layers (with a check; the button shows a dot while it is on), Reload and Deselect. `click` was split: `runAct(act, anchor)` is shared by the bar and the overflow.
**Decision (GP-016).** A finished selection shows only the diagonal stripes over the unselected area plus a faint 1 px edge; the black and white dashed line is drawn only while a selection is being drawn (`drawOverlay`, the dash offset advances with the clock on each pointer move). `drawOutline` lost its black dashes.
**Decision (GP-017, GP-018).** Transform handles are small filled dots (corners 4.5 px, sides 3.5 px); the amber node now sits below the bottom edge on a stem, mirroring the green rotate node (`fitNode`). Advanced Mesh stays visible and dim (disabled) outside Warp. A touch tap just outside an edge nudges 1 px toward it, outside a corner diagonally (`edgeTap`, within 44 screen px, touch only).
**Decision (FV-218).** The side rail has plain dark tracks, a 30 x 16 light pill thumb and no tinted fill; the memory ticks show only while the rail is hovered or focused. The size bubble stays a stroke sample (a dot would not show a brush's character); it now sits on a bright ground that flips to dark for light colors, the Size bubble paints at full strength, the preview pressure is firm (0.7 to 1) and the sample is drawn 3x the on-screen size. It closes 1.5 s after the pointer leaves it, at once on a tool switch, Esc or a press on the picture.
**Decision (FV-219).** The top bar has no centre label: "Track 1 · frame 3 of 24" goes to the status bar's hint slot (`ui/paint-hint.ts` swaps the shell's text and restores it on close). Tool glyphs are 24 px on a 64 px pitch, all filled (`ui/paint-icons.ts` has filled Eyedropper and Fill glyphs; the shared outline ones are untouched). Preference "Hide Eyedropper and Fill buttons" (Settings > Prefs, `hideToolExtras`, off by default) hides the two extras; their keys (I, G) and the Alt hold still work. The extras stay between Erase and Layers when shown.
**Decision (GP-008).** While a standing fill is on, the ColorDrop toast reads "ColorDrop" and "Continue filling" beside the tick that ends it. The old top toast "Click an area to fill it..." was removed (it sat under the new one); the how-to is the button's tooltip. The 0.976 clamp and the remembered threshold were checked: dragging to the far right reads "Threshold 100%" and stores 0.976. SwatchDrop uses the same `ColourDrop` (code read: `swatchDrag`). A group row is skipped by the fill (`begin`), and painting on one says "Select a layer to paint on" (now translated).
**Decision (GP-025).** `ui/brush-libs.ts`: a Libraries screen inside the brush panel, miniature cards (a stroke of the library's first brush, set and brush counts), opened by "All libraries" in the library menu, a two-finger pinch in on touch, or Ctrl + wheel inward. Cards are made once per library and patched in place; Esc closes the screen before the panel.
**Checked, no change.** GP-001 (hold a circle, Shift makes it regular, the toast's Edit Shape menu redoes it as a rectangle as one step), GP-003 (first stroke: the default Sketch Lead stub reads at about 83 percent of the color at 0.5 pressure and 6 px wide; the "pale hairline" was the old Studio ink), GP-009 (hold to pick defaults to All; a mouse press held 900 ms opens the loupe), GP-019 (filter list order and the "Adjustment filters" title), GP-007 and GP-014 (Automatic is the default Select mode; the filter screen has the title chip with the value, the bottom pill and the right tile cluster), GP-029 (the brush panel stays open after a pick, Esc closes it).
**Not done.** The extras are not moved after the five reference tools; the Size bubble is not a square with a dot (see above). GP-032 is test data in the scratch engine folder, not shipped code.

## v0.16.0 · Draw & Paint panels

Layers panel, Color panel, Flipbook strip, paint settings. Files: ui/layers-panel.ts, ui/colour-panel.ts, ui/flip-strip.ts, ui/flip-select.ts, ui/flip-mini.ts, ui/paint-settings.ts, styles/w16-panels.css (new), styles/colour.css, styles/flip-strip.css.

Decisions: GP-026 default kept. History stays at 10 swatches. Palette grid is 3x9 (27 footer swatches, 36 slots). Hold-to-pick defaults to All (pen and mouse); a stored Touch without a recorded choice follows the new default. Dynamic brush scaling labels are Pixel, Canvas, Screen. Prefs order: cursor, outline, pressure curve, stabilization, scaling, sidebar, finger, scrub speed, then Pen and input, then Files (Brush folder).

Removed code: Layers header Delete/Group icon buttons and the add-group button (now a + with Alt for group, text buttons only in multi-select); the box Lasso in flip-select (now a freehand SVG loop); strip cell numbers on by default (ruler carries them); palette card duplicate/default/delete buttons (now a tick and an ellipsis menu).

---

## Org-navi-map

```
frontend/
├── index.html                  critical style, theme boot, stage-share boot, stylesheet order, #app, #overlay-root, #toast-root
├── package.json                deps: fontsource, tauri api, fflate; dev: tauri cli, typescript, vite
├── vite.config.ts              port 5194, host false, strictPort, /api proxy to 9494
├── tsconfig.json               strict, bundler resolution, src only
├── oc_install / boot_frontend  install & dev server scripts (+ .bat)
├── public/
│   ├── splash.html             the desktop splash card, formmorpheusSplashDone()
│   └── favicon.ico/.png, apple-touch-icon.png, mark.png
└── src/
    ├── main.ts                 applyTheme, language, startApp, page translator
    ├── version.ts              VERSION (the dispatcher reads this line)
    ├── app/
    │   └── app.ts              shell template, commands, menus, keys, save/open, import, autosave, reveal
    ├── engine/                 no DOM imports; usable w/o the UI
    │   ├── types.ts            Movie, Track, Content, Asset, blend modes, presets
    │   ├── model.ts            factories, ids, lookups, spans
    │   ├── time.ts             fps presets, timecode, parse
    │   ├── ops.ts              pure movie edits (tracks, content, trims, groups, movie settings)
    │   ├── history.ts          snapshot undo w/ merge tags, recovery points, shared-node packing
    │   ├── engine.ts           Engine: run/undo/redo, selection, Playhead, modes, playback, jobs
    │   ├── events.ts           typed emitter
    │   ├── flip-ops.ts         Flipbook rows & frames, holds, split, conversion to & from tracks
    │   ├── keys.ts             keyframe kinds & channels, temporal Bezier eases, animate()
    │   ├── key-ops.ts          pure key edits: lanes, keys, eases, reverse, copy & paste, shift, scale
    │   ├── perform.ts          Perform takes: Recorder, motion filtering, key reduction, applyTake
    │   └── render.ts           Canvas 2D compositor: tracks, blends, masks, groups, flipbook rows, video, keys & live filters, prepareFrame, thumbnails
    ├── media/                  video & sound (no DOM except the AudioContext, FontFace & canvases)
    │   ├── types.ts            MediaInfo, VideoSource, AudioClip, ClockSource
    │   ├── video.ts            VideoPool: mediabunny decode window, exact frames, filmstrip thumbs
    │   ├── audio.ts            AudioEngine: decode, peaks, play on one AudioContext (the playback clock), scrub, mixdown
    │   ├── import.ts           importMedia: sniff, probe, assets & blocks for pictures, GIF, TIFF, video, sound, fonts
    │   ├── fonts.ts            registerFonts, FONT_FAMILIES
    │   └── gif-decode.ts, tiff-decode.ts
    ├── export/
    │   ├── types.ts            ExportOptions, ExportJob, ExportResult
    │   ├── run.ts              startExport: frame loop, mediabunny MP4 / WebM / MOV, GIF, frame zips, still
    │   └── gif.ts              median-cut quantiser, dithers, LZW, GifWriter
    ├── paint/                  the paint core, no DOM (OffscreenCanvas only in doc.ts)
    │   ├── types.ts            contract: Raster, Mask, PixelPatch, PenSample, Brush, StrokeSettings, PaintLayer
    │   ├── tips.ts, dynamics.ts, brushes.ts   tip shapes & grain, pressure curve & tilt, the starter library
    │   ├── stroke.ts           dab engine: paint, smudge, erase, opacity cap, alpha lock, selection, tile snapshots
    │   ├── input.ts            PointerEvents to PenSamples: coalesced & predicted points, streamline
    │   ├── preview.ts          brush stroke previews for the panel
    │   ├── doc.ts, history.ts  PaintDoc layers, compositing w/ clipping, encode & load, paint undo
    │   ├── fill.ts, select.ts, transform.ts   color drop & fills, masks & outlines, affine / quad / mesh resampling
    │   └── filters.ts          blur, sharpen, noise, HSB, lens blur (Draw & Paint & Keyframe live filters)
    ├── io/
    │   ├── api.ts              engine service client (library, capabilities, service state)
    │   ├── disk.ts             path helpers
    │   └── fmo.ts              .fmo zip: manifest, movie, history, assets, poster
    ├── ui/
    │   ├── stage-view.ts       Stage canvas, timecode, selection box, Compose move/scale/rotate
    │   ├── timeline.ts         transport row, ruler & tracks canvases, drags, mode pill, Edit pill
    │   ├── popover.ts          glass popover built once, submenus
    │   ├── content-menu.ts     content options popover
    │   ├── track-menu.ts       track options popover
    │   ├── movie-settings.ts   Movie settings popover (Project, Stage, Timeline)
    │   ├── new-movie-dialog.ts New Movie dialog
    │   ├── settings-dialog.ts  Preferences (General, Interface, Timeline)
    │   ├── status.ts           status bar: undo/redo, movie size, hint, jobs, engine
    │   ├── shell-model.ts      the small model Home & Jobs read
    │   ├── titlebar-tools.ts   theme toggle & command search
    │   ├── prefs.ts            formmorpheus.prefs store, font size, scale, system theme
    │   ├── icons-morph.ts      animation icons merged into ICONS
    │   ├── brand.ts            brand mark
    │   ├── paint-view.ts       Draw & Paint: canvas, top bar, sidebar, strokes, frames, onion skins, saving
    │   ├── paint-tools.ts      Select, Transform & Filters capsule & interactions
    │   ├── paint-settings.ts   Settings popover (Add, Canvas, Onions, Prefs) & the pressure curve
    │   ├── brush-panel.ts, layers-panel.ts, colour-panel.ts, flip-strip.ts   Draw & Paint panels
    │   ├── key-lanes.ts        keyframe lane layout, drawing & hit tests
    │   ├── action-menu.ts      Action menu, Motion & Live Filters lists, parameter cards (record in Perform), lane menus
    │   ├── perform-ui.ts       Perform banner, Modifications popover, perform settings
    │   ├── export-dialog.ts    Export dialog: Quick share, Advanced, progress, cancel
    │   ├── text-card.ts        Text options: words, font, size, weight, colour, alignment
    │   └── (from formvis)      dom, themes, icons, i18n, i18n/langs, commands, menu, native-menu,
    │                           caption-buttons, home, home-files, jobs-list, toast, dialogs,
    │                           dialog-history, dropdown, number-fields, command-palette, panels/controls
    └── styles/
        ├── tokens.css, fonts.css, shell.css, panels.css, dialogs.css, light-mode.css, scrollbars.css   (from formvis)
        ├── morpheus.css        Stage over Timeline layout & timeline tokens
        ├── popovers.css        popover, content, track, movie settings, new movie styles
        ├── paint.css           Draw & Paint view, sidebar, tools capsule
        └── paint-panels.css, paint-settings.css, colour.css, flip-strip.css, keyframes.css
```

---

## Table of contents

- [index.html](#index-html)
- [src/app/app.ts](#src-app-app)
- [src/engine/types.ts](#src-engine-types)
- [src/engine/ops.ts](#src-engine-ops)
- [src/engine/history.ts](#src-engine-history)
- [src/engine/engine.ts](#src-engine-engine)
- [src/engine/render.ts](#src-engine-render)
- [src/io/fmo.ts](#src-io-fmo)
- [src/ui/stage-view.ts](#src-ui-stage-view)
- [src/ui/timeline.ts](#src-ui-timeline)
- [src/ui (copied from formvis)](#src-ui-copied)
- [src/styles](#src-styles)
- [Phases 10 to 12 (v0.6.0)](#p1012)
- [Phases 13 to 15 (v0.7.0)](#p1315)
- [Phases 16 to 19 (v0.8.0)](#p1619)

---

## index.html {#index-html}

### index.html · theme boot & stage-share boot
- refers-to: index.html :: the two inline scripts in head
- kind: rationale
- logged: v0.3.0 · 2026-10-30

The theme boot is formvis's, unchanged except the skin key (`formmorpheus_user_skin`); `nodemode_ui_settings` stays shared w/ the family as the owner's map requires. The formvis dock boot was replaced by a stage-share boot that writes `--fm-stage-share` from `formmorpheus.prefs` before first paint, so the Stage and Timeline split never jumps. The `/node_modules` font preloads were dropped: they only resolve under the dev server.

---

## src/app/app.ts {#src-app-app}

### src/app/app.ts · startApp
- refers-to: src/app/app.ts :: startApp
- kind: rationale
- logged: v0.3.0 · 2026-10-30

Single movie at a time (no tab strip): the title row shows the movie name and the window title follows `• name - formmorpheus`. Home is formvis's Home screen and is opened by the Theater button. Every `button[data-cmd]` is synced from the command registry in one animation frame and run through one delegated click handler. The Create menu's items are set when it opens because a standalone PopupMenu resolves command ids at `setItems` time and the commands did not exist yet at construction (a v0.3.0 bug: the menu opened empty).

### src/app/app.ts · openFromLibrary, openFile, importImage
- refers-to: src/app/app.ts :: openFromLibrary, openFile, importImage
- kind: rationale
- logged: v0.3.0 · 2026-10-30

Pictures are decoded (`renderer.preload`) before the movie opens or the content is placed. Without it the Stage painted the movie once without its pictures and again a frame later, a visible blink under 4x CPU throttling.

### src/app/app.ts · importFiles
- refers-to: src/app/app.ts :: importFiles
- kind: todo
- logged: v0.3.0 · 2026-10-30

Video and audio are refused w/ a notice until the media phase (Phase 8). Drawings & flipbooks open a notice in `editContent` until Draw & Paint (Phase 4).

---

## src/engine/types.ts {#src-engine-types}

### src/engine/types.ts · Content
- refers-to: src/engine/types.ts :: Content, Movie
- kind: rationale
- logged: v0.3.0 · 2026-10-30

Time is integer frames at the movie fps (`start`, `duration`, `offset`); seconds appear only in labels. `offset` is the trimmed head of the source, so trims are non-destructive. Every content kind carries every field (layers, frames, text, tracks) so the type stays flat and serialises the same way for all kinds. `transform.x/y` are offsets from the movie centre in movie pixels.

---

## src/engine/ops.ts {#src-engine-ops}

### src/engine/ops.ts · whole file
- refers-to: src/engine/ops.ts :: every export
- kind: rationale
- logged: v0.3.0 · 2026-10-30

Pure functions: each returns a new Movie and copies only the path it changes, so history snapshots share everything else. A refused edit throws `OpError` w/ a sentence for the person; `Engine.run` turns it into a notice and records nothing.

### src/engine/ops.ts · trimContent
- refers-to: src/engine/ops.ts :: trimContent
- kind: explainer
- logged: v0.3.0 · 2026-10-30

A plain trim stops at the neighbour and at the source length (video, audio, flipbook). `ripple` (Free Trim, Alt in the timeline) pushes later content right when an end grows, and earlier content left when a start moves.

### src/engine/ops.ts · groupContent, ungroupContent
- refers-to: src/engine/ops.ts :: groupContent, ungroupContent
- kind: explainer
- logged: v0.3.0 · 2026-10-30

A group holds its own tracks w/ starts rebased to the group start; ungroup puts each inner track back as a new track at the group's place and restores absolute starts. Tracks that grouping empties are removed (the top one hosts the group), and ungroup removes the group's track when it is left empty, so a group then ungroup returns the same number of tracks (v0.3.0 fix: two empty tracks were left behind).

---

## src/engine/history.ts {#src-engine-history}

### src/engine/history.ts · History
- refers-to: src/engine/history.ts :: History.record
- kind: rationale
- logged: v0.3.0 · 2026-10-30

Snapshot undo after formvfx's engine (Arc snapshots there, structural sharing here). A gesture passes one merge tag on every step so a drag is one undo step; `endGesture` closes it. Depth 0 means unlimited. A recovery point is taken when a new edit discards a redo branch of 3 or more steps: the tip of that branch is kept (up to 3).

### src/engine/history.ts · packStates
- refers-to: src/engine/history.ts :: packStates, unpackStates
- kind: explainer
- logged: v0.3.0 · 2026-10-30

The saved history is a table of unique objects: shared subtrees are written once and referenced by index, so a long history costs roughly what it changed, not one movie per step.

---

## src/engine/engine.ts {#src-engine-engine}

### src/engine/engine.ts · run
- refers-to: src/engine/engine.ts :: Engine.run
- kind: explainer
- logged: v0.3.0 · 2026-10-30

`run(label, fn, merge)` is the only way the movie changes. `fn` may return a Movie or `{ movie, select }`. Playback uses an injected Ticker (the app gives it requestAnimationFrame) so the engine has no DOM dependency.

### src/engine/engine.ts · nameMovie
- refers-to: src/engine/engine.ts :: nameMovie
- kind: rationale
- logged: v0.3.0 · 2026-10-30

Saving under a name renames the movie w/o an undo step: the name is the file's, not an edit.

---

## src/engine/render.ts {#src-engine-render}

### src/engine/render.ts · composeTracks
- refers-to: src/engine/render.ts :: Renderer.composeTracks
- kind: explainer
- logged: v0.3.0 · 2026-10-30

Tracks draw bottom to top. Each content renders into its own layer, held one step before it is composited, so the content above can still act on it: clipping clips the new layer to the held one; an alpha or luminance mask (optionally inverted) cuts the held layer and is not drawn itself. Groups draw their inner tracks into the parent layer; passthrough blends as normal at the group level.

### src/engine/render.ts · preload
- refers-to: src/engine/render.ts :: Renderer.preload
- kind: rationale
- logged: v0.3.0 · 2026-10-30

Decodes image blobs into the bitmap cache ahead of first paint; see app.ts openFromLibrary.

---

## src/io/fmo.ts {#src-io-fmo}

### src/io/fmo.ts · layout
- refers-to: src/io/fmo.ts :: packMovie
- kind: explainer
- logged: v0.3.0 · 2026-10-30

A zip: `manifest.json` (app, format, version, saved, history flag), `movie.json`, `history.json` (labels, recovery metadata, packed states), `assets/<id>` (stored, no compression), `poster.png` (480 px wide, read by the Home screen through the backend). A newer format number is refused w/ a message. A share w/o history omits `history.json`.

---

## src/ui/stage-view.ts {#src-ui-stage-view}

### src/ui/stage-view.ts · hideSvg
- refers-to: src/ui/stage-view.ts :: hideSvg
- kind: warning-context
- logged: v0.3.0 · 2026-10-30

`setHidden` from dom.ts writes the `hidden` property, which SVG elements do not have; the selection box stayed hidden. SVG uses the attribute through `hideSvg`.

### src/ui/stage-view.ts · move
- refers-to: src/ui/stage-view.ts :: StageView.move
- kind: explainer
- logged: v0.3.0 · 2026-10-30

Compose transforms on the Stage: move snaps to the centre and quarter lines within 8 screen pixels (Alt turns snapping off), corner handles scale about the centre, the top handle rotates (Shift: 15 degree steps). Each drag is one undo step through a merge tag.

---

## src/ui/timeline.ts {#src-ui-timeline}

### src/ui/timeline.ts · TimelineView
- refers-to: src/ui/timeline.ts :: TimelineView
- kind: explainer
- logged: v0.3.0 · 2026-10-30

DOM for the transport row, the Edit pill and the mode pill; two canvases for the ruler and the tracks, redrawn in one animation frame on engine events (formvfx timeline pattern). Zoom is pixels per frame; ruler labels are seconds once a second is 40 px wide, frames below. Ruler click or drag scrubs, Alt-drag on the ruler zooms, Ctrl or Cmd wheel zooms about the pointer, Shift wheel pans, middle drag pans. On tracks: click selects and moves the Playhead into the block, Shift or Cmd adds, drag moves in time and between tracks, the edges of a selected block trim (Alt: Free Trim), drag on empty lane w/ Multi-select or Shift draws a box, the end-of-movie bar sets the duration, right-click opens content or track options, double-click edits.

### src/ui/timeline.ts · TOP_PAD
- refers-to: src/ui/timeline.ts :: TOP_PAD
- kind: rationale
- logged: v0.3.0 · 2026-10-30

26 px above the first lane so the Edit pill sits above the top block instead of over its name chip.

### src/ui/timeline.ts · tracksDown
- refers-to: src/ui/timeline.ts :: TimelineView.tracksDown
- kind: rationale
- logged: v0.3.0 · 2026-10-30

A selected block's edge wins over the movie's end bar when they meet (a block that runs to the end of the movie); the end bar sets the duration only away from an edge.

---

## src/ui (copied from formvis) {#src-ui-copied}

### src/ui · provenance
- refers-to: src/ui :: dom, themes, icons, i18n, i18n/langs, commands, menu, native-menu, caption-buttons, home, home-files, jobs-list, toast, dialogs, dialog-history, dropdown, number-fields, command-palette, panels/controls
- kind: explainer
- logged: v0.3.0 · 2026-10-30

Copied from formvis 1.98.4 (owner's repo, Apache-2.0), then edited by hand: storage keys renamed `formvis.*` to `formmorpheus.*`; the Engine type in home, jobs-list and command-palette replaced by `ShellModel` or removed; Home text, nav labels, format chips & presets made for movies; i18n tables emptied (English is the key and passes through; 30 languages stay selectable for when tables ship). Inherited doc comments in the copied files are comment debt, migrated here when a file is next touched.

### src/ui/i18n.ts · LOADERS, MORE, EXTRA
- refers-to: src/ui/i18n.ts :: the three table maps
- kind: removed-code
- logged: v0.3.0 · 2026-10-30

Removed: the 29 dynamic imports per map pointing at `./i18n/<code>`, `./i18n/more/<code>`, `./i18n/extra/<code>` (formvis 1.98.4 `frontend/src/ui/i18n.ts` lines 10 to 62). Those tables are keyed by formvis's English strings and weigh 3.6 MB; formmorpheus ships its own tables later. `load()` now tolerates a missing loader.

### src/ui/panels/controls.ts · matrixRow, curveRow
- refers-to: src/ui/panels/controls.ts :: after colorRow
- kind: removed-code
- logged: v0.3.0 · 2026-10-30

Removed: `matrixRow` and `curveRow` (formvis 1.98.4 `frontend/src/ui/panels/controls.ts` lines 107 to 195), filter widgets that imported the formvis engine (`clamp`, `filters-lib/distort.curveValue`). A local `clamp` replaces the import. The easing curve editor of Phase 6 may start from `curveRow`.

### src/ui/titlebar-tools.ts · TitleTools
- refers-to: src/ui/titlebar-tools.ts :: TitleTools
- kind: removed-code
- logged: v0.3.0 · 2026-10-30

Written fresh in formvis's shape w/o the workspace select, Lock Workspace, the Claude Code and terminal buttons (`WORKSPACES`, `loadCustom`, `saveCustom`, `choose`, `addCustom`, `removeCustom`, `syncCustom`, `syncDock`; formvis 1.98.4 `frontend/src/ui/titlebar-tools.ts`). formmorpheus has a fixed Stage over Timeline layout and no dock. Kept: theme toggle and command search.

### src/ui/command-palette.ts · render
- refers-to: src/ui/command-palette.ts :: CommandPalette.render, constructor
- kind: removed-code
- logged: v0.3.0 · 2026-10-30

Removed the tool and tool-variant hits loop (`for (const t of toolList()) { ... }`, formvis 1.98.4 lines 118 to 130) and the `engine` constructor argument; formmorpheus has no tool registry yet. Commands and menu paths remain.

### src/ui/native-menu.ts, dialogs.ts, icons.ts · comments
- refers-to: native-menu.ts :: header and accelerator docs; dialogs.ts :: Dialog.close focus note; icons.ts :: objectSelect
- kind: removed-code
- logged: v0.3.0 · 2026-10-30

Three doc comments that named formvis were removed; their content: native menus mirror the in-window MenuDef list and only run on macOS; focus left in a hidden dialog is blurred so shortcuts reach the app again; the Object Selection icon is a dashed frame w/ a pointer.

---

## src/styles {#src-styles}

### src/styles · shell.css, panels.css, dialogs.css
- refers-to: src/styles :: shell.css, panels.css, dialogs.css
- kind: todo
- logged: v0.3.0 · 2026-10-30

Copied whole from formvis 1.98.4; most selectors (rail, options bar, layers, tiles, video timeline, plugins, assistant) are unused here. Prune by selector in a dedicated, approved pass; `morpheus.css` overrides the grid for the Stage over Timeline layout.

---

## src/paint (Phase 4) {#src-paint}

### src/paint · provenance
- refers-to: src/paint :: every file
- kind: rationale
- logged: v0.4.0 · 2026-10-30

A self-contained CPU paint core on plain straight-alpha RGBA rasters (ImageData layout, so a raster moves to a canvas w/o conversion). formvis's stroke engine is tied to tiled rasters, GPU dabs & its document, so the dab placement, opacity cap, smudge & pressure dynamics were adapted rather than copied whole; fill, select, transform & filters were written fresh against `types.ts`. The brush library, tip shapes & palettes are original.

### src/paint/stroke.ts · Stroke
- refers-to: src/paint/stroke.ts :: Stroke
- kind: warning-context
- logged: v0.4.0 · 2026-10-30

The stroke opacity cap holds per stroke through a coverage buffer; tile snapshots (64 px) are taken on first touch so `finish()` returns one exact patch. The first dab waits for the second sample so a stroke-following dab knows its angle. `predicted` samples are ignored here (drawing them is the view's job; the view does not draw them yet). Mouse pressure is a fixed 0.5 and does not go through the pressure curve. Measured: one 2,000 sample stroke at 120 px on 3840x2160 about 490 ms in node (0.6 ms a dab).

### src/paint/stroke.ts · applySmudge
- refers-to: src/paint/stroke.ts :: applySmudge
- kind: fix
- logged: v0.4.0 · 2026-10-30

Smudge first only mixed colour inside existing paint (alpha untouched, from a wrong brief), so it never smeared. It now mixes the carried paint into the layer in premultiplied space, alpha included: paint drags out past its edge & dragging from empty canvas thins it. With alpha lock it mixes colour only.

### src/styles/paint.css · .fm-paint z-index
- refers-to: src/styles/paint.css :: .fm-paint
- kind: fix
- logged: v0.4.0 · 2026-10-30

The view sits at `--z-menu`, level w/ `#overlay-root`, which comes later in the page & so stays on top: the Flipbook strip's frame & track menus live there. At `--z-modal` they opened behind the canvas.

### src/paint/doc.ts · composite
- refers-to: src/paint/doc.ts :: composite
- kind: warning-context
- logged: v0.4.0 · 2026-10-30

Composites every visible layer each call; the view clips to the dirty rectangle before calling it (measured in headless software rendering: 20 layers at 4K, 90 to 190 ms clipped vs 410 to 540 ms unclipped). A clipped layer w/ a non-normal blend is exact over an opaque base & approximate at soft edges.

### src/paint/doc.ts · encode
- refers-to: src/paint/doc.ts :: encode
- kind: rationale
- logged: v0.4.0 · 2026-10-30

Layers are stored as PNG pixel assets, one per changed layer, so a saved Drawing is ordinary pictures in the `.fmo` & the movie history only records asset ids. `convertToBlob` took about one second for a 1080p layer in headless Chromium, which is why the view saves Flipbook frames in the background (see paint-view).

## src/ui/paint-view.ts {#src-ui-paint-view}

### src/ui/paint-view.ts · commitDoc, parked
- refers-to: src/ui/paint-view.ts :: commitDoc, encodeDoc, loadDoc, parked, saving
- kind: rationale
- logged: v0.4.0 · 2026-10-30

Moving to another Flipbook frame parks the open PaintDoc & encodes it on a promise chain; the frame is found again by its id when the encode lands (frames can move meanwhile), the parked doc is reused if the person returns before it lands, & onion skins & strip thumbnails draw parked docs live. Done & strip edits wait for the whole chain. Frame moves pressed while a load runs are queued (`pendingNav`), never dropped.

### src/ui/paint-view.ts · drawOnions, ghosts
- refers-to: src/ui/paint-view.ts :: drawOnions, ghosts
- kind: rationale
- logged: v0.4.0 · 2026-10-30

Tinted onion frames are built once per frame & setting & cached (24 kept); rebuilding them on every repaint made strokes on a Flipbook stall. Ghosts fade w/ distance from the current frame. Onion settings are the movie's unless the Flipbook has its own (`content.onion`).

### src/ui/paint-view.ts · redraw
- refers-to: src/ui/paint-view.ts :: redraw, paint, cursorBox
- kind: warning-context
- logged: v0.4.0 · 2026-10-30

Pixel changes repaint only their screen rectangle (plus the old brush outline box); view changes repaint everything. Keep that split: a full repaint per pointer move is too slow at 4K.

### src/ui/paint-tools.ts · lift, commitFloat
- refers-to: src/ui/paint-tools.ts :: lift, commitFloat, dropFloat
- kind: warning-context
- logged: v0.4.0 · 2026-10-30

Transform lifts the selection (or every pixel w/ alpha) into a float & keeps a full copy of the layer; Done writes one patch over the union of the source & destination rectangles, Cancel restores the copy. Freeform & Uniform preview through the canvas transform (fast); Distort & Warp preview by real resampling on pointer up.

## src/engine (Phases 5 & 6) {#src-engine-p56}

### src/engine/types.ts · FlipTrack, KeyLane
- refers-to: src/engine/types.ts :: FlipTrack, Key, KeyLane, OnionSettings
- kind: rationale
- logged: v0.4.0 · 2026-10-30

Flipbooks hold rows (`flip`), each a list of frames w/ holds that loop; `frames` on Content was replaced before any file shipped. Keys are stored per channel in content-local frames, w/ the ease of the span leaving each key; `options` carries the non-animated lane settings (Noise style). Onion settings count back & forward frames separately (0 turns a side off).

### src/engine/keys.ts · evalChannel
- refers-to: src/engine/keys.ts :: evalChannel, easeCurve
- kind: rationale
- logged: v0.4.0 · 2026-10-30

Ported from formvfx's temporal Bezier (speed & influence, Newton then bisection); the presets use speed 0 & 33 percent influence on the eased end(s). Binary search, no allocation: about 71 ns a call on a 200 key channel.

### src/engine/ops.ts · trimContent, splitContent, patchMovie
- refers-to: src/engine/ops.ts :: trimContent, splitContent, patchMovie
- kind: rationale
- logged: v0.4.0 · 2026-10-30

Trimming the start or splitting shifts keys so they stay at the same movie time; a frame rate change scales key times & Flipbook holds by the same ratio as content starts & durations.

### src/engine/render.ts · applyFilters
- refers-to: src/engine/render.ts :: applyFilters
- kind: todo
- logged: v0.4.0 · 2026-10-30

Live filters run on the content's whole view-sized surface w/ getImageData, so a blur costs 100 ms or more a frame in software rendering. Limit the work to the content's bounds & move it to a worker (or the GPU compositor) before Phase 9 export.

## Phases 7 to 9 (v0.5.0) {#p789}

### src/app/app.ts · audio clock
- refers-to: src/app/app.ts :: engine.setTicker, playing, wrap, time handlers
- kind: rationale
- logged: v0.5.0 · 2026-10-30

The Engine's ticker reads `audio.now()`: while sound plays it is the AudioContext clock continued from the moment playback started, otherwise performance.now(). The Engine derives the frame from elapsed clock time, so pictures follow the sound card and cannot drift. Loop turns (`wrap`) restart the sound from the new frame; ping pong backwards plays no sound but keeps the clock. Seeks while stopped scrub about one frame of sound.

### src/media/video.ts · VideoPool
- refers-to: src/media/video.ts :: VideoPool
- kind: warning-context
- logged: v0.5.0 · 2026-10-30

On screen `frame()` never returns a blank once a frame of the asset was shown (it returns the last frame while the wanted one decodes); `exact()` is for export & stills. Decoded frames are copied to canvases so the decoder never stalls on held VideoFrames; the window is about 1 s behind & the prefetch ahead, capped at 400 MB.

### src/media/import.ts · importMedia
- refers-to: src/media/import.ts :: importMedia
- kind: rationale
- logged: v0.5.0 · 2026-10-30

Files are recognised by their bytes first, the extension second. Animated GIFs become Flipbooks (one PNG pixel asset per picture, holds from the delays at the movie's frame rate w/ the rounding error carried); TIFF is decoded here & stored as PNG bc browsers do not read it; fonts become assets registered w/ FontFace on import & on every open.

### src/export/run.ts · startExport
- refers-to: src/export/run.ts :: startExport
- kind: rationale
- logged: v0.5.0 · 2026-10-30

Export renders on the main thread through the same renderer, frame by frame w/ `prepareFrame` (exact pictures & video), yielding every frame through a MessageChannel so a background tab does not throttle it (the plan said a worker; the decoders & bitmaps live on the main thread). Codecs are chosen by what the browser can encode: MP4 & MOV take H.264 then HEVC, AV1, VP9; sound AAC when encodable, else Opus w/ a warning (QuickTime does not play Opus in MP4).

### src/engine/perform.ts · Recorder, applyTake
- refers-to: src/engine/perform.ts :: Recorder, filterMotion, reduceKeys, applyTake
- kind: rationale
- logged: v0.5.0 · 2026-10-30

A take keeps one key per touched frame (skipped frames bridged linearly), then a zero-phase Gaussian (sigma 3 x filtering frames) & Ramer-Douglas-Peucker w/ a tolerance from the channel's range. While the pen is down the unfiltered take is applied under one merge tag, & on lift the filtered take replaces it under the same tag, so a performance is one undo step. Same-kind keys inside the take's range are replaced; other kinds stay (layering).

---

## Phases 10 to 12 (v0.6.0) {#p1012}

### src/media/video.ts · per-block lanes (whole-file rewrite)
- refers-to: src/media/video.ts :: VideoPool, VideoSource (frame, exact, prefetch w/ lane), release, stage, forgetExcept
- kind: rationale
- logged: v0.6.0 · 2026-10-30

Each block of a video asset decodes on its own lane (up to 4 per asset; the block's content id is the lane), so two blocks at different times no longer seek one decoder back and forth (7 seeks and 99 wrong checks before, 2 and 0 after). Scrubbing shows the nearest key frame at once and refines to the exact frame when the scrub rests. exact() takes the frame whose span covers the wanted time and caps its loop (a variable frame rate file hung before); the end clamp stays 4 ms inside the clip. The decoded-frame cap is 768 MB in bytes. Process note: this file was rewritten whole by its builder instead of edited region by region, against SEDO, because the lane change touched nearly every method; the lead kept it after review and records it here.

### src/media/plan.ts, thumb-cache.ts · nothing half-built
- refers-to: src/media/plan.ts :: planPrefetch, firstFrames, firstPictures; src/media/thumb-cache.ts; src/app/app.ts :: prepareOpen, importOne
- kind: fix
- logged: v0.6.0 · 2026-10-30

Import awaits the block's first picture before the engine op adds it, and every open path (library, file, recovery) awaits the first frames at the Playhead before the old movie is dropped; waits cap at 5 s so a stuck decoder cannot block an open. The loop prefetch starts 1.5 s before the end on its own `~wrap` lane, released 2 s after the turn. Filmstrip thumbnails are kept in IndexedDB (64 MB, LRU, every call in try/catch) and fill visible tiles first, then the rest while idle. GIFs stream one picture at a time and stop at 1,000 pictures or 512 MB w/ a warning.

### src/engine/render.ts · direct() and the bitmap byte cap
- refers-to: src/engine/render.ts :: composeTracks, direct, BITMAP_CAP_BYTES
- kind: rationale
- logged: v0.6.0 · 2026-10-30

Plain content (normal blend, opacity 1, no mask, no filter, and no mask on the content above it) is drawn straight onto the output instead of through a temporary surface: 200 tracks of full-frame drawings went from 1.2 to about 10 fps in software-rendered Chromium. The bitmap cache is capped at 1 GB in bytes; bitmaps drawn in the last two frames are never evicted.

### src/paint/history.ts · tiles and a budget
- refers-to: src/paint/history.ts :: tilePatch, PaintHistory(budget)
- kind: rationale
- logged: v0.6.0 · 2026-10-30

A stroke's undo keeps only the 128 px tiles it touched (a diagonal across a 4K layer: 63 MB to 6.3 MB). Total paint history is capped at 1 GB by default; the oldest steps drop w/ a toast. A Preferences field is not wired yet.

### src/ui/i18n.ts · 29 tables
- refers-to: src/ui/i18n.ts :: LOADERS; src/ui/i18n/[code].ts
- kind: explainer
- logged: v0.6.0 · 2026-10-30

One chunk per language, loaded on demand; es-MX and fr-CA hold only regional differences and fall back to es and fr. Keys are the English labels w/o a trailing "..." or ":"; key names, format codes, fonts and theme names stay English. Words drawn on canvases are not translated. Where formvis had the same key its wording was reused so the family reads alike.

### src/io/recovery.ts · crash recovery
- refers-to: src/io/recovery.ts :: Recovery; backend/app/routers/recovery.py
- kind: explainer
- logged: v0.6.0 · 2026-10-30

Every 60 s while the movie has unsaved changes a snapshot (no history, no poster) goes to the engine's Recovery folder; it is deleted on save, close, replace, a return to unmodified and on `pagehide`. The engine holds one movie, so Recover opens the newest snapshot as the unsaved movie and saves any others to the library as "[name] (Recovered)".

### src/export/engine-jobs.ts · ProRes and HEVC through the engine
- refers-to: src/export/engine-jobs.ts :: startEngineExport, encodeWav, jobCapabilities; src/ui/export-dialog.ts
- kind: explainer
- logged: v0.6.0 · 2026-10-30

Frames render as in the browser export, go up as PNGs (4 at a time) w/ a 16-bit WAV mixdown, and the engine runs ffmpeg. The dialog greys out formats the installed ffmpeg cannot make and says why. About 8 frames a second at 1080p.

### src/ui/help-view.ts · Help
- refers-to: src/ui/help-view.ts :: HelpView, renderMarkdown; docs/MANUAL.md
- kind: explainer
- logged: v0.6.0 · 2026-10-30

The manual is bundled w/ `?raw` and rendered once into DOM nodes (no innerHTML); each `##` heading is a section; search filters sections. F1 opens it, also on the Home screen. The section list and the manual text carry `data-no-i18n`: the manual is English only, and word-by-word table hits made it half translated.

---

## Phases 13 to 15 (v0.7.0) {#p1315}

### src/engine/gpu · the GPU compositor
- refers-to: src/engine/gpu/compositor.ts, shaders.ts, textures.ts, probe.ts; src/engine/render.ts :: useGpu, autoGpu, gpuActive, drawFrame
- kind: rationale
- logged: v0.7.0 · 2026-10-30

WebGL2 on an OffscreenCanvas walks the tracks as composeTracks does (held layer, clipping, masks, keyed opacity, groups, the direct path), w/ all 17 blend modes and the live filters as shader passes. The CPU path stays the reference and the fallback: content drawn through warp, distort, layer groups or masks, or row masks is rendered by the CPU and uploaded as one picture. Auto mode turns the GPU on only when WebGL2 exists, a probe frame matches the CPU and a heavy frame is no slower; `?gpu=force` skips the speed test. Against the CPU: blend modes max 24 levels on rotated edges (mean under 0.06), Hue up to 121 on near-grey pixels (0.05%), filters within 24 (mean 0.31), text 73 at glyph edges (resampled). On this machine (software WebGL) the GPU is slower than the CPU raster, so auto leaves it off; a real GPU is unmeasured. Process note: its builder once rewrote regions of its own new compositor.ts w/ a Python script, against SEDO; logged and kept after review.

### src/engine/warp-draw.ts · Warp and Distort keys
- refers-to: src/engine/warp-draw.ts :: warpQuads, drawWarped; src/engine/keys.ts :: warp, distort; src/ui/warp-view.ts, warp-card.ts
- kind: explainer
- logged: v0.7.0 · 2026-10-30

Distort is a projective map of the content's own rectangle (8 channels); Warp is a Catmull-Rom surface through a 2x2 to 6x6 node mesh (node positions exact), resampled when the mesh size changes. Both draw as affine-textured triangles w/ a half-pixel overlap so no seams show. Offsets are in content pixels, applied before move, scale and rotation. In Perform, dragging a node while playing records its track (one undo step per take).

### src/ui/paint-* · the paint tool carries
- refers-to: src/paint/viewmath.ts; src/ui/paint-gestures.ts, paint-loupe.ts, paint-drop.ts, paint-predict.ts; src/paint/transform.ts :: Bend, refineGridBent, nudgePoints
- kind: explainer
- logged: v0.7.0 · 2026-10-30

Eyedropper loupe (Alt or touch-and-hold), color drop threshold by dragging and continue-fill, Transform nudge (1 px, Shift 10 px) and an 8x8 mesh w/ bending handles, canvas rotate (two fingers, Shift w/ the hand, R resets), hold to repeat undo and redo, quick pinch fit, and predicted points drawn as a screen-only tail never written to the layer. A 4K stroke stays about 0.4 ms median per move.

### src/engine/flip-draw.ts, src/ui/flip-preview.ts · Flipbook carries
- refers-to: src/engine/flip-draw.ts :: drawMaskedRows; src/ui/flip-preview.ts :: FlipPreview; src/engine/engine.ts :: setRegion, playSpan
- kind: explainer
- logged: v0.7.0 · 2026-10-30

A row can mask the row below it (alpha or luminance, invert); onion skins can blend over the primary frame; scrubbing the strip follows the Scrub speed preference; a floating mini preview loops the flipbook and keeps its place; Playback can loop only the Timeline's visible region (saved in the movie), and the sound restarts at the region start. Process note: its builder appended to its own new flip-preview.css w/ a shell redirect once, against SEDO; logged.

### src/ui/i18n.ts · tp, dateText, RTL
- refers-to: src/ui/i18n.ts :: tp, dateText; src/styles/shell.css (logical properties, RTL chevrons); src/ui/timeline.ts (ruler labels)
- kind: explainer
- logged: v0.7.0 · 2026-10-30

`tp()` translates a label before a trailing " (shortcut)" group and keeps the group. Plurals go through `tn()` w/ the categories each language needs; dates use the app language. In Arabic, the status bar parts and the frame counter are isolated left to right, the Home sidebar follows the page direction (logical properties), chevrons flip, path fields are left to right. The ellipsis of a label like "Reset..." sits at the logical end in Arabic, as Arabic interfaces write it.

### media and export debt (v0.7.0)
- refers-to: src/media/video.ts :: lane eviction, exact waiters; src/media/import.ts :: animated streaming; src/export/engine-jobs.ts; src/io/recovery.ts :: heartbeat
- kind: fix
- logged: v0.7.0 · 2026-10-30

Lanes held by an exact() waiter are never evicted, and a waiter whose lane goes asks again (6 blocks of one clip exported: 180 of 180 exact tiles, was 73). Animated WebP, APNG and AVIF stream under the GIF budget. Recovery snapshots carry a heartbeat; only one silent for over 60 s is offered as a crash. A restore renamed to "name 2" says so; the open movie cannot be deleted from Home.

---

## Phases 16 to 19 (v0.8.0) {#p1619}

### src/ui/graph-editor.ts, src/engine/graph-ops.ts · custom eases
- refers-to: src/engine/keys.ts :: bezierSeg, evalChannel 'custom'; src/engine/key-ops.ts :: withEase, mirrorSpan
- kind: explainer
- logged: v0.8.0 · 2026-10-30

A key may carry `ease: 'custom'` w/ `out` / `in` handles (x clamped to 0..1, y may overshoot); presets map onto handles, so switching to Custom starts from the preset's shape. Reverse mirrors and swaps handles. The Graph view shows value and speed curves of one active channel (others as ghosts); each drag is one undo step.

### src/engine/path.ts · motion paths and pivots
- refers-to: src/engine/path.ts; src/engine/types.ts :: Key.sp, Content.pivot; px / py channels
- kind: rationale
- logged: v0.8.0 · 2026-10-30

Spatial tangents live on the x key (`sp`); a span is curved only when an end has `sp` or the lane's Smooth path is on, so older movies render as before. The x key's ease gives the fraction, mapped through a 64-step arc-length table. Pivot: stage = P + pos + R·S·(p − P), the same in render.ts, the GPU path and warp-draw. Known gap: reverseKeys drops `sp`.

### src/engine/transform.ts, camera.ts, parenting.ts · parents and the camera
- refers-to: src/engine/transform.ts :: worldMatrix, topMatrix, memberMatrix; camera.ts; parenting.ts :: setParent, unparent
- kind: rationale
- logged: v0.8.0 · 2026-10-30

One source for a content's world matrix: own transform and pivot, then each parent's, then the camera unless the track is fixed to the screen. Movies w/o camera or parents take the old path. Loops and cross-group parents are refused w/ a message; unparent bakes the world pose. The camera is keyed through a stand-in content so key-ops are reused.

### src/engine/bones.ts · bones
- refers-to: src/engine/bones.ts :: skinOf, boneMatrices, boneQuads; warp-draw.ts :: drawTriangles
- kind: rationale
- logged: v0.8.0 · 2026-10-30

Weights are inverse-square distance to each bone segment, softened near the bone, faded to zero at 0.4 x its length, top 2 bones, normalised, so far parts stay exactly put. Bones draw first, then Warp / Distort; both through the CPU raster. The Bones card is a Stage panel because the Action menu popover closes on any outside press.

### lip-sync, boil, round trips
- refers-to: src/media/lipsync.ts; src/engine/lipsync-ops.ts; src/paint/boil.ts; src/ui/boil-make.ts; src/io/formvis-doc.ts, formvfx-doc.ts, round-trip.ts
- kind: explainer
- logged: v0.8.0 · 2026-10-30

Lip-sync classifies 8 mouth shapes per frame from RMS, zero crossings and the two strongest spectral peaks (radix-2 FFT, Hann windows), smoothed to 2-frame holds, written as a new Lip-sync row (the chart row survives). Boil displaces w/ hash-lattice value noise whose seed cycles every `rate` frames; CPU and GPU share the maths (max 2 levels apart). Pool surfaces now use `willReadFrequently`, which made every CPU filter readback faster under software GL. formvis `.fvd` (zip manifest + PNGs) and formvfx `.fvxproj` (JSON, footage beside it, so the export is a zip w/ Footage/) round-trip as far as each format carries; a toast lists what was left out.

### process exceptions (v0.8.0)
- kind: warning-context
- logged: v0.8.0 · 2026-10-30

Two builders appended to existing files w/ a shell heredoc instead of the Edit tool: one CSS rule at the end of `styles/flip-strip.css` (lip-sync) and the FS_BOIL shader const at the end of `engine/gpu/shaders.ts` (boil). Both are pure appends, reviewed and kept; logged here as SEDO breaches. Phase 19 added more: the brush builder rewrote `paint/brushes.ts` and `ui/brush-panel.ts` whole and copied formvis's `engine/abr.ts` to `io/abr.ts` w/ `cp`; three builders appended CSS to their own new stylesheets w/ a heredoc (`paint-feel.css`, `timeline-extras.css`). Reviewed and kept; the skill pack's laws already say SEDO covers a builder's own new files.

### Phase 19 · reference parity, first wave
- refers-to: src/ui/stage-nav.ts, stage-options.ts; src/engine/transform-ops.ts; src/ui/stage-snap.ts, stage-box-menu.ts, shortcuts-dialog.ts, recovery-dialog.ts; src/ui/flip-select.ts, flip-mini.ts, flip-canvas.ts, flip-convert.ts; src/paint/feel.ts; src/ui/paint-feel.ts, paint-clip.ts, paint-keys.ts; src/io/brush-import.ts, abr.ts; src/ui/brush-store.ts; src/engine/blend.ts, track-ops.ts, key-sel-ops.ts; src/ui/timeline-extras.ts, home-theater.ts
- kind: explainer
- logged: v0.8.0 · 2026-10-30

Measured against the reference inventory and audit in the planning sidecar. The Stage has one view transform (stage-nav.ts); overlays read the pointer through `stageLocal`, and a rotated view turns the `.fm-stage-space` wrapper w/ CSS. Backstage visibility is a movie field (default 20%, `BACKSTAGE_DEFAULT`). Snapping uses Shift as the reference's second finger; Alt turns snapping off. Key combos are canonical (`canonCombo`), so duplicates are caught. Undo depth defaults to 250 w/ a Recent share kept one by one. Luminance masks use 0.299 / 0.587 / 0.114 on the CPU and GPU alike. The nine extra blend modes are pixel maths on the CPU (engine/blend.ts) and shader ids 17 to 25 on the GPU; pass-through groups really pass through. A mouse paints at full pressure. Brushes live in the engine data folder (`/api/brushes`), w/ an IndexedDB copy as fallback. A plain drag on the Timeline ruler now scales time (the reference's behaviour); scrub w/ the Playhead handle or Shift.

### Phases 20 to 22 (v0.9.0)
- refers-to: src/engine/text-layout.ts, src/ui/text-stage.ts, text-card.ts; src/ui/whats-new*.ts, about-dialog.ts, examples*.ts, tour.ts, onboarding.ts, theater-*.ts, library-folder.ts; src/export/still-formats.ts, src/ui/export-preview.ts; src/io/psd-import.ts, ora-import.ts, kra-import.ts, pdn-import.ts, layered-import.ts; src/media/tga-decode.ts, transcode.ts; src/engine/canvas.ts, src/ui/paint-crop.ts; src/ui/gestures.ts; src/paint/brushes-animation.ts; src/ui/paint-sliders.ts, flip-wheel.ts, brush-drop.ts, anchor-mode.ts
- kind: explainer
- logged: v0.9.0 · 2026-10-30

One text layout (`layoutText`) serves the renderer, the GPU text texture (keyed w/ `fontEpoch`), warp rects and the Stage box. `Content.canvas` (movie pixels) is written only when it differs from the movie rect; paint docs load at canvas size. The PSD reader is written from the spec (formvis uses a library this repo does not carry). Layered imports become movie-sized PNG assets per layer and mask. Videos and sounds the window cannot decode go through the engine's `/api/transcode` (the person's own ffmpeg). The gesture hub (`gestures.ts`) recognises multi-touch and turns a second finger into Shift. The Animation brush library is original (180 brushes); `.brush` import keys beyond spacing, jitter, scatter, rotation, texture, dynamics and opacity are assumptions, listed in BUILD_NOTES. Text defaults to #111111 so it reads on the default Stage. `--glass-bg` went to 99% opacity so popovers over a white canvas read as one piece. Process: the text builder rewrote `ui/text-card.ts` whole (SEDO), logged and kept.

### Phases 23 to 25 (v0.10.0)
- refers-to: src/ui/theater-carry.ts, home-theater.ts, home-files.ts, theater-preview.ts; src/ui/paint-crop-surface.ts, paint-view.ts; src/io/brush-export.ts, bplist-write.ts, safe-unzip.ts; src/media/font-bundle.ts, fonts.ts, video.ts; src/engine/push-ops.ts, flip-order.ts, normalize.ts, render.ts, blend.ts, transform.ts, text-layout.ts; src/app/push-commands.ts, loop-commands.ts; src/ui/pen-play.ts, paint-tools.ts, tour.ts, whats-new-data.ts
- kind: explainer
- logged: v0.10.0 · 2026-10-30

Theater carry is pointer-based (6 px or a 380 ms hold), one ghost moved by transform; a 650 ms hover enters a stack, stacks never nest. The manual order is the engine's (`.order.json` per folder); old localStorage orders are handed over once. The on-canvas crop surface shares the bake maths w/ the old dialog, which stays as the fallback under 560 x 420; Ctrl+Z falls through to the movie history when the paint document has nothing left and the top step is the crop. Brush export writes keyed binary plists; the value scales and the newer dynamics keys are assumptions (header of brush-export.ts). Fonts: one dynamic CSS import per family, Noto faces loaded per script as text needs them (`fontCss` falls back per glyph; Japanese before Chinese in the fallback order). Alpha video needed only `alpha: true` on every CanvasSink. Every movie entry point goes through `unpackMovie`, which runs `normalizeMovie` on the movie and its history states. Pixel-only blend surfaces are sized to the destination, never stretched; the Warp / Distort / Bones flat surface is capped at 8192 a side and 48 MP (`flatScale`, `WarpView.srcScale`). `levelFrameOf` gives the group-local frame for parenting. Text layouts are cached per style, text and movie size, cleared w/ the font epoch. The GPU probe drops only its own textures (`dropLive`). `paint-tools.ts` builds each variant once and toggles it. A Home DOM growth seen in review is the Recent grid filling to its 20-item cap, not a leak. Process: no SEDO breach was reported by this turn's builders.

### Phases 26 to 28 (v0.11.0)
- refers-to: src/engine/layer-split-ops.ts, frame-cache.ts, warp-draw.ts, flip-draw.ts, flip-ops.ts :: pasteIntoFree; src/ui/theater-storage.ts, paint-sample-all.ts, warp-drag-preview.ts, brush-thumb.ts, canvas-words.ts, stage-gesture-cache.ts, title-name.ts, tips.ts, text-edit-menu.ts; src/media/key-thumbs.ts; src/paint/brushes.ts :: keepCorners, stroke.ts :: pixelPerfect
- kind: explainer
- logged: v0.11.0 · 2026-10-30

Stage view changes go through `scheduleView()`, which keeps the cached picture and moves it w/ a CSS transform; a real render follows 160 ms after the gesture or past a 2x scale change; every other change marks the picture stale. The frame cache keeps finished Stage frames as ImageBitmaps (384 MB cap), never incomplete frames or frames w/ video, is dropped on any change of movie object, view, background, preview, camera mode or GPU state, and renders ahead only while cheap; look-ahead uses an HTML canvas because an OffscreenCanvas anti-aliases clip edges differently. The profile showed 72% of playback time in software `drawImage`, so a worker adds nothing on a loaded machine w/o spare cores; export still yields per frame. Filmstrip tiles decode from the nearest key frame (exact within 0.2 s), over 3 decoders, cache tag k2 (older entries dropped). Warp triangles are pushed out 0.75 px against seams; `options.resample` is written only when not the default. Shipped brushes keep corners: `keepCorners` lowers smoothing so the card's Stabilization (now read by the stroke as `stabilizationRope`) adds back to the old total. Escape no longer finishes a Drawing. Process: a third-audit auditor appended its item table to its own planning file w/ a shell `cat` (planning sidecar, not the repo); logged.

### Phases 29 to 31 (v0.12.0)
- refers-to: src/engine/sparse.ts, render.ts :: drawFrame exact, drawLayers, composeLayer; src/ui/stage-drag-cache.ts, stage-view.ts :: content signature, dispose; src/media/video.ts :: VideoSampleSink, toCanvas, EXACT_BEHIND; src/ui/brush-disk.ts, brush-store.ts, brush-panel.ts :: Show brush folder; src/io/recovery.ts :: keepLive (WebSocket); src/engine/layer-split-ops.ts; src/ui/colour-panel.ts :: split reticle; src/ui/flip-strip.ts :: Paste and Insert; src/ui/dropdown.ts, timeline.ts :: holdFor, thumbStale; src/ui/stage-fringe.ts :: dispose
- kind: explainer
- logged: v0.12.0 · 2026-10-30

Playback cost here is per destination pixel (about 3 ns), not per source pixel: a proxy (downscaled source) cache was built, measured to give nothing and removed (`engine/proxy-cache.ts` and its `opts.proxy` hooks in render.ts; `composeLayer` keeps an ignored `_proxy` parameter its caller passes). What helped: `sparse.ts` scans each decoded bitmap of 160k px or more once for ink bands and clips the draw to them (axis-aligned, plain composite only), T200 cold 12 to 17.7 fps, UHD 20 to 23.7. The clip moves 4 to 11 anti-aliased edge pixels a frame by up to 16 levels, so exports and the export preview pass `exact: true` and draw whole. Dropping `willReadFrequently` on pooled surfaces measured no change and was reverted. The drag cache composites the tracks below and above the moved blocks once per gesture; the mid-drag picture can differ on about 1,000 low-alpha edge pixels (8-bit premultiplied storage of the above bitmap), gone at release. Stage redraws are keyed by a content signature, so a Timeline edit that changes nothing visible draws nothing; Timeline thumbnails are renewed once at pointerup (`thumbStale`). Video seeks decode samples and convert only frames kept in the window. Brush sync deletes only ids the window knew, runs under a Web Lock and tells other windows through a BroadcastChannel. The frame cache key carries the font epoch. Process: the brush-files builder rewrote `backend/app/routers/brushes.py` largely in place (320 lines added); reviewed by the review round, logged and kept.

### Phases 32 to 35 (v0.13.0)
- refers-to: src/engine/gpu/mesh.ts, gpu/tree.ts, render.ts :: needsCpu; src/export/export-worker.ts, worker-host.ts, worker-protocol.ts; src/ui/a11y.ts; src/engine/asset-gc.ts, io/fmo.ts :: MAX_SAVED_STEPS; src/ui/help-center.ts, tutorials.ts, tutorial-steps.ts; src/ui/brush-studio*.ts, paint/studio-render.ts; src/media/recorder.ts, audio-edit.ts, ui/voice-panel.ts, sound-card.ts; src/paint/grains-lib.ts, tips-lib.ts, brush-materials.ts, wet.ts, render-modes.ts, curves.ts, tiles.ts, pump.ts; src/engine/snap.ts, fit-ops.ts, marker-ops.ts, retime*.ts, time-stretch.ts, transitions.ts, transition-draw.ts, key-fast-ops.ts
- kind: explainer
- logged: v0.13.0 · 2026-10-31

The owner judged parity by depth, not rows, so depth analyses (`DEPTH_GAPS_*.md` in the sidecar) drove the second half of this release. GPU: meshes (Warp, Distort, Bones) and layer trees / row masks left `needsCpu`; parity w/ the CPU raster is within rounding except a few hundred pixels of the discontinuous blends (hard mix, darker / lighter color) used as clip or group blends; on software GL the GPU is slower and the auto switch keeps it off. Transition frames bypass the GPU and mix on the CPU. Export renders in a Worker w/ the same `Run` and `Renderer`; sound is mixed on the main thread and sent as PCM; movies w/ video fall back to the main thread. Grains (54) and tips (79) are generated at runtime from seeded noise and cached, not shipped as images. Wet paint mixes in a Kubelka-Munk-style model written here; a big blending brush at 4K still costs about 2 s per 40 samples. Paint layers park as 128 px tiles when idle and unpark on first read, so the paint API is unchanged. Brush fields and their export keys are optional and `fm`-prefixed. Saved history keeps the newest 2,000 steps and halves on a string-size error. Process: no repo SEDO breach reported.

### Phases 36 to 39 (v0.14.0)
- refers-to: src/engine/fx/ (registry.ts, shadow, glow, colorcorrect, vignette, pixelate, directional-blur, radial-blur, motion-blur, key, fx2-cpu, fx2-glsl); src/engine/text-rich.ts, text-anim.ts, text-phase.ts; src/engine/shape*.ts, gpu/shaders-shape.ts; src/media/audio-dsp.ts, audio-dsp-worker.ts, audio-dsp-client.ts, engine/audio-fx.ts; src/export/delivery.ts, anim-image.ts, psd.ts, worker-video.ts, audio-export.ts; src/engine/bin-ops.ts, ui/media-bin.ts; src/paint/paint-worker.ts, ui/paint-bridge.ts, paint/shine.ts, dry-media.ts, io/palette-io.ts; src/engine/flip-time.ts, ui/flip-xsheet.ts, flip-tools.ts, flip-underlay.ts; src/engine/normalize.ts :: unknownLanes
- kind: explainer
- logged: v0.14.0 · 2026-10-31

Effects plug into one registry (`engine/fx/registry.ts`): an effect is a file that calls `registerEffect`, w/ params, a pure CPU function and a GLSL twin; lanes are `fx:<id>`; uniforms must not be named `uSize` or `uBox`. Lanes of an unknown kind (a removed effect, a newer file) move to `unknownLanes` on load and come back when the kind exists, so nothing is lost and nothing throws. Motion blur averages sub-frame poses in float on the CPU raster. Text runs, shadow, box and animators share `layoutText`; the GPU text signature includes the animation phase. Shapes are a content kind w/ 33 keyable channels and draw on the CPU raster under the GPU. Audio effects are our own DSP (no Web Audio nodes) run in a worker on the used span only, so playback equals export sample for sample. Exports w/ video decode in the worker (`WorkerVideo`, same frame choice as `VideoPool`). The paint worker owns a mirror of the active layer and returns dirty rects as transferables (no cross-origin isolation, so no SharedArrayBuffer); undo / redo wait for a landing stroke; the selection cache is 4 ids on both sides w/ a miss message. PSD and APNG writers stream and cap memory. Process: the wet-paint builder ran one `sed -i` on `paint/wet.ts` for a debug switch and reverted it by Edit (SEDO breach, logged; the reviewer found no residue).

- refers-to: src/ui/brush-import-dialog.ts, brush-drop.ts, brush-panel.ts, paint-view.ts :: importFileWithPreview
- kind: decision
- logged: v0.15.0 · 2026-10-31

Every brush file import (.abr, .brush, .brushset, .brushlib) opens one import preview (Dialog, built once, rows filled while hidden and patched in place; thumbnails drawn lazily for visible rows in idle time with the engine's own `renderBrushPreview`). Only a lone plain brush with no notes skips it. "Tips only" is applied at landing by `tipOnly` (the old plain-tip brush) so the parser needs no option. "Add to the current library" reuses `addImportedSet` per set, so no new store method. Two small hooks: the paint view's key handler ignores keys inside `.fm-bi-list` (it ate Space and Enter), and the Brushes panel no longer closes on pointer or Escape inside a dialog scrim, so it is still open after an import.

### Phase 40 (v0.15.0) · Timeline gaps (FT-GAP-01, 02, 03, 06, 08, 09, 11, 12, 15, 16, 17, 27)
- refers-to: src/ui/timeline.ts, timeline-heads.ts, timeline-marks.ts, timeline-view.ts, content-menu.ts, popover.ts :: openSub, track-menu.ts; src/engine/lock-ops.ts, ops.ts, types.ts :: Track.locked; src/app/timeline-view-commands.ts
- kind: decision
- logged: v0.15.0 · 2026-10-31

The chip checkbox hides the track (the model hides tracks), not one block; an Alt-click per-block hide was left out. A drag dropped between lanes or past the last lane moves the block onto a new track and removes the track it emptied, so a lone block just reorders. Track lock is `Track.locked`, enforced in ops (move, trim, split, delete, paste) and in the Timeline hit test. The header column shifts frame zero (LEFT) instead of resizing the canvases, so nothing relayouts; it cycles off, full, narrow and is kept in localStorage. Block menu sections are nested submenus: `Popover.openSub` now keeps a parent submenu open when the row lives inside it. Removed: the right-end-only group arrow stays, the old red Free Trim stub handles became bracket handles (small blocks keep the stub). The ruler shows seconds under 3 px a frame, frame numbers at every tick from 20 px.

### Phase 41 (v0.15.0) · pen tablets
- refers-to: src/paint/pen-sample.ts, pen-device.ts, pen-arbiter.ts, input.ts; src/ui/pen-settings.ts, paint-feel.ts :: attachPenStorage, paint-view.ts :: barrelAction, settings-dialog.ts; src/styles/pen-settings.css
- kind: explainer
- logged: v0.15.0 · 2026-10-31

One pipeline for every pen: `PenInput` reads each PointerEvent with `readPointer` (raw pressure, 1-pole smoothing in ms so 60 and 240 Hz feel alike, the device curve w/ min and max from a 256-entry table, then the older global curve, which stays and defaults to linear). A pen touching down with pressure 0 is a missing value, not a light touch: that sample is held and back-filled w/ the next real pressure (after 6 missing in a row the device is taken to have none and gets 0.5). The lift event's pressure 0 is replaced by the last pressure. The device key is the driver id when given, else `pen:w{min}-{max}:t{0|1}` (contact size range, tilt ever seen; tilt is learned and stored so the key does not flip on a stroke drawn upright). A profile saved for a key owns the curve, range and smoothing; editing while one exists edits the profile. Settings live in `formmorpheus.pen`; `paint/` stays pure because storage is handed in (`attachPenStorage` in paint-feel.ts). Arbiter: pen in range (any pen event within 500 ms) or down makes touch navigate only; a touch 44 px or wider (after a pen was ever seen) or within 24 px plus its width of a pen that is down is dropped at its pointerdown and ignored until it lifts; two fingers no longer cancel a pen stroke. Eraser end (button 5 or buttons 32) erases for that stroke; barrel 1 (button 2) and barrel 2 (button 1 or buttons 4) run an action: eyedropper, right-click menu, undo, pan, cycle tool, none. Pen button 1 no longer pans on its own (barrel 2 can). Pen settings win over the older Draw & Paint rows ("Pen button", "Pen eraser end erases") once set; unset they follow those rows. Events the app dispatches itself (isTrusted false, source 'link') are read like real pen events; the canvas wraps set and release pointer capture because a synthetic pointerId has none and the call throws. Chromium CDP cannot send eraser or barrel bits (`buttons` is derived from `button`: left 1, middle 4, right 2), so the eraser was verified w/ synthetic PointerEvents. The Stage records motion and does not paint, so pressure and tilt apply only in Draw & Paint. Not done: the WebView2 press-and-hold right click and flicks have no verified switch (no browser argument known to turn them off; a wrong `additional_browser_args` replaces Tauri's defaults), so only `touch-action: none`, no callout and a `contextmenu` preventDefault on the canvas and test pad are in place. No native tablet crate (see research section 2: only if a hardware test shows pen arriving as mouse).

### Phase 42 (v0.15.0) · Draw & Paint interface (GP-001 to GP-014)
- refers-to: src/paint/quickshape.ts, src/ui/paint-quick.ts, paint-size.ts, paint-bubble.ts, paint-drop.ts, paint-tools.ts, paint-view.ts, paint-settings.ts, flip-strip.ts, layers-panel.ts; src/styles/paint-ui15.css
- kind: explainer
- logged: v0.15.0 · 2026-10-31

QuickShape: a 500 ms dwell at stroke end fits line, arc, ellipse, rectangle or polygon (pure fitting in `paint/quickshape.ts`), the live stroke is cancelled and restamped from the shape with the pressure profile resampled by arc length; Shift regularizes, Shift+click draws a line from the last point; pref `quickShape` (pen only by default). The size slider uses a power curve (exponent 2) applied in the host (`paint-size.ts`), because `paint/dynamics.ts` belongs to the wet-media builder and keeps its linear 0..1. The default brush is the animation set's lead stub at about 10 px. Flipbook strip header keeps six controls, the rest sit in a More panel that reuses the same buttons. Blend list is grouped with live preview and commits on a tap outside. ColorDrop: "Continue filling" pill and tick, threshold line, remembered threshold clamped to 0.976. Select defaults to Automatic with a threshold line and cyan candidate tint. Layers: Alt-click alpha lock, Alt+Shift merge, swipe-left actions by mouse and touch. Hold-to-pick for pen and mouse behind pref `holdPick`. Filter screen is a dimmed interface with a title chip, a bottom pill and a right column of tiles. Finish menu has a Help submenu and Discard asks first. Not done: Select capsule trim (GP-015), strip cell tiers (GP-020), prefs order (GP-012); hold-to-pick and Edit Shape menu not exercised in the browser.

Follow-up, QuickShape lost strokes: not reproduced on the current tree. With CDP pen strokes on Lead stub, Chalk, Ink, Paint, Bristle, Airbrush, Graphic, Texture, Sponge and Script a circle held 1.8 s (still, or moving, or moving then still) snapped to its ellipse, a second stroke landed, and four strokes took four undo steps; Wash (a wet brush) did not snap and drew normally; Shift+click line plus a later stroke also undid in two steps. The likely cause was a wet or drying brush, which the `allowed` callback now keeps out (kept as is). One hole was closed in paint-view.ts: `qsPointer` was never cleared, so a late dwell timer or frame after the stroke ended could start a stroke nobody would lift and swallow the next pointer. `qsRestamp` now returns when no stroke is live and no Shift line is under way, and `qsPointer` is reset in `up`, `cancelStroke` and `qsReplace`. The toast text, Edit Shape and the kind names already go through `tr()`.

### v0.15.0 shell (G01 to G07, G11, G17, G20, G22): the reference's document model

**Decision (G01).** A movie is a file in the Theater from the moment it exists; there is no unsaved state. Why: the reference has no Save, and the old model lost work and hid new movies from the Theater. How, in `app/app.ts`: (1) `adopt()` runs whenever `engine.open` leaves `libraryName` null (New Movie, a Start-page size, a `.fmo` opened from outside, a recovered movie): it picks a free library name ("Untitled Movie", "Untitled Movie 2", checked against the library listing, never overwriting), sets `libraryName` and writes the file with a poster before anything else happens. (2) Every step (`engine` event `history` while `modified`) calls `scheduleSave()`: write 400 ms after the last step, at most 3 s after the first, longer for a movie that is slow to write (3 times the last write time, capped by 6 times), run from `requestIdleCallback` (1.5 s timeout) so a stroke is never held up; one write at a time through a promise chain; the engine's PUT writes a part file, fsyncs and renames, so a kill leaves the old or the new file. A step made while a write is in flight keeps `modified` true and schedules another. A failed write toasts once, keeps the work in memory (and in the crash snapshot, which only clears when the movie is no longer modified), and retries in 5 s. The 30 s interval stays as a safety net; the Preferences "Autosave" row now only sets that net. A hidden tab writes at once. (3) Ctrl+S ("Save") writes now with a fresh poster and a 1.2 s "Saved" notice. Save As became "Duplicate as..." (`Shift+Mod+S`): a copy in the library under a free name with a new movie id; the open movie stays open. (4) Closing, leaving for the Theater and opening another movie never ask: `askToKeep()` now only guards a running export and writes the movie. Leaving for the Theater (`toTheater()`) waits up to 700 ms for the write so the tile is current when the wall shows. (5) The poster is the Stage drawn at the Playhead frame (`stage.snapshot(480)`), taken fresh on leave and on Ctrl+S, reused up to 5 s on autosaves. (6) `.fmo` export and share are unchanged. (7) The title bar lost its unsaved dot (`movieLabel`).

**Removed.** The "Save Movie" name prompt on the normal path, the "Unsaved changes" confirm, and the dirty dot. `beforeunload` still guards the few hundred ms between a step and its write.

**G17 posters.** A movie without a poster (recovered, old) gets one when the Theater first draws its card: `ui/poster-maker.ts` reads the movie, draws the first frame that shows something on a private `Renderer` (the open movie is untouched), and PUTs it to the new engine route `PUT /api/library/{name}/poster`, which rewrites the zip with every other entry copied across, writes only when none exists, keeps the file's modified time (a poster is not an edit, so the Theater order holds), and replaces atomically. Not done: the Playhead frame is not stored in the movie header, so a lazily made poster uses the first busy frame.

**G02, G04.** `ui/undo-banner.ts`: hold-repeat on the Stage and status-bar buttons (`HoldRepeat`, delay = the Rapid undo delay, 80 ms step), the first step on press and the click that follows swallowed; the two- and three-finger hold reads the same delay. The banner names the step ("Undo Add Solid", "Undo Add Solid, 6 steps" while a burst runs, 1.5 s) for every source because it listens to the engine's own undo and redo notices; the gesture toasts were removed as duplicates.

**G03, G05, G20, FV-211.** Movie settings is one 372 px panel of a fixed height computed once per opening (room above the toolbar button, 300 to 560 px): a scrolling body over a bottom tab bar (icon over label, order Project, Stage, Timeline, Share, Prefs) that never moves; the open state fills the toolbar button. Playback is three radio rows with a check circle. About this artwork is a row with a small picture; Author a row. Prefs: Rapid undo delay slider (150 to 1000 ms, step 50) with a value chip, "Undo and redo buttons" toggle, Keyboard shortcuts, a Gestures page (six toggles with generic pen wording) and More settings. The Name field renames the library file. G22: the status-bar Undo and Redo give way while the Stage pair shows.

**G06, G21.** Theater poster wall (`styles/theater-wall.css`, top bar in `ui/home.ts`): gradient ground, wordmark at the left with a sidebar toggle (closed by default, remembered, closes after a choice), Select and "+" at the right, 16:9 borderless posters (radius 8, soft shadow), centred 13 px caption, kind and age in the tooltip. Filter, sort and view sit behind the "..." button, and appear by themselves while selecting or inside a stack. The hover delete waits 450 ms. Select-mode buttons do not wrap. Not done: the Gallery/Library layout setting (G06 asked for it); the Library look is reachable through the "..." row only.

**G07.** New Movie: Wide screen opens at 4K on a display of 1440p or more (HD below that); "Flipbook" and "Empty" are the two primary buttons and create at once; Enter creates with the last choice.

**G11.** Already padded in `clampScroll` (switch height plus 24 px): verified in the browser that scrolling to the end clears the last lane.

## v0.15.0 brush engine (FB-G01 to G10, G12)

**Decision.** Charge, burnout and fall off decay per distance in brush diameters, not per dab (`wet.ts` prepare, `stroke.ts`): a glaze runs low over 70 diameters at charge 0 and never below 0.3 load, a blending brush over 24. Fall off now fades opacity (it shrank the size before); `scatter` keeps meaning position (renaming it needs the Studio and `.brush` import, owned elsewhere: not done).
**Decision.** New `paint/bristle.ts`: a bundle of 10 to 72 hairs, each a continuous capsule with its own tone, length, wobble and paint, picking up the canvas as it was before the stroke (`Brush.bristle`, optional). Moving grain at movement under 0.9 slides with the brush; at 0.9 and over it is canvas anchored (the rotated frame made swirls on curves). Brushes with `bristle` skip `WetPaint`.
**Decision.** Watercolor: `wet-dry.ts` works in 192 px blocks with a margin (only blocks the stroke touches), rim from a crisp mask of the per-dab-flow coverage map (`edge`, one byte per pixel, pooled), rim 1.5x and interior 0.8x at wetEdges 1, pen-up bead, granulation by the paper tooth. Glaze alpha is `1 - exp(-1.6 f)` scaled to 1. `wetmap.ts` keeps a per-layer wet map (64 px tiles, dry time from pen sample times, no timers): a wash over a wet one bleeds (premultiplied blur near the stroke) and skips the rim. The wet map lives in the thread that paints, so worker and main thread agree for a session.
**Cause of the straight-edged tone blocks (G07).** Not the dirty rect: the worker returned only the last call's rectangle after `dryWash` had reworked the whole stroke. `paint-worker.ts` now returns the patch rectangle for `dries(brush)` brushes.
**Decision (G06).** A blend mode and luminance blend now apply inside `WetPaint.paint`; the wet model is no longer turned off by them.
**Decision (G09, G10).** `dry-media.ts` sets the pen floors to a response table (a 0.15 press against a full press: size 0.45 to 0.6, flow 0.25 to 0.45). Tilt shading: long axis 1+3k along the lean, short axis 1+k, so a pen leaning along the stroke still widens it.
**Known.** Faint 1 px vertical ticks on some bristle strokes; oil stroke ends are cut square; tilt size compression and per-pen grain are not done.

## v0.15.0 visual pass (FV-204, 205, 207, 209, 210, 202)
**Decision (FV-209 motion).** Popovers, menus, dialogs and the Edit pill animate with CSS keyframes that fire when `hidden` turns off on an already-mounted node: `scale .96 to 1` plus opacity, 140 ms (`--dur-pop`, `--ease-glass`), dialogs rise 8 px in 180 ms, the pill pops from 0.9 in 100 ms. `scale` is the individual property so it composes with the `translate()` transform that places the card and the `translate` property a dialog drag uses. `backwards` fill, so frame 0 is opacity 0 and nothing flashes. `popover.ts` and `menu.ts` now measure with `offsetWidth/offsetHeight` (a scaled card must not shift its own place) and set `--fm-ox/--fm-oy`, the anchor point the card grows from. Closing is instant on purpose: a lingering card would sit over the next press. Reduced motion: `animation: none` here and the global rule in `a11y.css`.
**Decision (FV-210).** Tokens `--radius-2xl` 24 (Stage, Timeline, dialogs, Movie Settings), `--radius-pop` 18 (popovers, menus), `--radius-row` 12; `--glass-menu-bg` (82 percent) and `--glass-menu-filter` for `.fm-pop` and the `.cv-menu` family. `--glass-bg` stays dense for panels over the white canvas. `--radius-xl` is left at 12: it is used in too many places to move in one pass.
**Decision (FV-204).** `ui/create-menu.ts` replaces the plain list: "Add new", four tiles, Photo, Video, File rows, and a More row whose rows are built on first open (the commands are registered after the menu is made). The "+" button holds `is-on` (solid accent) while it is open.
**Decision (FV-202).** `add-drawing`, `add-flipbook` and the frame-rate Flipbooks only insert and select; the Edit pill opens Draw & Paint. The old behaviour is the checked command "Open Draw & Paint after adding" (Create > More), stored per viewer by `ui/create-pref.ts`. A Settings row for it was left to the settings owner.
**Decision (FV-205).** `a11y.css`: the Stage shows a 1 px quiet inset hairline on keyboard focus only; a container that only holds focus (`tabindex=-1`) shows none. **Not done here:** the paint canvas frame (accent 2 px stroke over a dark 4 px rim, drawn in `paint-view.ts` draw(), "the canvas edge is a clear accent outline") belongs to the Draw & Paint file; it should become one 1.5 px `rgba(255,255,255,.9)` round stroke, radius 12, no rim.
**Decision (FV-207).** `.fm-modes` is a fully round capsule, three items of min 76 to 100 px, 24 px glyphs, no box behind the active item: glyph accent and filled, label white, color crossfade 120 ms. The Edit pill is 32 px high, 14 px bold, with a checkbox glyph drawn as a CSS mask.
**Removed.** The accent tint box behind the active mode; `CREATE_ITEMS` in `app/app.ts`.

### Phase 43 core (v0.15.0) · brush presets from .abr files
- refers-to: src/io/abr.ts, abr-desc.ts, abr-patt.ts, abr-map.ts, brush-import.ts :: brushesFromAbr, ImportResult.notes
- kind: explainer
- logged: v0.15.0 · 2026-10-31

An .abr import now makes one brush per preset (the `Brsh` list), not per tip: `abr.ts` reads the binary layer into `AbrFile` (samples, patterns, presets with folder paths, legacy v1/v2 brushes, warnings), `abr-desc.ts` reads every descriptor type (a type with no length, `ObAr`, stops the walk and keeps the partial tree; presets cut short without a tip are dropped), `abr-patt.ts` decodes patterns, `abr-map.ts` maps keys to Brush fields group by group and returns notes plus unread keys. Folders come from nested `Brsh` lists or from `phry` (used only when its preset count equals the preset count). `brushesFromAbr(buf, base, {applySettings, absoluteSizes})` returns `sets` (one per folder, nested folders joined as "A / B", root presets in a set named after the file), `libName` = the file name, `notes` per brush id and `skippedKeys`; `parseAbr` stays as a pictures-only view.
**Decision (calibrated by painting a synthetic file, `scratchpad/w15_abr/make_abr.py`).** Angle: the file turns counter-clockwise, the canvas clockwise, so `baseRot = -Angl`; with Direction control the engine's angle 0 lies across the stroke, so `baseRot` also gets -90 degrees and an arrow tip then points along the stroke in both axes. Grain: the pattern is mapped into the 0.3 to 0.7 band of the 256 tile (the stroke reads tooth from that band), light = tooth holds paint; a 64 px pattern at 100 percent paints dots of its own size (tile repeated 4 x, `fit` factor 1); a pattern over 256 px is shrunk to the tile (`fit` = w/256) and blended seamless; a flat pattern (range under 96) is stretched. Size fade: `fallOff = (1 - minimumDiameter) / 0.85` (min 0.15); the engine's fade length is about 25 dabs at the default size, so the file's step count is not carried (noted). Size jitter: `jitterSize = jitter * (1 - minimumDiameter) / 0.7` because the engine drops size by up to 0.7 of the jitter. Roundness jitter sets only `roundJitterH` (both axes would also turn the stamp). Sideways scatter: `pathJitter = jitter / 50` (the engine offsets by half the amount). Tilt size uses `tiltSize`, not `tilt`, so the dab does not widen. 16-bit tips: levels 0 to 32768 scale by 255/32768 (65535 if any value is higher). Tips over 512 px are box-reduced, `maxSize` capped at 400 with a note. Sizes scale with the canvas unless `absoluteSizes`. Tips-only mode keeps the old pressure defaults ([0.5,1] size, [0.7,1] flow); with settings, pressure is off unless the preset's controls say so.
**Not carried (noted per brush).** Dual brush, brush pose, purity, build-up, mixer settings, stylus wheel, pen rotation on angle, size/flow control by anything but pressure, tilt, fade and rotation, scatter and count controls, zip-compressed patterns, bristle and erodible tip shapes (drawn as this app's bristle tip or a soft round tip), the real fade length. Bitmap-mode patterns treat a set bit as black (unverified against a real file). The control numbering (5 rotation, 6 initial direction, 7 direction) follows the community table and was not checked against a real file.
**Removed.** `readDescSpacing` and the per-sample spacing/name matching in `abr.ts` (the preset descriptor now carries them), the fixed `Computed`-to-sample baking in the import path, and the 16,000,000 pixel drop.

### Phase 44 keys (v0.15.0) · Stage transforms, Action card, Perform takes
- refers-to: src/ui/stage-view.ts, stage-compose.ts, stage-hud.ts, key-lanes.ts, key-snap.ts, action-menu.ts, perform-ui.ts, popover.ts :: toCentre, fromCentre, StageHud, snapKeyFrame, setEasePreview
- kind: explainer
- logged: v0.15.0 · 2026-10-31

**Decision.** Compose edits only the base `transform` and never writes keys. The pivot is real data, so Compose converts: with pivot P and linear part M, t0 = t + (I-M)P, and the store inverts it (`stage-compose.ts`). The old "Compose follows animation" lane condition in `keyedFor` is removed; keys still drive the picture and a toast says so once per content.
**Decision.** Scale channels (scaleX, scaleY) have min -20 in `engine/keys.ts` so a side node pulled past the opposite side flips; the size floor is `0.02 * abs(base)`.
**Decision.** Anchor is editable only in Perform and Keyframe; Compose rotates and scales about the centre.
**Decision.** `Popover` gained `keep` (elements whose presses do not close it) so the parameter card stays open during Stage drags. The Action menu is two steps (Move, Filter) with a back button, replacing the combined list.
**Decision.** Frame snapping on Stage drags only while the snap modifier is held, with a "Snapping on" chip. The old always-on behaviour is the preference `stageSnapAlways`.
**Decision.** `key-lanes.ts` keeps module-level ease-preview state (`setEasePreview`) so the lane menu can show the easing name and ticks without a rebuild. Dragged keys snap to the Playhead (captured at pickup as `keyHome`, since the live Playhead follows the key) and to other keys.
**Decision.** Perform: roll default 100 percent, banner "Ready" then "Action", R/Ctrl turns and S scales with the mouse during a take, Retake and punch range and pre-roll in `perform-ui.ts`; a take is one undo step via history depth (`perform.markTake`). Dense keys returned when filtering is 0.
**Decision (tester round).** R and S are remembered by `StageView.modsHeld` from any keydown (cleared on window blur), so a key held before the pen comes down applies from the first sample. Perform S-drag scale is linear (`k = 1 + zoom`, 0.004 per px) instead of exponential, so it passes through zero and mirrors. One Escape closes a `Popover` and any submenu the pointer had opened (before, the first Escape only closed the submenu, which read as ignored). The reported sheared Solid was checked: the box and fill agree and are a rotated rectangle; the frame clip made it look like a parallelogram, so no composition change (`ownMatrix` is T R S T, no skew).
**Not done.** Group-drag ghost for several keys, inline numeric field at a key, `perform-retake` command entry (Shift+R is handled in the banner), union box for multi-selection.

### v0.15.0 review pass (code review and fixes)
- refers-to: src/app/app.ts :: askToKeep; src/ui/paint-view.ts :: draw; src/ui/movie-settings.ts :: openPaint row; src/paint/wetmap.ts :: layerOf; backend/app/penlink_static/pen.js :: deviceName
- kind: explainer
- logged: v0.15.0 · 2026-10-31

**Fixed (FV-205).** The Draw & Paint canvas edge is one 1.5 px `rgba(255,255,255,.9)` stroke on the picture's own edge (radius 12 where the canvas is rounded); the 4 px dark rim and the 2 px accent outline are gone.
**Added.** Movie settings > Prefs row "Open Draw & Paint after adding" (`create-pref.ts`), the same choice as the Create card's More row.
**Fixed.** `askToKeep` (leaving or closing a movie) now only asks when the final write failed or the engine is down; before, a failed write was silently discarded on close because the document model never prompts.
**Fixed.** `wetmap.ts` kept a wet map per layer id forever (worker lifetime); it now keeps the 24 most recent layers.
**Fixed.** The paired-device label no longer names a tablet brand: `Tablet` or `Browser`. Comment in `pen-link.ts` likewise.
**Not reproducible.** `touchMove is not a function` from `layers-panel.ts`: the method exists and one-finger and two-finger touches on a row run clean in Chromium; it came from a Vite hot update caught mid-edit.
**Known, left.** Console warning "shortcut P is the default of both shape-pen and paint-play" is older than v0.15.0 (the two commands live in different modes).

### v0.15.0 brush engine, tester round (watercolor in the real app)
- refers-to: src/paint/wet.ts :: WetPaint; src/paint/wet-dry.ts :: dryBlock; src/paint/wet-dry.ts :: bleed; src/paint/stroke.ts :: finish
- kind: explainer
- logged: v0.15.0 · 2026-10-31

**Cause of the fade.** Every dab mixed paper-white into the brush reservoir, slowly diluting the pigment, so a long stroke ran dry. Pickup now skips bare paper (`pg < 0.05`), and the glaze load decays per distance with `D = 250 * diameter` and a floor of 0.7 (`wet.ts`). A 4700 px stroke now reads 0.98 to 1.01 of its first 500 px.
**Decision.** Rim multiplier 2.6 (was lower) so the edge is clearly darker. Bleed reach `R = 3.2 * radius` with the work rectangle expanded by `0.7 * diameter` so a wet neighbour is inside the block; a stroke started within 4 s of a touching stroke now runs colour into it (3 s apart bleeds, 30 s apart stays crisp).
**Decision.** Pen-rest beads: `Stroke.pools` records a rest (gap over 120 ms and movement under max(3 px, 0.03 px per ms)), passed to `dryWash` as `ends`; the end of the stroke gets a bead of 0.6 times the pool strength. Worker and main thread give 0 differing bytes with a pause.
**Found, not mine (ui/paint-quick.ts, DWELL_MS = 500).** With QuickShape on `Pen` (the default), holding the pen still for 500 ms snaps and replaces the stroke, so a 1.8 s pause in the real app never reaches the brush: the stroke is thrown away and the next one is lost. The tester must set QuickShape to Off for pools; with it off a 1.8 s rest gives a dark bead. Suggest the owner skip the snap for wet brushes or lengthen the dwell.

## v0.16.0 · Export feedback and paint stalls

- refers-to: src/export/progress-meter.ts :: ProgressMeter; src/ui/export-chip.ts :: ExportChip; src/ui/export-dialog.ts :: showReading; src/ui/paint-bridge.ts :: tilePatches; src/paint/history.ts :: patchTiles; src/ui/paint-view.ts :: paint
- kind: explainer
- logged: v0.16.0 · 2026-10-31

**Decision (export progress).** One `ProgressMeter` serves every path (worker export, main-thread fallback, engine ffmpeg job), because all three already report the same `ExportProgress`. Stage weights are shares of wall time per format (`planFor`): plain video and sequences 93 percent frames, GIF-like formats 40 / 53 split, engine jobs 55 / 38; the fraction never goes down. The estimate uses the rate over the last 12 s of reports (not the whole run), so it follows a slow patch and a fast one, and it needs 1.2 s of history. The dialog patches a count line (`{done} of {total} frames`), a time line (`Elapsed`, `left`) and the bar; a 500 ms timer moves elapsed and the estimate between reports (a slow frame).
**Decision (chip).** `ExportChip` is one fixed element built once; it shows only while an export runs and the window is closed (stage, name, frames, bar, elapsed and left, Show, Cancel). Finish and cancel go to a notice (toast) when the window is closed, with the elapsed time. The status bar's generic Working readout is unchanged.
**Decision (paint history).** A worker stroke already snapshots every 64 px tile it touches (`RemoteStroke.snap`). The undo step is now built from those tiles as row runs (`tilePatches`), handed over through the `patchTiles` WeakMap keyed by the returned patch, so no bounding-box copy of before and after (a long stroke on 3840 px has a box close to the whole layer) and no scan of it (`tilePatch`) are made. The returned patch only carries the bounding rect.
**Measured, not the history.** A CPU profile of 100 strokes on 3840 x 2160 with 10 layers (software Chromium, no GPU) put 35 s of 165 s of main-thread time in `drawImage` and 15 s in canvas `restore`; the whole history path was about 0.4 s (`tilePatches` 0.36 s). The stall of a long painting session on this machine is the software raster of ten 3840 px layer canvases, not the commit.
**Tried and removed.** Drawing live frames at `imageSmoothingQuality = 'low'` (no mip chain per changed layer canvas) w/ a repaint at `'high'` 300 ms after the pen rests: the renderer's main thread dropped (CPU 56 to 40 s per 100 strokes) but the work moved to the GPU process (10 to 85 s) and long tasks rose (63 to 103, 133 to 289 per 100 strokes), so it was taken out again.
**Decision (layer cache, follow-up).** `paint/layer-cache.ts` (`LayerCache`, held by `PaintDoc.sides`, used by `composite`): the layers below and above the painted one are each drawn once into a layer-size canvas, keyed by `id:version:opacity` of the visible layers in order (so a change to another layer, its opacity, visibility, order, or a change of active layer rebuilds it), and a frame draws below, the active layer w/ the live preview, above, limited to the dirty region. It only applies to a plain stack: no groups, masks, clipping layers or parents, every layer except the active one `normal`, target alpha 1 and `source-over`; otherwise the whole list draws as before (`LayerCache.fits`). The active layer may use any blend (it draws after the below side). `renderRaster` (flatten, eyedropper) never uses the cache. `PaintDoc.noSides` switches it off. It sits in `paint/` and not in `ui/` because `doc.ts` may not import from `ui/`.
**Measured (cache).** 100 strokes, 3840 x 2160, 10 layers, software Chromium, quiet machine (load under 4), long tasks: before 26 tasks / 2,659 ms total / max 134 ms; after 13 / 1,243 / 131 and 18 / 1,507 / 131 (two runs). A run under contention from other builders is not comparable (293 tasks before) and is left out. Renderer CPU 57 to 59 s vs 60 to 61 s. The max stays near 130 ms: that is the first frame after a layer switch, which rebuilds both sides.
**Pixels vs the full path.** Not bit-identical, by nature: a flattened side is resampled once at view scale and its premultiplied 8-bit intermediate is rounded, where the full path resamples each layer and blends after. 1200 x 700 frame, 10 layers, active layer multiply / hue / overlay, other layers translucent normal: 23 percent of channel values differ by 1, 0.3 percent by 2 to 4, about 200 values (rectangle edges where a blend amplifies the error) by up to 31; opaque layers: 1,129 values, all on shape edges, max 50 on 12 of them. A frame where a layer above uses screen or multiply falls back and matches exactly (0 differing values). A region repaint after an edit and a rebuild after changing a lower layer's opacity match the full-frame result the same way. Flatten and export are exact (they never use the cache).
**Removed.** `RemoteStroke.copyRect` (replaced by `tilePatches`).
**Not done.** The worker mirror is still one layer: switching layer re-sends the layer (33 MB at 3840 x 2160) once per switch, not per stroke.

## v0.16.0 · Effects and compositing depth
- refers-to: src/engine/fx/ripple.ts, halftone.ts, outline.ts, gradmap.ts; src/engine/render.ts :: drawGroup; src/engine/gpu/compositor.ts :: adjust; src/engine/text-presets.ts; src/engine/shape.ts :: SHAPE_CHANNELS
- kind: explainer
- logged: v0.16.0 · 2026-10-31

**Decision (outline).** No distance transform: the stroke is the largest alpha (inside: the largest transparency) in a round window of the stroke width, with an antialiased falloff, read tap for tap on both paths. Over 12 px a side the window is sampled every Nth pixel and the edge softened by N, so wide strokes cost a bounded 27 by 27 taps. A transform that matches on CPU and GPU needs a jump-flood pass count the registry's step list cannot give.
**Decision (halftone).** Dot size follows coverage times the cell's alpha, so a nearly clear cell never sizes a dot from the garbage color of a 1/255 alpha (the first version differed by 235 levels on the silhouette between CPU and GPU). The pad is one cell: a dot whose centre is inside the picture reaches past its edge. Texel reads add 0.01 before floor so a centre on a pixel boundary rounds the same in float32 and float64.
**Decision (adjustment inside groups).** An Adjustment member filters only what its own group drew, so a group holding one is drawn on a surface of its own and laid on w/ the group's alpha and blend (CPU `drawGroup`, GPU `content` case group). A Passthrough group with an Adjustment inside is therefore isolated. The mask outline is drawn in the group's space (`adjustTx`, `nest`). Effect `ctx` of an Adjustment in a group is the group's origin and scale.
**Decision (titles).** `TextStyle.fillTo` is a two-color gradient across the block (spans with their own color keep it). `engine/text-presets.ts` holds ten presets laid over the style; they keep words, font and align. Position is the block's transform and is not set.
**Decision (shapes).** Gradient stop colors are keyable as channels `g<i>R`, `G`, `B`; `shapeBase` always reports them, `setBase` writes them into the stop. The panel writes the three channels through `write` and has one key button per stop.
**Not done.** Effect curve points stay unkeyed (a curve is an option string, not channels). Shapes still draw on the CPU raster under the GPU on purpose (one picture on every path).

### Re-check follow-up (effects and titles)
**Decision (halftone at low zoom).** The cell is `size * view scale` (floored at 1 px, no longer 2), and below 5 px cells the dot pattern blends toward the cell's flat average (weight `(5 - cell) / 3`) on CPU and GPU alike, so a zoomed-out Stage shows the mean tone of the export instead of moire and a lighter patch.
**Decision (defaults).** Vignette 0.85 / 0.3 / 0.7, Mirror position 0.4, Outline 8 px in orange: each shows the effect the moment it is added.
**Decision (new effects).** Glitch (hash bands, uint hash against Math.imul), Kaleidoscope (segments, angle, zoom, center), Hue Range Shift (band center, width, softness, shift, saturation), Sharpen Radius (amount, radius, threshold; unsharp mask over the blur step), Gaussian Blur X Y (separate sigmas, 96 taps a side). Each: one file, CPU and GLSL twins, every parameter keyable. CPU vs GPU on a 320 x 240 frame, max level difference: glitch 0, kaleidoscope 3, hue 2, gblur 2, sharpen 16 (mean 0.86; 11 with a threshold; the blur kernel's edge taps), halftone 2.
**Decision (motion blur).** Opacity change, video or animated-text time, and any text with animators count as "soft" motion: those get at least 8 sub-frames (2 for pure transform motion). Each sub-frame is the layer's content at its own time and weighted by its opacity relative to the frame's opacity (clamped 0..4), so fades blur and a clip's frames smear. Text is re-drawn per sub-frame at its own time.
**Decision (text card).** The card docks beside the Stage by default (clear of the Timeline) and a grab handle moves it; the dragged place is kept while the card stays open.
**Decision (text glow, path, selector).** `TextStyle.glow {color, radius, intensity}` is a halo pass under the letters (zero-offset blur, repeated per whole step of intensity), also per letter when animators run. `TextStyle.path` sets the text along an arc, wave or circle (engine/text-path.ts: polyline with arc length; each letter's middle sits on the curve and turns with the tangent; the box fill is left out on a path). A `curve` kind (pen nodes) exists in the engine; the card has no control that captures a drawn shape into it. Animator `range {start, end, shift}`: units (letters, words or lines) whose middle falls inside the window animate, the others rest.
**Checked.** CPU vs GPU renders of glow, arc, wave, circle and a ranged build: max 39 to 76 on glyph edges only (the text texture is resampled on the GPU; the same edge difference every text has); a png-still export of the five new effects plus a glow-on-arc title, CPU vs GPU max 7, mean 2.1. Typecheck clean. Not checked in the browser UI: the text-card dock and drag, and the new Glow, Text on a path and Range rows.

## v0.16.0 · Pen Link and .abr

- refers-to: src/io/abr.ts; src/io/abr-map.ts; src/io/abr-patt.ts; src/io/abr-dual.ts; src/io/brush-import.ts; src/ui/brush-import-dialog.ts; src/ui/pen-link.ts; src/ui/qr.ts; src/ui/i18n-fill.ts; src/ui/pen-settings.ts
- kind: decision
- logged: v0.16.0 · 2026-10-31

**Strings.** `ui/i18n-fill.ts` has `tf(english, vars)`: the whole sentence goes through `t()`, then every `{name}` is filled in one pass (a value that holds braces is not read again). Every note in abr-map (all of them, not only the ones that had `${}`), every warning and error in abr and abr-patt, the "File: {note}" prefix, the Pen and Tablet driver advice (six whole sentences, kind x OS, instead of a lead joined to a tail), "Saved pen: {pen}", the four "Pen detected: pressure {min} to {max}..." forms (tilt and twist variants are separate sentences), the Perform banner ("Action · {mode}", mode through `t`) and "{where} (not found)" in the Theater go through `t`/`tf`. The control names inside the notes ("pen pressure", "pen tilt"...) are `t()` values placed into `{control}`. The dialog badge and its tooltip already took the notes as they came, so they follow the language at the time of the import.
**Dual brush.** The second tip (a sampled picture or a round tip with its hardness) is laid out as a 256 x 256 grain tile by `io/abr-dual.ts`: dabs of 32 px at the dual brush's spacing, scattered by its scatter and count, wrapped, stored in the grain's tooth band (light holds paint, like a pattern). `grainScale` = the second tip's diameter / 32, `grain` 0.85, Multiply (Subtract when the file says so; other modes are named in a note). A texture the preset already has wins (the dual brush is then left out w/ a note). Checked on a hand-built descriptor: a 65536-byte tile, scale 2 for a 64 px second tip, looks like overlapping round dabs. It is a look-alike: the source app multiplies two strokes, this app has one tip and a tiling grain.
**Tips only and pixel sizes re-parse.** `brushesFromAbr` returns `reparse(opts)`; the import dialog calls it when "Tips only" or the new "Use the file's pixel sizes" changes, and patches each row in place (same order, same checks, name, badge and tooltip) before redrawing the thumbnails. The old `tipOnly()` reduction stays only for files with no `reparse` (the other formats). Pixel sizes sets `sizeAbs` so a brush keeps the file's pixel diameter instead of scaling with the canvas.
**Zip patterns.** Channel compression 2 (zip) and 3 (zip with prediction) are inflated with `DecompressionStream('deflate')` in a first pass over the file (`parseAbrFileAsync`), then read in a second pass from a cache; 8-bit and 16-bit rows are running sums and 32-bit rows are four byte planes, undone after inflating. A hand-built file with the same grey 16 x 16 pattern stored raw, zip and zip+prediction decoded to the same 256 values. A browser without the stream class leaves the pattern out with "{n} zip-compressed patterns could not be inflated". Not checked against a real preset file (none here).
**32-bit tips.** A sampled tip with depth 32 is read as big-endian floats 0 to 1 (a file with 0 to 255 or 65535 stored in floats is scaled by its largest value). Checked w/ a ramp: first 0, last 255.
**Pen Link.** QR code of the first address on the panel (`ui/qr.ts`: byte mode, level M, versions 1 to 10, all eight masks scored; no dependency); a real decoder read the panel's code back as the exact address. The mirror is now the drawing's own area (`penLinkFrame` in paint-view, the bounds of the canvas corners in view pixels, clipped to the view), not the grey around it: the tablet's aspect is the canvas's, and pen positions map into that rectangle too. Zoomed in, only the visible part of the canvas is shown, and the pen maps to what is shown. A rotated view sends the bounds of the rotated canvas.
**Not done.** Mixer brush settings and control codes 5 to 7 of the dynamics groups are still unchecked against a real file; the oil tilt size compression and the wash pen-up cost are other areas' rows.

## v0.16.0 · shell

- logged: v0.16.0 · 2026-10-31
**Built.** G06 Theater layout (Gallery / Library) in Preferences via `ui/shell-opts.ts`; G08 cloud folder (Library Folder field, sidebar entry, tile and Select "Copy to Cloud"); G10 quick Share rows (`fm:export-quick`); G12 tips docked to a Stage corner clear of the movie frame (`Tips.frame`, `StageView.frameClientRect`) and the tour card beside its target with "Don't show tips"; G17 the Playhead frame is stored in the `.fmo` (`playhead` in manifest) and used for lazy posters and on reopen; G21 "Copy to..." label and a stack delete confirm. FV-221, FV-223 (`new-movie-hero.ts`), FV-230 (`--fs-*` +1 px in tokens.css, `applyUiFontSize` scales from the same table), FV-231 (View > Hide Menu Bar / Hide Status Bar, `chrome-options.css`), FV-237, FV-241 (keyboard layout card, `key-layout.ts`). Tester minors: Preferences nav highlight follows the click at once, General page and recovery dialog reworded for the always-saved model, New Movie default size.
**Skipped.** G09 ruler part and G14 Action menu: other builders' areas. G13: the family rule keeps the orange accent. G15: would need another vendor's proprietary formats, with no spec. G18: Space is already tap-to-play with a hand drag, paint view uses Space as the hand, H is Hide/Show Track, middle mouse pans. G16: rounded frame and blurred Backstage need engine/render.ts changes that clash with the drag-cache path and cost too much per render; panel corners and the faint grid already exist.
**Removed.** The old unsaved-changes wording in General and the recovery dialog.

## v0.16.0 · Keyframe lanes, keys, easing and cards
- refers-to: src/ui/key-lanes.ts :: drawLanes; src/ui/key-group.ts :: KeyGroupDrag; src/ui/key-inline.ts :: openKeyField; src/app/key-commands.ts :: keyCommands; src/engine/fx/colorcorrect.ts :: curveAtFrame; src/engine/transform.ts :: followAt
- kind: explainer
- logged: v0.16.0 · 2026-10-31

**Decision.** Collapsed lanes are glyph only (FV-215): the picture chip and the bold name are gone; the name shows on a chip while the pointer is over the lane (`setLaneHover`), and the lane's values at the Playhead plus the easing of the stretch it is in are read out at the right end when the block is wide (G-25). Lanes draw for the chosen blocks only (`setLaneShown`, set by the Action menu); the rows keep their room so selecting never moves the tracks. Key glyphs are 14 px, the key under the Playhead 19 px. Above 8 keys at under 7 px apiece a lane draws one tick per key and a "{n} keys" count (G-30).
**Decision.** Several chosen keys drag together (`KeyGroupDrag`): a press on one of them (no modifier needed) moves all by the same frames, the grabbed one snaps as a single key does, dashed outlines stay where they were and a tooltip names the frame and the count (G-10). A tap without a move still drops the key from the choice. The key selection is now one shared object (`ui/key-state.ts`) so the keyboard commands act on the keys the Timeline draws as chosen.
**Decision.** Tapping a key in an expanded row opens a numeric field right at the key (`key-inline.ts`), the card stays for collapsed lanes (G-13).
**Decision.** Keyboard (G-21, `app/key-commands.ts`): K adds a key at the Playhead on every lane (a Move lane when none), Shift+K next key, Alt+K previous key (Alt+Arrow already nudges the Stage, so the suggested Alt+Arrow was not used), Delete drops the chosen keys before it falls through to deleting content, E then 1 to 4 sets Linear, Ease in, Ease out, Ease in and out on the stretch the Playhead is in. Reverse and Expand lanes have commands without keys. `perform-retake` is a command now (Shift+R, still handled by the banner; the second run finds nothing to undo).
**Decision.** The lane easing menu lists the four first and the rest under a "More" heading, with a check on the stretch's current easing (G-24, FV-216). Expanded bars are 18 px high (FV-224).
**Decision.** Curve points are keyable (colour correction): channels `cv<curve><point>` offset each point's height from the saved curve, flagged `demand` so they have no slider, are not keyed with the other channels and appear in a lane only once keyed. The curve editor has "Key points" (keys every point at the Playhead); after that a point's height drags write keys, a sideways drag still edits the saved curve, adding and removing points waits until "Points keyed: stop animating". Shape gradient stops and the gradient map's three colors were already keyable.
**Decision.** Camera follow (G-26): `Movie.camera.follow` {id, amount}; the camera pans by that share of the content's own move, left out while keys are edited like the shake. Picked in the Camera card ("Follow selection", amount slider). Depth and shake were already built.
**Decision.** Warp and Distort rows are disabled with a reason on an adjustment layer (G-27); every other visual content can be warped. Editing the words of a text block that has a Warp or Distort lane toasts once about cropping (G-31, `text-warp-note.ts`).
**Already done (stage builder note).** See "v0.16.0 · Stage, transform box, Perform and camera" below for G-16's code.
**Already done.** G-16 (a flip in Keyframe and Perform keys a mirrored scale), G-22 (tips sit top left of the Stage panel), G-33 (Compose never writes keys), G-35 (the path strip sits above the zoom cluster). **Skipped.** G-28 (no action in the spec).

## v0.16.0 · Stage, transform box, Perform and camera
- refers-to: src/engine/fit-base.ts :: fitBase; src/ui/stage-multi.ts :: MultiBox; src/ui/stage-surround.ts :: Surround; src/ui/camera-panel.ts :: CameraPanel; src/engine/camera-shake.ts :: shakeAt; src/engine/transform.ts :: depthPose; src/styles/stage-box2.css
- kind: explainer
- logged: v0.16.0 · 2026-10-31

**Decision.** G-23: a picture or video reads 100 percent at its fit to the Stage (`fitBase`: min of movie/asset). Display only, the stored scale is unchanged (3.6 for a 400 px picture on a 1440 px Stage), so old files open as before. Read in the Stage readout (`StageHud.base`, set while a box handle is dragged), the Action card (pill, typed value and its inverse) and the lane value readout (`setLaneBase`).
**Decision.** G-32: several selected contents in Compose show one union box (`MultiBox`, own svg): four corner nodes scale all about the box centre, the node above turns them together (Shift: 15 degree steps). Moving already moved the whole selection. It edits `transform` directly and ignores parents and the camera; it is hidden in Keyframe and Perform.
**Decision.** FV-214: Compose box is 1 px blue (`--cv-action-blue`), 12 px filled round nodes, a hollow rotation node 28 px out; Keyframe and Perform keep the accent, a round-dot dotted line and round nodes (the mode cue is deliberate). The anchor crosshair is already Perform and Keyframe only.
**Decision.** FV-232: the zoom cluster fades after 2 s without pointer movement over the Stage and returns on movement or hover. The shape tool strip is a tool strip that opens on demand, so it was left. FV-233: `Surround` draws a 20 px grid outside the frame (even-odd clip) and a soft glow plus 1 px outline around it; the Backstage default is 30 percent (`BACKSTAGE_DEFAULT`, was 20). FV-234: the Stage panel has no gutter above and bottom corners of 24 px. The canvas keeps square corners: the exported picture is square, a rounded outline would lie about it.
**Decision.** Camera depth and shake. `Track.depth` (absent or 1: normal) scales the camera's pan and zoom for that track (`depthPose`, used in `cameraFor`); `Movie.camera.shake` {amp px, freq per second, seed} adds a repeatable sine-sum wobble (`shakeAt`) to pan and a small turn. Both are left out of `poseAt`, so editing the camera never bakes them into keys. The Camera card (shown in Camera mode) has amount, speed, new pattern, shake off and the selected track's depth.
**Decision.** Perform count-in: with a pre-roll the banner reads "Count-in · n" and a large number shows over the Stage while the movie rolls in (`perform.countIn`, set in `beginRec`, patched on each time step).
**Decision.** G-16 in code: Flip in Keyframe and Perform keys a mirrored scale at the Playhead (`TransformRows.flip`), Compose flips the base transform.
**Checked.** G-29: a Gaussian Blur card slider dragged in Perform plays the movie and records (banner Action, the Playhead advanced from 2.0 s to 5.0 s), and the banner returns to Ready on release. G-34: handle cursors exist (nwse, nesw, ns, ew, grab for the rotation node). The Perform side-node flip works: pulling a side past the opposite one reads a negative scale. Pre-roll count-in observed with a mutation observer (24, 19, 18, ... frames).
**Fixed (re-check).** G-03: the anchor drag now takes the pointer's move back into the picture's own space (undo turn and scale) and writes pos' = pos + (R S - I)(P' - P) together with the pivot, so the picture stays put; Alt no longer matters. Keyed content rewrites px, py, x, y at every Move key frame and the Playhead, each with that frame's own turn and scale. The nine sector dots are placed through the content's matrix (they ignored scale and turn before) and snap in picture space; Shift gives a free drag. Verified: 0 changed Stage pixels after a free drag and after a sector snap. FV-232: the shape tool strip is hidden while the Camera card is open (`is-camera-card`). G-26 verified in the browser: depth 210 percent on one track moved it about twice as far as the other under the same camera pan; Follow kept the followed content centred while the other layer moved off.
**Removed.** Nothing.

## v0.16.0 · shell and Timeline fixes (re-check)

- logged: v0.16.0 · 2026-10-31
**Decision.** G17/FV-208: the hover strip was a stale blank one, because `previewFor` reused a strip drawn for the empty movie for 60 s; the cache now also keys on `engine.revision`, and `theater-preview.ts` skips a strip that is all white. A poster taken within 6 s of the last snapshot is drawn again on leave (app.ts `stalePoster`).
**Decision.** G12/FV-221: when no corner of the Stage panel is clear of the frame, the tip docks centred on the status bar line (`ui/tips.ts`).
**Decision.** FV-211: number inputs in the Movie settings pairs are 76 px (30 px for h/m/s), no spinner, the label shrinks; FV-209: `.fm-pop` takes `transform-origin` from the anchor (the open animation already ran). FV-210: `--radius-xl` is 18 px, rows and tabs use `--radius-row` (12), popovers use `--glass-pop-border` (5 percent); `--glass-border` is unchanged for dialogs.
**Decision.** G18 and FT-GAP-19: Space arms the hand over the Stage and the Timeline even when a button holds focus (the cause of the "quick Space then drag moved the Solid" report); keyup still decides tap or hold.
**Decision.** G16: `ui/stage-frame-ring.ts`, an overlay at the frame rect with a 12 px radius, a 1 px outline and four corner pieces in the Stage colour. Nothing is clipped, so backstage content and every export stay square.
**Decision.** FT-GAP-16: the pending view write now captures its values when scheduled and is flushed when another movie opens (it used to read the new movie's zoom after 400 ms and cancel the old write). FT-GAP-20: one sound rule, by duration (`previewSound(file, always)`: under 60 s imports straight, the preference opens it for every sound).
**Decision.** Recovery: no snapshot is written while the movie has no history step (a just-made movie is marked modified only so that it is written), which was the empty "Untitled Movie N" a crash offered back. Export ETA: none before 5 percent, then a moving average with a 4 s time constant.
**Decision.** The Edit pill sits to the right of the block's name chip.
**Removed.** `previewSounds.wants` and its 12 MB size rule.

## v0.16.0 · Draw and Paint fixes (re-check)

- logged: v0.16.0 · 2026-10-31
**Decision.** GP-028: a double click on the Disc cycles white, black, mid grey, half saturation, full saturation (`dcStep`, reset after 2.5 s); the nearest-point snap is gone. Half and full saturation keep the brightness the colour had before the clicks (at least 0.7). FV-238: history is 8 slots (`HIST_MAX`, `.fm-col-hstrip` 8 columns); the detached companion (204 px) was already built and was driven.
**Decision.** GP-020: the strip lane draws the unused tier as a `::after` on `.fm-fs-lane-in` (near-black cells, one per frame column, after the track's last frame); blank frames use the grey `.is-empty` tier.
**Decision.** GP-012: the Prefs pane has no scrollbar and a 24 px bottom fade that animates away at the end (`animation-timeline: scroll(self)` on `--fm-fade`).
**Decision.** GP-026: new-profile default of Dynamic brush scaling is Pixel (`DEFAULT_PAINT_PREFS.scaling` off). A saved profile keeps what it holds, so no saved movie or profile changes.
**Decision.** Shortcut conflicts: `Command.scope` (ui/commands.ts). A scoped command's keys live in their own table (`forScoped`) and never clash with the global ones; paint-play (P) and paint-tool-erase (E) are scoped to 'paint' (`SCOPED` in paint-keys.ts), so the Pen tool P and Set Easing E keep their keys and no warning prints. Rebinding in the editor works inside the scope.
**Decision.** FB-G20 / N9: `ui/paint-cursor.ts` is a transparent canvas laid over the paint canvas; moving the pen redraws only it (the picture is no longer repainted for the cursor, and the loupe never sees the outline). It draws `drawBrushCursor`: the per-brush outline (App setting, Brush tip, Circle, None) and the hover fill (17 percent of the colour inside the outline, circle and tip alike, off while stroking). paint-view only holds the layer and calls `drawCursor()`.
**Decision.** GP-006: Escape on the blend card puts the preview back and closes only the card (`LayersPanel.closeInner`, called first by paint-view's Escape); before, Escape closed the whole panel and left the previewed mode on the row.
**Decision.** GP-013: Eyedropper and Fill sit after Layers and Color in the top bar (the five reference tools first); the Prefs switch to hide them stays.
**Decision.** Popover exit: `Popover.hide` adds `.is-closing` (90 ms fade and 0.97 scale, `pointer-events: none` with the id selector that beats `#overlay-root > *`) and sets `hidden` after 90 ms; a show during the exit cancels it and adds `.is-still` so no second entry animation runs. Reduced motion closes at once. Panels that toggle `hidden` themselves (the Finish menu, the layers panel) are unchanged.
**Driven, no change needed.** GP-005 (swipe left, swipe right, two-finger Alpha Lock, pinch merge, by touch events), GP-016 to GP-018 (stripes after Done, filled dots, amber node, Mesh dimmed outside Warp), GP-021 (five tracks, three rows with scroll, strip 64 percent), GP-023 (companion), GP-024 (lifted row), GP-025 (Libraries screen by the menu and a touch pinch), GP-027 (freeform loop selects the cells inside), GP-033 (a group row never takes paint), GP-034 (Crop and Resample screens), FB-G11 (graph popover, Pad settings), FB-G13 (Count 6 keeps the stamp size).
**Not done.** Edge-tap nudge on touch (arrow buttons and keys stay). FB-G14 and FB-G18 are engine rows; a pen report rate cannot be varied here.

### v0.16.0 follow-up · Keys re-check
- Effect stack rows have an on/off switch: `options.off = true` on the lane (written only when off), skipped in `engine/keys.ts` when the lane is evaluated, so keys and settings are kept. Action: `setFxOff` in `engine/fx/stack.ts`.
- `Engine.view(fn)`: view-state changes (Expand or Collapse Lanes command) apply and save but are not undo steps. The Timeline's own expand toggle and the lane menu's still use `run` (Timeline builder's file).
- Lane menu: the Cut tile is always shown; off a key it cuts the whole lane (copy, then delete).
- Action menu views reset `scrollTop` on show; the view was already capped to the window height (100vh - 150px).
- Content menu: the row for an Adjustment reads "Adjustment options..." (Shape and Solid keep "Shape options...").

## v0.16.0 · review

- Proxies and exports: `VideoPool.base()` preferred a proxy whenever "Use proxies" was on, and an export on this thread (and the engine-job export) renders through the same pool, so a file could be made from the 540 px copy. Added `holdOriginals` (VideoSource, VideoPool) and `Renderer.pinOriginals()`; `export/run.ts` and `export/engine-jobs.ts` hold it for the whole export. The export worker has its own pool and never saw proxies. Proxies stay out of `engine.assets` and the `.fmo`.
- `app.ts` poster staleness: removed `Date.now() - posterCache.at < 6000` from the poster branch (it redrew the poster when it was recent, the opposite of stale).
- `io/recovery.ts`: a comment had been joined onto the `RECHECK_MS` line; put back on its own line.
- Strings built from translated parts made whole: the shuttle toasts ("Forward {n}x", "Back {n}x"), Media bin toasts and "Used in {n} block(s)", "Added {n} markers on beats.", Theater info frame rate and tracks, "Copied to {dir}." and "{n} movies copied to {dir}." (all through `tf`/`tn`); key command toasts now go through `t()`.
- Checked and left: the files two builders edited by script (`paint/wet-dry.ts`, `paint/stroke.ts`, `paint/brushes.ts`, `paint/brushes-animation.ts`, `styles/timeline-look.css`) were read line by line against the diff; no stray or corrupted lines (no CRLF, no whole-file churn, tsc clean).
- Export dialog: the notes box now has `min-height: 84px` (the progress box's height), so the dialog no longer re-centres when the progress box gives way to "Export cancelled.". Brush import counter reads "{n} of {all} selected" through `tf`.

## v0.16.0 · brush quality in the app

Found by painting through the real app (new movie, brush library, Color panel, CDP pen events), not the Stroke harness.
- Default pen (Animation > Sketch > Lead stub): the dots were the brush's own stamp, `lead-hb` (a speckled tip, 40 to 100 percent alpha by tooth), mapped by name in `brush-materials.ts`; at a hairline size every stamp read as a bead. The mapping is removed (plain soft round tip plus the graphite grain). Pen response is its own floor in `dry-media.ts` (`STUB`: size 0.2, flow 0.3, gamma 0.9) so a 0.2 press is a fine pale line and a 0.9 press a broad dark one; flow 0.95, grain 0.55, spacing 0.05, max 22. `defaultSlider` aims at 14 px (was 11).
- Watercolor: three real causes. (1) `PenInput.up` sent no sample when the pen lifted where it rested, so the stroke never saw the rest time and only the fixed 0.6 end bead ran: the lift is now reported after a rest over 120 ms. (2) A rest only darkened covered pixels; the wash now also spreads (three stamps, each wider, up to 1.9 diameters at 2.5 s) and the pool radius grows 0.5 + 0.2 t. (3) The default size of a wet or glaze brush was a pen's size (14 px) so rim, pool and bleed were a few pixels: `defaultSlider` gives them 60 percent of max (up to 64 px). Rim band 0.2 of the size (was 0.15), bleed blur reach 7 radii (was 5). The harness never lifted after a rest and always set a big size.
- Oil bristle seam: not reproduced in the current tree (Flipbook and Drawing, 10 bristle brushes, sparse and dense events, 6x CPU throttle, rests, strokes to and past the canvas edge, dsf 3). The fray lift and the finish rectangle were read again and show no step; no code changed for it.

## v0.17.0 · Keyframes parity (keys area)
- Ease in and Ease out were labelled backwards (L-KF-051/052). Plotted `easeCurve` at u 0.1/0.25/0.5/0.75/0.9: stored id `out` gives 0.019/0.109/0.375/0.703/0.891 (slow start, speeds up), id `in` gives 0.109/0.297/0.625/0.891/0.981 (fast start, slows into the next key). No file migration: the stored ids and the maths are unchanged so every old file plays the same; only the labels, order and the E then 1 to 4 numbers swapped (`EASES`, graph editor `PRESETS`, `key-commands.ts`). A key stored as `in` now reads "Ease out". Text build presets keep their ids, so they play as before.
- Reverse keyframes: `reverseKeys(c, kind, whole)` with `whole` mirrors every lane around the content's centre (frame 0 to duration-1), so lanes stay in step (Content menu and the Reverse Keyframes command). The Graph editor and lane Reverse keep the per-lane span. `reverseRefs` mirrors a multi-selection around the selection's centre across all kinds. Reverse is no longer hidden outside Keyframe mode, and is in Content > Keyframe tools.
- Edit anchor: `stage-view.ts down` now ignores any press that is not the pivot ring while anchor mode is on, so a drag on the picture or a hold-and-drag outside it neither moves the content nor writes a key.
- HSB shown 0 to 100 with 50 neutral (`ChannelSpec.shift`, `shownOf`/`storedOf`, D&P filter `Param.shift`); stored values unchanged.
- Warp: `options.rows` (optional) makes the mesh non-square; Add column / Add row in the card (`setWarpGrid`, `warpRows`, `meshOffset(..., rows)`). Collapsed Warp lane reads "Warp 5x6 mesh · N offsets".
- Filter menu: first group "Filters" in the reference order (Opacity, Gaussian Blur, Sharpen, Noise, HSB, Lens Blur), everything else under "More" (`ActionGroup.rest`).
- Swipe left on a red Action row (touch, pen, mouse drag) slides it and clears the lane; the Clear button stays.
- Draw & Paint Transform: the tap just outside the box edge nudges for mouse and pen too (the 44 px gap and 5 px travel rules stay).

## v0.17.0 · Timeline parity
- Expanded groups: inner tracks draw as full tracks through `drawBlock` (shifted copies of the inner blocks, cached per block so thumbnails stay), with chip, handles, sprocket holes and labels. Row height follows the track height. Nested open groups nest the drawing (`groupH`, `rowExtra`). Removed the 14 px `MINI_H` bars.
- Inner blocks: chip checkbox hides one block, hold or right-click opens a reduced menu (`ui/timeline-inner.ts`: hide, split, move out of group, delete). The full content menu stays top level only: its ops address top-level ids, so a full inner menu would need every op to learn nested ids.
- Drag in and out: an inner block dragged past its lane shows a ghost and the new-track line, and lands on the top level (`moveOutOfGroup`); a top-level block dropped on an open group's rows goes in (`moveIntoGroup`). Inner drags also change inner track.
- New content in an open group: `engine/group-ctx.ts` holds the target group (set by the Timeline: the group of the picked inner block, else the selected open group). `Engine.insert`, the import flow and the Track command read it. Removed nothing.
- Held-still on empty lane lifts the track (tint); sliding reorders it, releasing in place opens the track menu (before: the menu opened while the button was still down). A finger on empty lane pans; only a tap seeks.
- H hides the selected content (the track only when nothing is selected). Alt+Mod+F Fill duration, Alt+Mod+[ Contract to one frame. New track already had Shift+Mod+T.
- Up and Down in Keyframe and Perform modes walk the key lanes of the selected block first (`ui/lane-focus.ts`, ring on the lane), then change track.
- Track menu: Cut, Copy, Duplicate, Paste as the icon row; 264 px wide. Highlight: the seven reference colors (Coral and Amber are the red and orange slots; teal is no longer offered, still drawn for old movies). Masked blocks say Clipping, Alpha or Luminance Mask at the lower right. Text blocks render at the tile's scale so the words read.
- Held Ctrl+= / Ctrl+- zooms a little each frame (`installHeldZoom`). Files dragged over the Timeline from the desktop draw a ghost and the new-track line. The clipboard is mirrored to localStorage (`fm.clipboard.v1`, under 2 MB).
- Already working, only driven: lasso removal by crossing, per-movie view restore (needs the movie saved), sprocket holes, CAF / AC3 / MP2 through the engine, Action menu swipe Clear and the lane's Delete row.

## v0.17.0 · brushes · paints, textures, spray, color pencil
- Opaque paints (Round paint, Flat paint, Gouache, Acrylic, Filbert, Animation Paint set): new stamps in `paint/fam-paint-tips.ts` (`paint-round/flat/filbert/gouache/dry/plain`): a solid body whose side is combed by hair columns (the stamp turns with the stroke, so the strands run along it) and whose ends are ragged by hair length. Wet and render modes dropped from these brushes: the plain path keeps the paper tooth as a ceiling on coverage, which is what makes light pressure and a thinning load show grain. Tooth is fine (scale 0.4 to 0.5, depth floor 0.15) so the body stays solid and only the rim and the light strokes go dry. Name to stamp mapping is in `brush-materials.ts` (`flat paint`, `round paint`, `gouache`, `acrylic`, `filbert`).
- Texture brushes: Canvas weave, Fabric weave, Linen, Concrete, Paper tooth (Classic Material / Texture, Animation Texture): no more stamped crosses or sponge dots. One continuous round-bodied band; the surface is the grain. New grains in `paint/fam-paint-grains.ts` (`tex-weave`, `tex-linen`, `tex-concrete`, `tex-tooth`), strong and even, selected by name at the top of `GRAINS`. The old `paper-rough` and `paper-cold-press` grains read as leopard spots under a soft round stamp and are no longer used by these brushes. Grain scale below 1 mirrors the tile (kaleidoscope seams): all texture brushes stay at 1 or more.
- Spray (`spray-can`, `fat-cap`, `thin-cap`, `fade-spray`, `grit-spray`): new stamp `spray-mist` (2200 particles on a golden-angle spiral with stratified radii, so nothing clumps when many rotated stamps overlap). Spacing 0.03 to 0.04 of the cloud and flow 0.2 to 0.4 give a continuous mist with fine speckle at the rim instead of separate dotted clouds. Spacing 0.014 with low flow was tried and went smooth (no speckle).
- Color pencil: flow 0.4 to 0.9 (it never reached colour), max size 22. The dry-media floors still keep the light touch faint but visible.
- Other fixes while painting the unreviewed sets: Light streak and Vein (`baseRot -pi/2`: the long axis of an elongated stamp lies on the stroke), Woodcut (bold chisel, the rake stamp made hairlines), Faded print / Gritty marker / Grain smudge (`tex-tooth`), Quill (chisel nib, the blade stamp broke into dashes), Dry script (grain scale 0.6 mirrored), Boil fine / Boil bold (wiggle raised), Animation Texture set rebuilt (Rust, Plaster, Stone, Burlap, Weathered, Bark use `paint-plain` stamps).
- Shared hooks: one import and one loop line in `tips-lib.ts` and in `grains-lib.ts`; the mapping tables in `brush-materials.ts` lost `concrete=sponge-sea`, `woodcut=stamp-rake`, `vein=stamp-fern`. Not touched: Oil bristle, Impasto, Dry brush, Fan, Palette knife, Knife, Glaze, Watercolor family, pencils, charcoal, inks.

## v0.17.0 · shell (Theater, split, settings, help)
- Backstage visibility default back to 20 percent (`BACKSTAGE_DEFAULT` in engine/render.ts, a stage-builder had raised it to 30 last turn): the reference 2.1 default is 20 and the ledger row L-SH-070/317 says so. Movies saved with an explicit value keep it; ones saved without the field now show 20. The Stage options field shows a ign.
- Stage and Timeline resize: the central toolbar background (hold 450 ms, or any mouse drag) and the strip just above the Ruler (arms at once) drag the split, mouse and touch; same stageShare pref as the grip (app/app.ts).
- Mode pill and zoom cluster: Timeline.clampScroll already pads the lane scroll range by the pill height; verified at window heights 640, 800 and 1000 with 8 tracks, the last lane scrolls clear.
- Frame rate change now keeps frames (speed changes) as the reference does; a movie with content asks (ui/fps-change-dialog.ts) Keep frames (default) or Keep timing (the old retime). Empty movies still keep their length in seconds. ops.patchMovie takes keepFrames.
- Cloud folder is a second Theater: clicking it flips the engine library to the cloud folder and the computer entry flips back (ui/theater-flip.ts); nothing is copied. The home folder is remembered in localStorage.
- Picture in the Theater: choose a file (ui/author-picture.ts), kept as a 192 px square data URL in movie.authorPicture (about 10 to 30 KB, capped at 400 KB); the Theater poster itself is unchanged.
- End bar Enter duration takes hours, minutes, seconds (ui/duration-hms.ts: 0:00:10, 1m 30s, a bare number is seconds). Stage timecode is hh:mm:ss:ff.
- Help Center and Help menu link to the web handbook, community, video tutorials, education and the idea board (ui/external-link.ts; project GitHub pages, opened in the system browser, through the shell plugin when in the desktop app). The URLs live in one table.
- Recovery Points: Share saves a point as a .fmo (no history). Free Trim banner is fixed at the top of the interface. Onions is its own page of the Stage tab and the Stage options (row, back row).

## v0.17.0 · brushes · watercolor and wet inks

- Grey rectangular haze around washes: not the dry pass. `bleed()` in paint/wet-dry.ts blended colour into clear layer pixels whose bytes are black (0,0,0,0) while their alpha rose, so the stain read grey and ended on the dirty rectangle. A clear pixel now takes the running colour whole (k to 1 as alpha goes to 0). What is left is a faint blue wet-in-wet stain between strokes laid while the first is still wet.
- Even interior: paint/fam-wet.ts `washVariation` (two octaves of value noise, scale from the stroke width) multiplies the film thickness inside the rim in `dryBlock`; damped over dark pigment so black ink does not turn pale. Same maths in worker and main thread (no random numbers).
- Pressure: Watercolor wash pressureSize 0.4..1, pressureFlow 0.3..1; Animation Watercolor 0.4 / 0.35; Wet blend, Sky wash, Light wash, Granulate widened. Wet blend, Sky wash, Light wash got wetEdges (0.3 to 0.5) and grain 0.3 so they have a rim and tooth.
- Beads: a rest bead needs a 220 ms stall (was 120), t cap 1.8 (was 3.5), disc radius 0.4 + 0.12 t of the diameter, spread stamps halved. Sumi got uniform-glaze + wetEdges 0.55, max size 64, thinner at light touch; Pooled ink got taper and a larger max size.
- Granulate start blob: not reproduced at stroke start; the blobs seen were rest beads from stalled test input.
- Open: faint pale dashes in thin Sumi strokes at light pressure (rectangular, about 30 px), not traced.

## v0.17.0 · Draw & Paint interface (L-DP partial rows)

- **Reverses FV-202.** Create > Drawing and Create > Flipbook enter Draw & Paint again, because the Handbook (primary source) says so. `openPaintOnCreate()` in `ui/create-pref.ts` is true unless the stored choice is `'0'`; existing stored choices are kept; the command "Open Draw & Paint after adding" still turns it off.
- Size and opacity markers start empty (`ui/brush-slots.ts`, storage key `slots2`, so old pre-seeded values are not read back). The bubble "+" fills the first free marker; "-" empties the marker at the current value; an empty marker is hidden (`.is-empty`). The brush presets (`defaults()`) are no longer used for markers.
- Color history holds 10 (was 8). A second History strip with Clear sits above the palette list on the Palettes tab (the footer is hidden there); both strips paint from the one list (`i % HIST_MAX`). Palettes toolbar reflowed: Import, Export, format, Image, count fit the 254 px row; format names lost their dot.
- ColorDrop fringe: `paint/fill.ts` floodFill now grows the fill up to 10 px under the soft or antialiased body of the line it stopped at (frontier walk through partly covered pixels only, an opaque core still stops it, empty pixels beyond a line are not filled, so it cannot leak through a thin faint line). The lighter rim left on the outside of an opaque textured stroke is the brush's own edge, not the fill.
- Rectangle and Ellipse selection: a second finger held during the drag snaps to a square or circle (`PaintTools.snapTarget/setSnap`, `PaintView.snapPointer`); the second finger no longer starts a pinch while a selection drag is live. Shift stays.
- Dynamic brush scaling is a toggle plus a "Brush scaling" Canvas/Screen row that shows while on (`ui/paint-settings.ts`); the stored `scaling` value is unchanged.
- Advanced cursor settings: a Prefs row opens a second sheet beside the popover with Brush cursor and Cursor outline (same prefs, two views).
- Blend card list fades at the foot while more rows are below (`.is-more`, `ui/layers-panel.ts`).
- Brush panel: set column 140 px wide, 12 px names ("Environment" no longer truncates). Search field starts folded away (`.is-away`); a touch or pen swipe down, a wheel turn up at the top of the list, any printable key typed on the panel, Ctrl+F or "/" with the panel open, or Tab to the field reveals it. A mouse drag cannot swipe because rows are draggable (wheel and keys cover the mouse).
- Brush panel header has a magnifier button (`.fm-bp-find`, label "Search brushes") that reveals and focuses the folded search field for mouse users; the field stays revealed while it holds text; swipe, Ctrl+F and "/" unchanged.
- Fix: Select and Transform (top-bar buttons) wait for `landing` (the paint worker's pending stroke commit, set in `landStroke`) before reading the layer, so Transform at 200 ms after a stroke no longer says "Nothing to transform". Filters opens a menu only and reads the layer on Apply, so it is not gated.
- L-DP-028 redone: `fit()` pads 14 px at the sides, 40 px top (bar is 52 px glass at 88 to 62 percent), 14 px bottom (190 in a Flipbook), so the picture runs under the bar and the sidebar. A fully transparent bar made the labels unreadable on a white canvas.
- Crop and resize: `bakeCanvas` takes an `onStep` callback; `ui/paint-progress.ts` shows a progress chip ("Resampling picture 2 of 3") while the pictures are re-baked.
- Top bar is glass over the canvas, no strip edge (canvas full bleed, L-DP-028).
- Dragging the Timeline divider (or the transport bar resize) to the bottom opens Draw & Paint for the selected Drawing or Flipbook (`app.ts` `fullFlipbook`).
- Already done, only verified: Resample Quality percent (L-DP-284), mini Flipbook docking moves the sidebar (L-DP-052/346), unused cells past the track end near-black (L-DP-330), Transform nudge (L-DP-206).
- Not mine: roll brushes and cursor stamp angle (L-DP-040), library names (L-DP-068, 071, 083 apart from the layout fix).
- A 50 percent Resample of a 3840 x 2160 Flipbook crashed the headless Chromium tab (tab memory); 80 percent ran with progress. Not changed.

## v0.17.0 · Import

- `.procreate` import (L-IO-023, L-SH-196, L-SH-202): `io/tiled-artwork-import.ts` reads the documented layout (ZIP, Document.archive via `parsePlist` + `unarchive` of brush-import, tile folders per layer UUID, `col~row.chunk` LZO1X and `.lz4` Apple-framed tiles, rows bottom-up, premultiplied, masks one byte per pixel, groups from `unwrappedLayers`/`children`, blend ids with `extendedBlend` first, background colour layer) into a LayeredDoc, so it lands as a Drawing and Convert Layers to Tracks works. `io/lzo.ts` holds both decompressors, output sized by the caller. Fallback to QuickLook/Thumbnail.png with a notice when the archive or tiles cannot be read. Canvas rotation, flips and the file's own animation frames are not applied (no sample; noted in the toast). Colors are read as sRGB.
- `.drm` (L-IO-033, L-SH-030, L-SH-203): N/A, no public description of the format; refused with a specific message.
- L-IO-007: an import lands in empty space on the highlighted track (not locked, no overlap) before a new track is made.
- L-IO-040: Preview Sound opens for every sound picked through Import (also several at once, each asked in turn); `previewSounds` now defaults on, off leaves the one-minute duration rule.
- L-IO-021: HEIC verified through the engine route with pillow-heif present; this machine's engine has neither pillow-heif nor ffmpeg 7.1, so there the refusal message shows. L-IO-013: pictures are decoded by the browser with its default colour conversion (a Display P3 PNG with cICP gave 200,100,50 to 215,93,31), the canvas stays sRGB.
- L-IO-027/191: no HEVC alpha sample could be made (libx265 here has no alpha); engine transcode route unchanged, unverified.

## v0.17.0 · brushes · dry media and inking

- Tilt (L-BR-074/075/076/083/098/134): `dynamics.ts tiltShape` gives side-shading media (tilt 0.6 and up) a broader, softer swath (long axis up to 6x, 8x for small pencils; short axis 2.9x; reached at about 35 degrees) and more edge softness; the long axis stays along the lean, so the mark is widest across the pen's lean (a pen leaning along the stroke still thickens through the short axis). The charcoal / willow / pastel swath is a grid of stamps: `paint/fam-dry.ts swathGrid` keeps the grid at 0.36 of the stamp (the old 0.8 grid left hollow rails), shares the flow between overlaps and `swathCorner` drops the square corners so the ends round off. Hook in `stroke.ts` (compress block).
- Wiggle (L-BR-036): amplitude floor 4.5 px and 0.8 of the width (was 3 px and 0.7), so thin boil lines still wobble. No wiggle frame exists in the reference clips, so it was judged by eye.
- Airbrush default (L-BR-045/057/094): `paint-size.ts defaultSlider` starts a soft low-flow airbrush or mist at about half its maximum (to 90 px); imported brushes (custom, sampled tip) start at 0.7 of their maximum (to 56 px) (L-BR-128).
- Ink taper (L-BR-053/085): Studio ink and Brush pen taper in and out (pen: tail past the lift). Sumi and Pooled ink belong to the wet-inks entry.
- Cursor (L-BR-032/133): the App setting "Cursor outline" now defaults to Brush, which draws the tip shape, lean and roll (code already in `paint-feel.ts drawBrushCursor`). A person's saved choice is kept.
- Brush panel (L-BR-011/014): press and hold (about half a second, pen, touch or mouse) on a brush or set row opens the same menu as a right click, and the click that ends the hold is swallowed; a search also lists matching sets and libraries in the left column (a click opens them).
- Roll (L-BR-080): Charcoal roll, Marker roll and Calligraphy roll (names with "roll" follow the pen's barrel roll, `feel.ts ROLL_NAME`).
- Graphic set (L-BR-044): Cut paper, Sticker and Halftone are spaced close so a stroke is a band. Highlighter multiplies (L-BR-052), so it never covers ink under it.
- Brush Studio pad (L-BR-122): Pressure minimum / scale, Tilt direction, Wet mix, 8 preview colors and Create reset point were driven in the browser and work.
- Tilt re-check: `tiltShape` keeps scattered brushes (Toothbrush: shape count or scatter above 0.3) at their size on a lean, and gives paint-like brushes (bundle, wet, render, bristle, comb, speckle, sponge tips) a modest oval (1.6x, 0.6x) apart from the dry side law. `swathGrid` now gets the stamp's thinness (roundness) so a flat tip (Pastel side) has no hollow rails; Animation Conte uses the swath and canvas grain (its moving grain and bump drew rails). The boxy square ends of Flat bristle, Oil bristle, Impasto and Knife at tilt come from the bundle stamper (bristle.ts), not the swath hook (it returns before it): not changed here.

## v0.17.1 · brushes · dry media

- Tilt regression found: the v0.17.0 "scattered" guard in `tiltShape` counted `scatter` (stamp rotation, 1 for every charcoal and chalk) as a scatter, so stick media did not widen at all. It now counts only shape count above 1 and position scatter above 0.3 (Toothbrush still keeps its size).
- Side shade at any azimuth: the short axis of the swath is 0.68 of the long one, so a pen leaning along the stroke (tiltX) lays almost as broad a swath as one leaning across it (tiltY). Checked at tilt 30 and 60 on both axes: Charcoal stick, Pastel, Compressed, Stick chalk, Soft pastel, Chalk block (given tilt 0.8) and Crayon.
- Classic Chalk had `tilt` 0.5, under the 0.6 side-shade threshold, so it only got the plain lean; raised to 0.85. Verified at tiltX and tiltY 30 and 60.
- Animation Stick chalk and Soft pastel use the stamp swath (`tiltCompress`). Grain airbrush: the default-size rule no longer skips grained brushes, so it starts as a cloud.
- Reference brush names (L-BR-004): left as they are, an owner decision (originals; a reference alias tag would make a search for a reference name find ours).

## v0.17.0 · brushes · oil and bristle
- Tone blocks and the vertical seam in light oil strokes (L-BR-089, 071, 131): a hair's contact sat on a threshold at light force, so small changes in pressure or pen speed switched whole stretches on and off. Contact now eases along the path (`easeContact` in paint/fam-oil.ts, hook in paint/bristle.ts `step`, 0.35 brush widths). Light force also gets a small lift so a touch leaves a faint trail instead of nothing.
- Dark notch at the end of light strokes (L-BR-090): `bristleLift` in stroke.ts raised the pressure to at least 0.35 for the tail; it now leaves with the stroke's own pressure (`liftPressure`).
- Palette knife and Knife (L-BR-091): the tip was the three-line comb (blade) or a chisel. Both are now a bundle with `bristle.body` (new optional field, types.ts and bristle.ts): a solid band of hairs that keep their places (no wobble, no ragged start), strong pickup and carry (pull 0.5, charge 0.97). They scrape and drag the paint under them. The shared `blade` tip is unchanged (Quill, Grass, Cut line, Fern use it).
- Glaze (L-BR-092): a translucent film with canvas grain and pressure opacity; overlaps build tone. A wet edge was tried and left out (it hazed the stroke).
- Not changed: the bristle bundle code path is shared by main thread and worker, no worker-only code was added.
- Tilt on bundles (dry-media builder's report, boxy swatch): `BristleStep.lean` (tilt.lean) now makes the hairs at the outer edge touch later, lift sooner, lie thinner and lighter (`outerness` in fam-oil.ts, used in bristle.ts), so a leaning bundle fans out and its ends fray and round. A flat blade (`bristle.body`: Knife, Palette knife) turns onto its edge: `leanDia` cancels the tilt growth and narrows it to a thin line. Knife, Palette knife, Animation Oil blend, Impasto and Mixed color got `tilt` (they had none, so the lean never reached them); Animation Flat bristle is now a bundle (it was a fixed-angle chisel stamp, the parallelogram swatch). Shots w17_oil/tilt_a.png (before) and tilt_b.png (after).
- Tester v0.17.0 (pale grey oil and gouache): the mix with the canvas was too fast (pickup 1.6 per width, refill slow) and the force floor of flow was 0.5. In bristle.ts pickup per width halved and refill raised (a hair is mostly its own color again within about two widths); Oil bristle, Oil blend and Classic Impasto: lower pull / attack, higher charge, flow floor 0.8 (Oil). Gouache (Classic and Animation): flow 1, force floor 0.85, so it stays opaque. Seen in the app: red at force 0.25 / 0.5 / 0.8 is rich red with hair texture; red over blue mixes to brown instead of grey; gouache covers blue fully. Shots w17_oil/rich_om3.png, rich_g.png (before: rich_om.png).

## v0.17.0 · review
- `.procreate` reader (`io/tiled-artwork-import.ts`): a canvas up to 16384 x 16384 allocated 1 GB per layer. Now a canvas over 64 million pixels opens as the preview picture only, and one file may fill 1.5 GB of layer pictures in all; layers past that open empty with a note. The decompressors (`io/lzo.ts`) were checked: every copy and literal run is bounded by the known output size, no loop can run without consuming input, so they stay as written. Zip entry and total sizes are capped by `safeUnzipOr`.
- Picture in the Theater (`ui/movie-settings.ts`): a shared movie's `authorPicture` was put in an img src as is, so an address would have been fetched. Only an embedded `data:image/...;base64` picture under 400 KB is shown now.
- Clipboard kept in localStorage (`engine/engine.ts`): Paste drops blocks whose picture or sound the open movie does not hold (the clipboard now outlives the session, so it can come from another movie). Still capped at 2 MB, storage errors caught.
- Paint: the dry-media side-shade tilt rule (`paint/dynamics.ts`, tilt 0.6 and up) also hit oil bristle, impasto and thick oil (tilt 0.6), whose size grows with lean; it now skips any brush with a bristle bundle.
- Help links (`ui/external-link.ts`): the address is parsed; only https with a host and no user or password opens, in the system browser (desktop) or a new tab with noopener. All five addresses are in `HELP_LINKS`, one place to change.
- Checked, no change: fonts @fontsource anton, sora, space-grotesk, poppins 5.3.0 (published 2026-07-19, OFL-1.1, all imported by `media/font-bundle.ts`, NOTICE row present, `npm ci --dry-run` clean); Theater flip (library is repointed, nothing copied); fps `keepFrames` (ratio 1, nothing moves); group in and out ops keep ids and delete before place; HASHOUT logs only gained lines.
- Follow-up: the main-thread stroke path (worker off) never repainted the area a wash dries over, so it showed no rim or settling; paint-view.ts now marks the patch rect dirty after finish(). Fixed-seed worker vs main-thread wash: 10 of 23392 stroke pixels differ by more than 30 (max 35, from cursor and timestamps), was a visibly different stroke.
- Sumi dashes: the pale rectangular cells came from the brush grain at hairline width, not the dry pass; Sumi grain is now 0 (bristle tip gives the texture), and in dryBlock a near-black film no longer thins (rim cut of a hairline). Start blob did not reproduce (taper start).
- Wet-in-wet: bleed runs twice and reaches further (near x5); a red stroke through a wet blue band now runs into the blue and the blue into the red below the crossing.
- Wet edge and Ink wash (Classic Water): round tip, light-glaze, wetEdges 1 / 0.6, flow 0.5, larger min size: real rimmed washes instead of hairlines.

## v0.17.0 · brushes · grain fit at hairline width
- Grain features wider than the dab read as pale cells along a hairline stroke. The grain sampler itself is per pixel, canvas anchored and bilinear when scaled, so it has no cell-aligned offset. New paint/fam-grain-fit.ts measures a tile's feature width once (correlation length, cached per tile) and stroke.ts shrinks the grain scale so features are about 0.7 of the dab diameter. Fine tiles (pencil tooth, speckle) and brushes with Grain Zoom are untouched. Scale never goes below a quarter.
- Checked in the lab path at minimum and default size (Pencil HB, Color pencil, Chalk, Canvas weave, Watercolor with coarse grain): fine grain is unchanged; coarse grain scale 3 at 12 px is now about dab-sized blobs instead of 24 px patches. The real-app sheet could not be captured (memory limit kills Chromium).
- Not grain: faint 30 x 65 px boxes at stroke starts on glaze brushes with wet edges (Sumi) remain with grain 0. They come from the wet-bleed map covering the previous stroke's whole dirty rectangle (wetMark) when the new stroke starts within the bleed reach; left to the wash builder.
- Faint boxes at wet-glaze stroke starts: wetMark already marks only covered pixels (edge mask), the box came from `bleed()` spreading that wetness and its `near` reach with a single box blur (a square kernel). Both now go through `roundBlur` (three narrower box passes, near Gaussian), so the reach is a round cloud. Same code in worker and main thread. Checked with two Sumi strokes and two Watercolor strokes, tone exaggerated x12: round, no rectangle (w17_wet/two_after.png).
- Regression fix: reopening the movie already loaded from the Theater did nothing. HomeScreen.sync hides a forced Theater only when the open document count or id changes, and reopening the same movie keeps both. openFromLibrary and openFile now call home.hide() after engine.open (app/app.ts).
- Stroke-end blobs: the pen-up bead (end) was always 0.6 x wetEdges at 0.55 diameter, so every wash ended in a dark disc. It is now 0.12 x wetEdges at 0.6 diameter (a slight swell); a real bead needs a rest of 320 ms (was 220) with the pen down and still. Bead falloff is squared so the pool is soft at its edge. Checked with strokes whose last 10 events slow from 6 to 1 px (w17_wet/w2_lift_after.png): clean ends, no halo.
- Haze bands between adjacent wet strokes (re-check): the bleed pass gave bare paper beside a wash the same alpha gain as the wash itself, so strokes laid side by side in a row left vertical tinted bands. On clear paper outside the wash the stain is now a quarter strength and fades with the blurred wash share. Sumi: taper 0.35 / taperEnd 0.4 (was 0.4 / 0.7) to shorten the hairline tail. Checked with Watercolor wash strokes laid end to end (w17_wet/w2_cols_after.png).

## v0.17.0 · Timeline parity (re-check pass)
- Track menu clipped (Paste tile and name field cut at the right edge): `.fm-tm-list` was a grid with an implicit auto column, so its widest row's min-content pushed the list to 284 px inside a 262 px panel. The column is now `minmax(0, 1fr)`, rows get `min-width: 0`, labels ellipsize, and the panel is capped to the window width (styles/popovers.css). Checked at 1600 and 900 px wide: four 59 px tiles and the name field sit inside the card (w17_tl/d1600_trackmenu.png, d900_trackmenu.png).
- Mask label pill driven: Clipping, Alpha and Luminance Mask each show at the block's lower right (w17_tl/e_mask_*.png).
- CAF, AC3 and MP2 import driven: each opens the sound preview, Import adds a 2 s block with no console errors (w17_tl/a2_tone.*.png).

## v0.17.1 · Timeline
- L-TL-127: Copy now keeps, in memory beside the localStorage copy, the pictures and sounds (Asset record plus blob) of every copied block, layers and group contents included (`clipAssets`, engine/engine.ts). Paste into another movie of the same session adds the missing assets to that movie and to the blob store. Only when they are truly gone (after a reload, the localStorage clipboard has blocks only) are such blocks left out, with an error notice naming how many ("One block was left out..." / "N blocks were left out..."). The old filter checked `c.asset` only; it now checks every asset the block uses (usedAssetIds). Checked: video block copied, new movie, Ctrl+V gives the clip with thumbnails (w18_tl/p1_pasted.png); after a page reload the notice shows (w18_tl/p2_reload.png).
- L-TL-074: a trim drag with several blocks selected applies the same step to the same edge of every selected block inside one `run` with the drag's tag, so it is one undo step; a block on a locked track or without room stays put (ui/timeline.ts, trim branch). Checked with two Solids: both shortened together, one Undo Trim restored both (w18_tl/t1_trim.png, t2_undo1.png).
- L-TL-111: the Ungroup command (and its Content menu item) is enabled only with exactly one group selected (app/app.ts); the block menu row was already hidden in Multi-select. Checked in the Content menu: disabled with two blocks, enabled with one group.

## v0.17.0 · brushes · paint re-check fixes
- Default size: paint/fam-paint-size.ts (called from ui/paint-size.ts defaultSlider) opens opaque paints, cloth textures, Halftone and Rough hatch at a painterly size (up to 56 px) instead of the 14 px pen size, and keeps sprays small (Fade spray no longer inherits the 90 px airbrush rule). Halftone drew nothing at force 0.9 and 1.0 only at the 14 px default: its 7-dot screen was sub-pixel; at its new size it draws at every force.
- Weaves: tex-weave now 48 threads a tile with ridged threads; new tex-burlap (coarse open weave with gaps) maps to Burlap. Canvas, Fabric weave and Burlap read as cloth, not a ladder.
- Tint: the ring banding was per-stamp hue and brightness jitter; it now varies per stroke (strokeHue, strokeBri).
- Chrome: shine.ts let the shaded side of a steep metal slope drive the colour factor below zero (black offset line); the factor now floors at 0.55.
- Rough hatch: flow 0.95, spacing 0.08, grain 0.3, jitter opacity 0.1.
- Fade spray: scatter 0.8 to 0.25, softness 0.6, flow 0.35, max size 120: a mist, not a page-wide cloud.
- Real app path (pen events, brush library) before/after: w17_paint/before_a.png, after_a.png, before_c.png, after_c.png, after_c2.png.

## v0.17.1 · brushes · paints
- Opaque paints (Round, Flat, Gouache, Acrylic, Filbert; Classic and Animation) had floors of 0.45 to 0.6 on pressure size, so force 0.2 to 0.9 changed the width by about a quarter and the edge was clean. Size floor is now 0.25 to 0.3 (about 0.45 of max at force 0.2, full at 1.0), flow floor 0.2 (Gouache 0.4), grain 0.4 to 0.45 with depth min 0.05 and position scatter 0.04 to 0.05, burnout 0.2 to 0.35: the rim is ragged and breaks into the tooth at light pressure and as the load runs down.
- Real app path crops: w17_paint/p18_before.png, p18_after.png (Classic Painting set). The Animation Paint rows use the same recipe and were not captured separately.
- Edges (final pass): paint/fam-paint-tips.ts gains a `taper` (outer hairs run shorter) so Flat paint and Filbert end in a ragged, tapered edge instead of a ruler cut (hair length variation 0.85 and 0.7). Round and Gouache bodies use 9 to 11 coarse hairs with many missing outer ones, and their position scatter dropped to 0.012 so the hair streaks survive stamping: the rim shows a combed, streaky halo. It is still close to a capsule at the default size; a harder grain cut of the rim would need an engine edge mask and was left. Crops: w17_paint/p19_after.png, p19_after3.png.
- Edge mask (opt-in `edgeBreak` on Brush, absent or 0 is today's behaviour exactly): paint/fam-edge.ts, called once per dab from stroke.ts after the dab's coverage is formed. The outer band of each dab (about 35 percent of the radius at 1.0, because dense stamping piles each rim pixel up to solid) is cut by the canvas-anchored paper grain plus 3 px flake noise, stretched so the edge breaks instead of landing on one crisp radius; deeper at light pressure (dab flow) and as burnout lowers the load. The mask is canvas anchored, so every dab agrees on a pixel and the break survives stamping. Set on Round paint (1) and Gouache (1.2), Classic and Animation. Per-stroke cost measured in the lab (160 dabs of 70 px, 6 strokes, 4 runs): 0 vs 1 are within run noise (about 480 vs 450 ms); the pass skips the body, uses no square root and a lookup table for the noise. First tries cut only the halo (a crisp edge): the noise had to be stretched for a ragged one.
- Real app crops: w17_paint/p20_after.png (Gouache, Round paint, Acrylic as the unchanged control, Animation Gouache and Round paint); before is p19_after3.png.

## v0.17.1 · brushes · Chrome, Rough hatch, Sumi
- Chrome: paint/shine.ts shades the dark side of a metal at only a quarter strength and floors the factor at 0.55 + 0.3 metal, so a tube has a bright band and a soft body, no dark offset line (non-metal shiny brushes unchanged). paint/fam-paint-size.ts opens Chrome at up to 30 px.
- Rough hatch: new stamp hatch-rough (fam-paint-tips.ts: four rows of uneven ragged dashes with gaps and tooth), mapped in brush-materials.ts; brush spacing 0.45, roundness 0.9, grain 0.5, jitter opacity 0.2, size jitter 0.15, small rotation jitter. Reads as broken hatch marks with grain.
- Rough hatch, second pass: the tick-rows tip read as a tyre track. Now hatch-rough is three long uneven rough lines (length, offset, width, darkness vary), the brush is locked to the canvas (followStroke false, baseRot 0.785), spacing 0.28 w/ spacing jitter 0.6, size and opacity jitter, pressure size 0.7 to 1 and pressure flow: parallel diagonal hatching that fills the band, darker w/ pressure. Crop: w18_br/b2_hatch.png.
- Sumi: taperSize 0.5, taperTip 0, taperEnd 0.3: no hairline tail or start speck at force 0.2, 0.5 or 0.9.
- Crops (2x): scratchpad w18_br/before_*.png and a1_*.png, a2_*.png (final).

## v0.17.1 · help
- L-SH-011: the Manual (ui/help-view.ts, shown in the Help Center) gets version tabs: All plus one tab per release in ui/whats-new-data.ts, newest first. A version tab shows that release's highlights and the manual's "New in x.y.z" notes; All shows the whole manual with its section list. Each version page is built once with the section pages; a tab click only toggles hidden and classes. Tabs are a roving tablist (Left, Right, Home, End).
- Search keeps filtering sections as you type (inside the chosen tab) and now marks matches with the CSS Custom Highlight API (::highlight(fm-help-hit) and fm-help-cur in styles/help.css), so no DOM node is touched. The first match scrolls into view; Enter goes to the next, Shift+Enter to the previous, with a "Match i of n" status line. A browser without the API still filters, without marks.
- Placeholder, tab bar label and All tab follow the language (onLanguage); the manual text stays English. Checked in Chromium: w18_help/02_v015.png (tab), 03_search_brush.png, 04_enter_next.png (63 matches, third one current), 05_v013_search.png.

## v0.17.1 · brushes · wet

- Cream tint on bare paper: the bleed pass now gives clear paper outside a wash a stain only where it is deep in a wet neighbour's reach (gain under 0.12 is dropped, not drawn), so the faint pale discs at joins are gone; colour still runs inside and between the washes. Checked 12 x amplified (w17_wet/w2_cols3_amp.png): no tint.
- Rest beads: a gap in the events counts as a rest only if the pen was already slow (smoothed speed under 0.07 before the gap) and moved under 3 px; a stall in steady motion leaves no bead. A held pen that keeps reporting counts after 320 ms inside a 1.5 px spot (stroke.ts restX/restY/restT, one bead per rest).
- Wet-in-wet driven again: red through a wet blue band runs into the blue, and the blue pulls down into the red below the crossing (w17_wet/w2_wiw2.png).

## v0.17.1 · brushes · oil
- Hard vertical end of bristle strokes (upright and under tilt): all hairs left together. `BristleStep.lift` (0..1 along the run-out in `bristleLift`, stroke.ts) now lets each hair lift at its own place (bristle.ts `liftK`): random per hair, outer hairs of a leaning bundle first, so the end frays; a blade lifts from its corners in, so Knife and Palette knife end in a rounded point. The run-out is longer under lean (x1.8 at full lean) and the pressure now falls to 0.4 of its value instead of 0, so the per-hair lift, not the pressure, shapes the end.
- Flat bristle (bundle since v0.17.0) frays the same way. Tested with tiltX 30 / 60 and tiltY 45 (pen release carries the tilt). Shots w18_oil/tilt_a.png (before), tilt_b.png and tilt_k.png (after).

## v0.17.1 · review
- Engine notices with a count: the paste notice "{count} blocks were left out: ..." was built in English with the number joined in, so the UI could not translate it. `Notice` now carries optional `vars`; `app.ts` toast and `ui/status.ts` flash run `tf(text, vars)` (whole sentence translated, values filled after). Other engine notices are unchanged.
- Help: closing the manual now removes its two highlight registrations (`onClose` in help-view.ts), so no ranges stay registered on detached text. Export dialog: a stray spacing typo on the alphaNote line.
- Checked, no change: stroke timing on a 3840 px canvas, 2000 px stroke, ms (old tree via git archive in a second server vs now): oil 100 to 119 vs 91 to 118, watercolor 1050 to 1300 vs 840 to 1080, pencil 27 to 30 vs 30 to 41 (noise level), palette knife 96 to 121 vs 100 to 160, round paint 104 to 146 vs 92 to 177. Clipboard assets are cleared on every Copy; paste into a locked track throws in `pasteContent` before any asset is added to the movie (the blob store may keep an unused blob until reload). tsc and build clean; text lint clean (only build_app.log, not source).
- Known and left: the "dry media" entry above sits mid-way inside the earlier Tilt re-check list (log order only).
- Final pass (silent pen): a gap in events with the pen down and the next sample within 4 px is a rest for the gap's duration (the speed-before test is dropped; a stall in steady motion resumes farther away, so it still leaves no bead). A 0.9 s stop mid-stroke leaves a soft pool (w17_wet/w2_touch3.png).
- Wet-in-wet at a touching edge: a wash stays wet 10 + 14 x dilution seconds (was 4 + 8 x), and the bleed colour blur is now 1.6 x the rim radius (about 0.3 of the brush width) instead of 7 x, so the two colours feather into each other across the contact and keep their own body, instead of the earlier overlap-only darkening or a full merge (w2_touch2.png was the too-strong intermediate).

## v0.17.2 · opaque paints
- Tester: Flat paint a speckled marker with a plaid grid, Filbert an opaque marker, Round paint grainy spray with no opacity change, Gouache flat. Cause: the stamp's own hairs are smeared by 20 overlapping dabs and the grain was a fine canvas-anchored speckle, so nothing ran along the stroke; low flow saturated to solid under dense stamping, so pressure moved only the width.
- Hair marks: new grains in `paint/fam-paint-grains.ts` (`paint-hair`, `paint-hair-soft`, `paint-matte`: lanes across the tile, each lane its own load that goes dry and loaded again along it). They are read in stroke space (`grainAlign: true` on the brush, the v0.17.2 alignment, so streaks follow curves and no corduroy on verticals). `brush-materials.ts` GRAINS maps Flat paint and Filbert to `paint-hair` (grain 0.5, scale 0.5), Round paint to `paint-hair-soft` (0.22, smooth body), Gouache to `paint-matte` (0.25); the old `paper-fine` rows for the pair are replaced.
- Pressure drives coverage as well as width: `pressureOpacity` 0.5 to 0.55 (Round, Flat, Filbert) and 0.22 (Gouache, subtle), flow floors 0.25 to 0.45. Position scatter dropped to 0.006 to 0.01 so stamp hairs persist. Load runs out slowly: burnout 0.35 on Flat and Filbert (about 3000 px at 60 px width). Fam-edge: `edgeBreak` 0.6 on Round paint and Flat paint, 0.5 on Filbert (new), Gouache 1 (was 1.2): a dry streaky rim at light pressure, firm at full pressure. Flat keeps its clean chisel cut ends; Filbert's rounded stamp keeps a rounded, feathered start and end.
- Animation copies take the same recipe (Flat paint, Round paint, Gouache); there is no Animation Filbert. Not deliberately different: the shared tile and stamp are in the Classic path.
- Real app crops (new movie, Draw & Paint, library, Color panel, pen force 0.2 / 0.5 / 0.9, horizontal, vertical, diagonal, S curve, long stroke), 2x: w19_op/a1.png (white; rows Flat, Filbert, Round, Gouache, Animation Flat, Animation Round), w19_op/a2.png (red over blue gouache bands), before (lab, same stroke code): w19_op/base_w.png, lab after w19_op/t2_w.png. Seen: first sheet showed Animation Flat paint corduroy on a vertical because the Animation rows had not been updated; fixed in a2.png.
- Not done: dark ground sheet and tilt 30 / 60 shots were not captured.

## v0.17.2 · brushes
- Edge break in the real app (`paint/fam-edge.ts`, called from `stroke.ts` with the stroke direction): the v0.17.1 lab tuning was only a fine fuzz in the app, because up to 20 overlapping dabs pile a half-cut rim pixel back up to solid. A cut pixel now goes whole (`w`, full by e 0.25), the ragged zone sits inside the band (threshold starts at 0.15, so it lands where the cut is already whole), the band is wider and deeper at a light touch (dab flow) and the flake noise runs along the stroke (under 2 px across, about 4 px long) so the rim breaks into bristle streaks instead of round specks. The lookup depends on the pixel and the direction only, so every dab agrees (no seam, no dotted chain). Brushes without `edgeBreak` do not enter the function. Round paint 1, Gouache 1.2 (Classic and Animation).
- Checked in the app (new movie, Draw & Paint, brush library, Color panel, pen force 0.2 / 0.5 / 0.9, 200 percent): white ground, near-black ground, over four blue strokes: light force a thin dry broken line, full force a fuller line that still breaks at the rim, no ring, no seam. Live stroke against the committed one: 0 differing pixels (w19_br/lv_g_live.png, lv_g_done.png). w19_br/g4_*.png Gouache, r4_*.png Round paint, ag4_*.png and ar4_*.png the Animation rows. Seen and left: Round paint's body shows a repeating mirror-shaped cell on a dark ground (the paper grain tile with the coarse hairs, it was in the v0.17.1 lab shot too, not the edge pass).
- Animation copies, decided one by one. Same as the main brush (shares the fix): Round paint and Gouache already carried `edgeBreak` and take the pass; Flat paint gets the tapered hair body through brush-materials (`flat paint=paint-flat` is not an `a:` row, so the Animation brush uses it); Stick chalk raised from tilt 0.7 to 0.85 like Classic Chalk (lean now widens on both axes, w19_br/chalk.png: top row Animation Stick chalk, bottom row Classic Chalk, tilt 0 / 30 x / 30 y / 60 x / 60 y); Rough hatch is Animation only (v0.17.1 shots w18_br/b2_hatch.png); Chrome is Classic only (no copy); there is no Animation charcoal or Filbert. Deliberately different: Blackboard and Sidewalk (upright board and pavement chalk, no lean), Pavement (tilt 0.5, a heavy coarse chalk that stays near its size), Trembling chalk (wiggle), Soft pastel and Conte already had tilt 1 / 0.8 with the stamp swath, Animation Watercolor keeps pull 0.1 and a long wet time (dilution 0.6) so the washes stay tidy for in-betweening; Animation bristle row keeps its own tilt 0.6 and bundle (the fray is in bristle.ts, shared).
- Kaleidoscope cell in Round paint (follow-up): `scaleGrain` (paint/stroke.ts) mirrored the 256 px grain tile at its edge even when shrinking it (grainScale or the hairline fit below 1), so a mirrored copy showed every 256 x k px (about 40 px for grainScale 0.45). Shrinking (k below 1) now repeats the tile (library tiles are seamless); stretching keeps the mirror. Affects every brush whose effective grain scale is below 1 (Round paint, Gouache, Acrylic, Flat paint, Filbert and the finer pencil, chalk and texture grains); the edge change is only that the mirror is gone.
- Corduroy on non-horizontal strokes (follow-up): the strokes in the report were Flat paint (not Gouache): its grain was `bristle-drag`, a horizontally streaked tile anchored to the canvas, so every Flat paint stroke carried horizontal bands whatever its direction. Flat paint and Filbert now use `paper-fine` (brush-materials.ts); their hairs come from the stamp. Other brushes still on `bristle-drag` (Impasto, Oil bristle, Knife, Fan, Hog hair, Stiff, Splay, Streaky, Worn comb, Mixed color, Sumi, fibre and fur brushes) share the same canvas-anchored streak and were not changed here: they carry hair bundles of their own and were tuned last turn; a turn-with-the-stroke grain would be the next step.
- Streaked grain follows the stroke (`grainAlign`, new optional Brush field, types.ts): `withMaterials` sets it for every brush whose grain resolves to `bristle-drag`; other grains are untouched. The first try rotated the tile and re-wrapped it (`seamless`, then a 32 px band): it drew plaid squares and crossing streaks at 45 degrees (w19_br/d1.png, d2.png), so it was dropped and `seamless` is back as it was. The second try turned the lookup about the canvas origin (clean diagonals, d3.png) but far from (0,0) a 1 degree change moved the sample by many pixels, so S bends marbled. Final: the lookup is in stroke space, the tile never changes: `easeGrainDir` (stroke.ts, called at the top of `dab`) takes the stroke's own direction (full turn, eased 0.25 per dab, only to calm pen jitter) and per dab keeps fixed-point (x1024) cosine, sine and two offsets, so a pixel reads the original seamless tile at along = travel + (p - dab) . dir (tile x) and across = (p - dab) . perp + a per-stroke offset from the seed (tile y), `(py c - px s + gb) >> 10` by `(px c + py s + ga) >> 10`, wrapped; overlapping dabs agree to within the dab spacing and streaks bend with the curve like a ribbon (d5.png). Readers: the stamp's three grain reads, the coverage ceiling and relief passes (`ti`), the hair bundle (bristle.ts, `BristleStep.gc / gs`), the wet relief (wet.ts, `WetStamp.gc / gs`) and the lit relief (shine.ts, `ShineOptions.gc / gs`, the tile's slope turned back to the screen). Integer maths in the inner loops, no allocation. A grain that moves per stamp (`grainMode` moving with movement below 0.9) keeps its own turn. A horizontal stroke is unchanged (angle 0). Before: w19_br/d0.png (bands across vertical and diagonal strokes of Oil bristle, Impasto, Palette knife, Hog hair, Stiff, Mixed color, Sumi); after: d5.png (rows in that order; horizontal, vertical, two diagonals, an S curve; d3 and d4 are the canvas-origin version). The lit relief (shine.ts) first turned the tile by the canvas-origin angle at the stroke's last angle, so on a bend the highlights of Impasto and Palette knife ran off the paint's streaks; now the hair bundle records the grain value it read at each pixel into a per-stroke 16-bit map (`BristleCtx.gmap`, 0 = not read, allocated only for a shiny, relief, aligned bundle brush) and `bakeShine` takes the slope from that map (`ShineOptions.gmap`); a neighbour the hairs never read stands in with the centre so a hair edge makes no false slope. An 8-bit map was tried first and was too coarse (flat, muted horizontals). Recapture: w19_br/d6.png, S-curve crop at 2x w19_br/d6z.png; horizontals match d5.png (marginally softer highlights). Stroke time, 400 px diagonal at the default size (main thread, median of 7, ms, plain / aligned): Oil bristle 28.3 / 17.6, Impasto 33.9 / 31.6, Palette knife 33.5 / 30.0, Acrylic (not aligned) 15.9 / 16.8, so the lookup costs nothing measurable (run order and warm-up give the differences).
- Regression check after the scaleGrain change, vertical, diagonal and curved strokes (w19_br/r1.png, rows: Pencil HB, Color pencil, Chalk, Charcoal stick, Animation Canvas, Paper tooth, Lead stub): even grain at every angle, no mirrored cell; no before shot, the change only removes the mirror. Animation Gouache h_ag_*; Flat paint on dark h_f_dark.png: the thin pale dashes in that ground are gaps between the ground's own Flat paint strokes (26 px apart), not the test brush.
- Both directions, white and dark ground, force 0.2 / 0.5 / 0.9: w19_br/h_g_*.png (Gouache), h_r_* (Round paint), h_ag_* and h_ar_* (Animation), h_f_* (Flat paint); suffix _white and _dark.
- Animation Watercolor wet-in-wet (w19_br/wiw.png): red through two wet blue bands mixes at the crossing and feathers a little; it bleeds less than Classic Watercolor wash by design. Animation Flat paint at force 0.2 / 0.5 / 0.9 in the same shot: tapered ragged ends, fuller with force.
- Bristle lift no longer runs past the pen (stroke.ts `bristleLift`): the hair fray was dia x (2 + 1.6 speed) long (about 100 px for Oil bristle, Impasto, Palette knife, Hog hair); it is now at most 6 px (dia x 0.1, leaning bundles a little longer), so the end thins within a few pixels and never extends. Check: w19_br/L1.png (stroke 260 to 700 and a vertical, with markers at the lift points; rows Oil bristle, Impasto, Palette knife, Hog hair, Pencil HB).
- Pencil HB (brushes.ts) ignored pressure at tilt 0 in practice (size 0.6 to 1 and flow 0.3 to 1 were too narrow to read): size now 0.35 to 1.1, flow 0.1 to 1, plus `pressureOpacity` 0.6. Check: w19_br/P1.png (force 0.2 / 0.5 / 0.9 thin and light, medium, dark and wide; tilt 30 and 60 still broaden).

## v0.17.2 · pen input
- Pen `pointercancel` mid-stroke (with moves fed) now commits as a normal lift, read at the last pen position (a cancel may carry no position; the first try drew a line to 0,0). Touch cancel still discards. `strokeMoves` counts moves per stroke.
- `lostpointercapture` on the paint canvas ends the stroke when buttons are 0 and the pointer matches. Canvas `pointerleave` calls `arbiter.leave`. A pen pointerdown while a touch stroke is live cancels the touch stroke. Test pad prints touch width and height ("Touch size") and `webkitForce` ("Mouse force").
- DeviceTracker: tilt flag also from altitudeAngle below pi/2; `mouseVaries()` (4 distinct pressures other than 0, 0.5, 1; the tracker now watches mouse events too). New setting `mousePressure` (default off) read in `readPointer`: a mouse event with buttons and pressure above 0 goes through the curve and smoother; the lift keeps the last pressure. Pen and Tablet shows a sentence when the mouse varies and the setting is off, and on Linux when the pen looks like a mouse a Pen Link line.
- Hold to pick a color: the timer only fires for a pointer that has not moved (touch: not `moved`; others: no move beyond 7 px); it never cancels a stroke that has been drawn. Setting kept.
- `ctx.filter` in compositeEffects is guarded by `canvasFilter()` (property present and write-read check); when absent the blur and color keys are skipped in the preview and one notice is shown.
- "iPad" curve preset (gamma 0.5); comment in input.ts that coalesced events must not be read for pointerId.
- Tester items 5 and 6 (flip footer Next drawing, onion default): Next drawing could not be reproduced: in a fresh Flipbook, after a stroke, immediately after a stroke, by coordinates and by hold, the button went 1 to 2 to 3 to 4 and hold went to 24 (the earlier hidden Mini Flipbook button also carries data-act=next, so a selector on data-act alone clicks a hidden one). Code unchanged. Onion defaults left as they are: PARITY_LEDGER_PAINT L-DP-256..258 record the reference defaults as 2 back, 40 percent, tint on pink back and blue forward (defaultOnion in engine/model.ts); no lower or subtler reference value is recorded, so parity wins over the tester's taste. Onions stay switchable in Settings > Onions.
- Checked in Chromium (scratchpad/w19_pen): 1_pencancel.png (stroke stays, undo on), touch cancel control (no ink), 3_holdmid.png (pen still 1 s mid-stroke, full line), 4_touch_before.png / 4_touch_after_pen.png (touch stroke gone when the pen lands), 5_pad_off.png / 5_pad_on.png / 5_canvas_mouse_on.png (mouse force: flat line off, tapered on).

## v0.17.2 · review

### io/drop-files.ts, io/project-sniff.ts, app/capability.ts, paint/pen-sample.ts, ui/pen-link.ts, ui/pen-settings.ts
- refers-to: drop-files.ts :: walk; project-sniff.ts :: ENTRY_NAMES_MAX; capability.ts :: showUnsupported; pen-sample.ts :: CURVE_PRESETS
- kind: explainer
- logged: v0.17.2

Review fixes. A folder drop stops reading further batches once the 2000 file cap is reached (it only stopped adding before, so a huge tree was still enumerated). The zip sniffer keeps at most 20000 entry names (the name list had no bound). The unsupported message uses `--space-3` for its gap. Law 7: the curve preset label "iPad" is now "Linked tablet" (id unchanged), and the Pen Link and Pen and Tablet sentences no longer name a handwriting feature or a tablet product ("Turn off handwriting-to-text on the tablet ...", "Link a tablet or another browser ..."). The three changed sentences have no translations yet and show in English until added.
- Noted, not changed: the tracker now sees plain mouse strokes on the canvas, so Pen and Tablet shows the "looks like a mouse" line to a mouse-only person who painted before opening it; harmless. The pen settings page and the paste, GPU and engine encode paths were read and found sound.
