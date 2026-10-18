import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AppWindow, ArrowDownToLine, ArrowUpFromLine, BarChart3, Box, CheckCircle2,
  ChevronDown, ChevronRight, CircleDot, Download,
  FilePlus2, FileUp, Grid2X2, Grip, Info, Layers3, MousePointer2,
  Move, PanelLeftClose, Pencil, Play, Plus, RotateCcw, Ruler, Save, Settings2,
  ShieldCheck, SlidersHorizontal, Square, Sun, Moon, Trash2, Undo2, Redo2, X,
} from 'lucide-react';
import SectionCanvas from './components/SectionCanvas';
import InteractionPlots from './components/InteractionPlots';
import { boundaryDistance, insideConcrete, validateProject, validateTopology } from './geometry/topology';
import { calculateSurface, steelArea } from './engine/section';
import { defaultProject, diameters, perimeterBars, uid } from './model/defaults';
import type { Material, Point, Project, Surface, Tool, ViewName } from './model/types';
import { isTauri, openProjectNative, openProjectWeb, saveText, toCSV, toDXF, toSVG } from './utils/files';

const nav: { view: ViewName; title: string; icon: typeof Square }[] = [
  { view: 'section', title: 'Secciones', icon: Grip },
  { view: 'materials', title: 'Parámetros', icon: SlidersHorizontal },
  { view: 'loads', title: 'Cargas', icon: ArrowDownToLine },
  { view: 'uniaxial', title: 'Uniaxial', icon: Activity },
  { view: 'biaxial', title: 'Biaxial 3D', icon: Box },
  { view: 'contours', title: 'Contornos', icon: Layers3 },
];
const graphView = (v: ViewName) => ['uniaxial', 'biaxial', 'contours'].includes(v);
const format = (v: number, fraction = 2) => Number.isFinite(v) ? v.toLocaleString('es-PE', { maximumFractionDigits: fraction }) : '—';
const validStorage = (): Project => {
  try {
    const raw = localStorage.getItem('walltrux.project.v1');
    if (raw) {
      const p = JSON.parse(raw) as Project;
      if (p.format === 'walltrux-studio' && p.version === 1 && Array.isArray(p.shapes) && Array.isArray(p.bars)) return p;
    }
  } catch { /* Se usa un ejemplo cuando no hay almacenamiento disponible. */ }
  return defaultProject();
};
function Field({ title, value, unit, onChange, min, step = 'any' }: { title: string; value: number; unit?: string; onChange: (n: number) => void; min?: number; step?: string | number }) {
  return <label className="input-row"><span>{title}</span><span className="field-combined"><input type="number" value={value} min={min} step={step} onChange={e => onChange(Number(e.target.value))} />{unit && <small>{unit}</small>}</span></label>;
}
function App() {
  const [project, setProject] = useState<Project>(validStorage);
  const projectRef = useRef(project);
  const undoStack = useRef<Project[]>([]), redoStack = useRef<Project[]>([]);
  const [view, setView] = useState<ViewName>('section');
  const [tool, setTool] = useState<Tool>('select');
  const [selected, setSelected] = useState<string | null>(null);
  const [barSize, setBarSize] = useState('#5 · Ø15.9');
  const [snap, setSnap] = useState(true);
  const [showBars, setShowBars] = useState(true);
  const [spacing, setSpacing] = useState(35);
  const [surface, setSurface] = useState<Surface>();
  const [computing, setComputing] = useState(false);
  const [toast, setToast] = useState<{ message: string; error: boolean }>();
  const [compact, setCompact] = useState(false);
  const [help, setHelp] = useState(false);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('walltrux.theme') === 'dark');
  const importInput = useRef<HTMLInputElement>(null);
  const notify = useCallback((message: string, error = false) => setToast({ message, error }), []);
  useEffect(() => { if (!toast) return; const id = window.setTimeout(() => setToast(undefined), 5000); return () => clearTimeout(id); }, [toast]);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('walltrux.theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);
  useEffect(() => { const id = window.setTimeout(() => {
    try { localStorage.setItem('walltrux.project.v1', JSON.stringify(project)); } catch { /* no hay almacenamiento */ }
  }, 350); return () => clearTimeout(id); }, [project]);
  const validation = useMemo(() => validateProject(project), [project]);
  const mesh = validation.mesh;
  const as = project.bars.reduce((sum, bar) => sum + steelArea(bar.diameter), 0);
  const rho = mesh ? as / mesh.area * 100 : 0;
  const diameter = diameters[barSize];
  const apply = useCallback((updater: (p: Project) => Project, record = true) => {
    const old = projectRef.current, next = updater(old);
    if (next === old) return;
    if (record) { undoStack.current.push(old); if (undoStack.current.length > 60) undoStack.current.shift(); redoStack.current = []; }
    projectRef.current = next; setProject(next); setSurface(undefined);
  }, []);
  const undo = useCallback(() => {
    const previous = undoStack.current.pop(); if (!previous) return;
    redoStack.current.push(projectRef.current); projectRef.current = previous;
    setProject(previous); setSurface(undefined); setSelected(null);
  }, []);
  const redo = useCallback(() => {
    const next = redoStack.current.pop(); if (!next) return;
    undoStack.current.push(projectRef.current); projectRef.current = next;
    setProject(next); setSurface(undefined); setSelected(null);
  }, []);
  const removeSelected = useCallback(() => {
    if (!selected) return;
    apply(p => ({ ...p, shapes: p.shapes.filter(s => s.id !== selected), bars: p.bars.filter(b => b.id !== selected) }));
    setSelected(null);
  }, [selected, apply]);
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,select,textarea')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') removeSelected();
    };
    window.addEventListener('keydown', handle); return () => window.removeEventListener('keydown', handle);
  }, [undo, redo, removeSelected]);
  const addShape = useCallback((shape: Project['shapes'][number]) => {
    const next = { ...projectRef.current, shapes: [...projectRef.current.shapes, shape] };
    const result = validateTopology(next.shapes);
    if (!result.valid) { notify(result.errors.join(' '), true); return; }
    apply(() => next); setSelected(shape.id); setTool('select');
  }, [apply, notify]);
  const addBar = useCallback((point: Point) => {
    const newBar = { id: uid(), x: point.x, y: point.y, diameter };
    const next = { ...projectRef.current, bars: [...projectRef.current.bars, newBar] };
    const result = validateProject(next);
    if (!result.valid) { notify(result.errors.slice(0, 2).join(' '), true); return; }
    apply(() => next); setSelected(newBar.id);
  }, [apply, diameter, notify]);
  const moveVertex = useCallback((id: string, index: number, point: Point, record: boolean) => {
    apply(p => ({ ...p, shapes: p.shapes.map(s => s.id === id
      ? { ...s, points: s.points.map((v, i) => i === index ? point : v) } : s) }), record);
  }, [apply]);
  const moveBar = useCallback((id: string, point: Point, record: boolean) => {
    apply(p => ({ ...p, bars: p.bars.map(b => b.id === id ? { ...b, ...point } : b) }), record);
  }, [apply]);
  const updateMaterial = (key: keyof Material, value: string | number) => apply(p => ({ ...p,
    materials: { ...p.materials, [key]: value },
  }));
  const generateBars = (type: 'perimeter' | 'mesh') => {
    const p = projectRef.current;
    const g = validateTopology(p.shapes);
    if (!g.valid || !g.mesh) { notify(g.errors.join(' '), true); return; }
    const m = g.mesh;
    const newBars = type === 'perimeter' ? (() => {
      const s = p.shapes.find(s => s.id === selected && s.kind === 'solid') ?? p.shapes.find(s => s.kind === 'solid');
      if (!s || s.points.length !== 4 || !s.points.every((v, i) => {
        const b = s.points[(i + 1) % 4]; return Math.abs(v.x - b.x) < 1e-6 || Math.abs(v.y - b.y) < 1e-6;
      })) { notify('La distribución perimetral automática requiere un rectángulo ortogonal seleccionado.', true); return null; }
      const xs = s.points.map(v => v.x), ys = s.points.map(v => v.y);
      return perimeterBars(Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), p.cover, diameter, spacing);
    })() : (() => {
      const bars: Project['bars'] = [];
      if (spacing <= diameter || spacing <= 0) return bars;
      const margin = p.cover + diameter / 2;
      for (let x = m.min.x + margin; x < m.max.x - margin; x += spacing) {
        for (let y = m.min.y + margin; y < m.max.y - margin; y += spacing) {
          if (insideConcrete({ x, y }, m) && boundaryDistance({ x, y }, m) >= margin - 1e-7) bars.push({ id: uid(), x, y, diameter });
        }
      }
      return bars;
    })();
    if (!newBars) return;
    const next = { ...p, bars: newBars };
    const valid = validateProject(next);
    if (!valid.valid) { notify(valid.errors.slice(0, 2).join(' '), true); return; }
    apply(() => next); notify(`${newBars.length} barras generadas. Se reemplazó el armado anterior.`);
    setShowBars(true); setSelected(null);
  };
  const runAnalysis = () => {
    if (!validation.valid || !validation.mesh) { notify(validation.errors.join(' '), true); return; }
    if (computing) return;
    setComputing(true);
    // Se libera un frame para pintar el estado "calculando" antes del trabajo CPU local.
    window.setTimeout(() => {
      try { const result = calculateSurface(projectRef.current, validation.mesh!, 32, 42);
        setSurface(result); if (!graphView(view)) setView('biaxial'); notify(`${result.points.length} puntos de interacción calculados localmente.`);
      } catch (error) { notify(`Error al calcular: ${String(error)}`, true); }
      finally { setComputing(false); }
    }, 30);
  };
  const write = async (content: string, filename: string, mime?: string) => {
    try { await saveText(content, filename, mime); notify('Exportación completada (o diálogo de guardado cerrado).'); }
    catch (error) { notify(`No se pudo guardar: ${String(error)}`, true); }
  };
  const load = (p: Project) => {
    const valid = validateTopology(p.shapes);
    if (!valid.valid) { notify(`El archivo contiene errores: ${valid.errors.join(' ')}`, true); return; }
    apply(() => p); setSelected(null); setView('section'); setTool('select'); notify('Proyecto cargado.');
  };
  const openFile = async () => {
    try { if (isTauri()) { const p = await openProjectNative(); if (p) load(p); }
      else importInput.current?.click();
    } catch (error) { notify(`No se pudo abrir: ${String(error)}`, true); }
  };
  const newProject = () => {
    if (!window.confirm('¿Crear un proyecto nuevo? Se reemplazará el modelo actual (puedes guardarlo antes).')) return;
    apply(() => defaultProject()); setTool('select'); setSelected(null); setView('section');
  };
  const chooseView = (v: ViewName) => { setView(v); if (v === 'section') setTool('select'); };
  const currentLoad = project.loads[0];
  return <div className="app-shell">
    <aside className={`main-nav ${compact ? 'collapsed' : ''}`}>
      <div className="brand" onClick={() => chooseView('section')} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') chooseView('section'); }}>
        <div className="brand-mark">W<span>+</span></div>{!compact && <div><strong>WallTRUX</strong><small>STUDIO · v0.1</small></div>}
      </div>
      <button className="collapse-btn" title="Contraer/expandir panel" onClick={() => setCompact(v => !v)}><PanelLeftClose size={16} /></button>
      <div className="nav-project">
        <button onClick={newProject} title="Nuevo proyecto"><FilePlus2 size={15}/>{!compact && 'Nuevo proyecto'}</button>
        <button onClick={openFile} title="Abrir proyecto"><FileUp size={15}/>{!compact && 'Abrir proyecto'}</button>
        <button onClick={() => write(JSON.stringify(project, null, 2), 'WallTRUX-project.json')} title="Guardar proyecto"><Save size={15}/>{!compact && 'Guardar proyecto'}</button>
      </div>
      <div className="nav-divider" />
      {!compact && <div className="nav-caption">MODELADO Y ANÁLISIS</div>}
      <div className="navigation">{nav.map(n => <button key={n.view} title={n.title}
        onClick={() => chooseView(n.view)} className={view === n.view ? 'selected' : ''}>
        <n.icon size={18} strokeWidth={1.8} />{!compact && <span>{n.title}</span>}
        {!compact && n.view === 'section' && <span className="nav-ellipsis">⋮</span>}
      </button>)}</div>
      <div className="nav-bottom">
        <button onClick={() => setHelp(true)} title="Acerca de / ayuda"><Info size={17}/>{!compact && 'Acerca de'}</button>
        <button onClick={() => setDarkMode(value => !value)} title={darkMode ? 'Usar modo claro' : 'Usar modo oscuro'}>{darkMode ? <Sun size={17}/> : <Moon size={17}/>} {!compact && (darkMode ? 'Modo claro' : 'Modo oscuro')}</button>
        <button onClick={() => chooseView('materials')} title="Configuración"><Settings2 size={17}/>{!compact && 'Configuración'}</button>
        {!compact && <small>Sin nube · Cálculo local</small>}
      </div>
    </aside>
    <section className="work-area">
      <header className="titlebar">
        <div className="project-location"><AppWindow size={17}/><input aria-label="Nombre del proyecto" value={project.name} onChange={e => apply(p => ({ ...p, name: e.target.value }))} /><ChevronRight size={14} /><b>{nav.find(n => n.view === view)?.title}</b></div>
        <div className="header-actions">
          <button className="flat-button" onClick={undo} title="Deshacer (Ctrl+Z)"><Undo2 size={17}/></button>
          <button className="flat-button" onClick={redo} title="Rehacer (Ctrl+Y)"><Redo2 size={17}/></button>
          <div className="header-separator" />
          <button className="header-outline" onClick={() => write(toDXF(project), 'WallTRUX-section.dxf', 'application/dxf')}><Download size={14} />Exportar DXF</button>
          <button className="header-outline export-secondary" onClick={() => write(toSVG(project, mesh), 'WallTRUX-section.svg', 'image/svg+xml')}>SVG</button>
          <button className="analyze-btn" disabled={computing || !validation.valid} onClick={runAnalysis}><Play size={15} fill="currentColor"/>{computing ? 'Calculando...' : 'Analizar'}</button>
        </div>
      </header>
      <main className="workspace">
        <div className="inspector">
          <div className="inspector-head"><span>{view === 'materials' ? 'Materiales y norma' : view === 'loads' ? 'Combinaciones de carga' : 'Secciones Inteligentes +'}</span><ChevronDown size={15} /></div>
          {view === 'materials' ? <div className="inspector-content">
            <div className="hint">Propiedades constitutivas para interacción.</div>
            <div className="group-title">CONCRETO Y ACERO</div>
            <Field title="f’c" unit="MPa" value={project.materials.fc} min={1} onChange={v => updateMaterial('fc', v)} />
            <Field title="fy" unit="MPa" value={project.materials.fy} min={1} onChange={v => updateMaterial('fy', v)} />
            <Field title="Es" unit="MPa" value={project.materials.Es} min={1} onChange={v => updateMaterial('Es', v)} />
            <Field title="εcu" value={project.materials.epsCu} min={0} step="0.0001" onChange={v => updateMaterial('epsCu', v)} />
            <div className="group-title">REDUCCIÓN DE RESISTENCIA</div>
            <label className="select-row">Norma <select value="ACI318" disabled><option>ACI318</option></select></label>
            <label className="select-row">Confinamiento<select value={project.materials.confinement} onChange={e => updateMaterial('confinement', e.target.value)}><option value="tied">Estribos</option><option value="spiral">Espiral</option></select></label>
            <div className="info-panel"><ShieldCheck size={18} /><p>ϕ entre {project.materials.confinement === 'tied' ? '0.65' : '0.75'} y 0.90. Límite de compresión axial: {project.materials.confinement === 'tied' ? '0.80' : '0.85'} ϕPn0. Formulación simplificada ACI 318.</p></div>
            <p className="footnote">Convención interna: compresión negativa, tracción positiva.</p>
          </div> : view === 'loads' ? <div className="inspector-content">
            <div className="hint">Carga solicitante de referencia. N negativo representa compresión.</div>
            {project.loads.map((load, i) => <div className="load-card" key={i}>
              <div className="load-title"><b>{load.name}</b><button onClick={() => apply(p => ({ ...p, loads: p.loads.filter((_, j) => j !== i) }))}><X size={14}/></button></div>
              {(['n', 'mx', 'my'] as const).map(k => <Field key={k} title={k === 'n' ? 'N' : k === 'mx' ? 'Mx' : 'My'} unit={k === 'n' ? 'kN' : 'kN·m'} value={load[k]}
                onChange={v => apply(p => ({ ...p, loads: p.loads.map((x, j) => i === j ? { ...x, [k]: v } : x) }))} />)}
            </div>)}
            <button className="outline-button full" onClick={() => apply(p => ({ ...p, loads: [...p.loads, { name: `LC${p.loads.length + 1}`, n: -1000, mx: 0, my: 0 }] }))}><Plus size={14}/>Añadir carga</button>
            <p className="footnote">El punto de carga se representa sin evaluar automáticamente la razón demanda/capacidad.</p>
          </div> : <div className="inspector-content">
            <div className="hint">Dibuja polígonos, huecos y barras sobre el lienzo. Enter para cerrar.</div>
            <div className="mini-grid"><button onClick={newProject}><RotateCcw size={13}/> Nueva</button><button onClick={() => write(JSON.stringify(project, null, 2), 'WallTRUX-project.json')}><Save size={13}/> Guardar</button><button onClick={openFile}><ArrowUpFromLine size={13}/> Cargar</button><button onClick={() => write(toDXF(project), 'WallTRUX-section.dxf')}><Download size={13}/> DXF</button></div>
            <div className="status-line">{project.shapes.length} polígonos · {project.bars.length} barras</div>
            <label className="select-row">Unidad <select value="cm" disabled><option value="cm">cm</option></select></label>
            <Field title="r — recubr. (cm)" value={project.cover} min={0} onChange={v => apply(p => ({ ...p, cover: v }))} />
            <div className="group-title">ZONAS DE REFUERZO</div>
            <label className="select-row">Plantilla <select value="rect"><option value="rect">Perimetral / Rectángulo</option></select></label>
            <Field title="Espaciado" unit="cm" value={spacing} min={5} onChange={setSpacing} />
            <div className="twin"><button className="warm" onClick={() => generateBars('perimeter')}><Plus size={13}/> Confinada</button><button className="cold" onClick={() => generateBars('mesh')}><Plus size={13}/> Malla</button></div>
            <div className="hint spaced">Los generadores reemplazan las barras existentes.</div>
            <div className="group-title">ACEROS LIBRES</div>
            <div className="select-with-button"><select value={barSize} onChange={e => setBarSize(e.target.value)}>{Object.keys(diameters).map(d => <option key={d} value={d}>{d}</option>)}</select><button className="outline-button" onClick={() => { setTool('bar'); setView('section'); }}><Plus size={13}/> Barra</button></div>
            <label className="checkbox-row"><input type="checkbox" checked={snap} onChange={e => setSnap(e.target.checked)} /> Adoptar rejilla al hacer snap</label>
            <label className="checkbox-row"><input type="checkbox" checked={showBars} onChange={e => setShowBars(e.target.checked)} /> Mostrar barras</label>
            <div className="status-line sub">Modo: {tool === 'bar' ? 'clic para colocar barras' : tool === 'hole' ? 'dibujar hueco' : tool === 'solid' ? 'dibujar sección' : 'selección y edición'}</div>
            <div className="group-title">GEOMETRÍA</div>
            <div className="data-pairs"><span>Regiones</span><strong>{project.shapes.filter(s => s.kind === 'solid').length}</strong><span>Huecos</span><strong>{project.shapes.filter(s => s.kind === 'hole').length}</strong>
            <span>Área bruta</span><strong>{format(mesh?.area ?? 0)} cm²</strong><span>CG · x</span><strong>{format(mesh?.centroid.x ?? 0)} cm</strong><span>CG · y</span><strong>{format(mesh?.centroid.y ?? 0)} cm</strong>
            <span>As total</span><strong>{format(as)} cm²</strong><span>ρ bruto</span><strong>{format(rho, 3)} %</strong></div>
            {!!selected && <button className="danger-outline" onClick={removeSelected}><Trash2 size={13}/> Eliminar objeto seleccionado</button>}
          </div>}
        </div>
        <section className="work-surface">
          {!graphView(view) && <div className="canvas-toolbar">
            {([
              ['select', MousePointer2, 'Seleccionar'], ['solid', Square, 'Sección'], ['hole', Box, 'Hueco'],
              ['bar', CircleDot, 'Barra'], ['pan', Move, 'Desplazar'],
            ] as const).map(([key, Icon, label]) => <button key={key} onClick={() => { setTool(key); if (view !== 'section') setView('section'); }} className={tool === key ? 'tool active' : 'tool'} title={label}><Icon size={16}/><span>{label}</span></button>)}
            <div className="toolbar-divider" />
            <button title="Generar acero perimetral" onClick={() => generateBars('perimeter')}><Grid2X2 size={16}/> Conf.</button>
            <button title="Activar dibujo de polígono" onClick={() => setTool('solid')}><Pencil size={16}/> Polígono</button>
            <button onClick={undo} title="Deshacer"><Undo2 size={16}/></button>
            <button onClick={redo} title="Rehacer"><Redo2 size={16}/></button>
            <button onClick={removeSelected} disabled={!selected} title="Eliminar objeto"><Trash2 size={16}/></button>
          </div>}
          {graphView(view) ? surface ? <InteractionPlots surface={surface} view={view} load={currentLoad} darkMode={darkMode} />
            : <div className="empty-results"><BarChart3 size={56} strokeWidth={1.2}/><h2>Resultados de interacción</h2><p>Valida la sección y ejecuta el motor para generar la superficie nominal y de diseño.</p><button className="analyze-btn" onClick={runAnalysis} disabled={!validation.valid || computing}><Play size={15}/>{computing ? 'Calculando…' : 'Calcular superficie'}</button></div>
            : <SectionCanvas project={project} mesh={mesh} tool={tool} selected={selected} setSelected={setSelected}
                onAddShape={addShape} onAddBar={addBar} onMoveVertex={moveVertex} onMoveBar={moveBar}
                snap={snap} showBars={showBars} setTool={setTool} />}
          <div className="bottom-status"><div><span className={`small-status ${validation.valid ? 'ok' : 'bad'}`}>{validation.valid ? <CheckCircle2 size={13} /> : <Info size={13}/>} {validation.valid ? 'Geometría válida' : 'Revisar sección'}</span>
            <span>ACI 318 (simplificado)</span><span>cm · MPa · kN · kN·m</span></div>
            <div><span>OSNAP <b>{snap ? '●' : '○'}</b></span><span>UNIDADES cm</span><button onClick={() => setHelp(true)}><Info size={14}/></button></div></div>
        </section>
      </main>
      {!validation.valid && <div className="validation-strip"><Info size={16}/><span>{validation.errors.slice(0, 3).join(' · ')}</span></div>}
      {surface && <div className="results-strip"><BarChart3 size={15}/>{surface.points.length} puntos · {surface.angles} planos · {surface.depths} profundidades <button onClick={() => write(toCSV(surface), 'WallTRUX-interaction.csv', 'text/csv')}><Download size={13}/> CSV</button></div>}
    </section>
    <input type="file" accept=".json,application/json" ref={importInput} hidden onChange={async e => {
      const file = e.target.files?.[0]; if (!file) return;
      try { load(await openProjectWeb(file)); } catch (error) { notify(String(error), true); } e.target.value = '';
    }} />
    {toast && <div className={`toast ${toast.error ? 'error' : ''}`} role="status"><span>{toast.error ? '!' : '✓'}</span>{toast.message}<button onClick={() => setToast(undefined)}><X size={15}/></button></div>}
    {help && <div className="modal-backdrop" onClick={() => setHelp(false)}><div className="help-modal" onClick={e => e.stopPropagation()}>
      <button className="modal-close" onClick={() => setHelp(false)}><X size={19}/></button><div className="modal-icon"><Ruler size={28}/></div>
      <h2>WallTRUX Studio</h2><p>Aplicación local de modelado y análisis seccional de concreto armado. React + TypeScript + SVG + JSTS + Earcut + Plotly + Tauri.</p>
      <h3>Flujo de trabajo</h3><p>Dibuja regiones de concreto y huecos, coloca barras o utiliza las plantillas, configura materiales y presiona <b>Analizar</b>. Puedes inspeccionar el diagrama 3D, cortes uniaxiales y contornos, exportar DXF, SVG, CSV y el proyecto JSON.</p>
      <h3>Alcance del motor</h3><p>Compatibilidad de deformaciones con bloque de Whitney, acero elastoplástico ideal, factores ϕ de transición y límite axial simplificados según ACI 318. Compresión negativa, esfuerzos MPa y geometría cm. Los resultados son preliminares y requieren verificación independiente antes de cualquier uso profesional.</p>
      <button className="analyze-btn" onClick={() => setHelp(false)}>Entendido</button>
    </div></div>}
  </div>;
}
export default App;
