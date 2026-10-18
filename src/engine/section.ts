import type { Point, Project, SectionMesh, InteractionPoint, Surface, Triangle } from '../model/types';

/** La compresión es NEGATIVA, la tracción POSITIVA: ε, σ y N comparten signo. */
export const steelStress = (eps: number, fy: number, Es: number) => Math.max(-fy, Math.min(fy, Es * eps));
export const steelArea = (diameterCm: number) => Math.PI * diameterCm ** 2 / 4;

/** ACI 318: β1 según f'c, valores MPa; modelo de Whitney simplificado. */
export function beta1(fc: number): number {
  return Math.max(0.65, Math.min(0.85, 0.85 - (0.05 / 7) * Math.max(0, fc - 28)));
}
export function phiReduction(epsT: number, fy: number, Es: number, confinement: 'tied' | 'spiral'): number {
  const min = confinement === 'spiral' ? 0.75 : 0.65;
  const ey = fy / Es;
  if (epsT <= ey) return min;
  if (epsT >= ey + 0.003) return 0.9;
  return min + (0.9 - min) * (epsT - ey) / 0.003;
}
const projection = (p: Point, dx: number, dy: number) => p.x * dx + p.y * dy;

/** Recorte de un triángulo por el semiplano de compresión, sin integración por malla de píxeles. */
export function clipCompression(t: Triangle, dx: number, dy: number, limit: number): Point[] {
  let vertices = [t.a, t.b, t.c];
  const result: Point[] = [];
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    const fa = projection(a, dx, dy) - limit;
    const fb = projection(b, dx, dy) - limit;
    const inA = fa <= 0, inB = fb <= 0;
    if (inA) result.push(a);
    if (inA !== inB) {
      const alpha = fa / (fa - fb);
      result.push({ x: a.x + alpha * (b.x - a.x), y: a.y + alpha * (b.y - a.y) });
    }
  }
  vertices = result;
  return vertices;
}
/** Área y primer momento de un polígono simple (orientation-agnostic). */
export function polygonIntegral(vertices: Point[]): { area: number; x: number; y: number } {
  if (vertices.length < 3) return { area: 0, x: 0, y: 0 };
  let signedArea2 = 0, cx = 0, cy = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    const cross = a.x * b.y - b.x * a.y;
    signedArea2 += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  if (Math.abs(signedArea2) < 1e-12) return { area: 0, x: 0, y: 0 };
  return { area: Math.abs(signedArea2) / 2, x: cx / (3 * signedArea2), y: cy / (3 * signedArea2) };
}

/** Fuerzas de Whitney y acero desplazando el hormigón, respecto al centroide bruto. */
export function solvePoint(project: Project, mesh: SectionMesh, theta: number, c: number): Omit<InteractionPoint, 'designN' | 'designMx' | 'designMy'> {
  const { fc, fy, Es, epsCu, confinement } = project.materials;
  const dx = Math.cos(theta), dy = Math.sin(theta);
  // Los extremos se calculan en TODOS los vértices, no solo en la bounding box.
  let minimum = Infinity;
  for (const region of mesh.polygons) for (const ring of [region.exterior, ...region.holes]) {
    for (const vertex of ring) minimum = Math.min(minimum, projection(vertex, dx, dy));
  }
  const a = beta1(fc) * c;
  const stressC = -0.85 * fc;
  let n = 0, mx = 0, my = 0;
  const accumulate = (forceKn: number, x: number, y: number) => {
    n += forceKn;
    mx += forceKn * (y - mesh.centroid.y) * 0.01;
    my -= forceKn * (x - mesh.centroid.x) * 0.01;
  };
  const threshold = minimum + a;
  for (const triangle of mesh.triangles) {
    const { area, x, y } = polygonIntegral(clipCompression(triangle, dx, dy, threshold));
    if (area > 0) accumulate(stressC * area * 0.1, x, y);
  }
  let epsT = 0;
  for (const bar of project.bars) {
    const s = projection(bar, dx, dy);
    const eps = -epsCu * (1 - (s - minimum) / c);
    epsT = Math.max(epsT, eps);
    const steel = steelStress(eps, fy, Es);
    // σs - σc del concreto desplazado: solo si está en el bloque de Whitney.
    const concrete = s <= threshold + 1e-9 ? stressC : 0;
    accumulate((steel - concrete) * steelArea(bar.diameter) * 0.1, bar.x, bar.y);
  }
  return {
    theta, c, nominalN: n, nominalMx: mx, nominalMy: my,
    epsT, phi: phiReduction(epsT, fy, Es, confinement),
  };
}
export function calculateSurface(project: Project, mesh: SectionMesh, angles = 32, depths = 40): Surface {
  const { fc, fy, confinement } = project.materials;
  const b = beta1(fc);
  const ast = project.bars.reduce((a, bar) => a + steelArea(bar.diameter), 0);
  // Pn0 uniformemente comprimida. Restar concreto ocupado por acero.
  const pn0 = (-0.85 * fc * (mesh.area - ast) - fy * ast) * 0.1;
  const phi0 = confinement === 'spiral' ? 0.75 : 0.65;
  const limit = pn0 * phi0 * (confinement === 'spiral' ? 0.85 : 0.8);
  const tensileN = fy * ast * 0.1;
  const dimension = Math.hypot(mesh.max.x - mesh.min.x, mesh.max.y - mesh.min.y);
  const points: InteractionPoint[] = [];
  // Espaciamiento logarítmico para resolver la zona de tracción y la compresión elevada.
  for (let i = 0; i < angles; i++) {
    const theta = 2 * Math.PI * i / angles;
    for (let j = 0; j < depths; j++) {
      const t = j / (depths - 1);
      const c = dimension * 0.004 * (25 / 0.004) ** t;
      const p = solvePoint(project, mesh, theta, c);
      points.push({ ...p,
        // La cota axial se aplica a la representación de diseño de este prototipo.
        designN: Math.max(p.phi * p.nominalN, limit),
        designMx: p.phi * p.nominalMx,
        designMy: p.phi * p.nominalMy,
      });
    }
  }
  return { points, angles, depths, pn0, designCompressionLimit: limit, tensileN, beta1: b };
}
