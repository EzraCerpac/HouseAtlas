# Synthetic surroundings comparison

From the repository root, start the existing Vite development server:

```sh
cd frontend
npm exec -- vite --host 127.0.0.1 --port 4179
```

Open <http://127.0.0.1:4179/lantern-tests/surroundings-review/>.
The page uses generated boxes through the
actual MeshLayer. Before and After preserve the same geometry and camera;
After supplies the current production surroundings band and hour's backdrop.

Choose Day/Night and Phone/Desktop, then turn the View angle slider to inspect
depth ordering. Direct links accept `?hour=night&frame=phone` (also `day` and
`desktop`). Framing is 390 × 640 or 960 × 640 layout pixels; it emulates no
device, performance or household appearance. Owner visual approval and live
house review remain separate. The page adds no ordinary runner selection.
