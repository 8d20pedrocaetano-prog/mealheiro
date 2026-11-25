/**
 * In-app import (SPEC §4.8, M5): pick a file or share it from the CGD app, read it on this device, check
 * it, preview new / duplicate rows, then append the new rows. PayPal CSVs enrich instead of importing.
 */
import { CircleAlert, CircleCheck, FileUp, LoaderCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Model } from '../../core/model';
import { effOf } from '../../core/view';
import { parseCgd, type PageItems } from '../../import/cgd';
import { matchPaypal, parsePaypal, looksLikePaypal, type PaypalMatch } from '../../import/paypal';
import { importOp, planImport } from '../../import/plan';
import { looksLikeRevolut, parseRevolut } from '../../import/revolut';
import { ImportError, sha256Hex, type ParsedStatement } from '../../import/statement';
import { overrideOp, updateAccount } from '../../state/edits';
import { useApp, useModel } from '../../state/store';
import { Sheet } from '../components/Sheet';
import { Button, Card, CardTitle, Field, inputCls } from '../components/ui';
import { groupedCategories } from '../lib/categories';
import { activityHref } from '../lib/filter';
import { fmtDate, formatEUR, plural } from '../lib/format';

type Src = { kind: 'cgd-pdf'; pages: PageItems[] } | { kind: 'revolut-csv'; text: string };
interface Loaded {
  name: string;
  sha256: string;
  source: Src;
}

const SHARE_CACHE = 'mealheiro-share';
const shareUrl = () => new URL('shared-file', `${location.origin}${import.meta.env.BASE_URL}`).href;

function defaultAccount(m: Model, kind: Src['kind']): string {
  const accts = [...m.ds.accounts.values()];
  const want = kind === 'cgd-pdf' ? /cgd|caixa/i : /revolut/i;
  return (
    accts.find((a) => want.test(a.id) || want.test(a.institution) || want.test(a.name))?.id ??
    accts.find((a) => a.type !== 'cash')?.id ??
    ''
  );
}

const byWho = (source: string) =>
  source === 'demo'
    ? 'demo'
    : `app-${typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches ? 'phone' : 'desktop'}`;

export function StatementImport() {
  const m = useModel();
  const [sp, setSp] = useSearchParams();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [paypal, setPaypal] = useState<{
    name: string;
    matches: PaypalMatch[];
    unmatched: number;
    foreign: number;
  } | null>(null);

  const read = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      try {
        const bytes = await file.arrayBuffer();
        const sha256 = await sha256Hex(bytes);
        const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
        if (isPdf) {
          const { pdfPages } = await import('../../import/pdfBrowser');
          const pages = await pdfPages(bytes);
          setLoaded({ name: file.name, sha256, source: { kind: 'cgd-pdf', pages } });
          return;
        }
        const text = new TextDecoder().decode(bytes);
        const header = (text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? '')
          .split(',')
          .map((h) => h.replace(/^"|"$/g, '').trim());
        if (looksLikeRevolut(header)) {
          setLoaded({ name: file.name, sha256, source: { kind: 'revolut-csv', text } });
        } else if (looksLikePaypal(header)) {
          const r = matchPaypal(m.ds, parsePaypal(text));
          setPaypal({
            name: file.name,
            matches: r.matches,
            unmatched: r.unmatched.length,
            foreign: r.foreign,
          });
        } else {
          throw new ImportError(
            'Mealheiro reads CGD statements (PDF), Revolut statements (CSV) and PayPal activity (CSV). This file looks like none of them.',
          );
        }
      } catch (e) {
        setError(e instanceof ImportError ? e.message : "Couldn't read this file.");
      } finally {
        setBusy(false);
        if (input.current) input.current.value = '';
      }
    },
    [m.ds],
  );

  // A statement shared from another app (Android share target) waits in a local cache.
  const shared = sp.get('shared') === '1';
  useEffect(() => {
    if (!shared) return;
    setSp({}, { replace: true });
    void (async () => {
      try {
        const cache = await caches.open(SHARE_CACHE);
        const res = await cache.match(shareUrl());
        if (!res) {
          setError('Nothing arrived from the share. Try choosing the file instead.');
          return;
        }
        await cache.delete(shareUrl());
        const blob = await res.blob();
        const name = decodeURIComponent(res.headers.get('X-File-Name') ?? 'statement');
        await read(new File([blob], name, { type: blob.type }));
      } catch {
        setError('Nothing arrived from the share. Try choosing the file instead.');
      }
    })();
  }, [shared, setSp, read]);

  return (
    <Card>
      <CardTitle>Import a statement</CardTitle>
      <div className="flex flex-col gap-3 px-4 pb-4">
        <p className="text-sm text-ink-2">
          A CGD statement (PDF from “Consultar saldos e movimentos”), a Revolut statement (CSV) or PayPal
          activity (CSV). It is read on this device; only the new rows are saved to your data repo.
        </p>
        <input
          ref={input}
          type="file"
          accept=".pdf,.csv,application/pdf,text/csv"
          className="hidden"
          data-testid="import-file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void read(f);
          }}
        />
        <Button variant="primary" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? <LoaderCircle size={18} className="animate-spin" /> : <FileUp size={18} />}
          {busy ? 'Reading…' : 'Choose a file'}
        </Button>
        <p className="text-xs text-ink-3">
          On your phone you can also share the PDF from the CGD app straight to Mealheiro.
        </p>
        {error && (
          <p className="flex gap-2 rounded-xl bg-bad-soft p-3 text-sm text-bad" role="alert">
            <CircleAlert size={18} className="shrink-0" />
            {error}
          </p>
        )}
      </div>
      <Sheet
        open={!!loaded}
        onOpenChange={(o) => !o && setLoaded(null)}
        title={loaded?.source.kind === 'cgd-pdf' ? 'CGD statement' : 'Revolut statement'}
        description={loaded?.name}
      >
        {loaded && <Preview key={loaded.sha256} loaded={loaded} onDone={() => setLoaded(null)} />}
      </Sheet>
      <Sheet
        open={!!paypal}
        onOpenChange={(o) => !o && setPaypal(null)}
        title="PayPal names"
        description={paypal?.name}
      >
        {paypal && <PaypalSheet {...paypal} onDone={() => setPaypal(null)} />}
      </Sheet>
    </Card>
  );
}

function Preview({ loaded, onDone }: { loaded: Loaded; onDone: () => void }) {
  const m = useModel();
  const source = useApp((s) => s.source);
  const commit = useApp((s) => s.commit);
  const [account, setAccount] = useState(() => defaultAccount(m, loaded.source.kind));
  // Ids include the account, so the statement is parsed again when the account changes.
  const [result, setResult] = useState<{ account: string; parsed?: ParsedStatement; error?: string } | null>(
    null,
  );
  const [done, setDone] = useState<{ added: number; need: number; from: string; to: string } | null>(null);

  useEffect(() => {
    let live = true;
    const src = loaded.source;
    (src.kind === 'cgd-pdf' ? parseCgd(src.pages, account) : parseRevolut(src.text, account))
      .then((p) => live && setResult({ account, parsed: p }))
      .catch(
        (e) =>
          live &&
          setResult({
            account,
            error: e instanceof ImportError ? e.message : "Couldn't read this statement.",
          }),
      );
    return () => {
      live = false;
    };
  }, [loaded, account]);
  const current = result?.account === account ? result : null;
  const parsed = current?.parsed ?? null;
  const error = current?.error ?? null;

  const plan = useMemo(
    () => (parsed ? planImport(m.ds, parsed, { name: loaded.name, sha256: loaded.sha256 }) : null),
    [parsed, m.ds, loaded],
  );
  const acct = m.ds.accounts.get(account);

  if (done) {
    return (
      <div className="flex flex-col gap-3" data-testid="import-done">
        <p className="flex items-center gap-2 text-base font-semibold">
          <CircleCheck size={20} className="text-good" />
          Added {plural(done.added, 'transaction')}
        </p>
        <p className="text-sm text-ink-2">
          {fmtDate(done.from)} – {fmtDate(done.to)} on {acct?.name ?? account}.
          {done.need > 0 ? ` ${plural(done.need, 'transaction')} need a category in Review.` : ''}
        </p>
        {acct && acct.tracked !== 'true' && (
          <div className="rounded-xl bg-surface-2 p-3 text-sm">
            <p>
              {acct.name} is not tracked yet, so money sent there still counts as spent. Now that its
              statements are in Mealheiro, count it as tracked: transfers to it become neutral and its own
              purchases are itemised.
            </p>
            <Button
              className="mt-2"
              onClick={async () => {
                await commit([updateAccount(acct.id, { tracked: 'true' })]);
              }}
            >
              Track {acct.name}
            </Button>
          </div>
        )}
        <div className="flex gap-2">
          {done.need > 0 && (
            <Link to="/more/review" className="flex-1">
              <Button variant="primary" className="w-full">
                Review
              </Button>
            </Link>
          )}
          <Link
            {...activityHref({
              from: done.from,
              to: done.to,
              acct: account,
              label: `Imported · ${acct?.name ?? account}`,
            })}
            className="flex-1"
          >
            <Button className="w-full">See them</Button>
          </Link>
        </div>
        <Button variant="ghost" onClick={onDone}>
          Close
        </Button>
      </div>
    );
  }

  const s = plan?.statement;
  const blocked = !!error || !!(s && s.errors.length) || !!plan?.alreadyImported;
  return (
    <div className="flex flex-col gap-3" data-testid="import-preview">
      <Field label="Account">
        <select value={account} onChange={(e) => setAccount(e.target.value)} className={inputCls}>
          {[...m.ds.accounts.values()].map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </Field>
      {error && (
        <p className="flex gap-2 rounded-xl bg-bad-soft p-3 text-sm text-bad" role="alert">
          <CircleAlert size={18} className="shrink-0" />
          {error}
        </p>
      )}
      {!error && !plan && (
        <p className="flex items-center gap-2 text-sm text-ink-2">
          <LoaderCircle size={16} className="animate-spin" /> Checking…
        </p>
      )}
      {plan && s && (
        <>
          <p className="text-sm text-ink-2">
            {fmtDate(s.periodStart || plan.from)} – {fmtDate(s.periodEnd || plan.to)}
            {s.closingBalance !== null && ` · closing balance ${formatEUR(s.closingBalance)}`}
          </p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="In the file" value={s.rows.length} />
            <Stat label="New" value={plan.newRows.length} testId="import-new" />
            <Stat label="Already here" value={plan.duplicates} />
          </div>
          <ul className="flex flex-col gap-1.5 text-sm">
            <Check ok={s.errors.length === 0}>
              {s.errors.length === 0 ? 'Balance checks pass: every row adds up to the next.' : s.errors[0]}
            </Check>
            {s.errors.length > 1 && (
              <li className="pl-6 text-xs text-bad">and {plural(s.errors.length - 1, 'more problem')}</li>
            )}
            {plan.alreadyImported && (
              <Check ok={false}>
                You imported this file on {fmtDate(plan.alreadyImported.imported_at.slice(0, 10))}. Nothing to
                add.
              </Check>
            )}
            {plan.gap && (
              <Check ok={false} warn>
                Missing transactions? The first new row doesn't continue from a balance Mealheiro already has.
                Import the statement for the period before it too.
              </Check>
            )}
            {s.skipped.map((k) => (
              <Check key={k.reason} ok warn>
                {plural(k.count, 'row')} left out: {k.reason}.
              </Check>
            ))}
            {plan.newRows.length > 0 && (
              <Check ok={plan.needCategory === 0} warn>
                {plan.needCategory === 0
                  ? 'Your rules categorise every new row.'
                  : `No rule covers ${plural(plan.needCategory, 'new row')}: ${plan.needCategory === 1 ? 'it goes' : 'they go'} to Review.`}
              </Check>
            )}
          </ul>
          {s.errors.length > 0 && (
            <p className="text-xs text-ink-3">
              Nothing will be saved. Mealheiro never adjusts numbers: export the statement again, or use an
              ingest session and report the error.
            </p>
          )}
          {plan.newRows.length > 0 && !blocked && (
            <ul className="divide-y divide-line rounded-xl border border-line text-sm">
              {plan.newRows
                .slice(-40)
                .reverse()
                .map((r) => (
                  <li key={r.id} className="flex items-baseline gap-2 px-3 py-1.5">
                    <span className="num w-12 shrink-0 text-xs text-ink-3">
                      {fmtDate(r.value_date).slice(0, 5)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{r.description_raw}</span>
                    <span className={`num shrink-0 ${r.amount > 0 ? 'text-good' : ''}`}>
                      {formatEUR(r.amount)}
                    </span>
                  </li>
                ))}
              {plan.newRows.length > 40 && (
                <li className="px-3 py-1.5 text-xs text-ink-3">
                  and {plural(plan.newRows.length - 40, 'older row')}
                </li>
              )}
            </ul>
          )}
          {blocked || plan.newRows.length === 0 ? (
            <Button onClick={onDone} data-testid="import-close">
              {plan.newRows.length === 0 && !blocked ? 'Nothing new to add' : 'Close'}
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={blocked || plan.newRows.length === 0}
              data-testid="import-commit"
              onClick={async () => {
                await commit([importOp(plan, byWho(source?.kind ?? ''), new Date())]);
                setDone({
                  added: plan.newRows.length,
                  need: plan.needCategory,
                  from: plan.newRows[0].booking_date,
                  to: plan.newRows[plan.newRows.length - 1].booking_date,
                });
              }}
            >
              {plan.newRows.length === 0
                ? 'Nothing new to add'
                : `Add ${plural(plan.newRows.length, 'transaction')}`}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, testId }: { label: string; value: number; testId?: string }) {
  return (
    <div className="rounded-xl bg-surface-2 p-2">
      <div className="num text-lg font-semibold" data-testid={testId}>
        {value}
      </div>
      <div className="text-xs text-ink-2">{label}</div>
    </div>
  );
}

function Check({ ok, warn, children }: { ok: boolean; warn?: boolean; children: React.ReactNode }) {
  const cls = ok ? 'text-good' : warn ? 'text-warn' : 'text-bad';
  return (
    <li className="flex gap-2">
      {ok ? (
        <CircleCheck size={16} className={`mt-0.5 shrink-0 ${cls}`} />
      ) : (
        <CircleAlert size={16} className={`mt-0.5 shrink-0 ${cls}`} />
      )}
      <span>{children}</span>
    </li>
  );
}

function PaypalSheet({
  matches,
  unmatched,
  foreign,
  onDone,
}: {
  matches: PaypalMatch[];
  unmatched: number;
  foreign: number;
  onDone: () => void;
}) {
  const m = useModel();
  const commit = useApp((s) => s.commit);
  const groups = useMemo(() => groupedCategories(m, ['expense']), [m]);
  const [cat, setCat] = useState<Record<string, string>>(() =>
    Object.fromEntries(matches.map((x) => [x.txn.id, x.suggested ?? effOf(m.view, x.txn).categoryId])),
  );
  const [on, setOn] = useState<Set<string>>(
    () => new Set(matches.filter((x) => !x.decided && x.suggested).map((x) => x.txn.id)),
  );
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-2">
        {plural(matches.length, 'PayPal payment')} matched to a “PayPal Europe” row on your bank statement
        (same amount, within 3 days).
        {unmatched > 0 ? ` ${plural(unmatched, 'bank row')} had no match and stay in Review.` : ''}
        {foreign > 0
          ? ` ${plural(foreign, 'payment')} in another currency ${foreign === 1 ? 'was' : 'were'} left out.`
          : ''}{' '}
        Ticked rows get the category you pick and “PayPal: name” in their note. Nothing else changes.
      </p>
      <ul className="divide-y divide-line" data-testid="paypal-matches">
        {matches.map((x) => (
          <li key={x.txn.id} className="flex flex-col gap-1.5 py-2">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={on.has(x.txn.id)}
                onChange={(e) =>
                  setOn((s) => {
                    const n = new Set(s);
                    if (e.target.checked) n.add(x.txn.id);
                    else n.delete(x.txn.id);
                    return n;
                  })
                }
                className="size-5 shrink-0 accent-[var(--accent)]"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{x.payment.name}</span>
                <span className="block text-xs text-ink-3">
                  {fmtDate(x.txn.value_date)}
                  {x.decided ? ' · you already chose a category' : ''}
                </span>
              </span>
              <span className="num text-sm">{formatEUR(x.txn.amount)}</span>
            </label>
            <select
              value={cat[x.txn.id] ?? ''}
              onChange={(e) => {
                setCat((c) => ({ ...c, [x.txn.id]: e.target.value }));
                setOn((s) => new Set(s).add(x.txn.id));
              }}
              aria-label={`Category for ${x.payment.name}`}
              className={`${inputCls} h-10 text-sm`}
            >
              {groups.map((g) => (
                <optgroup key={g.group} label={g.group}>
                  {g.cats.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </li>
        ))}
      </ul>
      <Button
        variant="primary"
        disabled={on.size === 0}
        onClick={async () => {
          const ops = matches
            .filter((x) => on.has(x.txn.id))
            .map((x) => {
              const prev = m.ds.overrides.get(x.txn.id)?.note ?? '';
              const tag = `PayPal: ${x.payment.name}`;
              const note = prev.includes(tag) ? prev : prev ? `${prev} · ${tag}` : tag;
              return overrideOp(x.txn, { category_id: cat[x.txn.id], note }, 'name PayPal payment');
            });
          await commit(ops);
          onDone();
        }}
      >
        Save {plural(on.size, 'payment')}
      </Button>
    </div>
  );
}
