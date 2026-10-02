import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useToast } from "@/lib/toastContext";
import { LANGUAGES } from "@/lib/languages";
import { workspacesService, type ChannelSettings } from "@/services/workspaces.service";
import { scriptStylesService } from "@/services/scriptStyles.service";
import { projectsService } from "@/services/projects.service";
import type { ScriptStyle } from "@/types";

interface Props {
  workspaceId: string;
}

interface VoiceOption {
  voiceId: string;
  name: string;
  engine: string;
}

const cardStyle = {
  background: "rgba(255,255,255,0.04)",
  backdropFilter: "blur(16px)",
  border: "1px solid rgba(255,255,255,0.08)",
};
const labelClass = "text-[11px] font-medium uppercase tracking-widest";
// Mismo tope que el backend (CHANNEL_TEXT_MAX en lib/channelSettings.ts).
const MAX_CHARS = 6000;

type Draft = Pick<ChannelSettings, "channelLanguage" | "narrationStyle" | "visualStylePrompt" | "scriptStyleId" | "voiceId">;

function draftOf(s: ChannelSettings): Draft {
  return {
    channelLanguage: s.channelLanguage,
    narrationStyle: s.narrationStyle,
    visualStylePrompt: s.visualStylePrompt,
    scriptStyleId: s.scriptStyleId,
    voiceId: s.voiceId,
  };
}

// "Plantilla del canal" del workspace: todo proyecto nuevo de este workspace
// trae precargados el estilo de narración, la voz y el idioma, y el diseño
// visual se aplica a todos los prompts de imagen (Flow / Imagen con IA).
export default function ChannelResourcesPanel({ workspaceId }: Props) {
  const { showToast } = useToast();
  const [saved, setSaved] = useState<ChannelSettings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [styles, setStyles] = useState<ScriptStyle[]>([]);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    scriptStylesService.list().then(setStyles).catch(() => setStyles([]));
    projectsService.listVoices().then(setVoices).catch(() => setVoices([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSaved(null);
    setDraft(null);
    workspacesService
      .channelSettings(workspaceId)
      .then((settings) => {
        if (cancelled) return;
        setSaved(settings);
        setDraft(draftOf(settings));
      })
      .catch((err) => {
        if (!cancelled) showToast("error", err instanceof Error ? err.message : "No se pudieron cargar los recursos del canal");
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, showToast]);

  // El estilo compartido puede ser de otro miembro (no esta en mi lista).
  const styleOptions = useMemo(() => {
    const list = styles.map((s) => ({ id: s.id, name: s.name, status: s.status as string }));
    if (saved?.scriptStyle && !list.some((s) => s.id === saved.scriptStyle!.id)) list.unshift(saved.scriptStyle);
    return list;
  }, [styles, saved]);

  const voiceGroups = useMemo(() => {
    const groups = new Map<string, VoiceOption[]>();
    for (const v of voices) (groups.get(v.engine) ?? groups.set(v.engine, []).get(v.engine)!).push(v);
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [voices]);

  if (!saved || !draft) {
    return (
      <div className="rounded-2xl p-5" style={cardStyle}>
        <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>Cargando recursos del canal...</p>
      </div>
    );
  }

  const canEdit = saved.canEdit;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d));
  const changed = (key: keyof Draft) => (draft[key] ?? "").trim() !== (saved[key] ?? "").trim();
  const dirty = (Object.keys(draft) as (keyof Draft)[]).some(changed);
  const tooLong = draft.narrationStyle.length > MAX_CHARS || draft.visualStylePrompt.length > MAX_CHARS;
  const selectedStyle = styleOptions.find((s) => s.id === draft.scriptStyleId);
  const voiceKnown = !draft.voiceId || voices.some((v) => v.voiceId === draft.voiceId);

  const handleSave = async () => {
    setSaving(true);
    try {
      const patch: Partial<Draft> = {};
      for (const key of Object.keys(draft) as (keyof Draft)[]) if (changed(key)) patch[key] = draft[key].trim();
      const next = await workspacesService.updateChannelSettings(workspaceId, patch);
      setSaved(next);
      setDraft(draftOf(next));
      showToast(
        "success",
        changed("visualStylePrompt")
          ? "Guardado. Los prompts de imagen se rehacen con el nuevo diseño la próxima vez que los pidas."
          : "Plantilla del canal guardada. Los proyectos nuevos de este workspace ya la traen."
      );
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "No se pudo guardar");
    }
    setSaving(false);
  };

  const handlePreviewVoice = async () => {
    if (!draft.voiceId) return;
    setPreviewing(true);
    try {
      const { audioUrl } = await projectsService.previewVoice(draft.voiceId);
      audioRef.current?.pause();
      audioRef.current = new Audio(audioUrl);
      await audioRef.current.play();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "No se pudo reproducir la voz");
    }
    setPreviewing(false);
  };

  const section = (label: string, hint: string, children: React.ReactNode) => (
    <div className="space-y-1.5">
      <p className={labelClass} style={{ color: "var(--muted-foreground)" }}>{label}</p>
      <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>{hint}</p>
      {children}
    </div>
  );

  const textarea = (key: "narrationStyle" | "visualStylePrompt", placeholder: string, rows: number) => (
    <div>
      <textarea
        value={draft[key]}
        onChange={(e) => set(key, e.target.value)}
        readOnly={!canEdit}
        rows={rows}
        placeholder={canEdit ? placeholder : "Sin configurar"}
        className="input-glass w-full rounded-xl px-3 py-2.5 text-sm resize-y font-mono"
      />
      <p className="text-[10px] text-right" style={{ color: draft[key].length > MAX_CHARS ? "rgba(252,165,165,0.95)" : "var(--muted-foreground)" }}>
        {draft[key].length}/{MAX_CHARS}
      </p>
    </div>
  );

  return (
    <div className="rounded-2xl p-5 space-y-5" style={cardStyle}>
      <div>
        <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>Plantilla del canal</p>
        <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>
          Recursos compartidos con todo el workspace. Cada video nuevo de este workspace arranca con este estilo de
          narración, esta voz y este idioma ya cargados, y todos los prompts de imagen siguen el diseño visual.
          {!canEdit && " Solo los admins pueden cambiarlos."}
        </p>
      </div>

      {section(
        "Estilo de narración",
        "El Prompt Maestro que usan los guiones del canal. Al compartirlo, lo pueden usar todos los miembros aunque lo hayas creado vos.",
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={draft.scriptStyleId}
            onChange={(e) => set("scriptStyleId", e.target.value)}
            disabled={!canEdit}
            className="input-glass rounded-xl px-3 py-2 text-sm min-w-[220px]"
          >
            <option value="">Sin estilo de narración</option>
            {styleOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.status !== "READY" ? ` (${s.status})` : ""}
              </option>
            ))}
          </select>
          {canEdit && (
            <Link to="/script-styles" className="text-xs transition-opacity hover:opacity-80" style={{ color: "var(--accent)" }}>
              + Crear estilo nuevo
            </Link>
          )}
          {selectedStyle && selectedStyle.status !== "READY" && (
            <span className="text-[11px]" style={{ color: "#fbbf24" }}>
              Todavía no está listo: generalo en "Estilo de narración" antes de usarlo.
            </span>
          )}
        </div>
      )}

      {section(
        "Notas extra de narración (opcional)",
        "Reglas que se suman al Prompt Maestro en todos los guiones del canal: tono, cosas a evitar, frases de cierre, etc.",
        textarea("narrationStyle", "Ej: nunca usar la palabra 'increíble', cerrar siempre invitando a suscribirse...", 3)
      )}

      <div className="grid gap-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        {section(
          "Idioma del canal",
          "Viene precargado en el guion (se puede cambiar por video).",
          <select
            value={draft.channelLanguage}
            onChange={(e) => set("channelLanguage", e.target.value)}
            disabled={!canEdit}
            className="input-glass rounded-xl px-3 py-2 text-sm w-full"
          >
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.value ? l.label : "Sin definir (el de la idea)"}
              </option>
            ))}
          </select>
        )}

        {section(
          "Voz del canal",
          "Viene precargada en la pestaña Audio de cada video nuevo.",
          <div className="flex items-center gap-2">
            <select
              value={draft.voiceId}
              onChange={(e) => set("voiceId", e.target.value)}
              disabled={!canEdit}
              className="input-glass rounded-xl px-3 py-2 text-sm flex-1 min-w-0"
            >
              <option value="">Sin voz por defecto</option>
              {!voiceKnown && <option value={draft.voiceId}>{draft.voiceId}</option>}
              {voiceGroups.map(([engine, list]) => (
                <optgroup key={engine} label={engine}>
                  {list.map((v) => (
                    <option key={v.voiceId} value={v.voiceId}>{v.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button
              onClick={handlePreviewVoice}
              disabled={!draft.voiceId || previewing}
              className="shrink-0 px-3 py-2 text-xs rounded-xl disabled:opacity-50"
              style={{ border: "1px solid var(--border)", color: "var(--foreground)" }}
            >
              {previewing ? "..." : "▶ Escuchar"}
            </button>
          </div>
        )}
      </div>

      {section(
        "Diseño visual del canal",
        "Pegá acá el ESTILO VISUAL completo. La IA lo combina con el guion completo (con timestamps) para que todas las imágenes del video sigan la misma estética y una secuencia.",
        textarea(
          "visualStylePrompt",
          "Ej: ilustración digital estilo cómic, trazo grueso, paleta ocre y azul petróleo, iluminación dramática lateral, 16:9, sin texto...",
          10
        )
      )}

      {canEdit && (
        <div className="flex items-center justify-end gap-3">
          {dirty && <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>Cambios sin guardar</span>}
          <button
            onClick={handleSave}
            disabled={saving || !dirty || tooLong}
            className="btn-primary px-4 py-2 text-sm font-medium rounded-xl disabled:opacity-50"
          >
            {saving ? "Guardando..." : "Guardar"}
          </button>
        </div>
      )}
    </div>
  );
}
