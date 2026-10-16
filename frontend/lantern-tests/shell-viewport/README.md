# Shell viewport fixture

This passive fixture uses the integration's shell nesting, actual stylesheets
and synthetic content. It includes enough rows to scroll the inner sheet.
The `?sign-out` variant adds the in-flow choice after an inert shell.

Review it through the project's existing fixture server with supported browser
controls when available. Check that the shell fits the viewport, the sheet
scrolls internally, and dragging past the sheet or on the bars leaves the
document still. The sign-out choice must remain reachable inside the viewport
container. Include a notched phone, a desktop window, large text and keyboard
navigation in manual acceptance.

No browser runner is included or registered for this fixture. Source inspection
and emulation do not establish installed-PWA or physical-iPhone acceptance.
