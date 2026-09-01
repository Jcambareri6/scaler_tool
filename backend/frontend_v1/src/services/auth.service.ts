import { api, setToken, clearToken, getToken } from "@/lib/api";

export interface AuthUser {
  id: string;
  email: string;
}

interface SupabaseAuthPayload {
  user: AuthUser;
  session: { access_token: string; refresh_token: string } | null;
}

export const authService = {
  async login(email: string, password: string): Promise<AuthUser> {
    const data = await api.post<SupabaseAuthPayload>("/auth/login", { email, password });
    if (!data.session) {
      throw new Error("Login sin sesion — revisa la configuracion de Supabase Auth");
    }
    setToken(data.session.access_token);
    return data.user;
  },

  // Supabase puede devolver sesion inmediata (email confirmation off) o
  // requerir confirmar el mail primero (session: null) — el caller decide
  // que mostrar segun requiresLogin.
  async register(email: string, password: string): Promise<{ requiresLogin: boolean; user?: AuthUser }> {
    const data = await api.post<SupabaseAuthPayload>("/auth/register", { email, password });
    if (data.session) {
      setToken(data.session.access_token);
      return { requiresLogin: false, user: data.user };
    }
    return { requiresLogin: true };
  },

  logout(): void {
    clearToken();
  },

  isAuthenticated(): boolean {
    return Boolean(getToken());
  },

  // Pide la URL de autorizacion al backend y redirige el browser ahi —
  // Supabase hace el resto y vuelve a /auth/callback con el token.
  async signInWithOAuth(provider: "google" | "github"): Promise<void> {
    const redirectTo = `${window.location.origin}/auth/callback`;
    const { url } = await api.get<{ url: string }>(
      `/auth/oauth/${provider}?redirect_to=${encodeURIComponent(redirectTo)}`
    );
    window.location.href = url;
  },
};
