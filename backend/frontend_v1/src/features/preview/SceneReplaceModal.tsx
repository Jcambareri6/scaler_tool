import { useRef, useState } from "react";
import type { Asset, Scene } from "@/types";

interface Props {
  scene: Scene;
  // Assets YA asignados a esta escena (si los hay) -- solo para mostrar de
  // que keyword/clip vienen (metadata.keyword/provider/external_id, ver
  // replaceStockSegmentsForScene), no para editarlos aca.
  currentAssets: Asset[];
  onClose: () => void;
  // El modal ya NO espera la red -- junta los datos del tab elegido, se los
  // pasa al padre (StockReviewPanel) y se cierra al toque. El pedido real
  // (que puede tardar) corre ahi en segundo plano, para que el usuario pueda
  // seguir mirando/reemplazando otras escenas mientras tanto en vez de
  // quedar con el modal bloqueado tapando el resto de los clips.
  onSubmit: (sceneId: string, params: ReplaceParams) => void;
}

type Tab = "stock" | "upload" | "ai";

export type ReplaceParams =
  | { tab: "stock"; prompt: string }
  | { tab: "ai"; aiKind: "ai" | "ai_image"; aiPrompt: string }
  | { tab: "upload"; file: File };

// Modal de reemplazo puntual de una escena (click en "Reemplazar clip" desde
// el panel de escenas de StockReviewPanel) -- las tres vias que describe
// mejoras-interfaz-preview-scalertool.md: buscar stock, subir propio, o
// generar con IA. La llamada real a scene.service.ts (via projectsService)
// la hace el padre en segundo plano (ver onSubmit arriba), no este modal.
export default function SceneReplaceModal({ scene, currentAssets, onClose, onSubmit }: Props) {
  const [tab, setTab] = useState<Tab>("stock");
  const [stockPrompt, setStockPrompt] = useState(scene.visualPrompt ?? "");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiKind, setAiKind] = useState<"ai" | "ai_image">("ai");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = () => {
    setError(null);
    if (tab === "upload") {
      if (!file) {
        setError("Elegí un archivo primero");
        return;
      }
      onSubmit(scene.id, { tab: "upload", file });
    } else if (tab === "ai") {
      onSubmit(scene.id, { tab: "ai", aiKind, aiPrompt: aiPrompt.trim() });
    } else {
      onSubmit(scene.id, { tab: "stock", prompt: stockPrompt.trim() });
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl p-5 space-y-4"
        style={{
          background: "#0b0d13",
          border: "1px solid rgba(255,255,255,0.09)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
              Reemplazar clip · Escena {scene.order}
            </p>
            <p className="text-xs mt-0.5 line-clamp-2" style={{ color: "var(--muted-foreground)" }}>
              {scene.narrativeContent || "Sin narrativa para esta escena"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-opacity hover:opacity-80"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "var(--muted-foreground)" }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1.5 rounded-xl p-1" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
          {(
            [
              { id: "stock" as const, label: "Buscar stock" },
              { id: "upload" as const, label: "Subir propio" },
              { id: "ai" as const, label: "Video con IA" },
            ]
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex-1 text-xs font-medium py-1.5 rounded-lg transition-all duration-150"
              style={
                tab === t.id
                  ? { background: "rgba(124,106,255,0.15)", border: "1px solid rgba(124,106,255,0.3)", color: "var(--foreground)" }
                  : { background: "transparent", border: "1px solid transparent", color: "var(--muted-foreground)" }
              }
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Contenido por tab */}
        {tab === "stock" && (
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-widest mb-2" style={{ color: "var(--muted-foreground)" }}>
              Prompt de búsqueda
            </label>
            {/* De donde viene el/los clip/s YA asignados a esta escena --
                sirve para auditar si dos escenas que "se ven parecidas"
                son en realidad el mismo clip (mismo provider:external_id)
                o dos clips distintos que casualmente lucen similares.
                Solo informativo: no se pisa el textarea de abajo con esto
                (ver mismo criterio en ScenesPanel.tsx). */}
            {currentAssets.length > 0 && (
              <div className="mb-2 space-y-0.5">
                {currentAssets.map((a) => (
                  <p key={a.id} className="text-[11px] font-mono" style={{ color: "var(--muted-foreground)" }}>
                    {a.metadata?.keyword ? `Keyword: ${String(a.metadata.keyword)} · ` : ""}
                    Clip: <span style={{ color: "var(--foreground)" }}>{a.metadata?.provider ? `${a.metadata.provider}:${a.metadata.external_id}` : "sin datos"}</span>
                  </p>
                ))}
              </div>
            )}
            <textarea
              value={stockPrompt}
              onChange={(e) => setStockPrompt(e.target.value)}
              rows={3}
              placeholder="Si lo dejás vacío, se usa la narrativa de la escena..."
              className="input-glass w-full rounded-xl px-3 py-2.5 text-sm resize-none font-mono"
            />
          </div>
        )}

        {tab === "upload" && (
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-widest mb-2" style={{ color: "var(--muted-foreground)" }}>
              Archivo (video o imagen)
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*,image/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full rounded-xl px-3 py-4 text-sm text-center transition-colors"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px dashed rgba(255,255,255,0.15)",
                color: file ? "var(--foreground)" : "var(--muted-foreground)",
              }}
            >
              {file ? file.name : "Elegir archivo..."}
            </button>
          </div>
        )}

        {tab === "ai" && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <button
                onClick={() => setAiKind("ai")}
                className="flex-1 text-xs font-medium py-2 rounded-lg transition-all duration-150"
                style={
                  aiKind === "ai"
                    ? { background: "rgba(124,106,255,0.15)", border: "1px solid rgba(124,106,255,0.3)", color: "var(--foreground)" }
                    : { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", color: "var(--muted-foreground)" }
                }
              >
                Video con IA
              </button>
              <button
                onClick={() => setAiKind("ai_image")}
                className="flex-1 text-xs font-medium py-2 rounded-lg transition-all duration-150"
                style={
                  aiKind === "ai_image"
                    ? { background: "rgba(124,106,255,0.15)", border: "1px solid rgba(124,106,255,0.3)", color: "var(--foreground)" }
                    : { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", color: "var(--muted-foreground)" }
                }
              >
                Imagen con IA
              </button>
            </div>
            <div>
              <label className="block text-[11px] font-medium uppercase tracking-widest mb-2" style={{ color: "var(--muted-foreground)" }}>
                Prompt de generación
              </label>
              <textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                rows={3}
                placeholder="Si lo dejás vacío, se deriva de la narrativa de la escena..."
                className="input-glass w-full rounded-xl px-3 py-2.5 text-sm resize-none font-mono"
              />
            </div>
          </div>
        )}

        {error && (
          <p className="text-xs rounded-lg px-3 py-2" style={{ background: "rgba(239,68,68,0.09)", color: "rgba(252,165,165,0.95)", border: "1px solid rgba(239,68,68,0.2)" }}>
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button onClick={onClose} className="btn-secondary flex-1 py-2.5 text-sm font-medium rounded-xl">
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            className="btn-primary flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-xl"
          >
            Reemplazar
          </button>
        </div>
      </div>
    </div>
  );
}
