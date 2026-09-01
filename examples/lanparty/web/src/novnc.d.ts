// @novnc/novnc ships no types. Its package.json `exports` only maps the root
// specifier (to ./core/rfb.js), so the root import is the one that resolves
// under Vite / Node; the subpath is declared too for completeness.
declare module "@novnc/novnc/core/rfb.js" {
  const RFB: any;
  export default RFB;
}

declare module "@novnc/novnc" {
  const RFB: any;
  export default RFB;
}
