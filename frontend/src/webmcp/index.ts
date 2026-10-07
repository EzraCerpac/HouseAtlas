export { startWebMcp } from "./adapter.js";
export { detectModelContext } from "./browser.js";
export { mountStockWebMcp } from "./stock.js";
export type * from "./stock.js";
export type * from "./ports.js";
// Import React integration explicitly from ./react.js; pure ports need no React.
