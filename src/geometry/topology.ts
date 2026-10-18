import earcut from 'earcut';
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js';
import IsValidOp from 'jsts/org/locationtech/jts/operation/valid/IsValidOp.js';
import OverlayOp from 'jsts/org/locationtech/jts/operation/overlay/OverlayOp.js';
import type { Point, Primitive, Project, SectionMesh, Triangle, Validation } from '../model/types';

const AREA_TOL = 1e-7;
const reader = new GeoJSONReader();
const close = (points: Point[]) => [...points.map(p => [p.x, p.y]), [points[0].x, points[0].y]];
const polygon = (shape: Primitive): any => reader.read({ type: 'Polygon', coordinates: [close(shape.points)] });
const ringPoints = (ring: any): Point[] => {
  const coords: { x: number; y: number }[] = ring.getCoordinates();
  return coords.slice(0, -1).map(p => ({ x: p.x, y: p.y }));
};
const areaTriangle = (a: Point, b: Point, c: Point) => Math.abs(
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x),
) / 2;

/** El área de intersección distingue solape interior de contacto tangencial permitido. */
export function validateTopology(shapes: Primitive[]): Validation {
  const errors: string[] = [];
  const solids: any[] = [], holes: any[] = [];
  if (!shapes.some(p => p.kind === 'solid')) return { valid: false, errors: ['Dibuja al menos una región de concreto.'] };
  if (shapes.length > 200) return { valid: false, errors: ['Máximo 200 primitivas por proyecto.'] };
  if (shapes.reduce((total, shape) => total + shape.points.length, 0) > 10000) {
    return { valid: false, errors: ['Máximo 10 000 vértices de geometría.'] };
  }
  for (let i = 0; i < shapes.length; i++) {
    const shape = shapes[i];
    if (shape.points.length < 3 || shape.points.length > 2000 ||
        shape.points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
      errors.push(`Primitiva ${i + 1}: número de vértices o coordenadas no válido.`);
      continue;
    }
    try {
      const g = polygon(shape);
      const valid = new IsValidOp(g);
      if (!valid.isValid() || g.getArea() < AREA_TOL) {
        errors.push(`Primitiva ${i + 1}: polígono degenerado o autointersecado (${valid.getValidationError()?.toString() ?? 'área nula'}).`);
      } else (shape.kind === 'solid' ? solids : holes).push(g);
    } catch (error) { errors.push(`Primitiva ${i + 1}: ${String(error)}`); }
  }
  if (errors.length) return { valid: false, errors };
  try {
    // Los sólidos pueden tocarse por vértices o aristas; sus interiores no pueden solaparse.
    for (let i = 0; i < solids.length; i++) for (let j = i + 1; j < solids.length; j++) {
      if (OverlayOp.intersection(solids[i], solids[j]).getArea() > AREA_TOL) {
        errors.push(`Las regiones de concreto ${i + 1} y ${j + 1} se superponen.`);
      }
    }
    for (let i = 0; i < holes.length; i++) for (let j = i + 1; j < holes.length; j++) {
      if (OverlayOp.intersection(holes[i], holes[j]).getArea() > AREA_TOL) errors.push(`Los huecos ${i + 1} y ${j + 1} se superponen.`);
    }
    if (errors.length) return { valid: false, errors };
    const concreteUnion = solids.slice(1).reduce((acc, g) => OverlayOp.union(acc, g), solids[0]);
    for (let i = 0; i < holes.length; i++) {
      if (Math.abs(OverlayOp.intersection(concreteUnion, holes[i]).getArea() - holes[i].getArea()) > AREA_TOL) {
        errors.push(`Hueco ${i + 1}: debe estar dentro de las regiones de concreto.`);
      }
    }
    if (errors.length) return { valid: false, errors };
    const holeUnion = holes.length ? holes.slice(1).reduce((acc, g) => OverlayOp.union(acc, g), holes[0]) : null;
    const concrete = holeUnion ? OverlayOp.difference(concreteUnion, holeUnion) : concreteUnion;
    const valid = new IsValidOp(concrete);
    if (!valid.isValid()) return { valid: false, errors: [`La unión/diferencia geométrica no es válida: ${valid.getValidationError()}`] };
    if (concrete.getArea() < AREA_TOL) return { valid: false, errors: ['La sección tiene área nula.'] };
    const polys: any[] = concrete.getGeometryType() === 'Polygon'
      ? [concrete] : Array.from({ length: concrete.getNumGeometries() }, (_, i) => concrete.getGeometryN(i));
    const polygons: SectionMesh['polygons'] = [];
    const triangles: Triangle[] = [];
    for (const poly of polys) {
      if (poly.getGeometryType() !== 'Polygon') return { valid: false, errors: ['La topología generó geometrías no poligonales.'] };
      const exterior = ringPoints(poly.getExteriorRing());
      const interiors: Point[][] = [];
      for (let i = 0; i < poly.getNumInteriorRing(); i++) interiors.push(ringPoints(poly.getInteriorRingN(i)));
      polygons.push({ exterior, holes: interiors });
      const flat: number[] = []; const indices: number[] = [];
      for (const [ringIndex, ring] of [exterior, ...interiors].entries()) {
        if (ringIndex > 0) indices.push(flat.length / 2);
        for (const point of ring) flat.push(point.x, point.y);
      }
      const trianglesIds = earcut(flat, indices, 2);
      for (let i = 0; i < trianglesIds.length; i += 3) {
        const get = (index: number): Point => ({ x: flat[2 * index], y: flat[2 * index + 1] });
        const tri = { a: get(trianglesIds[i]), b: get(trianglesIds[i + 1]), c: get(trianglesIds[i + 2]) };
        if (areaTriangle(tri.a, tri.b, tri.c) > AREA_TOL) triangles.push(tri);
      }
    }
    const triArea = triangles.reduce((a, t) => a + areaTriangle(t.a, t.b, t.c), 0);
    if (Math.abs(triArea - concrete.getArea()) > Math.max(1e-5, concrete.getArea() * 1e-6)) {
      return { valid: false, errors: ['La triangulación no conserva el área de la sección. Revise las tangencias o huecos.'] };
    }
    const envelope = concrete.getEnvelopeInternal();
    const centroidArea = triangles.reduce((total, triangle) => total + areaTriangle(triangle.a, triangle.b, triangle.c), 0);
    const centroid = triangles.reduce((sum, triangle) => {
      const area = areaTriangle(triangle.a, triangle.b, triangle.c);
      return {
        x: sum.x + area * (triangle.a.x + triangle.b.x + triangle.c.x) / 3,
        y: sum.y + area * (triangle.a.y + triangle.b.y + triangle.c.y) / 3,
      };
    }, { x: 0, y: 0 });
    return {
      valid: true, errors: [], mesh: {
        polygons, triangles, area: concrete.getArea(),
        centroid: { x: centroid.x / centroidArea, y: centroid.y / centroidArea },
        min: { x: envelope.getMinX(), y: envelope.getMinY() },
        max: { x: envelope.getMaxX(), y: envelope.getMaxY() },
      },
    };
  } catch (error) { return { valid: false, errors: [`Error topológico: ${String(error)}`] }; }
}

function onSegment(p: Point, a: Point, b: Point): boolean {
  const cross = (p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x);
  return Math.abs(cross) < 1e-8 &&
    p.x >= Math.min(a.x, b.x) - 1e-8 && p.x <= Math.max(a.x, b.x) + 1e-8 &&
    p.y >= Math.min(a.y, b.y) - 1e-8 && p.y <= Math.max(a.y, b.y) + 1e-8;
}
function inRing(point: Point, ring: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (onSegment(point, a, b)) return false;
    if ((a.y > point.y) !== (b.y > point.y) &&
       point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function distanceSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
export function insideConcrete(p: Point, mesh: SectionMesh): boolean {
  return mesh.polygons.some(poly => inRing(p, poly.exterior) && !poly.holes.some(h => inRing(p, h)));
}
export function boundaryDistance(p: Point, mesh: SectionMesh): number {
  let distance = Infinity;
  for (const poly of mesh.polygons) for (const ring of [poly.exterior, ...poly.holes]) for (let i = 0; i < ring.length; i++) {
    distance = Math.min(distance, distanceSegment(p, ring[i], ring[(i + 1) % ring.length]));
  }
  return distance;
}
export function validateProject(project: Project): Validation {
  const errors: string[] = [];
  const v = validateTopology(project.shapes);
  if (!v.valid || !v.mesh) return v;
  const { fc, fy, Es, epsCu } = project.materials;
  if (![fc, fy, Es, epsCu].every(Number.isFinite) || fc <= 0 || fy <= 0 || Es <= fy || epsCu <= 0 || epsCu > 0.01) {
    errors.push('Propiedades mecánicas inválidas: f’c, fy, Es o εcu.');
  }
  if (project.bars.length > 5000) errors.push('Máximo 5000 barras discretas.');
  for (let i = 0; i < project.bars.length; i++) {
    const a = project.bars[i];
    if (![a.x, a.y, a.diameter].every(Number.isFinite) || a.diameter <= 0) { errors.push(`Barra ${i + 1}: coordenadas o diámetro inválidos.`); continue; }
    if (!insideConcrete(a, v.mesh) || boundaryDistance(a, v.mesh) < a.diameter / 2 - 1e-7) {
      errors.push(`Barra ${i + 1}: está fuera del concreto o intersecta su borde/hueco.`);
    }
    for (let j = 0; j < i; j++) {
      const b = project.bars[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) < (a.diameter + b.diameter) / 2 - 1e-7) {
        errors.push(`Las barras ${j + 1} y ${i + 1} se superponen.`);
        break;
      }
    }
    if (errors.length >= 15) break;
  }
  if (project.bars.length === 0) errors.push('Agrega al menos una barra para calcular interacción de concreto armado.');
  return { ...v, valid: errors.length === 0, errors };
}
