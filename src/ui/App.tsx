import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useApp } from '../state/store';
import { Shell } from './Shell';
import { Activity } from './screens/Activity';
import { Connect } from './screens/Connect';
import { Home } from './screens/Home';
import { Review } from './screens/Review';
import { AccountsSettings, CategoriesSettings, RulesSettings } from './screens/Settings';
import { ImportHistory } from './screens/ImportHistory';
import { Insights } from './screens/Insights';
import { Lock } from './screens/Lock';
import { More } from './screens/More';
import { Placeholder } from './screens/Placeholder';
import { LoadingScreen } from './components/LoadingScreen';
import { UpdatePrompt } from './components/UpdatePrompt';

const LOCK_AFTER_MS = 5 * 60 * 1000;
const SYNC_EVERY_MS = 10 * 60 * 1000;

/** Lock after 5 min in the background; sync on return and every 10 min while visible. */
function useLifecycle() {
  useEffect(() => {
    let hiddenAt = 0;
    const onVis = () => {
      const s = useApp.getState();
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        void s.flush();
      } else {
        if (hiddenAt && Date.now() - hiddenAt > LOCK_AFTER_MS) s.lock();
        else if (s.phase === 'ready') void s.syncNow();
        hiddenAt = 0;
      }
    };
    const onOnline = () => {
      const s = useApp.getState();
      if (s.phase === 'ready') void s.syncNow();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', onOnline);
    const timer = setInterval(() => {
      const s = useApp.getState();
      if (document.visibilityState === 'visible' && s.phase === 'ready') void s.syncNow();
    }, SYNC_EVERY_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', onOnline);
      clearInterval(timer);
    };
  }, []);
}

function Routed() {
  const phase = useApp((s) => s.phase);
  const error = useApp((s) => s.error);
  const boot = useApp((s) => s.boot);
  useLifecycle();

  useEffect(() => {
    void boot();
  }, [boot]);

  if (phase === 'boot' || phase === 'loading') return <LoadingScreen />;
  if (phase === 'connect') return <Connect />;
  if (phase === 'locked') return <Lock />;
  if (phase === 'error') return <LoadingScreen error={error} />;

  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Home />} />
        <Route path="activity" element={<Activity />} />
        <Route path="insights" element={<Insights />} />
        <Route path="plan" element={<Placeholder title="Plan" milestone="M4" />} />
        <Route path="more" element={<More />} />
        <Route path="more/import" element={<ImportHistory />} />
        <Route path="more/review" element={<Review />} />
        <Route path="more/accounts" element={<AccountsSettings />} />
        <Route path="more/categories" element={<CategoriesSettings />} />
        <Route path="more/rules" element={<RulesSettings />} />
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
