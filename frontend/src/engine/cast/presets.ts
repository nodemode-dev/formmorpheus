import type { CastInput } from './build';

export const STUDIO_PRESETS: readonly CastInput[] = [
  { id: 'maya', name: 'Maya', group: 'F', tag: 'The optimist', skin: '#c98a5e', hair: [6, '#3a2318'], outfit: 3 },
  { id: 'ingrid', name: 'Ingrid', group: 'F', tag: 'The athlete', skin: '#f6d2b8', hair: [7, '#e8c05a'], outfit: 4, body: { h: 1.08, build: .96 }, face: { eyeColor: '#2f5d8a' } },
  { id: 'zuri', name: 'Zuri', group: 'F', tag: 'The hero', skin: '#7a4a2e', hair: [3, '#1f1612'], outfit: 10, face: { earrings: true, lip: '#8a2f45' } },
  { id: 'mei', name: 'Mei', group: 'F', tag: 'The scientist', skin: '#f1c9a0', hair: [4, '#1c1a22'], outfit: 5, body: { h: .94 }, face: { glasses: true, blush: false } },
  { id: 'rosa', name: 'Rosa', group: 'F', tag: 'The chef', skin: '#dba078', hair: [8, '#b9b4b0'], outfit: 6, body: { h: .95, build: 1.24 }, face: { jaw: .86 } },
  { id: 'leo', name: 'Leo', group: 'M', tag: 'The student', skin: '#f0c6a4', hair: [11, '#6b4226'], outfit: 1 },
  { id: 'karl', name: 'Karl', group: 'M', tag: 'The executive', skin: '#5c3a24', hair: [2, '#17120f'], outfit: 2, body: { h: 1.06 }, face: { beard: 'full', blush: false } },
  { id: 'arjun', name: 'Arjun', group: 'M', tag: 'The host', skin: '#b97a4e', hair: [1, '#17141a'], outfit: 8, face: { beard: 'mustache', blush: false } },
  { id: 'finn', name: 'Finn', group: 'M', tag: 'The tinkerer', skin: '#fbd9c4', hair: [10, '#c8502a'], outfit: 12, body: { build: .88 }, face: { freckles: true, eyeColor: '#3f7a4f', jaw: .78 } },
  { id: 'otto', name: 'Otto', group: 'M', tag: 'The foreman', skin: '#e9b792', hair: [0, '#a3a3a3'], outfit: 7, body: { h: .97, build: 1.32 }, face: { glasses: true, beard: 'stubble', jaw: .98 } },
  { id: 'bolt', name: 'Bolt', group: 'S', tag: 'Robot', species: 'robot', skin: '#9fb3c8', hair: [-1, '#3a2318'], outfit: 9, body: { build: 1.06, head: 1.05 }, headWide: 1.08, face: { eyeColor: '#5ef2e0', blush: false } },
  { id: 'zib', name: 'Zib', group: 'S', tag: 'Visitor', species: 'alien', frame: 'f', skin: '#8fd694', hair: [-1, '#4a7bd6'], outfit: 11, body: { h: .9, build: .82, head: 1.16 }, headWide: 1.14, face: { eyeColor: '#b9f5c0', blush: false, lashes: false } },
  { id: 'moss', name: 'Moss', group: 'S', tag: 'Friendly monster', species: 'monster', skin: '#7c6bd6', hair: [9, '#e85d9c'], outfit: 0, colors: { 0: ['#ffd23f', '#3d5a8c', '#f4f1ea'] }, body: { h: .92, build: 1.36, head: 1.14 }, headWide: 1.06, face: { eyeColor: '#27b3a7', blush: false } },
];

export const NEW_PRESETS: readonly CastInput[] = [
  { id: 'dev', name: 'Dev', group: 'M', tag: 'The gamer', skin: '#b97a4e', hair: [13, '#17120f'], outfit: 13, body: { build: .94 }, face: { beard: 'goatee' } },
  { id: 'walt', name: 'Walt', group: 'M', tag: 'The grandpa', skin: '#f1c9a0', hair: [1, '#f5f5f5'], outfit: 14, body: { h: .95, build: 1.12 }, face: { glasses: true, beard: 'mustache', jaw: .9 } },
  { id: 'sami', name: 'Sami', group: 'M', tag: 'The medic', skin: '#8d5a3b', hair: [2, '#17120f'], outfit: 15, body: { h: 1.04 }, face: { beard: 'stubble' } },
  { id: 'amara', name: 'Amara', group: 'F', tag: 'The librarian', skin: '#5c3a24', hair: [14, '#17120f'], outfit: 14, colors: { 14: ['#7a3f6b', '#f3e3b0', '#2d2a3a'] }, face: { glasses: true, earrings: true, lip: '#7a2f40' } },
  { id: 'jade', name: 'Jade', group: 'F', tag: 'The drummer', skin: '#fbd9c4', hair: [15, '#e85d9c'], outfit: 0, colors: { 0: ['#1c1a22', '#3a3f52', '#e85d9c'] }, body: { h: 1.02 }, face: { freckles: true } },
  { id: 'pip', name: 'Pip', group: 'S', tag: 'Woodland fox', species: 'fox', skin: '#e07a3a', hair: [-1, '#e07a3a'], outfit: 0, colors: { 0: ['#3f7a4f', '#6b4226', '#f4f1ea'] }, body: { h: .9, head: 1.1 }, face: { eyeColor: '#2b2320' } },
  { id: 'rex', name: 'Rex', group: 'S', tag: 'Little dino', species: 'dino', skin: '#6fbf5a', hair: [-1, '#2f8a4a'], outfit: 4, colors: { 4: ['#d94a3a', '#f4f1ea', '#1c1a22'] }, body: { h: .88, build: 1.18, head: 1.12 } },
  { id: 'sprig', name: 'Sprig', group: 'S', tag: 'Garden sprite', species: 'sprout', frame: 'f', skin: '#a6d98a', hair: [-1, '#3fae8c'], outfit: 3, colors: { 3: ['#f3d24a', '#f4f1ea', '#e85d9c'] }, body: { h: .86, head: 1.14 } },
];

/** Every built starter in the order the Characters panel lists them and the Character Builder groups them. */
export const CAST_PRESETS: readonly CastInput[] = [...STUDIO_PRESETS, ...NEW_PRESETS];
