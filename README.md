# WallTRUX Studio

**Editor de secciones de concreto armado + motor de interacción local (MVP independiente).**

Interfaz de escritorio **Tauri 2 / React / TypeScript**, con lienzo **SVG**, validación y operaciones topológicas mediante **JSTS 2.12**, triangulación con **Earcut** y gráficos interactivos con **Plotly**. No utiliza API REST, servicio en la nube ni Python. El solver está escrito completamente en TypeScript; Rust se emplea únicamente como anfitrión Tauri y acceso a archivos.

Es una **implementación nueva inspirada visualmente** en la imagen de referencia, no una copia de su código original ni una reproducción completa de todas sus capacidades. Los resultados son preliminares y el producto **no está certificado para diseño estructural profesional**.

## Requisitos para Windows 10/11

1. Node.js 20.19+ (recomendado 22 LTS) y npm.
2. [Rust + Cargo (toolchain MSVC)](https://www.rust-lang.org/tools/install); `rustup default stable-x86_64-pc-windows-msvc`.
3. Visual Studio Build Tools 2022: «Desktop development with C++» + Windows SDK.
4. Microsoft Edge WebView2 Runtime (normalmente instalado en Windows 11).
5. Conexión a Internet durante la instalación inicial de npm/Cargo y para obtener las herramientas NSIS que Tauri pudiera necesitar.

## Compilar el EXE en Windows

Abrir PowerShell en la carpeta raíz (la que contiene `package.json`):

```powershell
npm install
npm run test
npm run tauri build
```

Se generará el ejecutable de aplicación bajo:

```text
src-tauri/target/release/walltrux_studio.exe
```

El **instalador NSIS** se genera bajo:

```text
src-tauri/target/release/bundle/nsis/
```

Para modo desarrollo:

```powershell
npm install
npm run tauri dev
```

Para abrirlo solo en el navegador durante el desarrollo (sin funcionalidad de diálogos nativos):

```powershell
npm run dev
```

Visita `http://127.0.0.1:1420`.

> Nota de validación: este paquete se ha preparado como código fuente listo para instalar y compilar, pero **no se ha ejecutado `npm install`, los tests ni una compilación Tauri** en el entorno de generación porque no dispone de acceso al registro npm ni de Rust/Cargo. Si una versión futura de dependencia modifica su API, podría necesitar ajuste. No se incluye el `.exe` compilado.

## Funcionalidad implementada

- Modelado de **múltiples polígonos de concreto**, regiones separadas, contacto en vértices y caras, y **huecos**. Cerrar con Enter, doble clic o clic en vértice inicial.
- Detección de **autointersección, degeneración, solape entre regiones de concreto, huecos inválidos y huecos solapados**. La unión geométrica regulariza las caras tangentes con JSTS.
- **Triangulación con verificación de conservación del área**, centroide y límites de sección, con huecos.
- Barras libres (por diámetro), arrastre y eliminación; rechazo de barras fuera del concreto, interceptando huecos/bordes o superpuestas.
- Generadores de armado **perimetral para rectángulos** y **malla ortogonal** para secciones generales (reemplazan el acero previo).
- Edición de vértices, arrastre de barras, zoom con rueda, paneo, encaje a rejilla, control de visualización y deshacer/rehacer.
- Materiales editables: f'c, fy, Es, εcu, estribos/espiral. Norma **ACI 318 simplificada**.
- Cálculo local de puntos `Pn, Mxn, Myn` y `ϕPn, ϕMxn, ϕMyn`; diagramas 3D, dos ramas uniaxiales y contornos axiales.
- Visualización de cargas para comparación visual, sin aprobar automáticamente su capacidad.
- Guardado/carga JSON, autosalvado local del último proyecto, exportación DXF (polilíneas/círculos, unidades cm), SVG y CSV de resultados.

## Método mecánico implementado

La geometría se mantiene en **cm**, las tensiones en **MPa**, fuerzas en **kN** y momentos en **kN·m**. Se adopta **compresión negativa / tracción positiva**:

- `ε = −εcu · (1 − (s − smin)/c)`; `s = x cosθ + y sinθ`.
- Concreto: bloque rectangular equivalente de Whitney **−0.85 f'c** para `s ≤ smin + β1 c`; tensión del concreto nula.
- `β1 = clamp(0.85 − 0.05 (f'c − 28)/7, 0.65, 0.85)` para f'c en MPa (sin reducción por debajo de 28 MPa).
- Acero: `σs = clamp(Es εs, −fy, fy)`; la fuerza discreta es `(σs − σc) As` cuando el acero desplaza concreto comprimido.
- Cada triángulo de concreto se recorta analíticamente por el semiplano comprimido; se integra su área y su primer momento geométrico, en vez de usar muestreo por píxeles.
- Resultantes referidas al centroide bruto de concreto: `N = ΣF`, `Mx = ΣF · (y−yc)`, `My = −ΣF · (x−xc)`.
- `ϕ` para estribos: 0.65 a 0.90, para espiral: 0.75 a 0.90, según `εt` desde `εy = fy/Es` hasta `εy + 0.003`.
- `Pn0 = −[0.85 f'c (Ag−Ast) + fy Ast] · 0.1`. Límite de compresión de diseño aplicado a los puntos: `max(ϕPn, 0.80 ϕc Pn0)` (estribos), o `0.85 ϕc Pn0` (espiral). Como N es **negativo**, el operador `max` limita la compresión.
- Grilla por defecto de **32 orientaciones × 42 profundidades** logarítmicas de eje neutro. En `src/engine/section.ts` están las funciones puras (`solvePoint`, `calculateSurface`).

**Limitaciones importantes:** no incluye pandeo/esbeltez, efectos P-Δ/P-δ, diseño al corte, detallado, armado mínimo/máximo, combinaciones normativas, estados de servicio, fluencia/endurecimiento de acero, leyes constitutivas no lineales, hormigón confinado como material distinto, comprobación analítica demanda/capacidad ni todas las excepciones/transiciones normativas ACI 318. El límite axial se implementa como corte en N del gráfico reducido (no reconstituye la envolvente exacta de una sección de diseño). No debe emplearse como única base para decisiones de seguridad estructural. Antes de ampliar a ingeniería profesional, realizar benchmarking contra casos conocidos y software validado, verificar signos de ejes, convergencia, equilibrio y cláusulas vigentes de la norma aplicable.

## Estructura

```text
src/
  App.tsx                     # UI, estado y acciones de proyecto
  components/SectionCanvas.tsx # Modelado interactivo SVG
  components/InteractionPlots.tsx # Plotly 3D, uniaxial y contornos
  geometry/topology.ts        # JSTS: validación, unión, diferencia, triangulación
  engine/section.ts           # Motor físico, Whitney + acero + factores ϕ
  model/{types,defaults}.ts   # Datos y ejemplo
  utils/files.ts              # JSON, DXF, SVG, CSV y diálogos
src-tauri/
  tauri.conf.json             # ventana y bundle NSIS
  capabilities/default.json  # autorización limitada al sistema de archivos local
  src/{main,lib}.rs           # host Tauri (sin solver Rust)
tests/
  geometry.test.ts            # topología y área
  section.test.ts             # signos, esfuerzos y fuerzas
```

## Desarrollo posterior recomendado

Agregar almacenamiento robusto con undo transaccional, dibujo de círculos/arcos y muros compuestos, escala de unidades real, restricciones de recubrimiento normativas, optimización del cálculo en Web Workers, fórmula compatible con la **edición exacta de ACI 318**, leyes de materiales intercambiables, refinamiento adaptativo de la superficie, curvas cerradas de tensión pura y verificación de cargas mediante algoritmo de intersección/raycast en la superficie 3D, además de una batería exhaustiva de pruebas de regresión.

Código MIT. Dependencias de terceros sujetas a sus propias licencias.
