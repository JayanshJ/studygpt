// Ambient declaration for the `cytoscape-fcose` layout extension, which ships
// no type declarations of its own. It is a standard Cytoscape extension:
// imported for its side-effect registration via `cytoscape.use(fcose)`, after
// which `name: "fcose"` is a valid layout option. Typed loosely against
// cytoscape's `Ext` to satisfy `cytoscape.use(...)` without a hard runtime type
// dependency.
import type cytoscape from "cytoscape";

declare module "cytoscape-fcose" {
  const ext: cytoscape.Ext;
  export default ext;
}