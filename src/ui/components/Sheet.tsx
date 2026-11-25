import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Sheets instead of modals (CLAUDE.md #7): a bottom sheet on the phone, a side panel on desktop.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 data-[state=open]:animate-in" />
        <Dialog.Content
          className="safe-bottom fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-3xl border border-line bg-surface shadow-2xl outline-none lg:inset-y-0 lg:right-0 lg:left-auto lg:max-h-none lg:w-[28rem] lg:rounded-none lg:rounded-l-3xl"
          aria-describedby={description ? undefined : undefined}
        >
          <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line lg:hidden" aria-hidden="true" />
          <div className="flex items-start gap-3 px-4 pt-3 pb-2">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="truncate text-lg font-semibold">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="text-sm text-ink-2">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{title}</Dialog.Description>
              )}
            </div>
            <Dialog.Close
              className="-mr-1 flex size-11 items-center justify-center rounded-full text-ink-2 hover:bg-surface-2"
              aria-label="Close"
            >
              <X size={20} />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
          {footer && <div className="border-t border-line px-4 py-3">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
