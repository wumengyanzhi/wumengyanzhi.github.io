import { StrictMode,Suspense,lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { AudioController } from './v2/audio';
const FullGame = lazy(() => import('./v2/ui/game-app'));
const LegacyGame = import.meta.env.DEV ? lazy(() => import('./App').then(module => ({ default: module.App }))) : null;
const LabApp=import.meta.env.DEV ? lazy(()=>import('./lab/ui/lab-app')) : null;
const labMode=import.meta.env.DEV && new URLSearchParams(window.location.search).get('lab')==='1';
const legacyMode = import.meta.env.DEV && new URLSearchParams(window.location.search).get('legacy') === '1';

const container = document.getElementById('root');

if (container === null) {
  throw new Error('未找到 #root 挂载点，index.html 可能被修改。');
}

createRoot(container).render(
  <StrictMode>
    <AudioController />
    <Suspense fallback={<p style={{ color: '#e8dbc0', background: '#201915', padding: '3rem', minHeight: '100vh', margin: 0 }}>正在展开军图…</p>}>
      {labMode && LabApp ? <LabApp /> : legacyMode && LegacyGame ? <LegacyGame /> : <FullGame />}
    </Suspense>
  </StrictMode>,
);
