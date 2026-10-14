import { api } from "@/lib/api";

export type AccountStatus = "pending" | "approved" | "rejected";

export interface Account {
  id: string;
  email: string;
  status: AccountStatus;
  isAdmin: boolean;
  unlimited: boolean;
  videosAvailable: number;
  videosUsed: number;
}

export interface AdminUser extends Account {
  createdAt: string;
  reviewedAt: string | null;
  lastRenderAt: string | null;
}

export interface CreditMovement {
  id: string;
  amount: number;
  reason: "welcome" | "admin_load" | "admin_remove" | "render" | "render_refund";
  note: string | null;
  projectTitle: string | null;
  createdByEmail: string | null;
  createdAt: string;
}

interface AccountRow {
  id: string;
  email: string;
  status: AccountStatus;
  is_admin: boolean;
  unlimited: boolean;
  videos_available: number;
  videos_used: number;
}

interface AdminUserRow extends AccountRow {
  created_at: string;
  reviewed_at: string | null;
  last_render_at: string | null;
}

function mapAccount(row: AccountRow): Account {
  return {
    id: row.id,
    email: row.email,
    status: row.status,
    isAdmin: row.is_admin,
    unlimited: row.unlimited,
    videosAvailable: row.videos_available,
    videosUsed: row.videos_used,
  };
}

function mapAdminUser(row: AdminUserRow): AdminUser {
  return {
    ...mapAccount(row),
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    lastRenderAt: row.last_render_at,
  };
}

export const accountService = {
  // Estado de la cuenta logueada: aprobacion, admin y saldo de videos.
  async getMe(): Promise<Account> {
    return mapAccount(await api.get<AccountRow>("/auth/me"));
  },
};

// Panel de administracion (solo admins, ver backend/src/modules/admin).
export const adminService = {
  async listUsers(): Promise<AdminUser[]> {
    const rows = await api.get<AdminUserRow[]>("/admin/users");
    return rows.map(mapAdminUser);
  },
  async approve(userId: string): Promise<AdminUser> {
    return mapAdminUser(await api.post<AdminUserRow>(`/admin/users/${userId}/approve`));
  },
  async reject(userId: string): Promise<AdminUser> {
    return mapAdminUser(await api.post<AdminUserRow>(`/admin/users/${userId}/reject`));
  },
  async adjustCredits(userId: string, amount: number, note?: string): Promise<AdminUser> {
    return mapAdminUser(
      await api.post<AdminUserRow>(`/admin/users/${userId}/credits`, { amount, ...(note?.trim() ? { note: note.trim() } : {}) })
    );
  },
  async setUnlimited(userId: string, unlimited: boolean): Promise<AdminUser> {
    return mapAdminUser(await api.post<AdminUserRow>(`/admin/users/${userId}/unlimited`, { unlimited }));
  },
  async listMovements(userId: string): Promise<CreditMovement[]> {
    const rows = await api.get<
      {
        id: string;
        amount: number;
        reason: CreditMovement["reason"];
        note: string | null;
        project_title: string | null;
        created_by_email: string | null;
        created_at: string;
      }[]
    >(`/admin/users/${userId}/movements`);
    return rows.map((r) => ({
      id: r.id,
      amount: r.amount,
      reason: r.reason,
      note: r.note,
      projectTitle: r.project_title,
      createdByEmail: r.created_by_email,
      createdAt: r.created_at,
    }));
  },
};
