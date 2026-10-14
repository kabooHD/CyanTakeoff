import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

// The app (with pdf.js and pdf-lib) loads as its own chunks while this
// small shell is already on screen: the first paint does not wait for them.
const App = lazy(() => import('./App').then((m) => ({ default: m.App })));

function Loading() {
  return (
    <div className="app-loading" role="status" aria-label="Loading">
      <div className="start-card"><h1>CyanTakeoff</h1><p className="muted">Loading…</p></div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<Loading />}><App /></Suspense>
  </StrictMode>,
);
