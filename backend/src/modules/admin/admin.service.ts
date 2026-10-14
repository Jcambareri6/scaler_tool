import type { Request, Response } from "express";
import { z } from "zod";
import { supabase } from "../../lib/supabase.js";
import { WELCOME_VIDEOS, forgetApprovalCache, isAdmin, type UserAccount } from "../../lib/accounts.js";

// Panel de administracion: aprobar/rechazar cuentas y cargar videos. Todas
// las rutas van detras de authMiddleware + requireAdmin (admin.route.ts).

const STATUSES = ["pending", "approved", "rejected"] as const;

const creditsSchema = z.object({
  amount: z.number().int().refine((n) => n !== 0, "amount no puede ser 0").refine((n) => Math.abs(n) <= 1000, "amount fuera de rango"),
  note: z.string().trim().max(300).optional(),
});

const unlimitedSchema = z.object({ unlimited: z.boolean() });

function targetId(req: Request): string | null {
  const id = req.params.user_id;
  return typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

async function getAccountRow(userId: string): Promise<UserAccount | null> {
  const { data } = await supabase.from("user_accounts").select("*").eq("user_id", userId).maybeSingle();
  return (data as UserAccount | null) ?? null;
}

// Fila que devuelven listUsers y las acciones sobre una cuenta.
async function userSummary(userId: string) {
  const [account, credits, lastRender] = await Promise.all([
    getAccountRow(userId),
    supabase.from("video_credits").select("balance, used").eq("user_id", userId).maybeSingle(),
    supabase
      .from("video_credit_movements")
      .select("created_at")
      .eq("user_id", userId)
      .eq("reason", "render")
      .order("created_at", { ascending: false })
      .limit(1),
  ]);
  if (!account) return null;
  return {
    id: account.user_id,
    email: account.email,
    status: account.status,
    unlimited: account.unlimited,
    is_admin: isAdmin(account.user_id),
    videos_available: credits.data?.balance ?? 0,
    videos_used: credits.data?.used ?? 0,
    created_at: account.created_at,
    reviewed_at: account.reviewed_at,
    last_render_at: lastRender.data?.[0]?.created_at ?? null,
  };
}

// GET /admin/users?status=pending|approved|rejected
export async function listUsers(req: Request, res: Response) {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    if (status && !STATUSES.includes(status as (typeof STATUSES)[number])) {
      return res.status(400).json({ error: "status invalido" });
    }

    let accountsQuery = supabase.from("user_accounts").select("*").order("created_at", { ascending: false });
    if (status) accountsQuery = accountsQuery.eq("status", status);
    const { data: accounts, error } = await accountsQuery;
    if (error) throw error;

    const ids = (accounts ?? []).map((a) => a.user_id as string);
    const [credits, renders] = ids.length
      ? await Promise.all([
          supabase.from("video_credits").select("user_id, balance, used").in("user_id", ids),
          supabase
            .from("video_credit_movements")
            .select("user_id, created_at")
            .in("user_id", ids)
            .eq("reason", "render")
            .order("created_at", { ascending: false }),
        ])
      : [{ data: [] }, { data: [] }];

    const creditsByUser = new Map((credits.data ?? []).map((c) => [c.user_id as string, c]));
    const lastRenderByUser = new Map<string, string>();
    for (const r of renders.data ?? []) {
      if (!lastRenderByUser.has(r.user_id as string)) lastRenderByUser.set(r.user_id as string, r.created_at as string);
    }

    return res.status(200).json(
      (accounts ?? []).map((a) => ({
        id: a.user_id,
        email: a.email,
        status: a.status,
        unlimited: a.unlimited,
        is_admin: isAdmin(a.user_id as string),
        videos_available: creditsByUser.get(a.user_id as string)?.balance ?? 0,
        videos_used: creditsByUser.get(a.user_id as string)?.used ?? 0,
        created_at: a.created_at,
        reviewed_at: a.reviewed_at,
        last_render_at: lastRenderByUser.get(a.user_id as string) ?? null,
      }))
    );
  } catch (error) {
    console.error("[admin] listUsers:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// POST /admin/users/:user_id/approve -- aprueba y da los videos de
// bienvenida (una sola vez por cuenta, aunque se apruebe de nuevo).
export async function approveUser(req: Request, res: Response) {
  try {
    const userId = targetId(req);
    if (!userId || !(await getAccountRow(userId))) return res.status(404).json({ error: "Usuario no encontrado" });

    const { error } = await supabase.rpc("approve_user_account", {
      p_user_id: userId,
      p_admin_id: req.user!.id,
      p_welcome_videos: WELCOME_VIDEOS,
    });
    if (error) throw error;
    forgetApprovalCache(userId);
    return res.status(200).json(await userSummary(userId));
  } catch (error) {
    console.error("[admin] approveUser:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// POST /admin/users/:user_id/reject
export async function rejectUser(req: Request, res: Response) {
  try {
    const userId = targetId(req);
    if (!userId || !(await getAccountRow(userId))) return res.status(404).json({ error: "Usuario no encontrado" });
    if (isAdmin(userId)) return res.status(400).json({ error: "No se puede rechazar a un administrador" });

    const { error } = await supabase
      .from("user_accounts")
      .update({ status: "rejected", reviewed_by: req.user!.id, reviewed_at: new Date().toISOString() })
      .eq("user_id", userId);
    if (error) throw error;
    forgetApprovalCache(userId);
    return res.status(200).json(await userSummary(userId));
  } catch (error) {
    console.error("[admin] rejectUser:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// POST /admin/users/:user_id/credits { amount, note? } -- amount positivo
// carga videos, negativo los saca (nunca deja el saldo en negativo).
export async function adjustCredits(req: Request, res: Response) {
  try {
    const userId = targetId(req);
    if (!userId || !(await getAccountRow(userId))) return res.status(404).json({ error: "Usuario no encontrado" });

    const parsed = creditsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "La cantidad tiene que ser un número entero distinto de 0 (máximo 1000)" });
    }

    const { error } = await supabase.rpc("adjust_video_credits", {
      p_user_id: userId,
      p_amount: parsed.data.amount,
      p_note: parsed.data.note || null,
      p_admin_id: req.user!.id,
    });
    if (error) {
      if (error.message.includes("insufficient_balance")) {
        return res.status(400).json({ error: "No tiene tantos videos para sacar" });
      }
      throw error;
    }
    return res.status(200).json(await userSummary(userId));
  } catch (error) {
    console.error("[admin] adjustCredits:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// POST /admin/users/:user_id/unlimited { unlimited } -- cuentas del equipo
// que renderizan sin descontar videos.
export async function setUnlimited(req: Request, res: Response) {
  try {
    const userId = targetId(req);
    if (!userId || !(await getAccountRow(userId))) return res.status(404).json({ error: "Usuario no encontrado" });

    const parsed = unlimitedSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "unlimited tiene que ser true o false" });

    const { error } = await supabase
      .from("user_accounts")
      .update({ unlimited: parsed.data.unlimited })
      .eq("user_id", userId);
    if (error) throw error;
    return res.status(200).json(await userSummary(userId));
  } catch (error) {
    console.error("[admin] setUnlimited:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// GET /admin/users/:user_id/movements -- historial de cargas, usos y
// devoluciones, del mas nuevo al mas viejo.
export async function listMovements(req: Request, res: Response) {
  try {
    const userId = targetId(req);
    if (!userId) return res.status(404).json({ error: "Usuario no encontrado" });

    const { data, error } = await supabase
      .from("video_credit_movements")
      .select("id, amount, reason, note, project_id, created_by, created_at, video_projects(title)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;

    const authorIds = [...new Set((data ?? []).map((m) => m.created_by).filter(Boolean))] as string[];
    const { data: authors } = authorIds.length
      ? await supabase.from("user_accounts").select("user_id, email").in("user_id", authorIds)
      : { data: [] };
    const emailById = new Map((authors ?? []).map((a) => [a.user_id as string, a.email as string]));

    return res.status(200).json(
      (data ?? []).map((m) => ({
        id: m.id,
        amount: m.amount,
        reason: m.reason,
        note: m.note,
        project_title: (m.video_projects as { title?: string } | null)?.title ?? null,
        created_by_email: m.created_by ? emailById.get(m.created_by as string) ?? null : null,
        created_at: m.created_at,
      }))
    );
  } catch (error) {
    console.error("[admin] listMovements:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
