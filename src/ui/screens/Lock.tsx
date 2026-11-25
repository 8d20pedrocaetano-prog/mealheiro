import { Delete } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useApp } from '../../state/store';
import { getConnection } from '../../sync/storage';

/** PIN lock (SPEC §4.9): required on open and after 5 min in the background. */
export function Lock() {
  const unlock = useApp((s) => s.unlock);
  const forgetDevice = useApp((s) => s.forgetDevice);
  const source = useApp((s) => s.source);
  const [pin, setPin] = useState('');
  const [len, setLen] = useState(4);
  const [wrong, setWrong] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmForget, setConfirmForget] = useState(false);

  useEffect(() => {
    void getConnection().then((c) => c?.pinLength && setLen(c.pinLength));
  }, []);

  async function tryUnlock(p: string) {
    setBusy(true);
    const ok = await unlock(p);
    setBusy(false);
    if (!ok) {
      setWrong(true);
      setPin('');
    }
  }

  function press(d: string) {
    if (busy) return;
    setWrong(false);
    const next = (pin + d).slice(0, 6);
    setPin(next);
    if (next.length === len) void tryUnlock(next);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="mx-auto flex min-h-full max-w-xs flex-col items-center justify-center gap-6 p-6">
      <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" className="size-14 rounded-2xl" />
      <div className="text-center">
        <h1 className="text-xl font-semibold">Enter your PIN</h1>
        {source?.kind === 'github' && (
          <p className="text-sm text-ink-3">
            {source.owner}/{source.repo}
          </p>
        )}
      </div>
      <div className="flex gap-3" aria-label={`${pin.length} of ${len} digits`}>
        {Array.from({ length: len }, (_, i) => (
          <span
            key={i}
            className={`size-3.5 rounded-full border-2 ${i < pin.length ? 'border-accent bg-accent' : 'border-ink-3'}`}
          />
        ))}
      </div>
      <p className={`h-5 text-sm ${wrong ? 'text-bad' : 'text-ink-3'}`} role="status">
        {wrong ? 'Wrong PIN, try again.' : busy ? 'Unlocking…' : ''}
      </p>
      <div className="grid grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button
            key={d}
            onClick={() => press(d)}
            className="num size-18 rounded-full bg-surface text-2xl font-medium shadow-sm active:bg-surface-2"
          >
            {d}
          </button>
        ))}
        <span />
        <button
          onClick={() => press('0')}
          className="num size-18 rounded-full bg-surface text-2xl font-medium shadow-sm active:bg-surface-2"
        >
          0
        </button>
        <button
          onClick={() => setPin((p) => p.slice(0, -1))}
          aria-label="Delete digit"
          className="flex size-18 items-center justify-center rounded-full text-ink-2"
        >
          <Delete size={24} />
        </button>
      </div>
      {confirmForget ? (
        <div className="flex flex-col items-center gap-2 text-center text-sm">
          <p className="text-ink-2">
            This wipes the app's data and token on this device. Your data repo is untouched; you'll connect
            again with your token.
          </p>
          <div className="flex gap-2">
            <button
              className="h-10 rounded-xl border border-line px-3"
              onClick={() => setConfirmForget(false)}
            >
              Cancel
            </button>
            <button className="h-10 rounded-xl bg-bad px-3 text-white" onClick={() => void forgetDevice()}>
              Wipe this device
            </button>
          </div>
        </div>
      ) : (
        <button className="text-sm text-ink-3 underline" onClick={() => setConfirmForget(true)}>
          Forgot PIN?
        </button>
      )}
    </div>
  );
}
