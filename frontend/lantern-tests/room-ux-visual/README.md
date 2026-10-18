# Fictional room UX fixture

This mounts the actual App, DetailPanel, SearchPalette and read-only providers
with the original fictional Alder house. It reuses the documented
`readme-house-visual` StoreProvider house override. It is presentation evidence,
not a HomeBox projection, current source binding, native admission or write path.
No session or transport client is supplied; application fetches return 404.
Geometry metadata and native operation history are explicitly unavailable;
there is no pending reader behind either state.
The original fictional records, counts, notes, claims and dates are unchanged.

Inspect `main.tsx`, the original `readme-house-visual/house.ts`, the StoreProvider,
App/provider imports and the normal Vite plugins before execution. On the pinned
Node 26.10.0 and existing locked dependencies, from `frontend`:

```sh
./node_modules/.bin/tsc --project lantern-tests/room-ux-visual/tsconfig.json
```

The normal frontend tsconfig excludes manual fixture entrypoints; its success
alone does not typecheck this file. The fixture config inherits all production
compiler options and adds its entrypoint and the existing asset declarations.
This focused command compiles source only with the local TypeScript executable.

For separately reserved generated desktop/mobile review, use the existing manual
Vite command from the complete verification guide on an unused owned loopback
port and stop the process within twenty minutes:

```sh
./node_modules/.bin/vite --config vite.config.ts --host 127.0.0.1 --port 4310 --strictPort
```

Open `/lantern-tests/room-ux-visual/`. The default room is Workshop; `?room=` may
select only an existing fictional space ID, such as `sp-landing`, `sp-hall` or
`sp-terrace`. Other values fall back to Workshop. Ordinary room links and Search
remain the production controls. Landing includes documents, upkeep and an empty
container; Entrance hall retains an empty container beside recorded belongings.
Check the exact supplied data rather than assume every room is empty or filled.
Capture settled desktop, 390px and 320px views, selection links, normal detail
Close/focus return and Search pointer/keyboard behavior. Retain captures outside
Git and preserve unrelated browser tabs and stores.

The source-host fixture separately exercises actual Host composition and retained
archive Search. The generated Saved fixture separately exercises native-shaped
historical room records and layer qualification. None of these surfaces supplies
native acquisition, household authority, process-cold or device-offline evidence.
