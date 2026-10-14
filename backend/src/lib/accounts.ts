import { supabase } from "./supabase.js";
import { envInt } from "./env.js";

// Aprobacion de cuentas + saldo de videos (migracion
// 20261015010000_accounts_and_video_credits.sql). Toda la logica que tiene
// que ser atomica (cobrar, devolver, aprobar, ajustar) vive en funciones SQL;
// aca solo se las llama.

export type AccountStatus = "pending" | "approved" | "rejected";

export interface UserAccount {
  user_id: string;
  email: string;
  status: AccountStatus;
  unlimited: boolean;
  created_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
}

export interface VideoCredits {
  balance: number;
  used: number;
}

// Videos que recibe una cuenta la primera vez que se aprueba.
export const WELCOME_VIDEOS = envInt("WELCOME_VIDEOS", 5, 0);

// Lista de UUIDs de Supabase Auth con permisos de administrador (aprobar
// cuentas, cargar videos, configurar providers). Los admins nunca quedan
// bloqueados por la aprobacion.
export function isAdmin(userId: string): boolean {
  return (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .includes(userId);
}

// Crea la cuenta 'pending' la primera vez (registro con mail o con Google) y
// devuelve su estado actual.
export async function ensureAccount(userId: string, email: string): Promise<UserAccount> {
  const { data, error } = await supabase.rpc("ensure_user_account", { p_user_id: userId, p_email: email });
  if (error) throw new Error(`No se pudo leer la cuenta: ${error.message}`);
  const account = (Array.isArray(data) ? data[0] : data) as UserAccount | undefined;
  if (!account) throw new Error("No se pudo leer la cuenta");
  return account;
}

export async function getVideoCredits(userId: string): Promise<VideoCredits> {
  const { data, error } = await supabase
    .from("video_credits")
    .select("balance, used")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer el saldo de videos: ${error.message}`);
  return { balance: data?.balance ?? 0, used: data?.used ?? 0 };
}

// Cuentas aprobadas recientemente: evita una consulta a la base en cada
// pedido. Solo se cachea "aprobada" -- pendiente y rechazada se vuelven a
// consultar siempre, asi aprobar a alguien tiene efecto en el acto.
// Rechazar a alguien ya aprobado tarda como mucho APPROVED_CACHE_MS.
const APPROVED_CACHE_MS = 60 * 1000;
const approvedUntil = new Map<string, number>();

export function forgetApprovalCache(userId: string): void {
  approvedUntil.delete(userId);
}

export async function getAccountStatus(userId: string, email: string): Promise<AccountStatus> {
  const until = approvedUntil.get(userId);
  if (until !== undefined && until > Date.now()) return "approved";

  const account = await ensureAccount(userId, email);
  if (account.status === "approved") {
    approvedUntil.set(userId, Date.now() + APPROVED_CACHE_MS);
  } else {
    approvedUntil.delete(userId);
  }
  return account.status;
}

export type ChargeResult = "already_charged" | "unlimited" | "charged" | "no_credits";

// Al apretar Renderizar (ver charge_render en la migracion).
export async function chargeRender(projectId: string): Promise<ChargeResult> {
  const { data, error } = await supabase.rpc("charge_render", { p_project_id: projectId });
  if (error) throw new Error(`No se pudo descontar el video: ${error.message}`);
  return data as ChargeResult;
}

// Devuelve el video si el render fallo definitivamente sin haber dejado
// nunca un video final. Nunca tira: un fallo aca se loguea y no debe tapar
// el error original del render.
export async function refundRender(projectId: string): Promise<void> {
  const { data, error } = await supabase.rpc("refund_render", { p_project_id: projectId });
  if (error) {
    console.error(`[credits] no se pudo devolver el video del proyecto ${projectId}: ${error.message}`);
    return;
  }
  if (data === true) console.log(`[credits] video devuelto al proyecto ${projectId} (render fallido)`);
}
