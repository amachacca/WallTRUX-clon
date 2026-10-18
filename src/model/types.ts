/** Convención: geometría en cm, esfuerzos en MPa, fuerzas en kN y momentos en kN·m. */
export interface Point { x: number; y: number }
export interface Primitive { id: string; kind: 'solid' | 'hole'; points: Point[] }
export interface Rebar { id: string; x: number; y: number; diameter: number }
export interface Material {
  fc: number; fy: number; Es: number; epsCu: number;
  confinement: 'tied' | 'spiral'; code: 'ACI318';
}
export interface LoadCase { name: string; n: number; mx: number; my: number }
export interface Project {
  format: 'walltrux-studio'; version: 1; name: string;
  shapes: Primitive[]; bars: Rebar[]; materials: Material;
  cover: number; loads: LoadCase[];
}
export type Tool = 'select' | 'solid' | 'hole' | 'bar' | 'pan';
export type ViewName = 'section' | 'materials' | 'loads' | 'uniaxial' | 'biaxial' | 'contours';
export interface Triangle { a: Point; b: Point; c: Point }
export interface SectionMesh {
  polygons: { exterior: Point[]; holes: Point[][] }[];
  triangles: Triangle[];
  area: number; centroid: Point; min: Point; max: Point;
}
export interface Validation { valid: boolean; errors: string[]; mesh?: SectionMesh }
export interface InteractionPoint {
  theta: number; c: number; nominalN: number; nominalMx: number; nominalMy: number;
  designN: number; designMx: number; designMy: number;
  phi: number; epsT: number;
}
export interface Surface {
  points: InteractionPoint[];
  angles: number; depths: number;
  pn0: number; designCompressionLimit: number;
  tensileN: number; beta1: number;
}
export interface Result { validation: Validation; surface?: Surface }
