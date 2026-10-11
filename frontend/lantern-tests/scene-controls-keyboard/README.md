# Scene overlay keyboard check

Run the static accessibility state check from the repository root:

```sh
node frontend/lantern-tests/scene-controls-keyboard.test.mjs
```

It renders every overlay selection and verifies one pressed button, two
unpressed buttons, ordinary named button-group semantics, and the selected
overlay's existing visual state.

Run the isolated real-browser keyboard and pointer check with the repository's
pinned Node and inspected Chrome:

```sh
HOUSEATLAS_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
node frontend/lantern-tests/scene-controls-keyboard-browser.mjs
```

It uses a fresh temporary browser profile, synthetic component inputs and a
loopback-only static fixture server, then closes its owned browser and listener.
If the sandbox denies the loopback bind, rerun only this inspected fixture with
the explicit local-test approval route.

The test page at `/lantern-tests/scene-controls-keyboard/` remains available for
manual inspection through the frontend Vite server.

With the pointer untouched, press Tab until an overlay button receives focus.
Press Space or Enter on each overlay in turn. The activated native button must
keep focus and expose `aria-pressed="true"`; the other two must expose
`aria-pressed="false"`. Tab and Shift+Tab move between overlay buttons, and
clicking a different overlay updates the pressed state without changing its
pointer behavior. The overlay container is a named group, not a radio group, so
all three ordinary buttons are in the normal tab order.
