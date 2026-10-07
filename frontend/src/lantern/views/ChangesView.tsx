import { useStore } from '../state/store';
import { Empty } from '../components/ui';
import { Sources } from '../components/DetailPanel';

export function ChangesView() {
  const { house, dispatch } = useStore();
  return <div className="view"><header className="view-head"><h1>Changes</h1><p>Results appear beside the action that produced them.</p></header>
    <div className="changes-grid"><section className="section"><header className="section-head"><h3>Operation history</h3></header>
      <button type="button" className="btn btn-primary" onClick={() => dispatch({ type: 'nativeOpen', open: true })}>Atlas tools</button>
      <Empty>Operation history is not supplied in this view.</Empty>
    </section><Sources house={house} outage={false} /></div>
  </div>;
}
