import { forwardRef, useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';

/* ----------------------------------------------------------------------------
 * Minimal UI primitives — shadcn aesthetic, hand-rolled (no CLI dependency).
 * Dark surfaces, hairline borders, single phosphor-green accent.
 * -------------------------------------------------------------------------- */

function cx(...parts: (string | false | undefined | null)[]): string {
  return parts.filter(Boolean).join(' ');
}

/* --- Button --------------------------------------------------------------- */
type ButtonVariant = 'primary' | 'ghost' | 'outline' | 'danger';
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
}

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-phos text-bg font-semibold hover:bg-phos-dim',
  ghost: 'bg-transparent text-ink-muted hover:bg-bg-inset hover:text-ink',
  outline: 'border border-line text-ink hover:border-line-strong hover:bg-bg-inset',
  danger: 'border border-danger/40 text-danger hover:bg-danger/10',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'outline', size = 'md', className, ...props }, ref) => (
    <button
      ref={ref}
      className={cx(
        'inline-flex select-none items-center justify-center gap-2 rounded-lg transition-colors disabled:opacity-40 disabled:pointer-events-none focus:outline-none focus:ring-2 focus:ring-phos/40',
        // 44px minimum on touch viewports (Apple HIG); the tighter desktop
        // heights come back at lg where the pointer is precise.
        size === 'sm' ? 'min-h-touch px-3 text-sm lg:h-8 lg:min-h-0' : 'min-h-touch px-4 text-sm lg:h-10 lg:min-h-0',
        buttonVariants[variant],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = 'Button';

/* --- Card ----------------------------------------------------------------- */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cx('rounded-card border border-line bg-bg-raised', className)}>{children}</div>
  );
}

export function CardHeader({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('flex items-center justify-between px-5 pt-4 pb-3', className)}>{children}</div>;
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <h3 className="min-w-0 text-sm font-semibold text-ink">{children}</h3>;
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('px-5 pb-5', className)}>{children}</div>;
}

/* --- Input ---------------------------------------------------------------- */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cx(
        'min-h-touch w-full rounded-lg border border-line bg-bg-inset px-3 text-sm text-ink placeholder:text-ink-faint lg:h-10 lg:min-h-0',
        'focus:outline-none focus:border-phos/50 focus:ring-1 focus:ring-phos/30',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

/* --- Badge / status pill -------------------------------------------------- */
type BadgeTone = 'ok' | 'warn' | 'bad' | 'idle';
const badgeTones: Record<BadgeTone, string> = {
  ok: 'text-phos border-phos/30 bg-phos/5',
  warn: 'text-warn border-warn/30 bg-warn/5',
  bad: 'text-danger border-danger/30 bg-danger/5',
  idle: 'text-ink-muted border-line bg-bg-inset',
};

export function Badge({ tone = 'idle', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        badgeTones[tone],
      )}
    >
      {children}
    </span>
  );
}

/* --- StatusDot ------------------------------------------------------------ */
export function StatusDot({ tone }: { tone: BadgeTone }) {
  const cls = tone === 'ok' ? 'dot-ok' : tone === 'warn' ? 'dot-warn' : tone === 'bad' ? 'dot-bad' : 'dot-idle';
  return <span className={cx('dot', cls)} />;
}

/* --- Section heading ------------------------------------------------------ */
export function PageHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-lg font-semibold text-ink sm:text-xl">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>}
    </div>
  );
}

/* --- Empty / loading states ---------------------------------------------- */
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-card border border-dashed border-line py-12 text-center text-sm text-ink-muted">
      {children}
    </div>
  );
}

export function Spinner() {
  return (
    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-line border-t-phos" />
  );
}

/* --- Switch / toggle ------------------------------------------------------ */
export function Switch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      // The visible track stays 20x36; the -m-3/p-3 pair grows the HIT area
      // to 44px without changing the layout around it.
      className={cx(
        'relative -m-3 box-content h-5 w-9 shrink-0 rounded-full bg-clip-content p-3 transition-colors disabled:opacity-40',
        checked ? 'bg-phos' : 'bg-line-strong',
      )}
    >
      <span
        className={cx(
          'absolute top-3.5 h-4 w-4 rounded-full bg-bg transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0.5',
        )}
        style={{ left: '0.75rem' }}
      />
    </button>
  );
}

/* --- Select --------------------------------------------------------------- */
export function Select({
  value,
  onChange,
  options,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cx(
        'min-h-touch max-w-full rounded-lg border border-line bg-bg-inset px-3 text-sm text-ink lg:h-10 lg:min-h-0',
        'focus:border-phos/50 focus:outline-none focus:ring-1 focus:ring-phos/30',
        className,
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/* --- Modal (simple bottom-sheet-ish overlay) ----------------------------- */
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  // Lock background scroll while open so the page behind doesn't slide
  // under the sheet on iOS.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      // Bottom sheet on phones (thumb-reachable, native-feeling), centred
      // dialog from sm up. A centred box on a 390px screen wastes the top
      // half and puts the controls in the hardest place to reach.
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl border border-line bg-bg-raised pb-safe sm:max-w-md sm:rounded-card sm:pb-0"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Grab handle — reads as a sheet, and is a bigger dismiss target. */}
        <div className="flex justify-center pt-2 sm:hidden">
          <span className="h-1 w-10 rounded-full bg-line-strong" />
        </div>
        <div className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-5 sm:py-3.5">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-touch w-touch place-items-center rounded-lg text-ink-faint hover:bg-bg-inset hover:text-ink sm:h-8 sm:w-8"
          >
            ✕
          </button>
        </div>
        <div className="px-4 py-4 sm:px-5">{children}</div>
      </div>
    </div>
  );
}

/* --- Field (label + control) --------------------------------------------- */
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="mb-3">
      <label className="mb-1 block text-xs font-medium text-ink-muted">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-ink-faint">{hint}</p>}
    </div>
  );
}

/* --- Toast (lightweight, self-dismissing) -------------------------------- */
export function InlineNote({ tone = 'idle', children }: { tone?: BadgeTone; children: ReactNode }) {
  const cls =
    tone === 'ok' ? 'text-phos' : tone === 'bad' ? 'text-danger' : tone === 'warn' ? 'text-warn' : 'text-ink-muted';
  return <p className={cx('text-xs', cls)}>{children}</p>;
}
