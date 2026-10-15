import { useEffect, useRef, type ReactNode, type ButtonHTMLAttributes } from 'react';
import { X } from 'lucide-react';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx('rounded-2xl bg-white/80 p-4 shadow-soft ring-1 ring-blush-200/60', className)}>{children}</section>;
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'soft' | 'ghost'; block?: boolean };

export function Button({ variant = 'primary', block, className, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      className={cx(
        'inline-flex min-h-[48px] items-center justify-center gap-2 rounded-2xl px-5 text-[15px] font-semibold transition',
        'active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40',
        variant === 'primary' && 'bg-rose-500 text-white shadow-lift hover:bg-rose-600',
        variant === 'soft' && 'bg-blush-100 text-rose-700 hover:bg-blush-200',
        variant === 'ghost' && 'text-ink-soft hover:bg-blush-100',
        block && 'w-full',
        className,
      )}
    />
  );
}

/** Selectable chip used across loggers. */
export function Chip({
  selected,
  onClick,
  children,
  className,
  tone = 'rose',
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
  tone?: 'rose' | 'sage' | 'lilac' | 'peach';
}) {
  const on = {
    rose: 'bg-rose-500 text-white ring-rose-500',
    sage: 'bg-sage-600 text-white ring-sage-600',
    lilac: 'bg-lilac-500 text-white ring-lilac-500',
    peach: 'bg-peach-400 text-white ring-peach-400',
  }[tone];
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cx(
        'flex min-h-[44px] items-center justify-center gap-1.5 rounded-2xl px-3 text-sm font-medium ring-1 transition duration-150',
        'active:animate-pop',
        selected ? on : 'bg-cream-100 text-ink-soft ring-blush-200 hover:bg-blush-100',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function SectionLabel({ icon, children, hint }: { icon?: ReactNode; children: ReactNode; hint?: string }) {
  return (
    <div className="mb-2 flex items-baseline justify-between">
      <h3 className="flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-wide text-ink-soft">
        {icon}
        {children}
      </h3>
      {hint && <span className="text-xs text-ink-faint">{hint}</span>}
    </div>
  );
}

/** Mobile bottom sheet with focus handling and Escape-to-close. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 animate-fade-up bg-ink/30 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={panel}
        tabIndex={-1}
        className="relative flex max-h-[92dvh] w-full max-w-md animate-sheet-up flex-col rounded-t-[28px] bg-cream shadow-lift outline-none"
      >
        <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-blush-300" />
        <header className="flex items-center justify-between px-5 pb-2 pt-3">
          <div className="font-display text-xl text-ink">{title}</div>
          <button onClick={onClose} aria-label="Close" className="grid h-10 w-10 place-items-center rounded-full text-ink-soft hover:bg-blush-100">
            <X size={20} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-4">{children}</div>
        {footer && <div className="border-t border-blush-200/70 px-5 pb-safe pt-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Stepper({
  value,
  onChange,
  min,
  max,
  suffix,
  label,
}: {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  suffix?: string;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-2xl bg-cream-100 p-2 ring-1 ring-blush-200">
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        onClick={() => onChange(Math.max(min, value - 1))}
        className="grid h-11 w-11 place-items-center rounded-xl bg-white text-xl text-rose-600 shadow-soft active:scale-95"
      >
        −
      </button>
      <div className="text-center" aria-live="polite">
        <span className="font-display text-3xl text-ink">{value}</span>
        {suffix && <span className="ml-1 text-sm text-ink-soft">{suffix}</span>}
      </div>
      <button
        type="button"
        aria-label={`Increase ${label}`}
        onClick={() => onChange(Math.min(max, value + 1))}
        className="grid h-11 w-11 place-items-center rounded-xl bg-white text-xl text-rose-600 shadow-soft active:scale-95"
      >
        +
      </button>
    </div>
  );
}
