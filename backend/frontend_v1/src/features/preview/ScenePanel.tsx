import { useEffect, useRef } from "react";
import type { Asset, Scene } from "@/types";
import StatusBadge from "@/components/StatusBadge";

interface Props {
  scenes: Scene[];
  assets: Asset[];
  // Que fila esta marcada como "seleccionada" (solo cambia con un click,
  // habilita el boton "Reemplazar clip" de arriba) -- independiente de
  // playingSceneId, que sigue al audio solo aunque nadie haya clickeado
  // nada.
  selectedSceneId: string | null;
  playingSceneId: string | null;
  onSelectScene: (scene: Scene) => void;
  onReplace: () => void;
}

// metadata.sequence lo asigna replaceStockSegmentsForScene/setAiVideoSegmentsForScene
// -- el primero en orden es el que mejor representa la escena para el thumbnail.
function sequenceOf(asset: Asset): number {
  const value = asset.metadata?.sequence;
  return typeof value === "number" ? value : 0;
}

function SceneThumbnail({ asset }: { asset: Asset | null }) {
  if (!asset) {
    return (
      <div className="w-full h-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.03)" }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
        </svg>
      </div>
    );
  }
  if (asset.type === "IMAGE") {
    return <img src={asset.storageKey} className="w-full h-full object-cover" alt="" />;
  }
  return <video src={asset.storageKey} muted playsInline preload="metadata" className="w-full h-full object-cover" />;
}

// Fila de escena del panel vertical -- reemplaza al filmstrip horizontal:
// numero + duracion + fragmento de guion + thumbnail, todo junto (ver
// mejoras-interfaz-preview-scalertool.md, seccion 3). El click selecciona
// la escena (StockReviewPanel hace seek del player a su inicio) y habilita
// el botón "Reemplazar clip" de arriba del panel. `selected` y `playing`
// son estados distintos que pueden no coincidir: `selected` solo cambia con
// un click (es el target del reemplazo); `playing` sigue al audio solo
// durante la reproduccion, aunque el usuario no haya tocado nada.
function SceneRow({
  scene,
  asset,
  selected,
  playing,
  onSelect,
}: {
  scene: Scene;
  asset: Asset | null;
  selected: boolean;
  playing: boolean;
  onSelect: () => void;
}) {
  const rowRef = useRef<HTMLButtonElement>(null);

  // El scroll automatico sigue a "playing", no a "selected" -- si el
  // usuario acaba de clickear la fila ya la tiene a la vista; el caso que
  // de verdad necesita auto-scroll es cuando el audio avanza solo y cruza a
  // una escena que quedo fuera del viewport de la lista.
  useEffect(() => {
    if (playing) rowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [playing]);

  const rowStyle = selected
    ? { background: "rgba(124,106,255,0.1)", border: "1px solid rgba(124,106,255,0.3)" }
    : playing
      ? { background: "rgba(124,106,255,0.04)", border: "1px solid rgba(124,106,255,0.15)" }
      : { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" };

  return (
    <button
      ref={rowRef}
      onClick={onSelect}
      className="w-full text-left p-2.5 rounded-xl flex gap-3 transition-all duration-150"
      style={rowStyle}
    >
      <div
        className="shrink-0 rounded-lg overflow-hidden relative"
        style={{ width: 84, height: 48, border: selected ? "1px solid #a78bfa" : "1px solid rgba(255,255,255,0.08)" }}
      >
        <SceneThumbnail asset={asset} />
        <span
          className="absolute top-1 left-1 px-1 rounded text-[10px] font-mono"
          style={{ background: "rgba(0,0,0,0.6)", color: "white" }}
        >
          {scene.order}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="flex items-center gap-1.5 text-[11px] font-mono" style={{ color: "var(--muted-foreground)" }}>
            {playing && (
              <span
                className="inline-block rounded-full shrink-0"
                style={{ width: 5, height: 5, background: "#a78bfa", boxShadow: "0 0 6px rgba(167,155,255,0.8)", animation: "pulse 2s cubic-bezier(0.4,0,0.6,1) infinite" }}
              />
            )}
            {scene.timeStart}–{scene.timeEnd}
          </span>
          <StatusBadge status={asset ? "DONE" : scene.visualStatus} />
        </div>
        <p className="text-xs leading-relaxed line-clamp-2" style={{ color: "var(--foreground)" }}>
          {scene.narrativeContent || "Sin narrativa"}
        </p>
      </div>
    </button>
  );
}

export default function ScenePanel({ scenes, assets, selectedSceneId, playingSceneId, onSelectScene, onReplace }: Props) {
  const assetsByScene = new Map<string, Asset[]>();
  for (const asset of assets) {
    if (!asset.sceneId) continue;
    const list = assetsByScene.get(asset.sceneId) ?? [];
    list.push(asset);
    assetsByScene.set(asset.sceneId, list);
  }
  for (const list of assetsByScene.values()) {
    list.sort((a, b) => sequenceOf(a) - sequenceOf(b));
  }

  const selectedScene = scenes.find((s) => s.id === selectedSceneId) ?? null;

  return (
    <div className="w-80 min-w-80 h-full flex flex-col" style={{ borderLeft: "1px solid rgba(255,255,255,0.07)" }}>
      <div className="px-4 pt-4 pb-3 space-y-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-medium uppercase tracking-widest" style={{ color: "var(--muted-foreground)" }}>
            {scenes.length} escenas
          </p>
          <span className="text-[11px] font-mono truncate max-w-[9rem]" style={{ color: "var(--muted-foreground)" }}>
            {selectedScene ? `Escena ${selectedScene.order}` : "Ninguna seleccionada"}
          </span>
        </div>
        <button
          onClick={onReplace}
          disabled={!selectedScene}
          className="btn-primary w-full flex items-center justify-center gap-2 py-2 text-xs font-medium rounded-lg disabled:opacity-40"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          Reemplazar clip
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 pt-3 pb-3 space-y-1.5">
        {scenes.map((scene) => (
          <SceneRow
            key={scene.id}
            scene={scene}
            asset={assetsByScene.get(scene.id)?.[0] ?? null}
            selected={scene.id === selectedSceneId}
            playing={scene.id === playingSceneId}
            onSelect={() => onSelectScene(scene)}
          />
        ))}
      </div>
    </div>
  );
}
