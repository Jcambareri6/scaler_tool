import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/authContext";
import { accountService, type Account } from "@/services/account.service";

interface AccountContextValue {
  account: Account | null;
  loading: boolean;
  // Vuelve a pedir /auth/me (ej: despues de renderizar, para actualizar el
  // saldo de videos del menu).
  refresh: () => Promise<void>;
}

const AccountContext = createContext<AccountContextValue | null>(null);

export function AccountProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setAccount(await accountService.getMe());
    } catch {
      // Si /auth/me falla no se bloquea la app desde aca: el backend igual
      // rechaza a las cuentas no aprobadas en cada pedido.
      setAccount(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [user?.id, refresh]);

  return <AccountContext.Provider value={{ account, loading, refresh }}>{children}</AccountContext.Provider>;
}

export function useAccount(): AccountContextValue {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error("useAccount must be used within AccountProvider");
  return ctx;
}
