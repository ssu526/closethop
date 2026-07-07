import { LoaderCircle, X } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Button({
  className = "",
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" }) {
  const styles = {
    primary: "bg-ink text-paper hover:bg-clay",
    secondary: "border border-ink/25 bg-paper text-ink hover:border-ink",
    danger: "bg-red-800 text-white hover:bg-red-900",
    ghost: "text-ink hover:bg-ink/5"
  };
  return (
    <button
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}
      {...props}
    />
  );
}

export function Field({
  label,
  error,
  children
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-2 text-sm font-semibold text-ink">
      <span>{label}</span>
      {children}
      {error && <span className="block text-xs font-normal text-red-700">{error}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-xl border border-stone bg-white px-4 py-3 font-normal text-ink outline-none transition placeholder:text-ink/35 focus:border-clay focus:ring-2 focus:ring-clay/15";

export function Loading({ label = "Loading your wardrobe" }: { label?: string }) {
  return (
    <div className="flex min-h-48 items-center justify-center gap-3 text-sm text-ink/60" role="status">
      <LoaderCircle className="animate-spin" size={20} />
      {label}
    </div>
  );
}

export function EmptyState({
  title,
  copy,
  action
}: {
  title: string;
  copy: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-[2rem] border border-dashed border-stone bg-paper/60 px-6 py-16 text-center">
      <p className="font-display text-3xl">{title}</p>
      <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-ink/60">{copy}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function ErrorState({
  message,
  onClose
}: {
  message: string;
  onClose?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
      <span className="min-w-0 flex-1">{message}</span>
      {onClose && (
        <button
          type="button"
          className="ml-auto shrink-0 rounded-full p-1 transition hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-700/30"
          onClick={onClose}
          aria-label="Close notification"
        >
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export function Modal({
  open,
  title,
  onClose,
  wide = false,
  extraWide = false,
  children
}: {
  open: boolean;
  title: string;
  onClose(): void;
  wide?: boolean;
  extraWide?: boolean;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/55 p-0 backdrop-blur-sm sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`max-h-[92vh] w-full overflow-y-auto rounded-t-[2rem] bg-white p-6 shadow-2xl sm:rounded-[2rem] sm:p-8 ${extraWide ? "max-w-6xl" : wide ? "max-w-4xl" : "max-w-2xl"}`}>
        <div className="mb-6 flex items-center justify-between">
          <h2 className="font-display text-3xl">{title}</h2>
          <button className="rounded-full p-2 hover:bg-ink/5" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function TagList({ tags }: { tags: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((tag) => (
        <span key={tag} className="rounded-full bg-linen px-3 py-1 text-xs text-ink/70">
          {tag}
        </span>
      ))}
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  onChange
}: {
  page: number;
  totalPages: number;
  onChange(page: number): void;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav className="mt-10 flex items-center justify-center gap-4" aria-label="Pagination">
      <Button variant="secondary" disabled={page === 0} onClick={() => onChange(page - 1)}>Previous</Button>
      <span className="text-sm text-ink/60">Page {page + 1} of {totalPages}</span>
      <Button variant="secondary" disabled={page + 1 >= totalPages} onClick={() => onChange(page + 1)}>Next</Button>
    </nav>
  );
}
