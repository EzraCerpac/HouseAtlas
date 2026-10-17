import { createRoot } from 'react-dom/client';
import { SavedAtlasHost } from '../src/offline/SavedAtlasHost';
const element = document.getElementById('root');
if (!element) throw new Error('Saved Atlas root missing');
createRoot(element).render(<SavedAtlasHost />);
