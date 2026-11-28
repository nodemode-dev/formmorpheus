/** A built character's recipe: body, face, hair and outfit. Building it again gives the same art. */
export interface CastSpec {
  id: string;
  name: string;
  /** F, M or S (special); decides defaults only. */
  group: 'F' | 'M' | 'S';
  tag: string;
  species: string;
  /** Body frame A ('f') or B ('m'). */
  frame: 'f' | 'm';
  headWide: number;
  skin: string;
  /** Hair style index into HAIRS, -1 for none. */
  hair: { style: number; color: string };
  /** Outfit index into OUTFITS. */
  outfit: number;
  /** Per-outfit colour overrides, outfit index to its channel colours. */
  colors: Record<number, string[]>;
  body: { h: number; build: number; head: number; shoulders: number };
  face: {
    eyeColor: string;
    lashes: boolean;
    blush: boolean;
    freckles: boolean;
    glasses: boolean;
    beard: 'none' | 'stubble' | 'mustache' | 'goatee' | 'full';
    earrings: boolean;
    lip: string;
    jaw: number;
  };
  /** Which way the character faces: front, three-quarter, side or back. Absent: front. */
  view?: CastView;
  /** Drawn mirrored, so a three-quarter or side view looks the other way. Absent: not flipped. */
  flip?: boolean;
}

export type CastView = 'front' | 'three' | 'side' | 'back';

/** One drawn primitive in bone-local space. Paths use absolute M L C Q Z only. */
export type CastPrim =
  | { t: 'p'; d: string; fill: string | null; stroke?: string; sw?: number; cap?: string; op?: number; z?: CastRole }
  | { t: 'e'; cx: number; cy: number; rx: number; ry: number; fill: string | null; rot?: number; stroke?: string; sw?: number; op?: number; z?: CastRole }
  | { t: 'r'; x: number; y: number; w: number; h: number; r: number; fill: string | null; stroke?: string; sw?: number; op?: number; z?: CastRole };

/** How a head prim turns with the view: s the outline (kept as drawn, seen from behind too), e an edge piece such as an
 *  ear (moves round the head, seen from behind). Absent: a face feature, moved round the head and not seen from behind. */
export type CastRole = 's' | 'e';

export interface CastBone {
  name: string;
  parent: string | null;
  x: number;
  y: number;
  rot: number;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
}

/** Prims hung on a bone, in draw order. oy offsets the slot along the bone. */
export interface CastSlot {
  name: string;
  bone: string;
  prims: CastPrim[];
  ox: number;
  oy: number;
  /** The view does not show this part (the face from behind): it is kept, hidden, so every view has the same parts. */
  hide?: boolean;
}

export interface CastRig {
  bones: CastBone[];
  slots: CastSlot[];
  /** Full height in rig units, feet to the top of the head. */
  height: number;
  /** The body metrics the rig was built from (engine/cast/metrics.ts). */
  M: Record<string, number>;
}
