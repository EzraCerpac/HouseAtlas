# Scene overlay keyboard check

Run the static accessibility state check from the repository root:

```sh
node frontend/lantern-tests/scene-controls-keyboard.test.mjs
```

It renders every overlay selection and verifies one pressed button, two
unpressed buttons, and ordinary named button-group semantics.

For keyboard and pointer interaction, start the frontend Vite server from `frontend/`, then open
`/lantern-tests/scene-controls-keyboard/` in a browser.

With the pointer untouched, press Tab until an overlay button receives focus.
Press Space or Enter on each overlay in turn. The activated native button must
keep focus and expose `aria-pressed="true"`; the other two must expose
`aria-pressed="false"`. Tab and Shift+Tab move between overlay buttons, and
clicking a different overlay updates the pressed state without changing its
pointer behavior. The overlay container is a named group, not a radio group, so
all three ordinary buttons are in the normal tab order.
