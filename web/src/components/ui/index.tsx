import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';

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
        'inline-flex items-center justify-center gap-2 rounded-lg transition-colors disabled:opacity-40 disabled:pointer-events-none focus:outline-none focus:ring-2 focus:ring-phos/40',
        size === 'sm' ? 'h-8 px-3 text-sm' : 'h-10 px-4 text-sm',
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
  return <h3 className="text-sm font-semibold text-ink">{children}</h3>;
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
        'h-10 w-full rounded-lg border border-line bg-bg-inset px-3 text-sm text-ink placeholder:text-ink-faint',
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
      <h1 className="text-xl font-semibold text-ink">{title}</h1>
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
      className={cx(
        'relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40',
        checked ? 'bg-phos' : 'bg-line-strong',
      )}
    >
      <span
        className={cx(
          'absolute top-0.5 h-4 w-4 rounded-full bg-bg transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0.5',
        )}
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
        'h-10 rounded-lg border border-line bg-bg-inset px-3 text-sm text-ink',
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
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-card border border-line bg-bg-raised"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          <button onClick={onClose} className="text-ink-faint hover:text-ink">
            ✕
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
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
