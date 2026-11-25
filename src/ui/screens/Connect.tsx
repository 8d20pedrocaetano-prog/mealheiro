import { useState } from 'react';
import { testConnection, useApp } from '../../state/store';
import { isValidPin } from '../../sync/crypto';

type Tested = { ok: true; name: string } | { ok: false; error: string } | null;

const field =
  'h-12 w-full rounded-xl border border-line bg-surface px-3 text-[16px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/25';

/** Connect screen (SPEC §4.9, ARCHITECTURE §2): owner, repo, branch, token → test → PIN. */
export function Connect() {
  const startDemo = useApp((s) => s.startDemo);
  const connect = useApp((s) => s.connect);
  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('mealheiro-data');
  const [branch, setBranch] = useState('main');
  const [token, setToken] = useState('');
  const [tested, setTested] = useState<Tested>(null);
  const [testing, setTesting] = useState(false);
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ref = { owner: owner.trim(), repo: repo.trim(), branch: branch.trim() || 'main' };
  const canTest = ref.owner && ref.repo && token.trim();

  async function onTest() {
    setTesting(true);
    setTested(null);
    try {
      const r = await testConnection(ref, token.trim());
      if (!r.private) {
        setTested({
          ok: false,
          error: `${r.full_name} is public. Your financial data must live in a private repo.`,
        });
      } else if (r.permissions && r.permissions.push === false) {
        setTested({
          ok: false,
          error: 'The token can read but not write. Give it Contents: Read and write.',
        });
      } else {
        setTested({ ok: true, name: r.full_name });
      }
    } catch (e) {
      setTested({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  }

  async function onConnect(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isValidPin(pin)) return setError('Choose a PIN of 4 to 6 digits.');
    if (pin !== pin2) return setError("The two PINs don't match.");
    setBusy(true);
    try {
      await connect(ref, token.trim(), pin);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col gap-6 p-6 pt-10">
      <div className="flex items-center gap-3">
        <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" className="size-14 rounded-2xl" />
        <div>
          <h1 className="text-2xl font-semibold">Mealheiro</h1>
          <p className="text-ink-2">Your spending and savings, from your own files.</p>
        </div>
      </div>

      <form
        className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4"
        onSubmit={onConnect}
      >
        <h2 className="font-medium">Connect your data repo</h2>
        <label className="flex flex-col gap-1 text-sm">
          GitHub owner
          <input
            className={field}
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
          />
        </label>
        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Data repo
            <input
              className={field}
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              autoCapitalize="none"
              spellCheck={false}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Branch
            <input
              className={field}
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              autoCapitalize="none"
              spellCheck={false}
            />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          Fine-grained token
          <input
            className={field}
            type="password"
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              setTested(null);
            }}
            autoComplete="off"
            spellCheck={false}
            required
          />
          <span className="text-xs text-ink-3">
            Only the data repo, Contents: Read and write. It is stored encrypted with your PIN.
          </span>
        </label>
        <button
          type="button"
          disabled={!canTest || testing}
          onClick={() => void onTest()}
          className="h-11 rounded-xl border border-line font-medium disabled:opacity-50"
        >
          {testing ? 'Testing…' : 'Test connection'}
        </button>
        {tested && (
          <p role="status" className={`text-sm ${tested.ok ? 'text-good' : 'text-bad'}`}>
            {tested.ok ? `Connected to ${tested.name} (private).` : tested.error}
          </p>
        )}

        {tested?.ok && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-sm">
                New PIN
                <input
                  className={`${field} num tracking-[0.3em]`}
                  type="password"
                  inputMode="numeric"
                  pattern="\d{4,6}"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                  autoComplete="new-password"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Repeat PIN
                <input
                  className={`${field} num tracking-[0.3em]`}
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={pin2}
                  onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))}
                  autoComplete="new-password"
                />
              </label>
            </div>
            {error && <p className="text-sm text-bad">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="h-12 rounded-xl bg-accent font-medium text-accent-ink disabled:opacity-60"
            >
              {busy ? 'Connecting…' : 'Connect'}
            </button>
          </>
        )}
      </form>

      <button className="h-12 rounded-xl border border-line font-medium" onClick={() => void startDemo()}>
        Try the demo
      </button>
      <p className="text-center text-xs text-ink-3">
        Demo data is synthetic. The app only talks to api.github.com; nothing else leaves this device.
      </p>
    </div>
  );
}
