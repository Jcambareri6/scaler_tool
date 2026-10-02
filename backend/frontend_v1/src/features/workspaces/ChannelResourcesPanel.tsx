import { useEffect, useState } from "react";
import { useToast } from "@/lib/toastContext";
import { LANGUAGES } from "@/lib/languages";
import { workspacesService, type ChannelSettings } from "@/services/workspaces.service";

interface Props {
  workspaceId: string;
}

const cardStyle = {
  background: "rgba(255,255,255,0.04)",
  backdropFilter: "blur(16px)",
  border: "1px solid rgba(255,255,255,0.08)",
};
const labelClass = "text-[11px] font-medium uppercase tracking-widest";
// Mismo tope que el backend (CHANNEL_TEXT_MAX en lib/channelSettings.ts).
const MAX_CHARS = 6000;

// "Recursos compartidos" del canal: lo que tiene que respetar todo video de
// este workspace, lo genere quien lo genere.
// - Idioma: default del guion (se puede cambiar por guion en Script).
// - Estilo de narración: se suma al prompt del guion (y al Prompt Maestro).
// - Diseño visual: va en cada prompt de imagen/video (Flow, Imagen con IA).
export default function ChannelResourcesPanel({ workspaceId }: Props) {
  const { showToast } = useToast();
  const [saved, setSaved] = useState<ChannelSettings | null>(null);
  const [language, setLanguage] = useState("");
  const [narration, setNarration] = useState("");
  const [visual, setVisual] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSaved(null);
    workspacesService
      .channelSettings(workspaceId)
      .then((settings) => {
        if (cancelled) return;
        setSaved(settings);
        setLanguage(settings.channelLanguage);
        setNarration(settings.narrationStyle);
        setVisual(settings.visualStylePrompt);
      })
      .catch((err) => {
        if (!cancelled) showToast("error", err instanceof Error ? err.message : "No se pudieron cargar los recursos del canal");
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, showToast]);

  if (!saved) {
    return (
      <div className="rounded-2xl p-5" style={cardStyle}>
        <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>Cargando recursos del canal...</p>
      </div>
    );
  }

  const canEdit = saved.canEdit;
  const dirty =
    language !== saved.channelLanguage || narration.trim() !== saved.narrationStyle || visual.trim() !== saved.visualStylePrompt;
  const visualChanged = visual.trim() !== saved.visualStylePrompt;

  const handleSave = async () => {
    setSaving(true);
    try {
      const next = await workspacesService.updateChannelSettings(workspaceId, {
        channelLanguage: language,
        narrationStyle: narration.trim(),
        visualStylePrompt: visual.trim(),
      });
      setSaved(next);
      setNarration(next.narrationStyle);
      setVisual(next.visualStylePrompt);
      showToast(
        "success",
        visualChanged
          ? "Guardado. Los prompts de imagen se van a rehacer con el nuevo diseño la próxima vez que los pidas."
          : "Recursos del canal guardados"
      );
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "No se pudo guardar");
    }
    setSaving(false);
  };

  const field = (
    label: string,
    hint: string,
    value: string,
    onChange: (v: string) => void,
    placeholder: string,
    rows: number
  ) => (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <p className={labelClass} style={{ color: "var(--muted-foreground)" }}>{label}</p>
        <span className="text-[10px]" style={{ color: value.length > MAX_CHARS ? "rgba(252,165,165,0.95)" : "var(--muted-foreground)" }}>
          {value.length}/{MAX_CHARS}
        </span>
      </div>
      <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>{hint}</p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        readOnly={!canEdit}
        rows={rows}
        placeholder={canEdit ? placeholder : "Sin configurar"}
        className="input-glass w-full rounded-xl px-3 py-2.5 text-sm resize-y font-mono"
      />
    </div>
  );

  return (
    <div className="rounded-2xl p-5 space-y-5" style={cardStyle}>
      <div>
        <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>Recursos compartidos del canal</p>
        <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>
          Se aplican a todos los videos de este workspace: guiones, prompts de imagen para Flow e imágenes/videos con IA.
          {!canEdit && " Solo los admins pueden cambiarlos."}
        </p>
      </div>

      <div className="space-y-1.5">
        <p className={labelClass} style={{ color: "var(--muted-foreground)" }}>Idioma del canal</p>
        <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
          Idioma por defecto de los guiones. En cada guion se puede elegir otro.
        </p>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          disabled={!canEdit}
          className="input-glass rounded-xl px-3 py-2 text-sm"
        >
          {LANGUAGES.map((l) => (
            <option key={l.value} value={l.value}>
              {l.value ? l.label : "Sin definir (el de la idea)"}
            </option>
          ))}
        </select>
      </div>

      {field(
        "Estilo de narración",
        "Tono, ritmo, persona que narra, frases típicas, cosas a evitar. Se suma al Prompt Maestro si el guion usa uno.",
        narration,
        setNarration,
        "Ej: narrador en segunda persona, tono intrigante y cercano, frases cortas, un gancho cada 30 segundos, sin chistes...",
        5
      )}

      {field(
        "Diseño visual del canal",
        "Pegá acá tu prompt de diseño visual. Se incorpora en cada prompt de imagen (Flow) junto con lo que cuenta cada escena del guion.",
        visual,
        setVisual,
        "Ej: ilustración digital estilo cómic, trazo grueso, paleta ocre y azul petróleo, iluminación dramática lateral, 16:9, sin texto...",
        8
      )}

      {canEdit && (
        <div className="flex items-center justify-end gap-3">
          {dirty && (
            <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>Cambios sin guardar</span>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !dirty || narration.length > MAX_CHARS || visual.length > MAX_CHARS}
            className="btn-primary px-4 py-2 text-sm font-medium rounded-xl disabled:opacity-50"
          >
            {saving ? "Guardando..." : "Guardar"}
          </button>
        </div>
      )}
    </div>
  );
}
