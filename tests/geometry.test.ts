import { describe, expect, it } from 'vitest';
import { rectangle } from '../src/model/defaults';
import { validateTopology } from '../src/geometry/topology';
import type { Primitive } from '../src/model/types';
const make = (id: string, kind: Primitive['kind'], x: number, y: number, w: number, h: number): Primitive => ({
  id, kind, points: rectangle(x, y, w, h),
});
describe('Topología JSTS y triangulación', () => {
  it('fusiona sólidos que comparten lado sin rechazarlos por tangencia', () => {
    const v = validateTopology([make('a','solid',0,0,100,50), make('b','solid',100,0,100,50)]);
    expect(v.valid, v.errors.join(', ')).toBe(true);
    expect(v.mesh!.area).toBeCloseTo(10000, 5);
  });
  it('mantiene polígonos disjuntos como una sola sección multipoligonal', () => {
    const v = validateTopology([make('a','solid',0,0,100,50), make('b','solid',200,0,100,50)]);
    expect(v.valid).toBe(true);
    expect(v.mesh!.polygons.length).toBe(2);
  });
  it('rechaza superposición de áreas', () => {
    const v = validateTopology([make('a','solid',0,0,100,100), make('b','solid',50,0,100,100)]);
    expect(v.valid).toBe(false);
    expect(v.errors.join(' ')).toContain('superponen');
  });
  it('resta huecos del área total', () => {
    const v = validateTopology([make('a','solid',0,0,100,100), make('h','hole',20,20,30,40)]);
    expect(v.valid, v.errors.join(' ')).toBe(true);
    expect(v.mesh!.area).toBeCloseTo(8800, 5);
    expect(v.mesh!.triangles.length).toBeGreaterThan(1);
  });
  it('rechaza huecos externos', () => {
    const v = validateTopology([make('a','solid',0,0,100,100), make('h','hole',80,80,40,40)]);
    expect(v.valid).toBe(false);
  });
  it('rechaza polígonos autointersecados', () => {
    const v = validateTopology([{ id: 'a', kind: 'solid', points: [
      { x: 0,y:0 },{ x: 100,y:100 },{ x: 100,y:0 },{ x: 0,y:100 },
    ] }]);
    expect(v.valid).toBe(false);
  });
});
