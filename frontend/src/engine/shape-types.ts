// Model of Shape, Solid and Adjustment content (all optional: movies without them are unchanged). Pure types.

export type ShapeType = 'rect' | 'ellipse' | 'polygon' | 'star' | 'line' | 'arrow' | 'path';

export interface GradStop {
  /** Position along the gradient, 0 to 1 (keyable as channel `o<index>`). */
  o: number;
  color: string;
  alpha?: number;
}

export interface ShapePaint {
  kind: 'solid' | 'linear' | 'radial';
  /** Solid colour as #rrggbb (keyable as fillR / fillG / fillB). */
  color: string;
  alpha?: number;
  stops?: GradStop[];
  /** Linear gradient direction in degrees (0: left to right). */
  angle?: number;
  /** Radial gradient centre as a share of half the width / height, -1 to 1. */
  cx?: number;
  cy?: number;
}

export interface ShapeStroke {
  color: string;
  alpha?: number;
  /** Width in movie pixels. */
  width: number;
  /** Dash and gap lengths in movie pixels; no dash when `dash` is 0 or absent. */
  dash?: number;
  gap?: number;
  dashOffset?: number;
  cap?: 'butt' | 'round' | 'square';
  join?: 'miter' | 'round' | 'bevel';
  /** Where the stroke sits on a closed outline (default centre). */
  align?: 'center' | 'inside' | 'outside';
  miter?: number;
}

/** A pen node: `x`, `y` from the content centre; `ix`, `iy` and `ox`, `oy` the in and out handles as offsets from the node. */
export interface BezNode {
  x: number;
  y: number;
  ix: number;
  iy: number;
  ox: number;
  oy: number;
}

export interface ShapeDef {
  type: ShapeType;
  /** Size in movie pixels; a Solid's 0 means the whole movie. A path keeps its bounding box here. */
  w: number;
  h: number;
  /** Rectangle corner radius. */
  radius?: number;
  sides?: number;
  points?: number;
  /** Star inner radius as a share of the outer one. */
  inner?: number;
  fill: ShapePaint | null;
  stroke: ShapeStroke | null;
  nodes?: BezNode[];
  closed?: boolean;
  /** Trim path, 0 to 1 along the outline, and the offset in degrees (360 turns the range once round). */
  trimStart?: number;
  trimEnd?: number;
  trimOffset?: number;
  /** Adjustment mask edge softness in movie pixels. */
  feather?: number;
}
