import { Router } from "express";
import {
  listWorkspaces,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
  listMembers,
  createInvite,
  revokeInvite,
  updateMemberRole,
  removeMember,
  listMyInvites,
  getInvite,
  acceptInvite,
} from "./workspace.service.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";

// Mounted at /workspaces
export const workspaceRouter = Router();
workspaceRouter.get("/", authMiddleware, listWorkspaces);
workspaceRouter.post("/", authMiddleware, createWorkspace);
workspaceRouter.patch("/:workspace_id", authMiddleware, updateWorkspace);
workspaceRouter.delete("/:workspace_id", authMiddleware, deleteWorkspace);
workspaceRouter.get("/:workspace_id/members", authMiddleware, listMembers);
workspaceRouter.patch("/:workspace_id/members/:user_id", authMiddleware, updateMemberRole);
workspaceRouter.delete("/:workspace_id/members/:user_id", authMiddleware, removeMember);
workspaceRouter.post("/:workspace_id/invites", authMiddleware, createInvite);
workspaceRouter.delete("/:workspace_id/invites/:invite_id", authMiddleware, revokeInvite);

// Mounted at /invites
export const inviteRouter = Router();
inviteRouter.get("/", authMiddleware, listMyInvites);
inviteRouter.get("/:token", authMiddleware, getInvite);
inviteRouter.post("/:token/accept", authMiddleware, acceptInvite);
