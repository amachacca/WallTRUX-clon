import type { Point, Primitive, Project, Rebar } from './types';

export const diameters: Record<string, number> = {
  '#3 · Ø9.5': 0.9525, '#4 · Ø12.7': 1.27, '#5 · Ø15.9': 1.5875,
  '#6 · Ø19.1': 1.905, '#7 · Ø22.2': 2.2225, '#8 · Ø25.4': 2.54,
  'Ø12 mm': 1.2, 'Ø16 mm': 1.6, 'Ø20 mm': 2.0, 'Ø25 mm': 2.5,
};
export const uid = () => Math.random().toString(36).slice(2, 10);
export const rectangle = (x: number, y: number, w: number, h: number): Point[] => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];
export function perimeterBars(x: number, y: number, w: number, h: number, cover: number, diameter: number, spacing = 35): Rebar[] {
  const offset = cover + diameter / 2;
  const a = { x: x + offset, y: y + offset };
  const b = { x: x + w - offset, y: y + h - offset };
  if (a.x >= b.x || a.y >= b.y) return [];
  const nx = Math.max(2, Math.ceil((b.x - a.x) / spacing) + 1);
  const ny = Math.max(2, Math.ceil((b.y - a.y) / spacing) + 1);
  const bars: Rebar[] = [];
  for (let i = 0; i < nx; i++) {
    const bx = a.x + (b.x - a.x) * i / (nx - 1);
    bars.push({ id: uid(), x: bx, y: a.y, diameter });
    bars.push({ id: uid(), x: bx, y: b.y, diameter });
  }
  for (let i = 1; i < ny - 1; i++) {
    const by = a.y + (b.y - a.y) * i / (ny - 1);
    bars.push({ id: uid(), x: a.x, y: by, diameter });
    bars.push({ id: uid(), x: b.x, y: by, diameter });
  }
  return bars;
}
export function defaultProject(): Project {
  const solid: Primitive = { id: uid(), kind: 'solid', points: rectangle(0, 0, 250, 200) };
  const diameter = diameters['#5 · Ø15.9'];
  return {
    format: 'walltrux-studio', version: 1, name: 'Proyecto sin título',
    shapes: [solid], bars: perimeterBars(0, 0, 250, 200, 4, diameter, 45),
    cover: 4,
    materials: { fc: 28, fy: 420, Es: 200000, epsCu: 0.003, confinement: 'tied', code: 'ACI318' },
    loads: [{ name: 'LC1', n: -6000, mx: 550, my: 450 }],
  };
}
