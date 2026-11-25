/**
 * The table view behind every chart (SPEC §7 accessibility): the same numbers as rows, for screen readers,
 * colour-blind reading and copying. `ViewToggle` switches a card between its chart and its table.
 */
import { BarChart3, Table2 } from 'lucide-react';
import type { ReactNode } from 'react';

export interface Column {
  label: string;
  /** Right-aligned tabular numbers. */
  num?: boolean;
}

export function DataTable({
  caption,
  columns,
  rows,
  footer,
  maxHeight = 320,
  testId,
}: {
  caption: string;
  columns: Column[];
  rows: ReactNode[][];
  footer?: ReactNode[];
  maxHeight?: number;
  testId?: string;
}) {
  const align = (c: Column) => (c.num ? 'text-right' : 'text-left');
  return (
    <div className="overflow-auto px-4 pb-3" style={{ maxHeight }} data-testid={testId}>
      <table className="num w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 bg-surface text-ink-2">
          <tr>
            {columns.map((c) => (
              <th key={c.label} scope="col" className={`py-1.5 font-medium ${align(c)}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) =>
                j === 0 ? (
                  <th key={j} scope="row" className={`py-1.5 font-normal ${align(columns[j])}`}>
                    {cell}
                  </th>
                ) : (
                  <td key={j} className={`py-1.5 ${align(columns[j])}`}>
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
        {footer && (
          <tfoot className="border-t border-line font-medium">
            <tr>
              {footer.map((cell, j) => (
                <td key={j} className={`py-1.5 ${align(columns[j])}`}>
                  {cell}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

export function ViewToggle({
  table,
  onChange,
  what,
}: {
  table: boolean;
  onChange: (table: boolean) => void;
  /** e.g. "budget pace", for the accessible name. */
  what: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={table}
      aria-label={`Show ${what} as a table`}
      onClick={() => onChange(!table)}
      className="-my-2 -mr-2 flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm text-accent"
    >
      {table ? <BarChart3 size={16} aria-hidden="true" /> : <Table2 size={16} aria-hidden="true" />}
      {table ? 'Chart' : 'Table'}
    </button>
  );
}
