import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type ToastKind = "success" | "error" | "info";

interface ToastItem {
  id: string;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  showToast: (kind: ToastKind, message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const KIND_STYLE: Record<ToastKind, { bg: string; border: string; color: string }> = {
  success: { bg: "rgba(16,185,129,0.12)", border: "rgba(52,211,153,0.3)", color: "rgba(110,231,183,0.95)" },
  error: { bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.3)", color: "rgba(252,165,165,0.95)" },
  info: { bg: "rgba(124,106,255,0.12)", border: "rgba(124,106,255,0.3)", color: "rgba(196,189,255,0.95)" },
};

// Provider global para feedback no bloqueante (exito/error/info) -- pensado
// para las acciones que antes fallaban en silencio (ver auditoria seccion 4:
// botones que quedan colgados sin avisar nada) y para acciones puntuales sin
// un lugar natural donde mostrar un mensaje inline (ej. boton "Compartir").
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback((kind: ToastKind, message: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const dismiss = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id));

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2 max-w-sm">
        {toasts.map((toast) => {
          const style = KIND_STYLE[toast.kind];
          return (
            <div
              key={toast.id}
              role="status"
              onClick={() => dismiss(toast.id)}
              className="rounded-xl px-4 py-3 text-sm cursor-pointer shadow-lg"
              style={{
                background: style.bg,
                border: `1px solid ${style.border}`,
                color: style.color,
                backdropFilter: "blur(16px)",
                boxShadow: "0 8px 32px rgba(0,0,0,0.35)",
                animation: "fadeInUp 0.2s ease-out",
              }}
            >
              {toast.message}
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast debe usarse dentro de ToastProvider");
  return ctx;
}
