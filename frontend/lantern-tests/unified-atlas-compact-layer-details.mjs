// Proposed generated source check; source owner registers the exact body and
// command before execution. Actual dock + explicit synchronous React hook seam,
// synthetic elements only. No DOM/browser/native modal, layout or GPU claims.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformWithOxc } from 'vite';

assert.equal(process.version, 'v26.10.0');
assert.deepEqual(process.argv.slice(2), [], 'This runner takes no arguments');
const dataURL = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const reactURL = new URL('../node_modules/react/index.js', import.meta.url).href;
const jsxURL = new URL('../node_modules/react/jsx-runtime.js', import.meta.url).href;
const { createElement } = await import(reactURL);
const { renderToStaticMarkup } = await import(new URL('../node_modules/react-dom/server.node.js', import.meta.url).href);
const symbol = Symbol.for('houseatlas.compact-layer-details.synthetic-hooks');
let refs = [], effects = [];
const dockHooks = { refs, effects };
let refAt = 0, effectAt = 0, pending = [], mediaSubscription;
function begin(hooks) {
  refs = hooks.refs; effects = hooks.effects; refAt = 0; effectAt = 0; pending = [];
}
globalThis[symbol] = {
  useRef(value) { return refs[refAt++] ?? (refs[refAt - 1] = { current: value }); },
  useLayoutEffect(effect, deps) {
    const index = effectAt++;
    const effectStore = effects, previous = effectStore[index];
    if (!previous || deps.some((dep, at) => dep !== previous.deps[at])) {
      pending.push(() => { previous?.cleanup?.(); effectStore[index] = { deps, cleanup: effect() }; });
    }
  },
  useSyncExternalStore(subscribe, current) { mediaSubscription = subscribe; return current(); },
};
const hooksURL = dataURL(`const hooks=globalThis[Symbol.for('houseatlas.compact-layer-details.synthetic-hooks')];
export const {useRef,useLayoutEffect,useSyncExternalStore}=hooks;`);
const file = new URL('../src/lantern/unified-atlas/LayerDetailsDock.tsx', import.meta.url);
let { code } = await transformWithOxc(readFileSync(file, 'utf8'), file.pathname,
  { lang: 'tsx', jsx: { runtime: 'automatic' }, target: 'esnext', tsconfig: false, sourcemap: false });
for (const [name, replacement] of [['react', hooksURL], ['react/jsx-runtime', jsxURL]]) {
  assert(code.includes(JSON.stringify(name)));
  code = code.replaceAll(JSON.stringify(name), JSON.stringify(replacement));
}
const { LayerDetailsDock, useLayerDetailsFocus, useShortLayerDetails } = await import(dataURL(code));
// Compile the actual shell handlers with observable local actions. The modal's
// capture/bubble sequence must leave the map, menu and graph actions untouched.
const atlas = readFileSync(new URL('../src/lantern/unified-atlas/UnifiedAtlas.tsx', import.meta.url), 'utf8');
const handlersStart = atlas.indexOf('  const graphEscape =');
const handlersEnd = atlas.indexOf('  const pickLabel =', handlersStart);
assert(handlersStart >= 0 && handlersEnd > handlersStart);
const { code: handlerCode } = await transformWithOxc(`export function shellHandlers(actions) {
  const menu = 'view', showGraph = true;
  const menuButton = { current: { focus: () => actions.menu++ } }, pickButton = menuButton;
  const setMenu = () => actions.menu++, closeGraph = () => actions.graph++, out = () => actions.out++;
  ${atlas.slice(handlersStart, handlersEnd)}
  return { graphEscape, escape };
}`, 'generated-layer-details-shell.ts', { lang: 'ts', target: 'esnext', tsconfig: false, sourcemap: false });
const { shellHandlers } = await import(dataURL(handlerCode));
const globals = Object.fromEntries(['document', 'window', 'HTMLElement', 'getComputedStyle'].map(name => [name,
  Object.getOwnPropertyDescriptor(globalThis, name)]));
let height = 320, mediaListener = null;
class Element {
  constructor(name) { this.name = name; this.visible = true; this.inert = false; this.isConnected = true; this.reveals = 0; }
  focus(options) { assert.deepEqual(options, { preventScroll: true }); document.activeElement = this; }
  getClientRects() { return this.visible && (!(this === key || this === closeButton) || dialog.open) ? [{}] : []; }
  closest(selector) {
    if (selector === '.ua-layer-dialog[aria-modal="true"]') return dialog.modal && dialog.contains(this) ? dialog : null;
    return selector.includes('[inert]') && this.inert ? this : null;
  }
  matches(selector) { assert.equal(selector, ':disabled'); return false; }
  scrollIntoView(options) {
    assert.deepEqual(options, { block: 'nearest', inline: 'nearest' }); this.offscreen = false; this.reveals++;
  }
}
const trigger = new Element('details trigger'), key = new Element('Network key'), closeButton = new Element('Close');
const calls = [];
class Dialog extends Element {
  open = true;
  modal = false;
  style = { values: new Map(), setProperty(name, value) { this.values.set(name, value); }, removeProperty(name) { this.values.delete(name); } };
  contains(element) { return element === key || element === closeButton; }
  matches(selector) { assert.equal(selector, ':modal'); return this.modal; }
  getClientRects() { return this.open ? [{}] : []; }
  close() {
    this.open = false; this.modal = false; calls.push('close');
    if (this.contains(document.activeElement)) document.activeElement = document.body;
  }
  showModal() {
    assert.equal(this.open, false); this.open = true; this.modal = true; calls.push('showModal'); document.activeElement = closeButton;
  }
  setAttribute(name, value) { assert.equal(name, 'open'); assert.equal(value, ''); this.open = true; }
  querySelector(selector) {
    assert(['.ua-key-head', '.ua-layer-details-close'].includes(selector));
    return selector === '.ua-key-head' ? key : closeButton;
  }
}
const dialog = new Dialog('dock'), dockRef = { current: dialog }, triggerRef = { current: trigger };
let closeRequests = 0;
const children = ['Electrical', 'Network', 'Measurements'].map(label => createElement('section', { key: label },
  createElement('button', { type: 'button', 'aria-expanded': true }, label),
  createElement('p', null, `${label}: Generated long source qualification. `.repeat(80))));
function render(short, expanded, hooks = dockHooks) {
  begin(hooks);
  const element = LayerDetailsDock({ dock: dockRef, trigger: triggerRef, id: 'generated-details',
    short, expanded, close: () => closeRequests++, children });
  const [header, body] = element.props.children;
  header.props.children[1].props.ref.current = closeButton;
  assert.equal(body.props.children, children, 'The same key children stay in the same body across responsive modes');
  for (const effect of pending) effect();
  return element;
}
const event = (pressed = 'Escape') => ({ key: pressed, target: key, nativeEvent: { isComposing: false }, prevented: false, stopped: false,
  get defaultPrevented() { return this.prevented; },
  preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } });
try {
  globalThis.HTMLElement = Element;
  globalThis.document = { activeElement: trigger, body: new Element('body') };
  globalThis.getComputedStyle = element => ({ visibility: element.visible ? 'visible' : 'hidden' });
  const resizeListeners = new Set();
  globalThis.window = { innerHeight: 320,
    addEventListener(type, listener) { assert.equal(type, 'resize'); resizeListeners.add(listener); },
    removeEventListener(type, listener) { assert.equal(type, 'resize'); resizeListeners.delete(listener); },
    matchMedia(query) {
    assert.equal(query, '(max-height: 480px)');
    return { matches: height <= 480,
      addEventListener(type, listener) { assert.equal(type, 'change'); mediaListener = listener; },
      removeEventListener(type, listener) { assert.equal(type, 'change'); assert.equal(listener, mediaListener); mediaListener = null; } };
  } };
  for (const [nextHeight, compact, expected] of [[320, true, true], [240, true, true],
    [844, true, false], [720, false, false], [320, false, false]]) {
    height = nextHeight;
    assert.equal(useShortLayerDetails(compact), expected);
  }
  let changes = 0;
  const unsubscribe = mediaSubscription(() => changes++);
  mediaListener(); assert.equal(changes, 1); unsubscribe(); assert.equal(mediaListener, null);

  const wide = render(false, false);
  assert.equal(wide.props.role, 'group'); assert.equal(wide.props['aria-modal'], undefined);
  assert.equal(dialog.open, true); assert.equal(dialog.modal, false);
  render(true, false);
  assert.equal(dialog.open, false); assert.equal(dialog.modal, false);
  const opened = render(true, true);
  assert.equal(dialog.modal, true); assert.equal(document.activeElement, closeButton);
  assert.equal(opened.props['aria-modal'], true);
  assert.equal(opened.props['aria-labelledby'], 'generated-details-title');
  assert(!opened.props.className.includes('is-unfolded'), 'Opening the modal does not enlarge the map control strip');
  const html = renderToStaticMarkup(opened);
  assert.match(html, /<dialog\b/); assert.match(html, /<h2 id="generated-details-title">Layer details<\/h2>/);
  assert.match(html, /aria-label="Close Layer details"/);
  for (const label of ['Electrical', 'Network', 'Measurements']) assert(html.includes(`${label}: Generated long source qualification.`));
  const escape = event(); opened.props.onKeyDown(escape);
  assert.equal(closeRequests, 1); assert(escape.prevented && escape.stopped);
  render(true, false);
  assert.equal(dialog.modal, false); assert.equal(dialog.open, false); assert.equal(document.activeElement, trigger);

  const reopened = render(true, true);
  const ordinaryKey = event('ArrowDown'); reopened.props.onKeyDown(ordinaryKey);
  assert.equal(closeRequests, 1); assert.equal(ordinaryKey.prevented, false);
  const actions = { out: 0, menu: 0, graph: 0 }, handlers = shellHandlers(actions);
  const composing = event(); composing.nativeEvent.isComposing = true;
  handlers.graphEscape(composing);
  reopened.props.onKeyDown(composing);
  if (!composing.stopped) handlers.escape(composing);
  assert.equal(closeRequests, 1); assert.equal(dialog.modal, true);
  assert.equal(composing.stopped, true, 'Composing Escape stays inside the modal');
  assert.equal(composing.prevented, false, 'Composition keeps its native default behavior');
  assert.deepEqual(actions, { out: 0, menu: 0, graph: 0 });
  // Shell defense also covers an Escape that reaches it without the child handler.
  const composingAtShell = event(); composingAtShell.nativeEvent.isComposing = true;
  handlers.escape(composingAtShell);
  handlers.escape(event());
  assert.deepEqual(actions, { out: 0, menu: 0, graph: 0 });
  const cancel = event(); reopened.props.onCancel(cancel);
  assert.equal(closeRequests, 2); assert(cancel.prevented && cancel.stopped);
  render(true, false); assert.equal(document.activeElement, trigger);

  render(true, true); document.activeElement = key;
  trigger.visible = false;
  const resized = render(false, true);
  assert.equal(dialog.modal, false); assert.equal(dialog.open, true); assert.equal(document.activeElement, key);
  assert.equal(resized.props.role, 'group'); assert.equal(resized.props['aria-modal'], undefined);
  // Tall compact to short compact with the drawer already open: the held key
  // was below long content in the dock's scroll; the new body reveals it.
  const heldReveals = key.reveals; key.offscreen = true;
  render(true, true); assert.equal(dialog.modal, true); assert.equal(document.activeElement, key);
  assert.equal(key.offscreen, false); assert.equal(key.reveals, heldReveals + 1);
  document.activeElement = closeButton;
  render(false, true); assert.equal(dialog.modal, false); assert.equal(document.activeElement, key);
  trigger.visible = true;
  render(true, true);
  const before = closeRequests;
  refs[0].current = closeButton;
  const close = render(true, true).props.children[0].props.children[1];
  close.props.onClick(); assert.equal(closeRequests, before + 1);
  render(true, false); assert.equal(document.activeElement, trigger);
  render(true, true);
  for (const effect of effects) effect.cleanup?.();
  assert.equal(dialog.modal, false); assert.equal(dialog.open, false);
  assert(calls.includes('showModal'));

  // Actual parent coordinator + child dock effects, in React's child-first
  // commit order. Start from the normal desktop drawer=null (and floors) case,
  // not an already-expanded helper. The fake document drops focus on close;
  // the stage's tracked origin must survive until the next commit opens layers.
  for (const initialDrawer of [null, 'floors']) {
    const parentHooks = { refs: [], effects: [] }, childHooks = { refs: [], effects: [] };
    const focusOrigin = { current: key };
    let drawer = initialDrawer;
    const setDrawer = next => { drawer = typeof next === 'function' ? next(drawer) : next; };
    function coordinatedCommit(compact) {
      const renderedDrawer = drawer;
      begin(parentHooks);
      useLayerDetailsFocus({ compact, drawer: renderedDrawer, dock: dockRef, trigger: triggerRef, focusOrigin, setDrawer });
      const parentEffects = pending;
      const child = render(compact, renderedDrawer === 'layers', childHooks);
      for (const effect of parentEffects) effect();
      return child;
    }
    dialog.open = true; dialog.modal = false; document.activeElement = key;
    const sameKey = key, sameChildren = children;
    const desktop = coordinatedCommit(false);
    assert.equal(drawer, initialDrawer); assert.equal(document.activeElement, sameKey);
    const reveals = key.reveals;
    key.offscreen = true;
    coordinatedCommit(true);
    assert.equal(drawer, 'layers', 'Parent queues the original key and requests the compact drawer');
    assert.equal(dialog.open, false); assert.equal(document.activeElement, document.body);
    const compact = coordinatedCommit(true);
    assert.equal(dialog.modal, true);
    assert.equal(document.activeElement, sameKey, 'Queued key replaces the helper\'s temporary Close focus');
    assert.equal(key.offscreen, false); assert.equal(key.reveals, reveals + 1);
    assert.equal(desktop.props.children[1].props.children, sameChildren);
    assert.equal(compact.props.children[1].props.children, sameChildren);
    for (const effect of childHooks.effects) effect.cleanup?.();
    for (const effect of parentHooks.effects) effect.cleanup?.();
    assert.equal(dialog.modal, false);
  }
  assert.match(atlas, /const laidOut = .*?!node\.matches\(':modal'\)/);
  assert.match(atlas, /const graphEscape =[\s\S]*?closest\('\.ua-layer-dialog\[aria-modal="true"\]'\)\) return;/);
  const css = readFileSync(new URL('../src/lantern/unified-atlas/unified-atlas.css', import.meta.url), 'utf8');
  assert.match(css, /\.ua-layer-dialog:modal \.ua-key-head \{ min-height: 44px; \}/);
  assert.match(css, /\.ua-layer-dialog:modal \.ua-key-body \{ overflow: visible; \}/);
  assert.match(css, /\.ua-layer-dialog:modal \.ua-layer-details-body \{[^}]*overflow-y: auto;/);
  assert.match(css, /max-height: calc\(100dvh - 24px - env\(safe-area-inset-top/);
  // Short landscape (568×320): the shell's bottom nav slims to one row and the
  // closed sheet head is one line, never cut off at the stage's foot. The
  // one-line head must follow the phone head rules it overrides.
  const shell = readFileSync(new URL('../src/lantern/styles/app.css', import.meta.url), 'utf8');
  assert.match(shell, /grid-template-rows: var\(--topbar\) minmax\(0, 1fr\) calc\(var\(--nav-row\) \+ env\(safe-area-inset-bottom\)\);/);
  assert.match(shell.slice(shell.indexOf('@media (max-width: 759px) and (max-height: 480px)')), /^@media[^{]*\{\s*\.lantern-host\.app,\s*\.lantern-host\.app\.has-detail \{\s*--nav-row: 44px;/);
  assert.match(css, /\.ua-inspector:not\(\.is-open\) \{\s*max-height: min\(100%, max\([^;]*calc\(var\(--ua-peek\) \+ 1px\)\)\);/);
  const phoneHead = css.indexOf('.lantern-host .ua-sheet-head { position: relative; padding: 13px 10px 7px 16px; }');
  const oneLine = css.indexOf('.lantern-host .ua-sheet-title > p { grid-area: 1 / 2; }');
  assert(phoneHead >= 0 && oneLine > css.indexOf('.lantern-host .ua-inspector.is-room h2 {', phoneHead), 'one-line head follows the phone head rules');
  console.log('PASS: compact layer-details generated hook/element transitions, markup and source constraints.');
  console.log('Native inertness, Tab containment, actual DOM state, pixels/hit targets and camera/selection preservation require the sole GUI lane.');
} finally {
  delete globalThis[symbol];
  for (const [name, descriptor] of Object.entries(globals)) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
  }
}
