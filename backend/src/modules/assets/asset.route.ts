import { Router } from "express";
import {
  createAsset,
  listAssets,
  getAsset,
  updateAsset,
  deleteAsset,
} from "./asset.service.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";

// Mounted at /projects/:project_id/assets
export const assetListRouter = Router({ mergeParams: true });
assetListRouter.post("/", authMiddleware, createAsset);
assetListRouter.get("/", authMiddleware, listAssets);

// Mounted at /assets/:asset_id
export const assetRouter = Router({ mergeParams: true });
assetRouter.get("/", authMiddleware, getAsset);
assetRouter.patch("/", authMiddleware, updateAsset);
assetRouter.delete("/", authMiddleware, deleteAsset);
