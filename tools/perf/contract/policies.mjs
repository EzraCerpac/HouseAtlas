// Trusted labels, units and direction. Run artifacts never supply report policy.
// No new deterministic budgets are configured by this initial measurement contract.
export const policies = Object.freeze([
  {
    "id": "frontend.scan.parse_ms",
    "label": "Synthetic scan profile parsing",
    "unit": "ms",
    "kind": "timing",
    "direction": "lower"
  },
  {
    "id": "frontend.scan.prepare_ms",
    "label": "Synthetic scan display preparation",
    "unit": "ms",
    "kind": "timing",
    "direction": "lower"
  },
  {
    "id": "frontend.scan.edges_ms",
    "label": "Synthetic scan display edges",
    "unit": "ms",
    "kind": "timing",
    "direction": "lower"
  },
  {
    "id": "frontend.scan.prepared_bytes",
    "label": "Synthetic scan prepared vertices",
    "unit": "bytes",
    "kind": "deterministic",
    "direction": "lower"
  },
  {
    "id": "frontend.standard_glb.load_ms",
    "label": "Standard GLB CPU load and disposal",
    "unit": "ms",
    "kind": "timing",
    "direction": "lower"
  },
  {
    "id": "frontend.standard_glb.prepared_bytes",
    "label": "Standard GLB prepared vertices",
    "unit": "bytes",
    "kind": "deterministic",
    "direction": "lower"
  },
  {
    "id": "frontend.navigation.index_ms",
    "label": "Synthetic navigation index",
    "unit": "ms",
    "kind": "timing",
    "direction": "lower"
  },
  {
    "id": "frontend.mesh.pick_ms",
    "label": "Synthetic mesh CPU picking",
    "unit": "ms",
    "kind": "timing",
    "direction": "lower"
  },
  {
    "id": "frontend.navigator.ssr_ms",
    "label": "Synthetic navigator static React render",
    "unit": "ms",
    "kind": "timing",
    "direction": "lower"
  },
  {
    "id": "frontend.startup_js.bytes",
    "label": "Entry and HTML modulepreload JavaScript",
    "unit": "bytes",
    "kind": "deterministic",
    "direction": "lower"
  },
  {
    "id": "frontend.startup_js.gzip_bytes",
    "label": "Offline gzip of startup JavaScript",
    "unit": "bytes",
    "kind": "deterministic",
    "direction": "lower"
  },
  {
    "id": "frontend.bundle.largest_asset_bytes",
    "label": "Largest emitted frontend asset",
    "unit": "bytes",
    "kind": "deterministic",
    "direction": "lower"
  },
  {
    "id": "browser.first_mesh_draw_ms",
    "label": "First actual browser mesh draw",
    "unit": "ms",
    "kind": "timing",
    "direction": "lower"
  },
  {
    "id": "browser.selection_commit_ms",
    "label": "Browser selection commit",
    "unit": "ms",
    "kind": "timing",
    "direction": "lower"
  },
  {
    "id": "browser.transition_frame_ms",
    "label": "Browser transition frame duration",
    "unit": "ms",
    "kind": "timing",
    "direction": "lower"
  },
  {
    "id": "browser.draw_calls",
    "label": "Actual browser draw calls",
    "unit": "calls",
    "kind": "deterministic",
    "direction": "lower"
  },
  {
    "id": "browser.live_gpu_bytes",
    "label": "Actual live GPU resource bytes",
    "unit": "bytes",
    "kind": "deterministic",
    "direction": "lower"
  }
].map(policy => Object.freeze(policy)));
