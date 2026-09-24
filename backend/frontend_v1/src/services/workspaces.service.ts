import { api } from "@/lib/api";
import type { Workspace, WorkspaceMember, WorkspaceInvite, WorkspaceRole, MyInvite } from "@/types";

interface WorkspaceRow {
  id: string;
  name: string;
  owner_id: string;
  is_personal: boolean;
  my_role: WorkspaceRole;
  member_count: number;
  created_at: string;
}

interface MemberRow {
  user_id: string;
  email: string | null;
  role: WorkspaceRole;
  created_at: string;
}

interface InviteRow {
  id: string;
  email: string;
  role: WorkspaceRole;
  invite_url: string;
  expires_at: string;
}

interface MyInviteRow {
  id: string;
  token: string;
  role: WorkspaceRole;
  expires_at: string;
  workspace: { id: string; name: string } | null;
}

export interface InvitePreview {
  email: string;
  role: WorkspaceRole;
  expiresAt: string;
  workspaceName: string | null;
  emailMatches: boolean;
}

const mapWorkspace = (row: WorkspaceRow): Workspace => ({
  id: row.id,
  name: row.name,
  ownerId: row.owner_id,
  isPersonal: row.is_personal,
  myRole: row.my_role,
  memberCount: row.member_count,
  createdAt: row.created_at,
});

const mapMember = (row: MemberRow): WorkspaceMember => ({
  userId: row.user_id,
  email: row.email,
  role: row.role,
  createdAt: row.created_at,
});

const mapInvite = (row: InviteRow): WorkspaceInvite => ({
  id: row.id,
  email: row.email,
  role: row.role,
  inviteUrl: row.invite_url,
  expiresAt: row.expires_at,
});

export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: "Propietario",
  admin: "Administrador",
  editor: "Editor",
  viewer: "Lector",
};

export const ROLE_DESCRIPTIONS: Record<WorkspaceRole, string> = {
  owner: "Control total del workspace",
  admin: "Invita y gestiona miembros, borra proyectos",
  editor: "Edita guion, escenas y clips, genera previews y renders",
  viewer: "Solo ve proyectos y previews",
};

export const workspacesService = {
  async list(): Promise<Workspace[]> {
    const rows = await api.get<WorkspaceRow[]>("/workspaces");
    return rows.map(mapWorkspace);
  },

  async create(name: string): Promise<Workspace> {
    return mapWorkspace(await api.post<WorkspaceRow>("/workspaces", { name }));
  },

  async rename(id: string, name: string): Promise<void> {
    await api.patch(`/workspaces/${id}`, { name });
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/workspaces/${id}`);
  },

  async members(id: string): Promise<{ myRole: WorkspaceRole; members: WorkspaceMember[]; invites: WorkspaceInvite[] }> {
    const res = await api.get<{ my_role: WorkspaceRole; members: MemberRow[]; invites: InviteRow[] }>(
      `/workspaces/${id}/members`
    );
    return { myRole: res.my_role, members: res.members.map(mapMember), invites: res.invites.map(mapInvite) };
  },

  async invite(id: string, email: string, role: WorkspaceRole): Promise<WorkspaceInvite> {
    return mapInvite(await api.post<InviteRow>(`/workspaces/${id}/invites`, { email, role }));
  },

  async revokeInvite(id: string, inviteId: string): Promise<void> {
    await api.delete(`/workspaces/${id}/invites/${inviteId}`);
  },

  async updateMemberRole(id: string, userId: string, role: WorkspaceRole): Promise<void> {
    await api.patch(`/workspaces/${id}/members/${userId}`, { role });
  },

  async removeMember(id: string, userId: string): Promise<void> {
    await api.delete(`/workspaces/${id}/members/${userId}`);
  },

  async myInvites(): Promise<MyInvite[]> {
    const rows = await api.get<MyInviteRow[]>("/invites");
    return rows.map((r) => ({
      id: r.id,
      token: r.token,
      role: r.role,
      workspaceName: r.workspace?.name ?? "Workspace",
      expiresAt: r.expires_at,
    }));
  },

  async previewInvite(token: string): Promise<InvitePreview> {
    const r = await api.get<{
      email: string; role: WorkspaceRole; expires_at: string; workspace_name: string | null; email_matches: boolean;
    }>(`/invites/${token}`);
    return {
      email: r.email,
      role: r.role,
      expiresAt: r.expires_at,
      workspaceName: r.workspace_name,
      emailMatches: r.email_matches,
    };
  },

  async acceptInvite(token: string): Promise<{ workspaceId: string }> {
    const r = await api.post<{ workspace_id: string }>(`/invites/${token}/accept`);
    return { workspaceId: r.workspace_id };
  },
};
