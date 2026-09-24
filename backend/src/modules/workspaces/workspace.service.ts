import type { Request, Response } from "express";
import { randomBytes } from "crypto";
import { supabase } from "../../lib/supabase.js";
import { getWorkspaceRole, roleAtLeast, type WorkspaceRole } from "../../lib/ownership.js";

// Modelo copiado de Drive (unidades compartidas) / Figma teams / Frame.io:
// cada usuario tiene un workspace personal que se crea solo, y puede crear
// workspaces de equipo e invitar gente por email con un rol. La invitacion
// queda atada al email (como Drive): solo la puede aceptar una cuenta
// logueada con ese mismo email.

const INVITABLE_ROLES: WorkspaceRole[] = ["admin", "editor", "viewer"];

function normalizeEmail(email: unknown): string | null {
  if (typeof email !== "string") return null;
  const trimmed = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null;
}

function inviteUrl(token: string): string {
  const base = process.env.FRONTEND_ORIGIN ?? "http://localhost:8443";
  return `${base}/invites/${token}`;
}

// Idempotente: el indice unico parcial (owner_id where is_personal) evita
// duplicados si dos requests llegan a la vez.
export async function ensurePersonalWorkspace(userId: string, email?: string | null): Promise<string> {
  const { data: existing } = await supabase
    .from("workspaces")
    .select("id")
    .eq("owner_id", userId)
    .eq("is_personal", true)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: created, error } = await supabase
    .from("workspaces")
    .insert({ name: "Mi workspace", owner_id: userId, is_personal: true })
    .select("id")
    .single();

  if (error || !created) {
    // Carrera con otra request: el insert choco con el indice unico.
    const { data: again } = await supabase
      .from("workspaces")
      .select("id")
      .eq("owner_id", userId)
      .eq("is_personal", true)
      .single();
    if (!again) throw new Error(error?.message ?? "No se pudo crear el workspace personal");
    return again.id;
  }

  await supabase
    .from("workspace_members")
    .upsert({ workspace_id: created.id, user_id: userId, role: "owner", email: email?.toLowerCase() ?? null });
  return created.id;
}

export async function listWorkspaces(req: Request, res: Response) {
  try {
    const userId = req.user!.id;
    await ensurePersonalWorkspace(userId, req.user!.email);

    const { data: memberships, error } = await supabase
      .from("workspace_members")
      .select("role, workspaces(id, name, owner_id, is_personal, created_at)")
      .eq("user_id", userId);
    if (error) return res.status(400).json({ error: error.message });

    const ids = (memberships ?? []).map((m) => (m.workspaces as unknown as { id: string }).id);
    const { data: members } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .in("workspace_id", ids);

    const counts = new Map<string, number>();
    for (const m of members ?? []) counts.set(m.workspace_id, (counts.get(m.workspace_id) ?? 0) + 1);

    const result = (memberships ?? [])
      .map((m) => {
        const ws = m.workspaces as unknown as {
          id: string; name: string; owner_id: string; is_personal: boolean; created_at: string;
        };
        return { ...ws, my_role: m.role, member_count: counts.get(ws.id) ?? 1 };
      })
      // Personal primero, despues por fecha de creacion.
      .sort((a, b) =>
        a.is_personal === b.is_personal
          ? a.created_at.localeCompare(b.created_at)
          : a.is_personal ? -1 : 1
      );

    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function createWorkspace(req: Request, res: Response) {
  try {
    const userId = req.user!.id;
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name) return res.status(400).json({ error: "name is required" });

    const { data: ws, error } = await supabase
      .from("workspaces")
      .insert({ name, owner_id: userId, is_personal: false })
      .select()
      .single();
    if (error || !ws) return res.status(400).json({ error: error?.message });

    const { error: memberError } = await supabase
      .from("workspace_members")
      .insert({ workspace_id: ws.id, user_id: userId, role: "owner", email: req.user!.email?.toLowerCase() ?? null });
    if (memberError) {
      await supabase.from("workspaces").delete().eq("id", ws.id);
      return res.status(400).json({ error: memberError.message });
    }

    return res.status(201).json({ ...ws, my_role: "owner", member_count: 1 });
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function updateWorkspace(req: Request, res: Response) {
  try {
    const { workspace_id } = req.params;
    const role = await getWorkspaceRole(workspace_id, req.user!.id);
    if (!roleAtLeast(role, "admin")) return res.status(404).json({ error: "Workspace not found" });

    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name) return res.status(400).json({ error: "name is required" });

    const { data, error } = await supabase
      .from("workspaces")
      .update({ name, updated_at: new Date().toISOString() })
      .eq("id", workspace_id)
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function deleteWorkspace(req: Request, res: Response) {
  try {
    const { workspace_id } = req.params;
    const role = await getWorkspaceRole(workspace_id, req.user!.id);
    if (role !== "owner") return res.status(404).json({ error: "Workspace not found" });

    const { data: ws } = await supabase
      .from("workspaces")
      .select("is_personal")
      .eq("id", workspace_id as string)
      .single();
    if (ws?.is_personal) {
      return res.status(400).json({ error: "El workspace personal no se puede borrar" });
    }

    // Los proyectos no se borran: el FK es "on delete set null" y vuelven a
    // quedar solo visibles para su creador.
    const { error } = await supabase.from("workspaces").delete().eq("id", workspace_id as string);
    if (error) return res.status(400).json({ error: error.message });

    return res.status(204).send();
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function listMembers(req: Request, res: Response) {
  try {
    const { workspace_id } = req.params;
    const role = await getWorkspaceRole(workspace_id, req.user!.id);
    if (!role) return res.status(404).json({ error: "Workspace not found" });

    const { data: members, error } = await supabase
      .from("workspace_members")
      .select("user_id, role, email, created_at")
      .eq("workspace_id", workspace_id as string)
      .order("created_at", { ascending: true });
    if (error) return res.status(400).json({ error: error.message });

    // Las invitaciones pendientes (y su link) solo las ven quienes pueden
    // gestionarlas.
    let invites: unknown[] = [];
    if (roleAtLeast(role, "admin")) {
      const { data } = await supabase
        .from("workspace_invites")
        .select("id, email, role, token, expires_at, created_at")
        .eq("workspace_id", workspace_id as string)
        .eq("status", "PENDING")
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false });
      invites = (data ?? []).map(({ token, ...rest }) => ({ ...rest, invite_url: inviteUrl(token) }));
    }

    return res.status(200).json({ my_role: role, members: members ?? [], invites });
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function createInvite(req: Request, res: Response) {
  try {
    const { workspace_id } = req.params;
    const userId = req.user!.id;
    const myRole = await getWorkspaceRole(workspace_id, userId);
    if (!roleAtLeast(myRole, "admin")) return res.status(404).json({ error: "Workspace not found" });

    const email = normalizeEmail(req.body?.email);
    if (!email) return res.status(400).json({ error: "email invalido" });

    const role = (req.body?.role ?? "editor") as WorkspaceRole;
    if (!INVITABLE_ROLES.includes(role)) return res.status(400).json({ error: "role invalido" });
    // Un admin no puede crear otro admin por encima de lo que el owner decida.
    if (role === "admin" && myRole !== "owner") {
      return res.status(403).json({ error: "Solo el owner puede invitar admins" });
    }

    const { data: alreadyMember } = await supabase
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", workspace_id as string)
      .eq("email", email)
      .maybeSingle();
    if (alreadyMember) return res.status(409).json({ error: "Ese email ya es miembro del workspace" });

    // Re-invitar al mismo email reemplaza la invitacion anterior (nuevo
    // token, nuevo vencimiento) en vez de fallar por el indice unico.
    await supabase
      .from("workspace_invites")
      .update({ status: "REVOKED" })
      .eq("workspace_id", workspace_id as string)
      .eq("email", email)
      .eq("status", "PENDING");

    const token = randomBytes(24).toString("base64url");
    const { data: invite, error } = await supabase
      .from("workspace_invites")
      .insert({ workspace_id, email, role, token, invited_by: userId })
      .select("id, email, role, expires_at, created_at")
      .single();
    if (error || !invite) return res.status(400).json({ error: error?.message });

    return res.status(201).json({ ...invite, invite_url: inviteUrl(token) });
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function revokeInvite(req: Request, res: Response) {
  try {
    const { workspace_id, invite_id } = req.params;
    const role = await getWorkspaceRole(workspace_id, req.user!.id);
    if (!roleAtLeast(role, "admin")) return res.status(404).json({ error: "Workspace not found" });

    const { error } = await supabase
      .from("workspace_invites")
      .update({ status: "REVOKED" })
      .eq("id", invite_id as string)
      .eq("workspace_id", workspace_id as string)
      .eq("status", "PENDING");
    if (error) return res.status(400).json({ error: error.message });

    return res.status(204).send();
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function updateMemberRole(req: Request, res: Response) {
  try {
    const { workspace_id, user_id } = req.params;
    const myRole = await getWorkspaceRole(workspace_id, req.user!.id);
    if (!roleAtLeast(myRole, "admin")) return res.status(404).json({ error: "Workspace not found" });

    const role = req.body?.role as WorkspaceRole;
    if (!INVITABLE_ROLES.includes(role)) return res.status(400).json({ error: "role invalido" });

    const targetRole = await getWorkspaceRole(workspace_id, user_id as string);
    if (!targetRole) return res.status(404).json({ error: "Member not found" });
    if (targetRole === "owner") return res.status(400).json({ error: "No se puede cambiar el rol del owner" });
    if (myRole !== "owner" && (targetRole === "admin" || role === "admin")) {
      return res.status(403).json({ error: "Solo el owner puede gestionar admins" });
    }

    const { data, error } = await supabase
      .from("workspace_members")
      .update({ role })
      .eq("workspace_id", workspace_id as string)
      .eq("user_id", user_id as string)
      .select("user_id, role, email, created_at")
      .single();
    if (error) return res.status(400).json({ error: error.message });

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

// Sirve tanto para "sacar a alguien" (admin) como para "salir del
// workspace" (el propio miembro, user_id === yo).
export async function removeMember(req: Request, res: Response) {
  try {
    const { workspace_id, user_id } = req.params;
    const me = req.user!.id;
    const myRole = await getWorkspaceRole(workspace_id, me);
    if (!myRole) return res.status(404).json({ error: "Workspace not found" });

    const targetRole = await getWorkspaceRole(workspace_id, user_id as string);
    if (!targetRole) return res.status(404).json({ error: "Member not found" });
    if (targetRole === "owner") {
      return res.status(400).json({ error: "El owner no puede salir ni ser removido del workspace" });
    }

    const isSelf = user_id === me;
    if (!isSelf) {
      if (!roleAtLeast(myRole, "admin")) return res.status(403).json({ error: "Forbidden" });
      if (targetRole === "admin" && myRole !== "owner") {
        return res.status(403).json({ error: "Solo el owner puede remover admins" });
      }
    }

    const { error } = await supabase
      .from("workspace_members")
      .delete()
      .eq("workspace_id", workspace_id as string)
      .eq("user_id", user_id as string);
    if (error) return res.status(400).json({ error: error.message });

    return res.status(204).send();
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

// Bandeja de "compartido conmigo": invitaciones pendientes para mi email.
export async function listMyInvites(req: Request, res: Response) {
  try {
    const email = normalizeEmail(req.user!.email);
    if (!email) return res.status(200).json([]);

    const { data, error } = await supabase
      .from("workspace_invites")
      .select("id, role, token, expires_at, created_at, workspaces(id, name)")
      .eq("email", email)
      .eq("status", "PENDING")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });
    if (error) return res.status(400).json({ error: error.message });

    return res.status(200).json(
      (data ?? []).map((inv) => ({ ...inv, workspace: inv.workspaces, workspaces: undefined }))
    );
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

async function findPendingInvite(token: string) {
  const { data } = await supabase
    .from("workspace_invites")
    .select("id, workspace_id, email, role, expires_at, status, workspaces(name)")
    .eq("token", token)
    .maybeSingle();
  if (!data || data.status !== "PENDING" || new Date(data.expires_at) < new Date()) return null;
  return data;
}

export async function getInvite(req: Request, res: Response) {
  try {
    const invite = await findPendingInvite(req.params.token as string);
    if (!invite) return res.status(404).json({ error: "Invitacion invalida o vencida" });

    return res.status(200).json({
      email: invite.email,
      role: invite.role,
      expires_at: invite.expires_at,
      workspace_name: (invite.workspaces as unknown as { name: string } | null)?.name ?? null,
      email_matches: normalizeEmail(req.user!.email) === invite.email.toLowerCase(),
    });
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function acceptInvite(req: Request, res: Response) {
  try {
    const userId = req.user!.id;
    const invite = await findPendingInvite(req.params.token as string);
    if (!invite) return res.status(404).json({ error: "Invitacion invalida o vencida" });

    if (normalizeEmail(req.user!.email) !== invite.email.toLowerCase()) {
      return res.status(403).json({
        error: `Esta invitacion es para ${invite.email}. Inicia sesion con esa cuenta para aceptarla.`,
      });
    }

    const existingRole = await getWorkspaceRole(invite.workspace_id, userId);
    if (!existingRole) {
      const { error } = await supabase.from("workspace_members").insert({
        workspace_id: invite.workspace_id,
        user_id: userId,
        role: invite.role,
        email: invite.email.toLowerCase(),
      });
      if (error) return res.status(400).json({ error: error.message });
    }

    await supabase
      .from("workspace_invites")
      .update({ status: "ACCEPTED", accepted_at: new Date().toISOString() })
      .eq("id", invite.id);

    return res.status(200).json({ workspace_id: invite.workspace_id, role: existingRole ?? invite.role });
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}
