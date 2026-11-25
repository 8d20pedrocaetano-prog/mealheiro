/** Progress against a limit with a pace marker (SPEC §4.4 colour states). */
export function BudgetBar({
  spent,
  limit,
  pace,
  projected,
}: {
  spent: number;
  limit: number;
  pace: number | null;
  /** Projected month-end spend: an amber outline when it would end over. */
  projected?: number;
}) {
  const pct = limit > 0 ? Math.min(1, spent / limit) : 0;
  const over = spent > limit;
  const overPace = pace !== null && spent > pace;
  const projectedOver = !over && projected !== undefined && projected > limit;
  return (
    <div
      className={`relative h-2 rounded-full bg-surface-2 ${projectedOver ? 'outline-1 outline-offset-1 outline-warn' : ''}`}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={limit}
      aria-valuenow={spent}
    >
      <div
        className={`h-2 rounded-full ${over ? 'bg-bad' : overPace ? 'bg-warn' : 'bg-accent'}`}
        style={{ width: `${pct * 100}%` }}
      />
      {pace !== null && limit > 0 && (
        <div
          className="absolute -top-1 h-4 w-0.5 rounded bg-ink-2"
          style={{ left: `${Math.min(1, pace / limit) * 100}%` }}
          title="Where spending would be on a straight line"
        />
      )}
    </div>
  );
}
