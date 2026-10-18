import { describe, expect, it } from 'vitest';
import { defaultProject } from '../src/model/defaults';
import { validateProject } from '../src/geometry/topology';
import { beta1, calculateSurface, clipCompression, phiReduction, polygonIntegral, solvePoint, steelStress } from '../src/engine/section';

describe('Equilibrio seccional y convención de signos', () => {
  it('acero: compresión negativa, tracción positiva, fluencia simétrica', () => {
    expect(steelStress(-0.003,420,200000)).toBe(-420);
    expect(steelStress(0.003,420,200000)).toBe(420);
  });
  it('β1 y transición de resistencia', () => {
    expect(beta1(28)).toBeCloseTo(0.85);
    expect(beta1(56)).toBeCloseTo(0.65);
    expect(phiReduction(0,420,200000,'tied')).toBe(0.65);
    expect(phiReduction(0.01,420,200000,'tied')).toBe(0.9);
  });
  it('el recorte de un triángulo conserva área geométrica exacta', () => {
    const triangle = { a: { x: 0,y:0 },b:{ x:10,y:0 },c:{ x:0,y:10 } };
    const clip = clipCompression(triangle,1,0,5);
    expect(polygonIntegral(clip).area).toBeCloseTo(37.5,8);
  });
  it('bloque totalmente comprimido aproxima Pn0 con c grande', () => {
    const p = defaultProject(), v = validateProject(p);
    expect(v.valid, v.errors.join(' ')).toBe(true);
    const s = calculateSurface(p,v.mesh!,8,20);
    const extreme = solvePoint(p,v.mesh!,0,1_000_000);
    expect(extreme.nominalN).toBeCloseTo(s.pn0, 0);
    expect(extreme.nominalMx).toBeCloseTo(0, 3);
    expect(extreme.nominalMy).toBeCloseTo(0, 3);
    expect(s.designCompressionLimit).toBeGreaterThan(s.pn0);
    expect(s.points).toHaveLength(160);
  });
});
