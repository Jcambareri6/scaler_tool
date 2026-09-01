import { useEffect, useState } from "react";
import { projectsService } from "@/services/projects.service";
import StatusBadge from "@/components/StatusBadge";
import type { Scene, Asset } from "@/types";

interface Props {
  projectId: string;
}

function SceneCard({ scene, selected, onSelect }: { scene: Scene; selected: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className="w-full text-left p-4 rounded-xl transition-all duration-150"
      style={
        selected
          ? {
              background: "rgba(124,106,255,0.1)",
              border: "1px solid rgba(124,106,255,0.25)",
              backdropFilter: "blur(12px)",
            }
          : {
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.07)",
              backdropFilter: "blur(8px)",
            }
      }
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] font-mono px-2 py-0.5 rounded-md"
            style={{ background: "rgba(255,255,255,0.06)", color: "var(--muted-foreground)", border: "1px solid rgba(255,255,255,0.07)" }}
          >
            Escena {scene.order}
          </span>
          <span className="text-[10px] font-mono" style={{ color: "var(--muted-foreground)" }}>
            {scene.timeStart}–{scene.timeEnd}
          </span>
        </div>
        <StatusBadge status={scene.visualStatus} />
      </div>
      <p className="text-sm font-medium line-clamp-1 mb-1" style={{ color: "var(--foreground)" }}>
        {scene.title}
      </p>
      <p className="text-xs leading-relaxed line-clamp-2" style={{ color: "var(--muted-foreground)" }}>
        {scene.narrativeContent}
      </p>
    </button>
  );
}

function SceneDetail({
  scene,
  asset,
  onRegenerate,
}: {
  scene: Scene;
  asset: Asset | null;
  onRegenerate: (sceneId: string, prompt: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [narrative, setNarrative] = useState(scene.narrativeContent);
  const [visualPrompt, setVisualPrompt] = useState(scene.visualPrompt ?? "");
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNarrative(scene.narrativeContent);
    setVisualPrompt(scene.visualPrompt ?? "");
    setEditing(false);
    setError(null);
  }, [scene.id]);

  const handleRegenerate = async () => {
    setRegenerating(true);
    setError(null);
    try {
      await onRegenerate(scene.id, visualPrompt.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo regenerar el visual");
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span
              className="text-[10px] font-mono px-2 py-0.5 rounded-md"
              style={{ background: "rgba(255,255,255,0.05)", color: "var(--muted-foreground)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              Escena {scene.order}
            </span>
            <span className="text-[11px] font-mono" style={{ color: "var(--muted-foreground)" }}>
              {scene.timeStart} – {scene.timeEnd} · {scene.duration}
            </span>
          </div>
          <h3 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>{scene.title}</h3>
        </div>
        <StatusBadge status={asset ? "DONE" : scene.visualStatus} size="md" />
      </div>

      {/* Visual: clip real si ya se genero/regenero, si no un placeholder */}
      <div
        className="w-full rounded-xl flex items-center justify-center relative overflow-hidden"
        style={{
          aspectRatio: "16/9",
          background: "#020408",
          border: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        {asset ? (
          <video key={asset.id} src={asset.storageKey} controls className="w-full h-full object-cover" />
        ) : regenerating ? (
          <div className="relative text-center">
            <div className="w-8 h-8 border-2 rounded-full animate-spin mx-auto mb-2" style={{ borderColor: "rgba(167,155,255,0.2)", borderTopColor: "#a78bfa" }} />
            <p className="text-xs" style={{ color: "#a78bfa" }}>Buscando clip...</p>
          </div>
        ) : (
          <>
            <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 30% 40%, rgba(99,77,220,0.1) 0%, transparent 70%)" }} />
            <div className="relative text-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-2">
                <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
              </svg>
              <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>Visual pendiente</p>
            </div>
          </>
        )}
      </div>

      {error && (
        <p className="text-xs rounded-lg px-3 py-2" style={{ background: "rgba(239,68,68,0.09)", color: "rgba(252,165,165,0.95)", border: "1px solid rgba(239,68,68,0.2)" }}>
          {error}
        </p>
      )}

      {/* Narrative */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-[11px] font-medium uppercase tracking-widest" style={{ color: "var(--muted-foreground)" }}>Narrativa</label>
          <button onClick={() => setEditing(!editing)} className="text-[11px] transition-opacity hover:opacity-80" style={{ color: "var(--primary)" }}>
            {editing ? "Cancelar" : "Editar"}
          </button>
        </div>
        {editing ? (
          <textarea
            value={narrative}
            onChange={(e) => setNarrative(e.target.value)}
            rows={4}
            className="input-glass w-full rounded-xl px-3 py-2.5 text-sm resize-none"
          />
        ) : (
          <p
            className="text-sm leading-relaxed rounded-xl px-3 py-2.5"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", color: "var(--foreground)" }}
          >
            {narrative}
          </p>
        )}
      </div>

      {/* Visual prompt */}
      <div>
        <label className="block text-[11px] font-medium uppercase tracking-widest mb-2" style={{ color: "var(--muted-foreground)" }}>Prompt visual</label>
        <textarea
          value={visualPrompt}
          onChange={(e) => setVisualPrompt(e.target.value)}
          rows={3}
          placeholder="Palabras clave para la búsqueda de stock (si lo dejás vacío, se usa la narrativa de la escena)..."
          className="input-glass w-full rounded-xl px-3 py-2.5 text-sm resize-none font-mono"
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={handleRegenerate}
          disabled={regenerating}
          className="btn-secondary flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-xl disabled:opacity-50"
        >
          {regenerating
            ? <span className="w-3.5 h-3.5 border rounded-full animate-spin" style={{ borderColor: "rgba(255,255,255,0.15)", borderTopColor: "rgba(255,255,255,0.6)" }} />
            : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
          }
          Regenerar visual
        </button>
        <button className="btn-primary flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-xl">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
            <polyline points="17 21 17 13 7 13 7 21" />
          </svg>
          Guardar cambios
        </button>
      </div>
    </div>
  );
}

export default function ScenesPanel({ projectId }: Props) {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [assetsByScene, setAssetsByScene] = useState<Record<string, Asset>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      projectsService.getScenes(projectId),
      projectsService.getStockPreviewAssets(projectId),
    ]).then(([s, assets]) => {
      setScenes(s);
      const map: Record<string, Asset> = {};
      for (const asset of assets) {
        if (asset.sceneId) map[asset.sceneId] = asset;
      }
      setAssetsByScene(map);
      if (s.length > 0) setSelectedId(s[0].id);
      setLoading(false);
    });
  }, [projectId]);

  const selectedScene = scenes.find((s) => s.id === selectedId) ?? null;

  const handleRegenerate = async (sceneId: string, prompt: string) => {
    const asset = await projectsService.regenerateSceneVisual(sceneId, prompt || undefined);
    setAssetsByScene((prev) => ({ ...prev, [sceneId]: asset }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: "rgba(124,106,255,0.2)", borderTopColor: "#a78bfa" }} />
      </div>
    );
  }

  if (scenes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center gap-4 px-8">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="7" width="20" height="15" rx="2" /><polyline points="17 2 12 7 7 2" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-medium mb-1" style={{ color: "var(--foreground)" }}>Sin escenas todavía</p>
          <p className="text-xs max-w-xs leading-relaxed" style={{ color: "var(--muted-foreground)" }}>
            Las escenas se generan a partir del guion. Generá el guion primero en la pestaña Script.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* List */}
      <div className="w-72 min-w-72 overflow-y-auto p-4 space-y-2" style={{ borderRight: "1px solid rgba(255,255,255,0.07)" }}>
        <p className="text-[10px] font-medium uppercase tracking-widest mb-3 px-1" style={{ color: "var(--muted-foreground)" }}>
          {scenes.length} escenas
        </p>
        {scenes.map((scene) => (
          <SceneCard
            key={scene.id}
            scene={assetsByScene[scene.id] ? { ...scene, visualStatus: "DONE" } : scene}
            selected={scene.id === selectedId}
            onSelect={() => setSelectedId(scene.id)}
          />
        ))}
      </div>

      {/* Detail */}
      {selectedScene ? (
        <SceneDetail
          scene={selectedScene}
          asset={assetsByScene[selectedScene.id] ?? null}
          onRegenerate={handleRegenerate}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-sm" style={{ color: "var(--muted-foreground)" }}>
          Seleccioná una escena
        </div>
      )}
    </div>
  );
}
