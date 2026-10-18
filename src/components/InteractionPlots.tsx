import { useEffect, useMemo, useRef, useState } from 'react';
import type { InteractionPoint, LoadCase, Surface, ViewName } from '../model/types';

type Mode = 'design' | 'nominal';
type Props = { surface: Surface; view: ViewName; load?: LoadCase; darkMode?: boolean };
const palette = { blue: '#245eef', cyan: '#00a7c6', amber: '#f4aa2c', red: '#ec5965' };
const nOf = (p: InteractionPoint, m: Mode) => m === 'design' ? p.designN : p.nominalN;
const mxOf = (p: InteractionPoint, m: Mode) => m === 'design' ? p.designMx : p.nominalMx;
const myOf = (p: InteractionPoint, m: Mode) => m === 'design' ? p.designMy : p.nominalMy;

function Plot({ data, layout, threeD = false, darkMode = false }: { data: any[]; layout: Record<string, unknown>; threeD?: boolean; darkMode?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let disposed = false;
    const el = ref.current;
    if (!el) return;
    import('plotly.js-dist-min').then(({ default: Plotly }) => {
      if (disposed || !el) return;
      void Plotly.react(el, data, {
        autosize: true, margin: { l: 57, r: 17, t: 23, b: 54 },
        paper_bgcolor: darkMode ? '#172235' : '#ffffff', plot_bgcolor: darkMode ? '#172235' : '#ffffff',
        font: { family: 'Segoe UI, sans-serif', color: darkMode ? '#c8d5e8' : '#526480', size: 12 },
        ...(threeD ? { margin: { l: 0, r: 0, t: 0, b: 0 } } : {}),
        ...layout,
      }, { responsive: true, displaylogo: false, scrollZoom: true, modeBarButtonsToRemove: ['lasso2d', 'select2d'] });
      const obs = new ResizeObserver(() => { if (!disposed) Plotly.Plots.resize(el); });
      obs.observe(el);
      // Guardamos limpieza específica de esta instancia.
      cleanup = () => { obs.disconnect(); Plotly.purge(el); };
    }).catch(error => { if (el && !disposed) el.textContent = `No se pudo cargar Plotly: ${String(error)}`; });
    let cleanup = () => {};
    return () => { disposed = true; cleanup(); };
  }, [data, layout, threeD]);
  return <div ref={ref} className="plot-host" aria-label="Gráfico interactivo Plotly" />;
}

export default function InteractionPlots({ surface, view, load, darkMode = false }: Props) {
  const [mode, setMode] = useState<Mode>('design');
  const [angle, setAngle] = useState(0);
  const minN = useMemo(() => Math.min(...surface.points.map(p => nOf(p, mode))), [surface, mode]);
  const maxN = useMemo(() => Math.max(...surface.points.map(p => nOf(p, mode))), [surface, mode]);
  const [fraction, setFraction] = useState(0.5);
  const level = minN + (maxN - minN) * fraction;
  const options = useMemo(() => {
    if (view === 'biaxial') {
      const x = surface.points.map(p => mxOf(p, mode));
      const y = surface.points.map(p => myOf(p, mode));
      const z = surface.points.map(p => nOf(p, mode));
      const i: number[] = [], j: number[] = [], k: number[] = [];
      const index = (a: number, b: number) => a * surface.depths + b;
      for (let a = 0; a < surface.angles; a++) for (let d = 0; d < surface.depths - 1; d++) {
        const b = (a + 1) % surface.angles;
        const p = index(a, d), q = index(b, d), r = index(a, d + 1), s = index(b, d + 1);
        i.push(p, q); j.push(q, s); k.push(r, r);
      }
      const data: any[] = [{
        type: 'mesh3d', x, y, z, i, j, k,
        intensity: z, colorscale: [[0, '#244ba5'], [0.4, '#4ba6cc'], [0.75, '#6ccef3'], [1, '#f8b55b']],
        flatshading: false, opacity: 0.89, showscale: true,
        colorbar: { title: { text: 'N (kN)' }, thickness: 12 },
        hovertemplate: 'Mx: %{x:.1f} kN·m<br>My: %{y:.1f} kN·m<br>N: %{z:.1f} kN<extra></extra>',
      }];
      if (load) data.push({ type: 'scatter3d', mode: 'markers', name: 'Carga solicitante', x: [load.mx], y: [load.my], z: [load.n], marker: { color: palette.red, size: 6, line: { color: 'white', width: 1.5 } } });
      return { data, layout: { showlegend: !!load,       scene: { bgcolor: darkMode ? '#172235' : '#fff',
        xaxis: { title: { text: 'Mx (kN·m)' }, gridcolor: '#e4eaf5' },
        yaxis: { title: { text: 'My (kN·m)' }, gridcolor: '#e4eaf5' },
        zaxis: { title: { text: 'N (kN)' }, gridcolor: '#e4eaf5', zerolinecolor: '#b8c9e5' },
        aspectmode: 'data', camera: { eye: { x: 1.5, y: 1.45, z: 0.8 } },
      }, legend: { orientation: 'h', y: 1.02 } } };
    }
    if (view === 'uniaxial') {
      const a = Math.round(angle / 360 * surface.angles) % surface.angles;
      const b = (a + surface.angles / 2) % surface.angles;
      const normal = 2 * Math.PI * a / surface.angles;
      const curve = (index: number) => surface.points.slice(index * surface.depths, (index + 1) * surface.depths);
      const branches = [curve(a), curve(Math.round(b))].filter(b => b.length);
      const data: any[] = branches.map((branch, idx) => ({
        type: 'scatter', mode: 'lines', name: idx === 0 ? 'Dirección +' : 'Dirección −',
        x: branch.map(p => mxOf(p, mode) * Math.sin(normal) - myOf(p, mode) * Math.cos(normal)),
        y: branch.map(p => nOf(p, mode)),
        line: { color: idx === 0 ? palette.blue : palette.cyan, width: 3 },
        hovertemplate: 'M: %{x:.1f} kN·m<br>N: %{y:.1f} kN<extra></extra>',
      }));
      if (load) data.push({ type: 'scatter', mode: 'markers', name: 'Solicitación', x: [load.mx * Math.sin(normal) - load.my * Math.cos(normal)], y: [load.n], marker: { color: palette.red, size: 11, symbol: 'x' } });
      return { data, layout: { xaxis: { title: { text: 'Momento proyectado (kN·m)' }, zeroline: true, gridcolor: '#e7edf6' },
        yaxis: { title: { text: 'N (kN), compresión negativa' }, zeroline: true, gridcolor: '#e7edf6' },
        legend: { orientation: 'h', y: 1.09 }, hovermode: 'closest' } };
    }
    // Cortes de la superficie por planos de esfuerzo axial N = constante.
    const p: { x: number; y: number }[] = [];
    for (let a = 0; a < surface.angles; a++) {
      const ray = surface.points.slice(a * surface.depths, (a + 1) * surface.depths);
      let best = ray[0], score = Math.abs(nOf(best, mode) - level);
      for (let d = 0; d < ray.length - 1; d++) {
        const u = ray[d], v = ray[d + 1];
        const n0 = nOf(u, mode), n1 = nOf(v, mode);
        if ((n0 - level) * (n1 - level) <= 0 && Math.abs(n1 - n0) > 1e-9) {
          const t = (level - n0) / (n1 - n0);
          best = { ...u, nominalMx: u.nominalMx + t * (v.nominalMx - u.nominalMx),
            nominalMy: u.nominalMy + t * (v.nominalMy - u.nominalMy),
            designMx: u.designMx + t * (v.designMx - u.designMx),
            designMy: u.designMy + t * (v.designMy - u.designMy) };
          score = 0; break;
        }
        const err = Math.abs(nOf(v, mode) - level);
        if (err < score) { best = v; score = err; }
      }
      p.push({ x: mxOf(best, mode), y: myOf(best, mode) });
    }
    const data: any[] = [{ type: 'scatter', mode: 'lines', name: `N = ${level.toFixed(0)} kN`,
      x: [...p.map(p => p.x), p[0].x], y: [...p.map(p => p.y), p[0].y], fill: 'toself',
      fillcolor: 'rgba(37, 94, 239, .10)', line: { color: palette.blue, width: 3 } }];
    if (load) data.push({ type: 'scatter', mode: 'markers', name: 'Mx/My solicitante (verificar N)',
      x: [load.mx], y: [load.my], marker: { color: palette.red, size: 10, symbol: 'x' } });
    return { data, layout: { xaxis: { title: { text: 'Mx (kN·m)' }, gridcolor: '#e7edf6', scaleanchor: 'y', scaleratio: 1 },
      yaxis: { title: { text: 'My (kN·m)' }, gridcolor: '#e7edf6' }, legend: { orientation: 'h', y: 1.09 } } };
  }, [surface, view, mode, angle, level, load]);
  return <div className="result-content">
    <div className="result-header">
      <div><h2>{view === 'biaxial' ? 'Superficie de interacción 3D' : view === 'uniaxial' ? 'Interacción uniaxial' : 'Contornos de interacción'}</h2>
        <p>{mode === 'design' ? 'Resistencia de diseño · ϕPn, ϕMxn, ϕMyn' : 'Resistencia nominal · Pn, Mxn, Myn'}</p></div>
      <div className="segmented"><button className={mode === 'design' ? 'active' : ''} onClick={() => setMode('design')}>Diseño ϕ</button><button className={mode === 'nominal' ? 'active' : ''} onClick={() => setMode('nominal')}>Nominal</button></div>
    </div>
    {view === 'uniaxial' && <div className="plot-controls"><label>Dirección del eje neutro <strong>{angle}°</strong></label><input type="range" min="0" max="179" value={angle} onChange={e => setAngle(+e.target.value)} /></div>}
    {view === 'contours' && <div className="plot-controls"><label>Plano axial <strong>{level.toFixed(0)} kN</strong></label><input type="range" min="0" max="1" step="0.002" value={fraction} onChange={e => setFraction(+e.target.value)} /></div>}
    <Plot data={options.data} layout={options.layout} threeD={view === 'biaxial'} darkMode={darkMode} />
    <div className="metrics three">
      <div><span>Pn0</span><b>{surface.pn0.toLocaleString('es-PE', { maximumFractionDigits: 0 })} kN</b><small>Compresión nominal</small></div>
      <div><span>ϕPn máx.</span><b>{surface.designCompressionLimit.toLocaleString('es-PE', { maximumFractionDigits: 0 })} kN</b><small>Límite axial de diseño</small></div>
      <div><span>β₁</span><b>{surface.beta1.toFixed(3)}</b><small>Bloque de Whitney</small></div>
    </div>
    <p className="disclaimer">Modelo seccional preliminar ACI 318. No se ha comprobado esbeltez, segundo orden, cortante, disposición normativa ni compatibilidad con un expediente de diseño. La presencia del punto de carga no constituye una verificación de capacidad.</p>
  </div>;
}
