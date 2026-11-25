import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useApp } from '../state/store';
import { Shell } from './Shell';
import { Activity } from './screens/Activity';
import { Connect } from './screens/Connect';
import { Home } from './screens/Home';
import { More } from './screens/More';
import { Placeholder } from './screens/Placeholder';
import { LoadingScreen } from './components/LoadingScreen';
import { UpdatePrompt } from './components/UpdatePrompt';

function Routed() {
  const source = useApp((s) => s.source);
  const load = useApp((s) => s.load);
  const error = useApp((s) => s.error);
  const startDemo = useApp((s) => s.startDemo);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('demo') === '1' && !useApp.getState().source) void startDemo();
  }, [startDemo]);

  if (!source) return <Connect />;
  if (load === 'error') return <LoadingScreen error={error} />;
  if (load !== 'ready') return <LoadingScreen />;

  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Home />} />
        <Route path="activity" element={<Activity />} />
        <Route path="insights" element={<Placeholder title="Insights" milestone="M2" />} />
        <Route path="plan" element={<Placeholder title="Plan" milestone="M4" />} />
        <Route path="more" element={<More />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <Routed />
      <UpdatePrompt />
    </BrowserRouter>
  );
}
