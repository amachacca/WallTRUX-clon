declare module 'jsts/org/locationtech/jts/io/GeoJSONReader.js' {
  const GeoJSONReader: new () => { read: (geometry: unknown) => any };
  export default GeoJSONReader;
}
declare module 'jsts/org/locationtech/jts/operation/valid/IsValidOp.js' {
  const IsValidOp: new (geometry: any) => { isValid: () => boolean; getValidationError: () => { toString(): string } | null };
  export default IsValidOp;
}
declare module 'jsts/org/locationtech/jts/operation/overlay/OverlayOp.js' {
  const OverlayOp: { union(a: any, b: any): any; intersection(a: any, b: any): any; difference(a: any, b: any): any };
  export default OverlayOp;
}
declare module 'plotly.js-dist-min' {
  const Plotly: {
    react: (node: HTMLElement, data: any[], layout: Record<string, unknown>, config?: Record<string, unknown>) => Promise<unknown>;
    purge: (node: HTMLElement) => void;
    Plots: { resize: (node: HTMLElement) => void };
  };
  export default Plotly;
}
