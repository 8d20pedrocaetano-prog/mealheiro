import { CheckCheck, ChevronRight } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Txn } from '../../core/dataset';
import { titleCase } from '../../core/normalize';
import { countsForBadge, type ReviewCard } from '../../core/review';
import { suggestPattern } from '../../core/ruleTools';
import { effOf } from '../../core/view';
import {
  confirmCategory,
  linkCashEntries,
  linkPassThrough,
  linkPayback,
  namePerson,
  recategorise,
} from '../../state/edits';
import { useApp, useModel } from '../../state/store';
import { CashItemiser } from '../components/CashItemiser';
import { CategoryGrid } from '../components/CategoryGrid';
import { RuleEditor } from '../components/RuleEditor';
import { Sheet } from '../components/Sheet';
import { NoDataYet } from '../components/Onboarding';
import { Button, Card, Field, Switch, inputCls } from '../components/ui';
import { categoryName } from '../lib/categories';
import { fmtDate, formatEUR, plural } from '../lib/format';
import { cardsOf } from '../lib/review';

function TxnLine({ t }: { t: Txn }) {
  const m = useModel();
  return (
    <div className="flex items-start gap-3 rounded-xl bg-surface-2 p-3">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{effOf(m.view, t).merchant}</div>
        <div className="truncate font-mono text-xs text-ink-2">{t.description_raw}</div>
        <div className="text-xs text-ink-3">
          {fmtDate(t.value_date)} · {m.ds.accounts.get(t.account_id)?.name ?? t.account_id}
        </div>
      </div>
      <div className={`num shrink-0 font-semibold ${t.amount > 0 ? 'text-good' : ''}`}>
        {formatEUR(t.amount, { plus: true })}
      </div>
    </div>
  );
}

function CardShell({ kicker, title, children }: { kicker: string; title: ReactNode; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div>
        <div className="text-xs font-medium tracking-wide text-accent uppercase">{kicker}</div>
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      {children}
    </Card>
  );
}

type Open = { kind: 'rule'; t: Txn; categoryId: string } | { kind: 'cash'; t: Txn } | null;

function Uncategorised({
  c,
  setOpen,
}: {
  c: Extract<ReviewCard, { type: 'uncategorised' }>;
  setOpen: (o: Open) => void;
}) {
  const m = useModel();
  const commit = useApp((s) => s.commit);
  const [picking, setPicking] = useState(!c.suggestion);
  const [allLike, setAllLike] = useState(false);
  const pick = (id: string) =>
    allLike ? setOpen({ kind: 'rule', t: c.txn, categoryId: id }) : commit(recategorise(c.txn, id));
  return (
    <CardShell kicker="Uncategorised" title="What is this?">
      <TxnLine t={c.txn} />
      {c.suggestion && (
        <p className="text-sm text-ink-2">
          {c.txn.suggested_by ? `${c.txn.suggested_by} thinks` : 'Suggested'}:{' '}
          <b className="text-ink">{categoryName(m, c.suggestion)}</b>
          {c.txn.review_note ? `. ${c.txn.review_note}` : ''}
        </p>
      )}
      {picking ? (
        <>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span>
              Apply to all like this{' '}
              <span className="font-mono text-xs text-ink-3">{suggestPattern(c.txn)}</span>
            </span>
            <Switch checked={allLike} onChange={setAllLike} label="Apply to all like this" />
          </div>
          <CategoryGrid value={c.suggestion ?? undefined} onPick={pick} />
        </>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="primary"
            className="col-span-2"
            onClick={() => commit(recategorise(c.txn, c.suggestion!))}
          >
            Yes, {categoryName(m, c.suggestion!)}
          </Button>
          <Button onClick={() => setPicking(true)}>Pick another</Button>
          <Button onClick={() => setOpen({ kind: 'rule', t: c.txn, categoryId: c.suggestion! })}>
            All like this…
          </Button>
        </div>
      )}
    </CardShell>
  );
}

function Person({ c }: { c: Extract<ReviewCard, { type: 'person' }> }) {
  const m = useModel();
  const commit = useApp((s) => s.commit);
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState(c.categoryId);
  const [picking, setPicking] = useState(false);
  const who = titleCase(c.key.replace(/^(TFI|TRF MBWAY|TRF)\s+/, ''));
  const last = c.txns[c.txns.length - 1];
  return (
    <CardShell kicker="Who is this?" title={who}>
      <p className="text-sm text-ink-2">
        {plural(c.txns.length, 'transfer')} {c.direction === 'in' ? 'from' : 'to'}{' '}
        <span className="font-mono">{c.key}</span>,{' '}
        <span className="num">{formatEUR(c.total, { plus: true })}</span> in total, last on{' '}
        {fmtDate(last.value_date)}.
      </p>
      <Field label="Nickname">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Joana (flatmate)"
          className={inputCls}
        />
      </Field>
      {picking ? (
        <CategoryGrid
          value={categoryId}
          onPick={(id) => {
            setCategoryId(id);
            setPicking(false);
          }}
        />
      ) : (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-line p-3">
          <div className="min-w-0">
            <div className="text-xs text-ink-2">Default category</div>
            <div className="truncate font-medium">{categoryName(m, categoryId)}</div>
          </div>
          <Button variant="ghost" onClick={() => setPicking(true)}>
            Change
          </Button>
        </div>
      )}
      <Button
        variant="primary"
        disabled={!name.trim()}
        onClick={() => commit(namePerson(m, c.key, c.direction, name, categoryId))}
      >
        Save
      </Button>
    </CardShell>
  );
}

function Payback({ c }: { c: Extract<ReviewCard, { type: 'payback' }> }) {
  const m = useModel();
  const commit = useApp((s) => s.commit);
  return (
    <CardShell kicker="Payback?" title="Is this money paying you back?">
      <TxnLine t={c.incoming} />
      <p className="text-sm text-ink-2">
        For this {categoryName(m, effOf(m.view, c.expense).categoryId).toLowerCase()} expense a few days
        before:
      </p>
      <TxnLine t={c.expense} />
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={() => commit(confirmCategory(m, c.incoming))}>No</Button>
        <Button variant="primary" onClick={() => commit(linkPayback(m, c.incoming, c.expense))}>
          Yes, link them
        </Button>
      </div>
    </CardShell>
  );
}

function PassThrough({ c }: { c: Extract<ReviewCard, { type: 'pass-through' }> }) {
  const m = useModel();
  const commit = useApp((s) => s.commit);
  const [categoryId, setCategoryId] = useState(effOf(m.view, c.outgoing).categoryId);
  const [picking, setPicking] = useState(false);
  return (
    <CardShell kicker="Pass-through?" title="Money in and straight out again?">
      <TxnLine t={c.incoming} />
      <TxnLine t={c.outgoing} />
      <p className="text-sm text-ink-2">
        Linking puts both in one category, so they cancel out there and don't inflate income or spending.
      </p>
      {picking ? (
        <CategoryGrid
          value={categoryId}
          onPick={(id) => {
            setCategoryId(id);
            setPicking(false);
          }}
        />
      ) : (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-line p-3">
          <div className="min-w-0">
            <div className="text-xs text-ink-2">Both as</div>
            <div className="truncate font-medium">{categoryName(m, categoryId)}</div>
          </div>
          <Button variant="ghost" onClick={() => setPicking(true)}>
            Change
          </Button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={() => commit(confirmCategory(m, c.incoming))}>Not related</Button>
        <Button variant="primary" onClick={() => commit(linkPassThrough(c.incoming, c.outgoing, categoryId))}>
          Link both
        </Button>
      </div>
    </CardShell>
  );
}

function Cash({ c, setOpen }: { c: Extract<ReviewCard, { type: 'cash' }>; setOpen: (o: Open) => void }) {
  const m = useModel();
  const commit = useApp((s) => s.commit);
  const logged = c.unlinked.reduce((s, t) => s - t.amount, 0);
  return (
    <CardShell kicker="Cash (optional)" title="What was this cash for?">
      <TxnLine t={c.txn} />
      {c.unlinked.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border border-line p-3 text-sm">
          <p>
            You logged {plural(c.unlinked.length, 'cash expense')} (
            <span className="num">{formatEUR(logged)}</span>) in the week after it. Link them to this
            withdrawal?
          </p>
          <Button variant="primary" onClick={() => commit(linkCashEntries(c.unlinked, c.txn))}>
            Link them
          </Button>
        </div>
      )}
      <p className="text-sm text-ink-2">If you skip, it stays as unitemized cash and won't be asked again.</p>
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={() => commit(confirmCategory(m, c.txn))}>Skip</Button>
        <Button
          variant={c.unlinked.length ? 'secondary' : 'primary'}
          onClick={() => setOpen({ kind: 'cash', t: c.txn })}
        >
          What was it for?
        </Button>
      </div>
    </CardShell>
  );
}

/** SPEC §4.6: one card at a time; swipe left (or "Later") to come back to it. */
export function Review() {
  const m = useModel();
  const cards = cardsOf(m);
  const [later, setLater] = useState<string[]>([]);
  const [open, setOpen] = useState<Open>(null);
  const touch = useRef<number | null>(null);
  const card = cards.find((c) => !later.includes(c.id)) ?? null;
  const required = cards.filter(countsForBadge).length;
  const skip = () => card && setLater((l) => [...l.filter((x) => x !== card.id), card.id]);

  let body: ReactNode = null;
  if (card?.type === 'uncategorised') body = <Uncategorised key={card.id} c={card} setOpen={setOpen} />;
  if (card?.type === 'person') body = <Person key={card.id} c={card} />;
  if (card?.type === 'payback') body = <Payback key={card.id} c={card} />;
  if (card?.type === 'pass-through') body = <PassThrough key={card.id} c={card} />;
  if (card?.type === 'cash') body = <Cash key={card.id} c={card} setOpen={setOpen} />;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Review</h1>
        <span className="text-sm text-ink-2" data-testid="review-count">
          {required ? `${required} to go` : 'Inbox clear'}
          {cards.length > required ? ` · ${cards.length - required} optional` : ''}
        </span>
      </div>

      {card ? (
        <>
          <div
            onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
            onTouchEnd={(e) => {
              if (touch.current !== null && e.changedTouches[0].clientX - touch.current < -80) skip();
              touch.current = null;
            }}
          >
            {body}
          </div>
          <button
            type="button"
            onClick={skip}
            className="flex min-h-11 items-center justify-center gap-1 text-sm text-ink-2"
          >
            Later <ChevronRight size={16} />
          </button>
        </>
      ) : m.ds.txns.length === 0 ? (
        <NoDataYet what="Nothing to review yet. After an import, the transactions the rules can't place, and the people behind transfers, wait here for you." />
      ) : (
        <Card className="flex flex-col items-center gap-2 p-8 text-center">
          <CheckCheck size={32} className="text-good" />
          <p className="font-medium">All done.</p>
          {later.length > 0 ? (
            <Button variant="ghost" onClick={() => setLater([])}>
              Show the {plural(later.length, 'card')} you left for later
            </Button>
          ) : (
            <Link to="/" className="text-sm text-accent">
              Back to Home
            </Link>
          )}
        </Card>
      )}

      <Sheet
        open={!!open}
        onOpenChange={(o) => !o && setOpen(null)}
        title={open?.kind === 'cash' ? 'What was this cash for?' : 'All like this'}
        description={
          open ? `${effOf(m.view, open.t).merchant} · ${formatEUR(open.t.amount, { plus: true })}` : undefined
        }
      >
        {open?.kind === 'cash' && <CashItemiser t={open.t} onDone={() => setOpen(null)} />}
        {open?.kind === 'rule' && (
          <RuleEditor
            initial={{
              pattern: suggestPattern(open.t),
              direction: open.t.amount < 0 ? 'out' : 'in',
              amount_min: '',
              amount_max: '',
              account_id: '',
              merchant: '',
              category_id: open.categoryId,
            }}
            onDone={() => setOpen(null)}
          />
        )}
      </Sheet>
    </div>
  );
}
