import { CheckCircle2, X } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

type ToastTone = "success" | "info";

type ToastInput = {
  title: string;
  description?: string;
  tone?: ToastTone;
};

type ToastItem = ToastInput & {
  id: string;
};

type ToastContextValue = {
  showToast(toast: ToastInput): void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback((toast: ToastInput) => {
    const id = globalThis.crypto?.randomUUID?.() ?? `toast-${Date.now()}-${Math.random()}`;
    setToasts((current) => [...current, { id, ...toast }]);
    window.setTimeout(() => removeToast(id), 4500);
  }, [removeToast]);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-[min(24rem,calc(100vw-1.5rem))] flex-col gap-3"
        aria-live="polite"
        aria-relevant="additions removals"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-2xl border bg-white px-4 py-3 shadow-2xl ${
              toast.tone === "success"
                ? "border-emerald-200"
                : "border-stone"
            }`}
            role="status"
          >
            <div className="flex items-start gap-3">
              <div
                className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                  toast.tone === "success"
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-linen text-ink"
                }`}
                aria-hidden="true"
              >
                <CheckCircle2 size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">{toast.title}</p>
                {toast.description && (
                  <p className="mt-1 text-sm leading-5 text-ink/65">
                    {toast.description}
                  </p>
                )}
              </div>
              <button
                type="button"
                className="rounded-full p-1 text-ink/45 transition hover:bg-ink/5 hover:text-ink"
                onClick={() => removeToast(toast.id)}
                aria-label="Dismiss toast"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
