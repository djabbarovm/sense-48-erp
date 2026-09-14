/* Дизайн-система Finance OS: базовые компоненты (Tailwind, shadcn-стиль). */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from 'react';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

// ── Button ──

const BUTTON_VARIANTS = {
  default:
    'bg-brand-600 text-white shadow-sm hover:bg-brand-700 active:bg-brand-800 focus-visible:outline-brand-600',
  outline:
    'border border-gray-300 bg-white text-gray-700 shadow-sm hover:border-gray-400 hover:bg-gray-50 focus-visible:outline-gray-400',
  danger:
    'bg-red-600 text-white shadow-sm hover:bg-red-700 active:bg-red-800 focus-visible:outline-red-600',
  ghost: 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-gray-400',
} as const;

export function Button({
  variant = 'default',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof BUTTON_VARIANTS;
  size?: 'sm' | 'md';
}) {
  return (
    <button
      className={cn(
        'inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg font-medium transition-all duration-150',
        'focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50',
        size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm',
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

// ── Form controls ──

const CONTROL =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm transition-colors placeholder:text-gray-400 hover:border-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-gray-50';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(CONTROL, className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(CONTROL, 'appearance-none pr-8', className)} {...props} />;
}

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={cn('mb-1.5 block text-[13px] font-medium text-gray-700', className)} {...props} />
  );
}

// ── Card ──

export function Card({
  className,
  title,
  actions,
  children,
}: {
  className?: string;
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={cn('rounded-xl border border-gray-200/80 bg-white p-5 shadow-card', className)}>
      {title || actions ? (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title ? <h2 className="text-[15px] font-semibold tracking-tight text-gray-900">{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </div>
  );
}

// ── Stat card (дашборды) ──

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'default',
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: 'default' | 'danger' | 'success' | 'warning';
}) {
  return (
    <div className="rounded-xl border border-gray-200/80 bg-white p-5 shadow-card">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[13px] font-medium text-gray-500">{label}</p>
          <p
            className={cn(
              'tnum mt-1.5 text-2xl font-semibold tracking-tight',
              tone === 'danger' && 'text-red-600',
              tone === 'success' && 'text-emerald-600',
              tone === 'warning' && 'text-amber-600',
            )}
          >
            {value}
          </p>
          {hint ? <p className="mt-1 text-xs text-gray-400">{hint}</p> : null}
        </div>
        {icon ? (
          <div className="rounded-lg bg-brand-50 p-2.5 text-brand-600 [&>svg]:h-5 [&>svg]:w-5">{icon}</div>
        ) : null}
      </div>
    </div>
  );
}

// ── Badge ──

const BADGE_TONES = {
  gray: 'bg-gray-100 text-gray-700 ring-gray-500/10',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15',
  red: 'bg-red-50 text-red-700 ring-red-600/15',
  yellow: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  blue: 'bg-brand-50 text-brand-700 ring-brand-600/15',
} as const;

const DOT_TONES = {
  gray: 'bg-gray-400',
  green: 'bg-emerald-500',
  red: 'bg-red-500',
  yellow: 'bg-amber-500',
  blue: 'bg-brand-500',
} as const;

export function Badge({
  tone = 'gray',
  dot = false,
  children,
}: {
  tone?: keyof typeof BADGE_TONES;
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
        BADGE_TONES[tone],
      )}
    >
      {dot ? <span className={cn('h-1.5 w-1.5 rounded-full', DOT_TONES[tone])} /> : null}
      {children}
    </span>
  );
}

// ── Table ──

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200/80 bg-white shadow-card">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'border-b border-gray-200 bg-gray-50/80 px-4 py-2.5 text-left text-[11px] font-semibold tracking-wider text-gray-500 uppercase',
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn('border-b border-gray-100 px-4 py-3 text-gray-700 group-hover:bg-gray-50', className)}
      {...props}
    />
  );
}

// ── Page header ──

export function PageHeader({
  title,
  meta,
  actions,
}: {
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-gray-900">{title}</h1>
        {meta}
      </div>
      {actions}
    </div>
  );
}

export function EmptyState({ icon, text }: { icon?: ReactNode; text: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 bg-white/60 py-12 text-gray-400">
      {icon ? <div className="[&>svg]:h-8 [&>svg]:w-8">{icon}</div> : null}
      <p className="text-sm">{text}</p>
    </div>
  );
}
