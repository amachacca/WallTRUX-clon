import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent, WheelEvent } from 'react';
import { Check, MousePointer2, X } from 'lucide-react';
import type { Point, Primitive, Project, SectionMesh, Tool } from '../model/types';
import { uid } from '../model/defaults';

type Props = {
  project: Project; mesh?: SectionMesh; tool: Tool;
  selected: string | null; setSelected: (id: string | null) => void;
  onAddShape: (shape: Primitive) => void;
  onAddBar: (p: Point) => void;
  onMoveVertex: (id: string, index: number, p: Point, start: boolean) => void;
  onMoveBar: (id: string, p: Point, start: boolean) => void;
  snap: boolean; showBars: boolean;
  setTool: (tool: Tool) => void;
};
const fmt = (n: number) => n.toFixed(1);
const path = (points: Point[]) => points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${-p.y}`).join(' ') + ' Z';

export default function SectionCanvas(props: Props) {
  const { project, mesh, tool, selected, setSelected, onAddShape, onAddBar, onMoveVertex, onMoveBar, snap, showBars, setTool } = props;
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [center, setCenter] = useState<Point>({ x: 125, y: 100 });
  const [scale, setScale] = useState(0.61);
  const [draft, setDraft] = useState<Point[]>([]);
  const [mouse, setMouse] = useState<Point | null>(null);
  const drag = useRef<null | { kind: 'pan' | 'vertex' | 'bar'; id?: string; index?: number; last: Point; initialized: boolean }>(null);
  useEffect(() => {
    if (!svg.current) return;
    const observer = new ResizeObserver(entries => {
      const rect = entries[0].contentRect;
      setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(svg.current);
    return () => observer.disconnect();
  }, []);
  const world = useCallback((e: { clientX: number; clientY: number }): Point => {
    const svgElement = svg.current;
    if (!svgElement) return { x: 0, y: 0 };
    const pt = svgElement.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const matrix = svgElement.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const result = pt.matrixTransform(matrix.inverse());
    return { x: result.x, y: -result.y };
  }, []);
  const quantize = (p: Point) => snap ? { x: Math.round(p.x / 5) * 5, y: Math.round(p.y / 5) * 5 } : p;
  const visibleWidth = size.width * scale, visibleHeight = size.height * scale;
  const viewBox = `${center.x - visibleWidth / 2} ${-center.y - visibleHeight / 2} ${visibleWidth} ${visibleHeight}`;
  const bounds = {
    left: center.x - visibleWidth / 2, right: center.x + visibleWidth / 2,
    bottom: center.y - visibleHeight / 2, top: center.y + visibleHeight / 2,
  };
  const gridX: number[] = [], gridY: number[] = [];
  for (let x = Math.floor(bounds.left / 25) * 25; x <= bounds.right; x += 25) gridX.push(x);
  for (let y = Math.floor(bounds.bottom / 25) * 25; y <= bounds.top; y += 25) gridY.push(y);
  const finalize = useCallback(() => {
    const cleaned = draft.filter((p, i) => i === 0 || Math.hypot(p.x - draft[i - 1].x, p.y - draft[i - 1].y) > 1e-6);
    if (cleaned.length >= 3) onAddShape({ id: uid(), kind: tool === 'hole' ? 'hole' : 'solid', points: cleaned });
    setDraft([]);
  }, [draft, tool, onAddShape]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.matches('input,textarea,select')) return;
      if (event.key === 'Escape') { setDraft([]); setTool('select'); }
      if ((event.key === 'Enter' || event.key.toLowerCase() === 'c') && draft.length) { event.preventDefault(); finalize(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [draft.length, finalize, setTool]);
  const pointerDown = (e: PointerEvent<SVGSVGElement>) => {
    const p = quantize(world(e));
    if (e.button === 1 || tool === 'pan' || (e.button === 2 && tool === 'select')) {
      drag.current = { kind: 'pan', last: { x: e.clientX, y: e.clientY }, initialized: true };
      e.currentTarget.setPointerCapture(e.pointerId); return;
    }
    if (e.button !== 0) return;
    if (tool === 'solid' || tool === 'hole') {
      if (draft.length > 2 && Math.hypot(p.x - draft[0].x, p.y - draft[0].y) < 7 * scale) finalize();
      else setDraft(list => [...list, p]);
      return;
    }
    if (tool === 'bar') { onAddBar(p); return; }
    setSelected(null);
  };
  const pointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const p = world(e); setMouse(p);
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pan') {
      const dx = (e.clientX - d.last.x) * scale, dy = -(e.clientY - d.last.y) * scale;
      setCenter(old => ({ x: old.x - dx, y: old.y - dy }));
      d.last = { x: e.clientX, y: e.clientY }; return;
    }
    const target = quantize(p);
    if (d.kind === 'vertex') onMoveVertex(d.id!, d.index!, target, !d.initialized);
    if (d.kind === 'bar') onMoveBar(d.id!, target, !d.initialized);
    d.initialized = true;
  };
  const beginDrag = (e: PointerEvent, kind: 'bar' | 'vertex', id: string, index?: number) => {
    if (tool !== 'select') return;
    e.stopPropagation();
    setSelected(id);
    drag.current = { kind, id, index, last: world(e), initialized: false };
    svg.current?.setPointerCapture(e.pointerId);
  };
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    const prev = world(e);
    const newScale = Math.max(0.045, Math.min(8, scale * (e.deltaY < 0 ? 0.88 : 1.12)));
    // Zoom centrado en el cursor.
    setCenter(c => ({ x: prev.x + (c.x - prev.x) * newScale / scale,
      y: prev.y + (c.y - prev.y) * newScale / scale }));
    setScale(newScale);
  };
  const fit = () => {
    if (!mesh) return;
    const w = mesh.max.x - mesh.min.x, h = mesh.max.y - mesh.min.y;
    setCenter({ x: (mesh.min.x + mesh.max.x) / 2, y: (mesh.min.y + mesh.max.y) / 2 });
    setScale(Math.max((w + 80) / Math.max(size.width, 1), (h + 80) / Math.max(size.height, 1)));
  };
  const chosen = project.shapes.find(s => s.id === selected);
  const activeTool = tool === 'solid' || tool === 'hole';
  return <div className="canvas-wrapper">
    <svg ref={svg} className={`section-canvas tool-${tool}`} viewBox={viewBox} onPointerDown={pointerDown}
      onPointerMove={pointerMove} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
      onWheel={wheel} onContextMenu={e => { e.preventDefault(); if (activeTool) finalize(); }}
      onDoubleClick={e => { e.preventDefault(); if (activeTool) finalize(); }}>
      <rect x={bounds.left} y={-bounds.top} width={visibleWidth} height={visibleHeight} fill="var(--canvas-bg)" />
      {gridX.map(x => <line key={`x${x}`} x1={x} y1={-bounds.top} x2={x} y2={-bounds.bottom} stroke={x === 0 ? 'var(--grid-axis)' : 'var(--grid-line)'} strokeWidth={(x === 0 ? 1.3 : 0.7) * scale} />)}
      {gridY.map(y => <line key={`y${y}`} x1={bounds.left} y1={-y} x2={bounds.right} y2={-y} stroke={y === 0 ? 'var(--grid-axis)' : 'var(--grid-line)'} strokeWidth={(y === 0 ? 1.3 : 0.7) * scale} />)}
      {gridX.filter(x => x % 100 === 0).map(x => <text key={`label-x-${x}`} x={x} y={-bounds.bottom - 7 * scale} fontSize={11 * scale} textAnchor="middle" fill="var(--grid-label)">{x}</text>)}
      {gridY.filter(y => y % 100 === 0).map(y => <text key={`label-y-${y}`} x={bounds.left + 5 * scale} y={-y - 4 * scale} fontSize={11 * scale} fill="var(--grid-label)">{y}</text>)}
      {/* Contornos macizos originales; uniones tangentes se regularizan solo en el motor. */}
      {project.shapes.filter(p => p.kind === 'solid').map(shape => <path key={shape.id} d={path(shape.points)} fill="rgba(100,119,145,.19)"
        stroke={selected === shape.id ? '#205ce8' : '#667689'} strokeWidth={(selected === shape.id ? 2.8 : 1.8) * scale}
        onPointerDown={e => { if (tool === 'select') { e.stopPropagation(); setSelected(shape.id); } }} />)}
      {project.shapes.filter(p => p.kind === 'hole').map(shape => <path key={shape.id} d={path(shape.points)} fill="var(--canvas-bg)" stroke="#db895d"
        strokeWidth={(selected === shape.id ? 2.7 : 1.8) * scale} strokeDasharray={`${6 * scale} ${3 * scale}`}
        onPointerDown={e => { if (tool === 'select') { e.stopPropagation(); setSelected(shape.id); } }} />)}
      {showBars && project.bars.map(bar => <g key={bar.id} onPointerDown={e => beginDrag(e, 'bar', bar.id)}>
        <circle cx={bar.x} cy={-bar.y} r={bar.diameter / 2} fill={selected === bar.id ? '#ffb02f' : '#83d856'} stroke="#387a43" strokeWidth={Math.max(0.15, scale * .7)} />
        <circle cx={bar.x} cy={-bar.y} r={Math.max(bar.diameter / 2 + 3 * scale, 4 * scale)} fill="transparent" />
        <title>Barra Ø{fmt(bar.diameter * 10)} mm · ({fmt(bar.x)}, {fmt(bar.y)}) cm</title>
      </g>)}
      {chosen && tool === 'select' && chosen.points.map((p, i) => <circle key={`vertex-${i}`} cx={p.x} cy={-p.y} r={5.5 * scale}
        fill="#94b5e5" stroke="#35516d" strokeWidth={1.6 * scale} className="vertex-handle"
        onPointerDown={e => beginDrag(e, 'vertex', chosen.id, i)}><title>Arrastrar vértice {i + 1}</title></circle>)}
      {mesh && <g pointerEvents="none">
        <circle cx={mesh.centroid.x} cy={-mesh.centroid.y} r={3.4 * scale} fill="#ffbd36" />
        <path d={`M${mesh.centroid.x - 9 * scale},${-mesh.centroid.y} h${18 * scale} M${mesh.centroid.x},${-mesh.centroid.y - 9 * scale} v${18 * scale}`} stroke="#ffba2c" strokeWidth={1.4 * scale} />
        <path d={`M${mesh.centroid.x},${-mesh.centroid.y} l${31 * scale},0 m${-6 * scale},${-4 * scale} l${6 * scale},${4 * scale} l${-6 * scale},${4 * scale}`} fill="none" stroke="#50c96b" strokeWidth={1.7 * scale} />
        <path d={`M${mesh.centroid.x},${-mesh.centroid.y} v${-34 * scale} m${-4 * scale},${6 * scale} l${4 * scale},${-6 * scale} l${4 * scale},${6 * scale}`} fill="none" stroke="#35b8ff" strokeWidth={1.7 * scale} />
        <text x={mesh.centroid.x + 8 * scale} y={-mesh.centroid.y - 8 * scale} fontSize={10 * scale} fill="#e6a515" fontWeight="700">CG</text>
        <text x={mesh.centroid.x + 36 * scale} y={-mesh.centroid.y + 3 * scale} fontSize={11 * scale} fill="#40b666">2</text>
        <text x={mesh.centroid.x + 1 * scale} y={-mesh.centroid.y - 40 * scale} fontSize={11 * scale} fill="#30a7ec">3</text>
      </g>}
      {activeTool && draft.length > 0 && <g pointerEvents="none">
        <polyline points={[...draft, ...(mouse ? [quantize(mouse)] : [])].map(p => `${p.x},${-p.y}`).join(' ')} fill="none" stroke={tool === 'hole' ? '#dc8b54' : '#3767ed'} strokeWidth={2 * scale} strokeDasharray={`${7 * scale} ${4 * scale}`} />
        {draft.map((p, i) => <circle key={i} cx={p.x} cy={-p.y} r={4 * scale} fill="#fff" stroke="#2761de" strokeWidth={1.5 * scale} />)}
      </g>}
    </svg>
    <div className="canvas-actions">
      <button title="Ajustar sección a la ventana" onClick={fit}><MousePointer2 size={15} /> Centrar</button>
      <button title="Acercar" onClick={() => setScale(v => Math.max(0.045, v * .8))}>+</button>
      <button title="Alejar" onClick={() => setScale(v => Math.min(8, v * 1.25))}>−</button>
    </div>
    {activeTool && <div className="draft-banner"><span>{tool === 'solid' ? 'Sección' : 'Hueco'} · {draft.length} vértices. Clic para añadir, C/Enter/doble clic para cerrar.</span><button title="Cancelar" onClick={() => setDraft([])}><X size={15} /></button><button title="Finalizar" onClick={finalize}><Check size={15} /></button></div>}
    <div className="canvas-coordinates">X {fmt(mouse?.x ?? 0)} cm &nbsp; Y {fmt(mouse?.y ?? 0)} cm · {Math.round(100 / scale)}%</div>
    <div className="material-badge"><span /> Concrete</div>
    <div className="canvas-legend"><span className="legend-dot solid" /> Concreto <span className="legend-dot hole" /> Huecos <span className="legend-dot bar" /> Acero</div>
  </div>;
}
