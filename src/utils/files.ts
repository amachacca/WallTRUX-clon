import { isTauri } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import type { Project, SectionMesh, Surface } from '../model/types';

function download(content: string, filename: string, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}
const dxfNumber = (n: number) => Number(n.toFixed(6)).toString();
const paired = (code: number, value: string | number) => `${code}\n${value}\n`;

/** Exporta las polilíneas y círculos en cm, sin escalado ni conversión implícita. */
export function toDXF(project: Project): string {
  let output = '0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1015\n9\n$INSUNITS\n70\n5\n0\nENDSEC\n';
  output += '0\nSECTION\n2\nENTITIES\n';
  for (const shape of project.shapes) {
    output += '0\nLWPOLYLINE\n' + paired(8, shape.kind === 'hole' ? 'HUECOS' : 'CONCRETO')
      + paired(90, shape.points.length) + paired(70, 1);
    for (const p of shape.points) output += paired(10, dxfNumber(p.x)) + paired(20, dxfNumber(p.y));
  }
  for (const bar of project.bars) {
    output += '0\nCIRCLE\n' + paired(8, 'ACERO') + paired(10, dxfNumber(bar.x)) + paired(20, dxfNumber(bar.y))
      + paired(30, 0) + paired(40, dxfNumber(bar.diameter / 2));
  }
  return output + '0\nENDSEC\n0\nEOF\n';
}
export function toSVG(project: Project, mesh: SectionMesh | undefined): string {
  const bound = mesh ? { x: mesh.min.x - 20, y: mesh.min.y - 20, width: mesh.max.x - mesh.min.x + 40, height: mesh.max.y - mesh.min.y + 40 } : { x: -20, y: -20, width: 400, height: 300 };
  const escape = (v: string) => v.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]!);
  const shape = (points: { x: number; y: number }[]) => points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${-p.y}`).join(' ') + ' Z';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bound.x} ${-(bound.y + bound.height)} ${bound.width} ${bound.height}">\n<title>${escape(project.name)}</title>\n` +
    project.shapes.map(s => `<path d="${shape(s.points)}" fill="${s.kind === 'hole' ? 'white' : '#d4dce6'}" stroke="${s.kind === 'hole' ? '#d57b49' : '#53657a'}" stroke-width="1"/>`).join('\n') + '\n' +
    project.bars.map(b => `<circle cx="${b.x}" cy="${-b.y}" r="${b.diameter / 2}" fill="#7cd18c" stroke="#276a45" stroke-width="0.4"/>`).join('\n') + '\n</svg>';
}
export function toCSV(surface: Surface): string {
  const lines = ['angulo_deg,c_cm,Pn_kN,Mxn_kNm,Myn_kNm,phi,eps_t,phiPn_kN,phiMxn_kNm,phiMyn_kNm'];
  for (const p of surface.points) lines.push([
    p.theta * 180 / Math.PI, p.c, p.nominalN, p.nominalMx, p.nominalMy,
    p.phi, p.epsT, p.designN, p.designMx, p.designMy,
  ].map(n => n.toPrecision(12)).join(','));
  return lines.join('\r\n');
}
export function validateImportedProject(raw: unknown): Project {
  if (!raw || typeof raw !== 'object') throw new Error('El archivo no contiene un objeto JSON.');
  const data = raw as Project;
  if (data.format !== 'walltrux-studio' || data.version !== 1) throw new Error('Formato o versión de proyecto no admitido.');
  if (!Array.isArray(data.shapes) || !Array.isArray(data.bars) || !Array.isArray(data.loads) || !data.materials) throw new Error('Faltan datos esenciales del proyecto.');
  if (data.shapes.length > 200 || data.bars.length > 5000 || data.loads.length > 500) throw new Error('El proyecto excede los límites de tamaño.');
  if (data.shapes.some(s => !['solid', 'hole'].includes(s.kind) || !Array.isArray(s.points) || s.points.length > 2000 || s.points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)))) throw new Error('Se encontraron primitivas inválidas.');
  if (data.bars.some(b => ![b.x, b.y, b.diameter].every(Number.isFinite))) throw new Error('Se encontraron barras inválidas.');
  return data;
}
export async function saveText(content: string, filename: string, mime = 'application/json') {
  if (isTauri()) {
    const extension = filename.split('.').pop() ?? 'txt';
    const filePath = await save({ defaultPath: filename, filters: [{ name: extension.toUpperCase(), extensions: [extension] }] });
    if (filePath) await writeTextFile(filePath, content);
  } else download(content, filename, mime);
}
export async function openProjectWeb(file: File): Promise<Project> {
  if (file.size > 5_000_000) throw new Error('El archivo excede los 5 MB permitidos.');
  return validateImportedProject(JSON.parse(await file.text()));
}
export async function openProjectNative(): Promise<Project | null> {
  const filePath = await open({ multiple: false, directory: false, filters: [{ name: 'WallTRUX JSON', extensions: ['json'] }] });
  if (typeof filePath !== 'string') return null;
  return validateImportedProject(JSON.parse(await readTextFile(filePath)));
}
export { isTauri };
