"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { CheckCircle2, XCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastType = "success" | "error" | "info";

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastOptions {
  message: string;
  type?: ToastType;
}

interface ToastContextValue {
  toast: (opts: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 0;

const toastConfig: Record<
  ToastType,
  { borderClass: string; icon: React.ReactNode }
> = {
  success: {
    borderClass: "border-l-4 border-l-green-500",
    icon: <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />,
  },
  error: {
    borderClass: "border-l-4 border-l-destructive",
    icon: <XCircle className="h-4 w-4 text-destructive flex-shrink-0" />,
  },
  info: {
    borderClass: "border-l-4 border-l-primary",
    icon: <Info className="h-4 w-4 text-primary flex-shrink-0" />,
  },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback(({ message, type = "info" }: ToastOptions) => {
    const id = ++nextId;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed right-4 top-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => {
          const { borderClass, icon } = toastConfig[t.type];
          return (
            <div
              key={t.id}
              className={cn(
                "flex items-center gap-3 max-w-sm rounded-lg border border-border bg-card px-4 py-3 text-sm text-card-foreground shadow-lg",
                borderClass
              )}
            >
              {icon}
              <span>{t.message}</span>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
