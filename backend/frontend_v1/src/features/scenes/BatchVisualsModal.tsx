import { useEffect, useMemo, useRef, useState } from "react";
import { projectsService } from "@/services/projects.service";
import type { Asset, Scene, SceneImagePrompt } from "@/types";
import {
  fileKey,
  isVisualFile,
  matchFilesToScenes,
  type FileMatch,
} from "./matchSceneFiles";

interface Props {
  projectId: string;
  scenes: Scene[];
  // Escenas que ya tienen algun visual (stock, IA o subido) -- para marcar
  // las que faltan y para "rellenar solo las que faltan".
  scenesWithVisual: Set<string>;
  onClose: () => void;
  onScenesUpdated: (scenes: Scene[]) => void;
  onAssetsUploaded: (assetsByScene: Record<string, Asset[]>) => void;
}

type Tab = "prompts" | "upload";

type UploadStatus = { state: "pending" } | { state: "uploading" } | { state: "ok" } | { state: "error"; message: string };

// Mismo tope que multer en scene.route.ts.
const MAX_FILE_BYTES = 80 * 1024 * 1024;
// Archivos por request (el backend acepta hasta 10, ver MAX_BATCH_FILES).
const CHUNK_SIZE = 5;

function pad(order: number): string {
  return String(order).padStart(2, "0");
}

const tabStyle = (active: boolean) =>
  active
    ? { background: "rgba(227,11,16,0.15)", border: "1px solid rgba(227,11,16,0.3)", color: "var(--foreground)" }
    : { background: "transparent", border: "1px solid transparent", color: "var(--muted-foreground)" };

const panelStyle = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" };

// Flujo "generar afuera y cargar en lote" (Google Flow no tiene API):
// 1) Prompts: arma un prompt de imagen por escena, para copiar/descargar
//    numerados y pegarlos en Flow.
// 2) Cargar: el usuario sube todo lo que bajo de Flow junto; cada archivo
//    se empareja con su escena (numero en el nombre o, si no, por orden) y
//    se revisa antes de subir. Un archivo que falla queda marcado para
//    reintentar sin volver a subir el resto.
export default function BatchVisualsModal({
  projectId,
  scenes,
  scenesWithVisual,
  onClose,
  onScenesUpdated,
  onAssetsUploaded,
}: Props) {
  const [tab, setTab] = useState<Tab>("prompts");

  // --- prompts -------------------------------------------------------
  const [prompts, setPrompts] = useState<SceneImagePrompt[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loadingPrompts, setLoadingPrompts] = useState(false);
  const [regeneratingIds, setRegeneratingIds] = useState<Set<string>>(new Set());
  const [promptsError, setPromptsError] = useState<string | null>(null);
  const [onlyMissingPrompts, setOnlyMissingPrompts] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const scenesById = useMemo(() => new Map(scenes.map((s) => [s.id, s])), [scenes]);
  const scenesRef = useRef(scenes);
  scenesRef.current = scenes;

  // Lo que devuelve el backend tambien quedo guardado en scene.content --
  // se refleja en las escenas del padre para que un "Guardar cambios"
  // posterior en SceneDetail no lo pise (el PATCH reemplaza content entero).
  const applyPrompts = (rows: SceneImagePrompt[]) => {
    setPrompts((prev) => {
      const byId = new Map(prev.map((p) => [p.sceneId, p]));
      for (const row of rows) byId.set(row.sceneId, row);
      return [...byId.values()].sort((a, b) => a.order - b.order);
    });
    setDrafts((prev) => {
      const next = { ...prev };
      for (const row of rows) next[row.sceneId] = row.imagePrompt ?? "";
      return next;
    });
    const rowById = new Map(rows.map((r) => [r.sceneId, r]));
    onScenesUpdated(
      scenesRef.current.map((s) => {
        const row = rowById.get(s.id);
        if (!row?.imagePrompt) return s;
        return {
          ...s,
          imagePrompt: row.imagePrompt,
          imagePromptEdited: row.imagePromptEdited,
          ...(row.imagePromptStyleKey ? { imagePromptStyleKey: row.imagePromptStyleKey } : {}),
        };
      })
    );
  };

  const loadPrompts = async (options?: { regenerate?: boolean; sceneIds?: string[] }) => {
    setPromptsError(null);
    try {
      const rows = await projectsService.getSceneImagePrompts(projectId, options);
      applyPrompts(options?.sceneIds ? rows.filter((r) => options.sceneIds!.includes(r.sceneId)) : rows);
    } catch (err) {
      setPromptsError(err instanceof Error ? err.message : "No se pudieron generar los prompts");
    }
  };

  const reloadAllPrompts = () => {
    setLoadingPrompts(true);
    loadPrompts().finally(() => setLoadingPrompts(false));
  };

  useEffect(() => {
    reloadAllPrompts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const regenerateOne = async (sceneId: string) => {
    setRegeneratingIds((prev) => new Set(prev).add(sceneId));
    await loadPrompts({ regenerate: true, sceneIds: [sceneId] });
    setRegeneratingIds((prev) => {
      const next = new Set(prev);
      next.delete(sceneId);
      return next;
    });
  };

  // Persiste un prompt editado a mano (al salir del textarea).
  const saveDraft = async (sceneId: string) => {
    const scene = scenesById.get(sceneId);
    const text = (drafts[sceneId] ?? "").trim();
    const current = prompts.find((p) => p.sceneId === sceneId);
    if (!scene || !text || text === (current?.imagePrompt ?? "")) return;
    try {
      const updated = await projectsService.updateScene(sceneId, projectId, { ...scene, imagePrompt: text, imagePromptEdited: true });
      onScenesUpdated(scenesRef.current.map((s) => (s.id === sceneId ? updated : s)));
      setPrompts((prev) => prev.map((p) => (p.sceneId === sceneId ? { ...p, imagePrompt: text, error: undefined } : p)));
    } catch (err) {
      setPromptsError(err instanceof Error ? err.message : "No se pudo guardar el prompt");
    }
  };

  const visiblePrompts = prompts.filter((p) => !onlyMissingPrompts || !scenesWithVisual.has(p.sceneId));
  const exportable = visiblePrompts.filter((p) => (drafts[p.sceneId] ?? "").trim());

  const exportText = exportable
    .map((p) => `Escena ${pad(p.order)}  (guardar como escena_${pad(p.order)})\n${(drafts[p.sceneId] ?? "").trim()}`)
    .join("\n\n");

  const copy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
    } catch {
      setPromptsError("No se pudo copiar al portapapeles");
    }
  };

  const download = () => {
    const blob = new Blob([exportText + "\n"], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "prompts_escenas.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  // --- upload --------------------------------------------------------
  const [files, setFiles] = useState<File[]>([]);
  const [matches, setMatches] = useState<FileMatch[]>([]);
  const [onlyMissingUpload, setOnlyMissingUpload] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, UploadStatus>>({});
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadedSceneIds, setUploadedSceneIds] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sceneSlots = useMemo(
    () => scenes.map((s) => ({ id: s.id, order: s.order, hasVisual: scenesWithVisual.has(s.id) })),
    [scenes, scenesWithVisual]
  );

  // Re-empareja todo cuando cambian los archivos o el modo -- pisa las
  // asignaciones manuales, por eso solo corre en esos dos casos.
  // Excepcion: los archivos ya cargados (o asignados a mano) conservan su
  // escena, asi agregar mas archivos despues no los mueve de lugar.
  const matchesRef = useRef(matches);
  matchesRef.current = matches;
  const statusesRef = useRef(statuses);
  statusesRef.current = statuses;
  useEffect(() => {
    const keep = new Map(
      matchesRef.current
        .filter((m) => m.reason === "manual" || statusesRef.current[m.key]?.state === "ok")
        .map((m) => [m.key, m])
    );
    const fresh = matchFilesToScenes(
      files.filter((f) => !keep.has(fileKey(f))),
      sceneSlots.filter((s) => ![...keep.values()].some((m) => m.sceneId === s.id)),
      { onlyMissing: onlyMissingUpload }
    );
    setMatches([...keep.values()].filter((m) => files.some((f) => fileKey(f) === m.key)).concat(fresh));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, onlyMissingUpload]);

  const previewUrls = useMemo(() => {
    const map: Record<string, string> = {};
    for (const file of files) map[fileKey(file)] = URL.createObjectURL(file);
    return map;
  }, [files]);
  useEffect(() => () => Object.values(previewUrls).forEach((u) => URL.revokeObjectURL(u)), [previewUrls]);

  const addFiles = (list: FileList | File[]) => {
    const incoming = Array.from(list).filter(isVisualFile);
    if (incoming.length === 0) {
      setUploadError("Solo se aceptan imágenes o videos");
      return;
    }
    setUploadError(null);
    setFiles((prev) => {
      const keys = new Set(prev.map(fileKey));
      return [...prev, ...incoming.filter((f) => !keys.has(fileKey(f)))];
    });
  };

  const removeFile = (key: string) => {
    setFiles((prev) => prev.filter((f) => fileKey(f) !== key));
    setStatuses((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const assignScene = (key: string, sceneId: string | null) => {
    setMatches((prev) => prev.map((m) => (m.key === key ? { ...m, sceneId, reason: sceneId ? "manual" : "none" } : m)));
    setStatuses((prev) => ({ ...prev, [key]: { state: "pending" } }));
  };

  const sceneUseCount = useMemo(() => {
    const count = new Map<string, number>();
    for (const m of matches) if (m.sceneId) count.set(m.sceneId, (count.get(m.sceneId) ?? 0) + 1);
    return count;
  }, [matches]);
  const hasDuplicates = [...sceneUseCount.values()].some((n) => n > 1);

  const toUpload = matches.filter(
    (m) => m.sceneId && statuses[m.key]?.state !== "ok" && m.file.size <= MAX_FILE_BYTES
  );
  const failedCount = matches.filter((m) => statuses[m.key]?.state === "error").length;
  const okCount = matches.filter((m) => statuses[m.key]?.state === "ok").length;

  const missingOrders = scenes
    .filter((s) => !scenesWithVisual.has(s.id) && !uploadedSceneIds.has(s.id))
    .map((s) => s.order)
    .sort((a, b) => a - b);

  const handleUpload = async () => {
    if (toUpload.length === 0 || hasDuplicates) return;
    setUploading(true);
    setUploadError(null);
    try {
      const script = await projectsService.getScript(projectId);
      if (!script) throw new Error("El proyecto todavía no tiene guion");

      for (let i = 0; i < toUpload.length; i += CHUNK_SIZE) {
        const chunk = toUpload.slice(i, i + CHUNK_SIZE);
        setStatuses((prev) => {
          const next = { ...prev };
          for (const m of chunk) next[m.key] = { state: "uploading" };
          return next;
        });
        try {
          const { results, assets } = await projectsService.uploadBatchSceneVisuals(
            script.id,
            chunk.map((m) => ({ sceneId: m.sceneId!, file: m.file }))
          );
          setStatuses((prev) => {
            const next = { ...prev };
            chunk.forEach((m, idx) => {
              const r = results[idx];
              next[m.key] = r?.ok ? { state: "ok" } : { state: "error", message: r?.error ?? "Falló la carga" };
            });
            return next;
          });
          const grouped: Record<string, Asset[]> = {};
          for (const asset of assets) if (asset.sceneId) (grouped[asset.sceneId] ??= []).push(asset);
          onAssetsUploaded(grouped);
          setUploadedSceneIds((prev) => {
            const next = new Set(prev);
            for (const r of results) if (r.ok) next.add(r.sceneId);
            return next;
          });
        } catch (err) {
          // Falla de red/servidor de la tanda entera: se marcan sus archivos
          // y se sigue con la proxima tanda.
          const message = err instanceof Error ? err.message : "Falló la carga";
          setStatuses((prev) => {
            const next = { ...prev };
            for (const m of chunk) next[m.key] = { state: "error", message };
            return next;
          });
        }
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "No se pudo cargar");
    } finally {
      setUploading(false);
    }
  };

  const orderOf = (sceneId: string | null) => (sceneId ? scenesById.get(sceneId)?.order : undefined);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={uploading ? undefined : onClose}
    >
      <div
        className="w-full max-w-3xl rounded-2xl p-5 flex flex-col gap-4"
        style={{
          maxHeight: "88vh",
          background: "#0b0d13",
          border: "1px solid rgba(255,255,255,0.09)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
              Imágenes en lote (Flow)
            </p>
            <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>
              Copiá los prompts, generá en Flow y subí todo junto: cada archivo se carga en su escena.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={uploading}
            className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-opacity hover:opacity-80 disabled:opacity-40"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "var(--muted-foreground)" }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1.5 rounded-xl p-1" style={panelStyle}>
          <button onClick={() => setTab("prompts")} className="flex-1 text-xs font-medium py-1.5 rounded-lg transition-all duration-150" style={tabStyle(tab === "prompts")}>
            1 · Prompts
          </button>
          <button onClick={() => setTab("upload")} className="flex-1 text-xs font-medium py-1.5 rounded-lg transition-all duration-150" style={tabStyle(tab === "upload")}>
            2 · Cargar archivos
          </button>
        </div>

        {/* Escenas sin visual */}
        <p className="text-[11px]" style={{ color: missingOrders.length ? "#FF8A8D" : "var(--muted-foreground)" }}>
          {missingOrders.length
            ? `Escenas sin visual (${missingOrders.length}): ${missingOrders.join(", ")}`
            : "Todas las escenas tienen visual"}
        </p>

        {tab === "prompts" ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-xs mr-auto" style={{ color: "var(--muted-foreground)" }}>
                <input type="checkbox" checked={onlyMissingPrompts} onChange={(e) => setOnlyMissingPrompts(e.target.checked)} />
                Solo escenas sin visual
              </label>
              <button
                onClick={() => copy(exportText, "all")}
                disabled={exportable.length === 0}
                className="btn-secondary text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-50"
              >
                {copied === "all" ? "¡Copiado!" : `Copiar todos (${exportable.length})`}
              </button>
              <button
                onClick={download}
                disabled={exportable.length === 0}
                className="btn-secondary text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-50"
              >
                Descargar .txt
              </button>
            </div>

            {promptsError && (
              <p className="text-xs rounded-lg px-3 py-2" style={{ background: "rgba(239,68,68,0.09)", color: "rgba(252,165,165,0.95)", border: "1px solid rgba(239,68,68,0.2)" }}>
                {promptsError}
              </p>
            )}

            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {loadingPrompts ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <div className="w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: "rgba(227,11,16,0.2)", borderTopColor: "#FF8A8D" }} />
                  <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                    Leyendo el guion completo y armando los prompts de {scenes.length} escenas en secuencia...
                  </p>
                </div>
              ) : (
                visiblePrompts.map((p) => {
                  const busy = regeneratingIds.has(p.sceneId);
                  return (
                    <div key={p.sceneId} className="rounded-xl p-3 space-y-2" style={panelStyle}>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-md" style={{ background: "rgba(255,255,255,0.06)", color: "var(--muted-foreground)" }}>
                          Escena {pad(p.order)}
                        </span>
                        <span
                          className="text-[10px]"
                          style={{ color: scenesWithVisual.has(p.sceneId) || uploadedSceneIds.has(p.sceneId) ? "var(--muted-foreground)" : "#FF8A8D" }}
                        >
                          {scenesWithVisual.has(p.sceneId) || uploadedSceneIds.has(p.sceneId) ? "con visual" : "sin visual"}
                        </span>
                        <div className="ml-auto flex gap-1.5">
                          <button
                            onClick={() => regenerateOne(p.sceneId)}
                            disabled={busy}
                            className="text-[11px] px-2 py-1 rounded-md transition-opacity hover:opacity-80 disabled:opacity-50"
                            style={{ color: "var(--muted-foreground)", border: "1px solid rgba(255,255,255,0.08)" }}
                          >
                            {busy ? "Generando..." : "Otro prompt"}
                          </button>
                          <button
                            onClick={() => copy((drafts[p.sceneId] ?? "").trim(), p.sceneId)}
                            disabled={!(drafts[p.sceneId] ?? "").trim()}
                            className="text-[11px] px-2 py-1 rounded-md transition-opacity hover:opacity-80 disabled:opacity-50"
                            style={{ color: "var(--accent)", border: "1px solid rgba(255,255,255,0.08)" }}
                          >
                            {copied === p.sceneId ? "¡Copiado!" : "Copiar"}
                          </button>
                        </div>
                      </div>
                      <p className="text-[11px] line-clamp-2" style={{ color: "var(--muted-foreground)" }}>
                        {p.text}
                      </p>
                      <textarea
                        value={drafts[p.sceneId] ?? ""}
                        onChange={(e) => setDrafts((prev) => ({ ...prev, [p.sceneId]: e.target.value }))}
                        onBlur={() => saveDraft(p.sceneId)}
                        rows={2}
                        placeholder="Sin prompt todavía"
                        className="input-glass w-full rounded-lg px-2.5 py-2 text-xs resize-y font-mono"
                      />
                      {p.error && (
                        <p className="text-[11px]" style={{ color: "rgba(252,165,165,0.95)" }}>
                          {p.error}
                        </p>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
              Tip: guardá cada imagen de Flow como <span className="font-mono">escena_07.png</span> y se carga sola en la escena 7. Si no tienen número, se asignan en orden alfabético.
            </p>
          </>
        ) : (
          <>
            {/* Drop zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                addFiles(e.dataTransfer.files);
              }}
              onClick={() => fileInputRef.current?.click()}
              className="rounded-xl py-6 text-center cursor-pointer transition-all duration-150"
              style={{
                background: dragOver ? "rgba(227,11,16,0.08)" : "rgba(255,255,255,0.02)",
                border: `1px dashed ${dragOver ? "rgba(227,11,16,0.5)" : "rgba(255,255,255,0.15)"}`,
              }}
            >
              <p className="text-sm" style={{ color: "var(--foreground)" }}>
                Arrastrá las imágenes o videos de Flow, o hacé clic para elegirlos
              </p>
              <p className="text-[11px] mt-1" style={{ color: "var(--muted-foreground)" }}>
                Con número en el nombre (escena_07.png, 7.jpg) van a esa escena; el resto, en orden.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs" style={{ color: "var(--muted-foreground)" }}>
                <input type="checkbox" checked={onlyMissingUpload} onChange={(e) => setOnlyMissingUpload(e.target.checked)} />
                Los archivos sin número van solo a escenas sin visual
              </label>
              {files.length > 0 && (
                <button
                  onClick={() => {
                    setFiles([]);
                    setStatuses({});
                  }}
                  disabled={uploading}
                  className="ml-auto text-[11px] transition-opacity hover:opacity-80 disabled:opacity-40"
                  style={{ color: "var(--muted-foreground)" }}
                >
                  Quitar todos
                </button>
              )}
            </div>

            {(uploadError || hasDuplicates) && (
              <p className="text-xs rounded-lg px-3 py-2" style={{ background: "rgba(239,68,68,0.09)", color: "rgba(252,165,165,0.95)", border: "1px solid rgba(239,68,68,0.2)" }}>
                {uploadError ?? "Hay más de un archivo asignado a la misma escena — corregilo antes de cargar."}
              </p>
            )}

            {/* Revision de emparejamiento */}
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
              {matches.map((m) => {
                const status = statuses[m.key] ?? { state: "pending" as const };
                const tooBig = m.file.size > MAX_FILE_BYTES;
                const duplicate = m.sceneId ? (sceneUseCount.get(m.sceneId) ?? 0) > 1 : false;
                const isVideo = m.file.type.startsWith("video/");
                const url = previewUrls[m.key];
                const order = orderOf(m.sceneId);
                return (
                  <div
                    key={m.key}
                    className="flex items-center gap-3 rounded-lg p-2"
                    style={{
                      ...panelStyle,
                      ...(duplicate ? { border: "1px solid rgba(239,68,68,0.4)" } : {}),
                    }}
                  >
                    <div className="shrink-0 rounded-md overflow-hidden" style={{ width: 64, height: 36, background: "#020408" }}>
                      {url &&
                        (isVideo ? (
                          <video src={url} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                        ) : (
                          <img src={url} alt="" className="w-full h-full object-cover" />
                        ))}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs truncate" style={{ color: "var(--foreground)" }}>
                        {m.file.name}
                      </p>
                      <p className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>
                        {tooBig
                          ? "Supera 80MB"
                          : m.reason === "number"
                            ? "Por número en el nombre"
                            : m.reason === "order"
                              ? "Por orden"
                              : m.reason === "manual"
                                ? "Asignado a mano"
                                : "Sin escena — elegí una"}
                      </p>
                    </div>
                    <select
                      value={m.sceneId ?? ""}
                      disabled={uploading || status.state === "ok"}
                      onChange={(e) => assignScene(m.key, e.target.value || null)}
                      className="input-glass text-xs rounded-lg px-2 py-1.5"
                    >
                      <option value="">— sin escena —</option>
                      {scenes.map((s) => (
                        <option key={s.id} value={s.id}>
                          Escena {pad(s.order)}
                          {scenesWithVisual.has(s.id) ? "" : " (sin visual)"}
                        </option>
                      ))}
                    </select>
                    <span
                      className="shrink-0 text-[10px] w-28 text-right"
                      title={status.state === "error" ? status.message : undefined}
                      style={{
                        color:
                          status.state === "ok"
                            ? "#4ade80"
                            : status.state === "error"
                              ? "rgba(252,165,165,0.95)"
                              : "var(--muted-foreground)",
                      }}
                    >
                      {status.state === "ok"
                        ? `✓ Escena ${order !== undefined ? pad(order) : ""}`
                        : status.state === "uploading"
                          ? "Subiendo..."
                          : status.state === "error"
                            ? `Error: ${status.message}`.slice(0, 40)
                            : ""}
                    </span>
                    <button
                      onClick={() => removeFile(m.key)}
                      disabled={uploading}
                      className="shrink-0 text-[11px] px-1.5 transition-opacity hover:opacity-80 disabled:opacity-40"
                      style={{ color: "var(--muted-foreground)" }}
                      title="Quitar"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center gap-3">
              <p className="text-[11px] mr-auto" style={{ color: "var(--muted-foreground)" }}>
                {matches.length > 0 &&
                  `${matches.length} archivos · ${okCount} cargados${failedCount ? ` · ${failedCount} con error` : ""}`}
              </p>
              <button
                onClick={handleUpload}
                disabled={uploading || toUpload.length === 0 || hasDuplicates}
                className="btn-primary flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-xl disabled:opacity-50"
              >
                {uploading && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                {failedCount > 0 && toUpload.length === failedCount
                  ? `Reintentar ${failedCount} fallidos`
                  : `Cargar ${toUpload.length} en sus escenas`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
