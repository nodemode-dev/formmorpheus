/** What's New: the additions of the recent releases in plain words, newest first. Each row's `command` is a command id
 *  that Show Me runs; add a release at the top when one ships. */
export interface Addition { title: string; text: string; command: string }
export interface Release { version: string; name: string; additions: Addition[] }

export const RELEASES: readonly Release[] = [
  {
    version: '0.14.0', name: 'Effects, titles, shapes and sound post',
    additions: [
      { title: 'Effects library', text: 'Drop shadow, glow, color correction, vignette, pixelate, blurs, motion blur, chroma and luma key, chromatic aberration and mirror, all keyable, reorderable and copyable.', command: 'mode-keyframe' },
      { title: 'Rich titles', text: 'Style single words, add a shadow or a background box, and build text on letter by letter, word by word or as a typewriter.', command: 'add-text' },
      { title: 'Shapes and solids', text: 'Draw shapes with gradient fills and animated strokes, fill the movie with a solid, and color-correct everything below with an Adjustment block.', command: 'home' },
      { title: 'Sound post', text: 'EQ, compressor, reverb, ducking, level meters with loudness, normalize, and sound-only exports.', command: 'record-audio' },
      { title: 'Delivery', text: 'Export presets, size targets, vertical reframing with a focus point, watermarks, animated WebP and APNG, and layered PSD.', command: 'export' },
      { title: 'Drawing and Flipbooks', text: 'Painting runs in the background, wet paint drags, shine, palettes, and Flipbook timing with an exposure sheet and an underlay.', command: 'new-flipbook' },
      { title: 'Stage guides', text: 'Grid, thirds, safe areas and guides you drag from the rulers.', command: 'stage-options' },
    ],
  },
  {
    version: '0.13.0', name: 'Brush Studio, real wet paint, sound recording and editing tools',
    additions: [
      { title: 'Brush Studio', text: 'Edit every part of a brush on a live drawing pad: stroke, taper, shape, grain, rendering, wet mix, color dynamics, pressure curves and more.', command: 'new-flipbook' },
      { title: 'Real wet paint', text: 'Wet brushes pick up and mix the paint already on the canvas, and blue over yellow makes green.', command: 'new-flipbook' },
      { title: 'New tips and grains', text: 'Pencils, charcoal, chalk, bristles and sponges now each have their own tip and paper grain.', command: 'new-flipbook' },
      { title: 'Record sound', text: 'Record a voice-over straight onto the Timeline, with takes, punch-in, fades, pan, mute and solo.', command: 'record-audio' },
      { title: 'Editing tools', text: 'Snapping, markers, speed, reverse and freeze, transitions between blocks, and fit or fill for imported media.', command: 'home' },
      { title: 'Help Center', text: 'Guided tutorials that run inside the app, the manual, and a place to send ideas.', command: 'settings' },
      { title: 'Keyboard and screen readers', text: 'Reach every control from the keyboard, with names for screen readers and reduced motion.', command: 'settings' },
    ],
  },
  {
    version: '0.12.0', name: 'Faster playback, smooth dragging and brush folders',
    additions: [
      { title: 'Faster playback', text: 'Movies with many sparse drawings play faster from the first pass.', command: 'play' },
      { title: 'Smooth dragging', text: 'Moving, scaling and turning a block on the Stage stays smooth on big movies.', command: 'home' },
      { title: 'Quicker video jumps', text: 'Jumping far into a long video reaches the exact frame sooner.', command: 'import-file' },
      { title: 'Brush folders', text: 'Your brush libraries are folders of brush files you can browse. Show brush folder opens them.', command: 'new-flipbook' },
      { title: 'Paste and Insert', text: 'In a Flipbook, Paste and Insert (or Alt with Paste) pushes the later frames along.', command: 'new-flipbook' },
    ],
  },
  {
    version: '0.11.0', name: 'A smoother Stage, a second color and tips',
    additions: [
      { title: 'Smooth zoom and pan', text: 'Zooming and panning the Stage stays smooth on big movies, and playback reuses frames it has already drawn.', command: 'play' },
      { title: 'Your movie by name', text: 'The movie name sits in the title bar. Click it to rename the movie.', command: 'home' },
      { title: 'Copy to Folder', text: 'Copy movies to any folder from the Theater, and see or change where your library lives.', command: 'home' },
      { title: 'Layers to tracks', text: 'A layered Drawing can turn each of its layers into its own track.', command: 'add-drawing' },
      { title: 'Secondary color', text: 'Pick a real secondary color, swap the two, and click the previous color to go back.', command: 'new-flipbook' },
      { title: 'Transform several layers', text: 'Select several layers and move, scale or warp them together.', command: 'new-flipbook' },
      { title: 'Tips', text: 'A short tip shows the first time you open each mode. Turn tips off in Preferences.', command: 'settings' },
    ],
  },
  {
    version: '0.10.0', name: 'Folders, crop on the canvas, more fonts and sturdier files',
    additions: [
      { title: 'Theater folders', text: 'Movies can be stacked into real folders, and you can hold and carry several movies at once into a folder.', command: 'home' },
      { title: 'Crop on the canvas', text: 'Crop right on the picture in Draw & Paint, with a Flipbook time bar to check the frames as you go.', command: 'new-flipbook' },
      { title: 'Export brushes, sets and libraries', text: 'Send your brushes, brush sets and whole libraries back out as files to share or keep.', command: 'new-flipbook' },
      { title: '15 font families', text: 'Fifteen built-in font families, including Arabic, Chinese, Japanese, Korean, Thai and Devanagari.', command: 'add-drawing' },
      { title: 'Video with transparency', text: 'Video that has transparency now keeps it on the Stage instead of showing black.', command: 'export' },
      { title: 'HEIC pictures', text: 'HEIC photos open through the engine when you have ffmpeg 7.1 or newer.', command: 'add-drawing' },
      { title: 'Push, extend and contract content', text: 'Move what is inside a block by a frame, stretch it longer or shorter, and flip the order of its content.', command: 'mode-keyframe' },
      { title: 'Loop range and pen play', text: 'Set a loop range to repeat a part of the movie, and press the pen button to play. A four-finger tap previews the movie.', command: 'play' },
      { title: 'Insert a file', text: 'Bring any picture, video or sound in from the Create menu with Insert a file.', command: 'import-file' },
      { title: 'Recover Lost Movies', text: 'Find movies that were left behind after a crash or a moved folder and bring them back.', command: 'recover-lost' },
      { title: 'Safer engine', text: 'The engine now checks the host and origin of every request, and old movie files load cleanly.', command: 'settings' },
    ],
  },
  {
    version: '0.9.0', name: 'Text, onboarding, export and import formats',
    additions: [
      { title: 'Text formatting', text: 'Style text on the Stage and edit it in place.', command: 'add-text' },
      { title: 'Examples, tour and What\'s New', text: 'Three example movies, a short tour, this page and an About window help you get started.', command: 'tour' },
      { title: 'More ways to export', text: 'A preview window, H.264, HEVC, ProRes and VP9 video as .mp4, .mov or .webm, GIF presets and picture frames in PNG, JPG, TIFF, TGA, BMP and WebP.', command: 'export' },
      { title: 'More ways to import', text: 'Open TGA pictures and layered PSD, ORA, KRA and PDN files as Drawings; ProRes video and AIFF, CAF and AC-3 sound are converted by the engine.', command: 'add-drawing' },
      { title: 'A canvas for each Drawing', text: 'Every Drawing or Flipbook can have a canvas size of its own.', command: 'new-flipbook' },
      { title: 'Touch and pen gestures', text: 'Multi-finger taps and pinches work on the Stage and in Draw & Paint.', command: 'help' },
      { title: 'A library folder', text: 'Choose where your movies are kept, and share a movie with or without its history.', command: 'settings' },
    ],
  },
  {
    version: '0.8.0', name: 'Motion paths, the Graph, bones and a friendlier start',
    additions: [
      { title: 'Example movies and a tour', text: 'Three small example movies wait in your Theater, and a short tour points out the Stage, the Timeline, the modes and the Create menu. Both can be brought back from Help.', command: 'tour' },
      { title: 'Preview in the Theater', text: 'Rest the pointer on a movie in the Theater to see it move. Sharing a movie asks whether to keep its full undo history or to make the file smaller.', command: 'home' },
      { title: 'Graph editor and custom eases', text: 'Draw your own easing curves with Bezier handles, with overshoot, and reverse a span with one click.', command: 'graph-editor' },
      { title: 'Motion paths, pivots and parenting', text: 'Bend the path a Move takes with handles on the Stage, turn things around a pivot you place, and make one block follow another.', command: 'mode-keyframe' },
      { title: 'Camera, bones and lip-sync', text: 'Key a movie camera, rig a drawing with bones, and have mouth shapes follow a voice track.', command: 'mode-keyframe' },
      { title: 'Stage Options', text: 'Background color, transparency, the Backstage, the timecode and Onion skins in one panel, also on the Stage right-click menu.', command: 'stage-options' },
      { title: 'Keyboard Shortcuts editor', text: 'Every command with its keys. Change them, and conflicts are moved with a message.', command: 'shortcuts' },
      { title: 'Brush library and blend modes', text: '165 original brushes in 19 sets, import of brush files, and 25 blend modes with a true pass-through.', command: 'new-flipbook' },
      { title: 'Theater management', text: 'Select several movies, rename, duplicate, stack movies into folders and use the right-click menu.', command: 'home' },
      { title: 'Round trips', text: 'Send the current frame to the form image editor and the whole movie to the form effects editor, and bring them back.', command: 'export-fvd' },
    ],
  },
  {
    version: '0.7.0', name: 'Groups, masks, Warp and a faster Stage',
    additions: [
      { title: 'Layer groups and masks', text: 'Group Drawing layers, give them opacity and blend modes, and paint masks that hide without erasing.', command: 'add-drawing' },
      { title: 'Flipbook row masks and mini preview', text: 'Rows can cut the row below them, and a small preview loops beside the strip at the movie rate.', command: 'new-flipbook' },
      { title: 'Warp and Distort keys', text: 'Bend a block with a mesh or four corners and key the bend over time.', command: 'mode-keyframe' },
      { title: 'Loop the visible region', text: 'Play only the part of the Timeline you can see, with sound restarting at its start.', command: 'play' },
      { title: 'GPU compositing', text: 'The Stage and exports draw on the graphics card when it matches the processor path. It is on by default and can be turned off in Preferences.', command: 'settings' },
    ],
  },
  {
    version: '0.6.0', name: 'More export formats, recovery and 30 languages',
    additions: [
      { title: 'ProRes and HEVC export', text: 'Export ProRes 422 HQ, ProRes 4444 with transparency and HEVC through the ffmpeg you have installed.', command: 'export' },
      { title: 'Recently Deleted', text: 'Deleted movies and exports stay for 30 days and can be restored.', command: 'home' },
      { title: 'Crash recovery', text: 'If the window closes by accident, the next start offers to bring your movie back.', command: 'recovery-points' },
      { title: 'Thirty languages', text: 'The whole interface in 30 languages, switched live in Preferences.', command: 'settings' },
      { title: 'The Manual', text: 'A searchable manual inside the app. Press F1.', command: 'help' },
    ],
  },
];
