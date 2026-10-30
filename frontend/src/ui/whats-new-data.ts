/** What's New: the additions of the recent releases in plain words, newest first. Each row's `command` is a command id
 *  that Show Me runs; add a release at the top when one ships. */
export interface Addition { title: string; text: string; command: string }
export interface Release { version: string; name: string; additions: Addition[] }

export const RELEASES: readonly Release[] = [
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
