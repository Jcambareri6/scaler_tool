import { useEffect, useState } from "react";
import { projectsService } from "@/services/projects.service";
import type { Asset, VideoProject } from "@/types";

interface Props {
  projectId: string;
  project: VideoProject;
}

interface VoiceOption {
  voiceId: string;
  name: string;
  engine: string;
}

export default function AudioPanel({ projectId, project }: Props) {
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedVoiceId, setSelectedVoiceId] = useState(project.voiceId ?? "");
  const [saving, setSaving] = useState(false);
  const [selectedEngine, setSelectedEngine] = useState("");

  const [sampleText, setSampleText] = useState("");
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [audioAsset, setAudioAsset] = useState<Asset | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    Promise.all([projectsService.listVoices(), projectsService.getAudioAsset(projectId)])
      .then(([voiceList, asset]) => {
        setVoices(voiceList);
        setAudioAsset(asset);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudieron cargar las voces"))
      .finally(() => setLoading(false));
  }, [projectId]);

  const handleSelectVoice = async (voiceId: string) => {
    setSelectedVoiceId(voiceId);
    setSaving(true);
    try {
      await projectsService.updateProject(projectId, { voiceId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la voz elegida");
    } finally {
      setSaving(false);
    }
  };

  const handlePreview = async (voiceId: string) => {
    setPreviewingVoiceId(voiceId);
    setError(null);
    try {
      const { audioUrl } = await projectsService.previewVoice(voiceId, sampleText);
      setPreviewUrl(audioUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo generar la prueba de voz");
    } finally {
      setPreviewingVoiceId(null);
    }
  };

  const handleGenerate = async () => {
    if (!selectedVoiceId) return;
    setGenerating(true);
    setError(null);
    try {
      const asset = await projectsService.generateVoice(projectId, selectedVoiceId);
      setAudioAsset(asset);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo generar la narracion");
    } finally {
      setGenerating(false);
    }
  };

  const engines = Array.from(new Set(voices.map((v) => v.engine))).sort();
  const filteredVoices = selectedEngine ? voices.filter((v) => v.engine === selectedEngine) : voices;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div
          className="w-5 h-5 border-2 rounded-full animate-spin"
          style={{ borderColor: "rgba(124,106,255,0.2)", borderTopColor: "#a78bfa" }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <div>
          <h2 className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
            Voz del proyecto
          </h2>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[11px] font-mono" style={{ color: "var(--muted-foreground)" }}>
              {filteredVoices.length} de {voices.length} voces
            </span>
            {saving && (
              <span className="text-[11px] font-mono" style={{ color: "var(--muted-foreground)" }}>
                · Guardando...
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedEngine}
            onChange={(e) => setSelectedEngine(e.target.value)}
            className="input-glass rounded-lg px-2 py-1.5 text-xs"
          >
            <option value="">Todos los proveedores</option>
            {engines.map((engine) => (
              <option key={engine} value={engine}>
                {engine}
              </option>
            ))}
          </select>
          <button
            onClick={handleGenerate}
          disabled={!selectedVoiceId || generating}
          className="btn-primary flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg disabled:opacity-50"
        >
          {generating ? (
            <>
              <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Guardando (puede tardar unos minutos)...
            </>
          ) : (
            "Guardar audio para guion"
          )}
          </button>
        </div>
      </div>

      {error && (
        <p className="text-xs px-6 py-2" style={{ color: "#f87171" }}>
          {error}
        </p>
      )}

      {audioAsset && (
        <div className="px-6 py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <label className="text-[11px] font-medium uppercase tracking-widest block mb-2" style={{ color: "var(--muted-foreground)" }}>
            Narracion generada
          </label>
          <audio controls src={audioAsset.storageKey} className="w-full" style={{ height: 36 }} />
        </div>
      )}

      <div className="px-6 py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <label className="text-[11px] font-medium uppercase tracking-widest block mb-2" style={{ color: "var(--muted-foreground)" }}>
          Texto de prueba (opcional)
        </label>
        <input
          type="text"
          value={sampleText}
          onChange={(e) => setSampleText(e.target.value)}
          placeholder="Hola, esta es una prueba de esta voz para tu proyecto."
          className="input-glass w-full rounded-lg px-3 py-2 text-xs"
        />
        {previewUrl && (
          <audio controls autoPlay src={previewUrl} className="w-full mt-3" style={{ height: 36 }} />
        )}
      </div>

      <div className="flex-1 px-6 py-4 space-y-2">
        {filteredVoices.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
            {voices.length === 0
              ? "No hay voces disponibles todavia. Verifica que el provider de voz este configurado."
              : "Ninguna voz de este proveedor."}
          </p>
        ) : (
          filteredVoices.map((voice) => {
            const active = selectedVoiceId === voice.voiceId;
            return (
              <div
                key={voice.voiceId}
                onClick={() => handleSelectVoice(voice.voiceId)}
                className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl cursor-pointer transition-all"
                style={{
                  background: active ? "rgba(124,106,255,0.1)" : "rgba(255,255,255,0.03)",
                  border: active ? "1px solid rgba(124,106,255,0.4)" : "1px solid rgba(255,255,255,0.07)",
                }}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: "var(--foreground)" }}>
                    {voice.name}
                  </p>
                  <p className="text-[11px] font-mono" style={{ color: "var(--muted-foreground)" }}>
                    {voice.engine} · {voice.voiceId}
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePreview(voice.voiceId);
                  }}
                  disabled={previewingVoiceId === voice.voiceId}
                  className="btn-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg disabled:opacity-50 flex-shrink-0"
                >
                  {previewingVoiceId === voice.voiceId ? (
                    <span className="w-3 h-3 border rounded-full animate-spin" style={{ borderColor: "rgba(255,255,255,0.15)", borderTopColor: "rgba(255,255,255,0.6)" }} />
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <polygon points="10 8 16 12 10 16 10 8" />
                    </svg>
                  )}
                  Escuchar
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
