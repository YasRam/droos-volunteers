import clsx from 'clsx'
import { Loader2, X } from 'lucide-react'
import {
  forwardRef,
  useEffect,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import type { RequestStatus, VolunteerStatus } from '@/lib/types'
import { REQUEST_LABEL } from '@/lib/types'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition active:scale-[.98] disabled:opacity-50 disabled:pointer-events-none',
        size === 'sm' && 'h-8 px-3 text-sm',
        size === 'md' && 'h-10 px-4 text-sm',
        size === 'lg' && 'h-12 px-6 text-base',
        variant === 'primary' && 'bg-brand-700 text-white hover:bg-brand-800',
        variant === 'secondary' && 'border border-line bg-white text-ink hover:bg-surface',
        variant === 'ghost' && 'text-brand-700 hover:bg-brand-50',
        variant === 'danger' && 'bg-red-600 text-white hover:bg-red-700',
        variant === 'success' && 'bg-emerald-600 text-white hover:bg-emerald-700',
        className,
      )}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  )
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx('rounded-2xl border border-line bg-white p-4 shadow-sm', className)}>{children}</div>
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-ink">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-muted">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  )
}

const inputCls =
  'w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-surface disabled:text-muted'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} {...rest} className={clsx(inputCls, 'h-10', className)} />
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} rows={3} {...rest} className={clsx(inputCls, className)} />
})

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & { options: (string | { value: string; label: string })[]; placeholder?: string }
>(function Select({ className, options, placeholder, ...rest }, ref) {
  return (
    <select ref={ref} {...rest} className={clsx(inputCls, 'h-10', className)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) =>
        typeof o === 'string' ? (
          <option key={o} value={o}>
            {o}
          </option>
        ) : (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ),
      )}
    </select>
  )
})

export function Spinner({ label = 'بيحمّل...' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-muted">
      <Loader2 className="size-5 animate-spin" />
      <span className="text-sm">{label}</span>
    </div>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-white px-4 py-10 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  )
}

export function Badge({ tone = 'gray', children }: { tone?: 'gray' | 'brand' | 'green' | 'orange' | 'red' | 'purple' | 'blue'; children: ReactNode }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold',
        tone === 'gray' && 'bg-gray-100 text-gray-600',
        tone === 'brand' && 'bg-brand-50 text-brand-800',
        tone === 'green' && 'bg-emerald-50 text-emerald-700',
        tone === 'orange' && 'bg-orange-50 text-orange-700',
        tone === 'red' && 'bg-red-50 text-red-700',
        tone === 'purple' && 'bg-purple-50 text-purple-700',
        tone === 'blue' && 'bg-blue-50 text-blue-700',
      )}
    >
      {children}
    </span>
  )
}

export function StatusBadge({ status }: { status: VolunteerStatus }) {
  const tone = { 'مسئول': 'purple', 'مشروع مسئول': 'blue', 'تحت المتابعة': 'green', 'مدرب': 'brand', 'خارج المتابعة': 'gray' } as const
  return <Badge tone={tone[status]}>{status}</Badge>
}

export const ACCEPTANCE_TONE = {
  اختبار: 'orange',
  مقبول: 'green',
  'رفض الانترفيو': 'red',
  مرفوض: 'red',
  معتذر: 'gray',
  'معتذر نهائى': 'gray',
  مفصول: 'red',
} as const

export function AcceptanceBadge({ value }: { value: keyof typeof ACCEPTANCE_TONE | null | undefined }) {
  if (!value) return <Badge>لسه</Badge>
  return <Badge tone={ACCEPTANCE_TONE[value]}>{value}</Badge>
}

export function RequestBadge({ status }: { status: RequestStatus }) {
  const tone = { pending: 'orange', accepted: 'green', rejected: 'red' } as const
  return <Badge tone={tone[status]}>{REQUEST_LABEL[status]}</Badge>
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: T; label: string; count?: number }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-white p-1 shadow-sm ring-1 ring-line">
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={clsx(
            'flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition',
            value === t.value ? 'bg-brand-700 text-white' : 'text-muted hover:bg-surface',
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="ms-1 opacity-75">({t.count})</span>}
        </button>
      ))}
    </div>
  )
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:max-w-lg sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-muted hover:bg-surface" aria-label="إغلاق">
            <X className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Stat({ label, value, tone = 'brand' }: { label: string; value: ReactNode; tone?: 'brand' | 'orange' | 'green' }) {
  return (
    <Card className="p-3">
      <p className="text-xs text-muted">{label}</p>
      <p
        className={clsx(
          'mt-1 text-2xl font-bold',
          tone === 'brand' && 'text-brand-700',
          tone === 'orange' && 'text-orange-600',
          tone === 'green' && 'text-emerald-600',
        )}
      >
        {value}
      </p>
    </Card>
  )
}

export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'flex w-full items-center justify-between rounded-xl border px-3 py-2 text-sm transition disabled:opacity-60',
        checked ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-line bg-white text-muted',
      )}
    >
      <span className="font-semibold">{label}</span>
      <span className={clsx('relative h-5 w-9 rounded-full transition', checked ? 'bg-emerald-500' : 'bg-gray-300')}>
        <span className={clsx('absolute top-0.5 size-4 rounded-full bg-white shadow transition-all', checked ? 'start-4' : 'start-0.5')} />
      </span>
    </button>
  )
}
