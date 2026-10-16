import { createRoot } from 'react-dom/client';
import '../../src/styles/atlas.css';
import '../../src/styles/session.css';
import '../../src/lantern/styles/fonts.css';
import '../../src/lantern/styles/tokens.css';
import '../../src/lantern/styles/app.css';
import '../../src/lantern/styles/atlas.css';
import '../../src/lantern/styles/panels.css';
import '../../src/lantern/styles/integration.css';
import '../../src/lantern/styles/topology.css';

// The integration's shell nesting with synthetic content. `?sign-out` adds the
// in-flow sign-out choice after the inert app, as the session screen does.
const signOut = new URLSearchParams(window.location.search).has('sign-out');

function ShellViewportCheck() {
  return (
    <div className="lantern-integration">
      <div inert={signOut}>
        <div className="lantern-host app">
          <header className="topbar"><strong>Synthetic home</strong></header>
          <nav className="navrail" aria-label="Sections">
            {['Rooms', 'Scans', 'Documents'].map(label => <button key={label} type="button">{label}</button>)}
          </nav>
          <div className="shell-tools"><button type="button">Search</button></div>
          <main id="main" className="main" tabIndex={-1}>
            <h1>Synthetic sheet</h1>
            {Array.from({ length: 80 }, (_, index) => <p key={index}>Synthetic row {index + 1}</p>)}
          </main>
        </div>
      </div>
      {signOut && <section className="access-panel" role="dialog" aria-modal="true" aria-labelledby="sign-out-heading">
        <h2 id="sign-out-heading">Sign out</h2>
        <p>Synthetic sign-out choice.</p>
      </section>}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<ShellViewportCheck />);
