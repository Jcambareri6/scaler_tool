import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { projectsService } from "@/services/projects.service";
import { scriptStylesService } from "@/services/scriptStyles.service";
import { workspacesService, type ChannelSettings } from "@/services/workspaces.service";
import type { ScriptStyle, Workspace } from "@/types";
import { useAccount } from "@/lib/accountContext";
import StyleGallery from "@/features/documental/StyleGallery";

const starters = [
  { label: "Una idea", icon: "💡", placeholder: "Quiero crear un video sobre..." },
  { label: "Un tema", icon: "📚", placeholder: "El tema es la historia del..." },
  { label: "Un prompt", icon: "⚡", placeholder: "Genera un video documental de 3 minutos sobre..." },
  { label: "Un guion", icon: "📄", placeholder: "APERTURA\n\nEn un mundo donde..." },
  { label: "Transcripción", icon: "🎙️", placeholder: "Transcripción del audio o entrevista..." },
];

// Formatos que se eligen al crear. "Estándar" es el de todos los usuarios
// (stock, IA o Flow, con graficos opcionales que se eligen en la preview);
// "Documental" es solo para admins (el backend lo vuelve a chequear en
// lib/formats.ts y para el resto lo trata como estándar).
type Kind = "estandar" | "documental";
const kinds: { value: Kind; title: string; text: string; icon: ReactNode; adminOnly: boolean }[] = [
  {
    value: "estandar",
    title: "Video estándar",
    text: "Stock, IA o Flow, con gráficos animados opcionales. Los ajustes finos los elegís en la preview.",
    adminOnly: false,
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m10 9 5 3-5 3z" />
      </svg>
    ),
  },
  {
    value: "documental",
    title: "Documental",
    text: "Material real con licencia, plano a plano, con gráficos, música y efectos.",
    adminOnly: true,
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 7h16v12H4z" />
        <path d="M4 7l3-3h10l3 3" />
        <path d="M9 11h6M9 15h4" />
      </svg>
    ),
  },
];

const TITLE_MAX = 120;

const labelClass = "block text-[11px] font-medium uppercase tracking-widest mb-1.5";
const labelStyle = { color: "var(--muted-foreground)" };

function Section({ step, title, hint, children }: { step: number; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <header className="flex items-baseline gap-2.5">
        <span
          className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-semibold shrink-0"
          style={{ background: "rgba(227,11,16,0.18)", color: "#FFB3B4" }}
          aria-hidden="true"
        >
          {step}
        </span>
        <div>
          <h2 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
            {title}
          </h2>
          {hint && (
            <p className="text-[11px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
              {hint}
            </p>
          )}
        </div>
      </header>
      {children}
    </section>
  );
}

export default function NewProjectPage() {
  const navigate = useNavigate();
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [activeStarter, setActiveStarter] = useState(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [styles, setStyles] = useState<ScriptStyle[]>([]);
  const [scriptStyleId, setScriptStyleId] = useState("");
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  // Plantilla del canal del workspace elegido: preselecciona su estilo de
  // narracion (la voz y el idioma los aplica el backend / el panel de guion).
  const [channel, setChannel] = useState<ChannelSettings | null>(null);
  // "¿Que video queres hacer?": el formato se elige primero porque cambia el
  // guion, las fuentes, la musica y el look.
  const { account } = useAccount();
  const isAdmin = !!account?.isAdmin;
  const availableKinds = kinds.filter((k) => !k.adminOnly || isAdmin);
  const [kind, setKind] = useState<Kind>("estandar");
  const [documentalStyle, setDocumentalStyle] = useState("documental");
  const effectiveKind: Kind = availableKinds.some((k) => k.value === kind) ? kind : "estandar";

  useEffect(() => {
    titleRef.current?.focus();
    scriptStylesService.list().then(setStyles).catch(() => setStyles([]));
    // Solo workspaces donde puedo crear (editor o mas); el personal va primero.
    workspacesService
      .list()
      .then((all) => setWorkspaces(all.filter((ws) => ws.myRole !== "viewer")))
      .catch(() => setWorkspaces([]));
  }, []);

  const effectiveWorkspaceId = workspaceId || workspaces.find((ws) => ws.isPersonal)?.id || "";
  useEffect(() => {
    if (!effectiveWorkspaceId) return;
    let cancelled = false;
    workspacesService
      .channelSettings(effectiveWorkspaceId)
      .then((settings) => {
        if (cancelled) return;
        setChannel(settings);
        setScriptStyleId(settings.scriptStyleId);
      })
      .catch(() => {
        if (!cancelled) setChannel(null);
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveWorkspaceId]);

  // El estilo compartido del workspace puede ser de otro miembro.
  const styleOptions = useMemo(() => {
    const list = styles.map((s) => ({ id: s.id, name: s.name, status: s.status as string }));
    if (channel?.scriptStyle && !list.some((s) => s.id === channel.scriptStyle!.id)) list.unshift(channel.scriptStyle);
    return list;
  }, [styles, channel]);

  const canCreate = !!title.trim() && !creating;
  const showSettings = workspaces.length > 1 || styleOptions.length > 0;
  const steps = { format: 1, content: availableKinds.length > 1 ? 2 : 1 };

  const handleCreate = async () => {
    if (!canCreate) return;
    setCreating(true);
    setError(null);
    try {
      const project = await projectsService.createProject(
        title.trim(),
        content.trim() || undefined,
        // null = "Sin estilo" elegido a proposito (no se pisa con el del canal).
        scriptStyleId || null,
        workspaceId || undefined,
        isAdmin
          ? effectiveKind === "documental"
            ? { videoFormat: "documental", videoStyle: documentalStyle }
            : { videoFormat: "stock" }
          : undefined
      );
      navigate(`/projects/${project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el proyecto");
      setCreating(false);
    }
  };

  // Ctrl/Cmd + Enter crea desde cualquier campo.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void handleCreate();
    }
  };

  return (
    <div className="min-h-full flex flex-col items-center p-4 sm:p-8" onKeyDown={onKeyDown}>
      <div className="w-full max-w-2xl my-auto">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-semibold tracking-tight mb-2" style={{ color: "var(--foreground)" }}>
            Nuevo proyecto
          </h1>
          <p style={{ color: "var(--muted-foreground)" }}>Contale a la IA de qué se trata tu video y empezamos juntos.</p>
        </div>

        <div
          className="rounded-2xl p-5 sm:p-7 space-y-8"
          style={{
            background: "rgba(255,255,255,0.04)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            border: "1px solid rgba(255,255,255,0.1)",
            boxShadow: "0 8px 40px rgba(0,0,0,0.3), 0 1px 0 rgba(255,255,255,0.04) inset",
          }}
        >
          {availableKinds.length > 1 && (
            <Section step={steps.format} title="¿Qué video querés hacer?" hint="Cambia el guion, las fuentes, la música y el look.">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5" role="radiogroup" aria-label="Tipo de video">
                {availableKinds.map((opt) => {
                  const active = effectiveKind === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setKind(opt.value)}
                      className="relative text-left rounded-xl p-3.5 transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-[#FF8A8D]"
                      style={
                        active
                          ? { background: "rgba(227,11,16,0.13)", border: "1px solid rgba(227,11,16,0.5)" }
                          : { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.09)" }
                      }
                    >
                      <span className="flex items-center gap-2.5 mb-1.5">
                        <span
                          className="inline-flex items-center justify-center w-8 h-8 rounded-lg"
                          style={{
                            background: active ? "rgba(227,11,16,0.22)" : "rgba(255,255,255,0.06)",
                            color: active ? "#FFB3B4" : "var(--muted-foreground)",
                          }}
                        >
                          {opt.icon}
                        </span>
                        <span className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
                          {opt.title}
                        </span>
                        {opt.adminOnly && (
                          <span
                            className="ml-auto text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded"
                            style={{ background: "rgba(255,255,255,0.06)", color: "var(--muted-foreground)" }}
                          >
                            Beta
                          </span>
                        )}
                      </span>
                      <span className="block text-[12px] leading-snug" style={{ color: "var(--muted-foreground)" }}>
                        {opt.text}
                      </span>
                    </button>
                  );
                })}
              </div>
              {effectiveKind === "documental" && (
                <div className="pt-1">
                  <StyleGallery value={documentalStyle} onChange={setDocumentalStyle} />
                </div>
              )}
            </Section>
          )}

          <Section step={steps.content} title="Contenido">
            <div>
              <label htmlFor="np-title" className={labelClass} style={labelStyle}>
                Título del proyecto
              </label>
              <input
                id="np-title"
                ref={titleRef}
                type="text"
                value={title}
                maxLength={TITLE_MAX}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ej: 10 hábitos de la gente exitosa"
                className="input-glass w-full rounded-xl px-4 py-3 text-sm"
              />
              {title.length > TITLE_MAX * 0.8 && (
                <p className="text-[11px] mt-1 text-right" style={labelStyle}>
                  {title.length}/{TITLE_MAX}
                </p>
              )}
            </div>

            <div>
              <span className={labelClass} style={labelStyle} id="np-starter-label">
                ¿Con qué arrancás?
              </span>
              <div className="flex gap-1.5 mb-2 overflow-x-auto pb-1" role="tablist" aria-labelledby="np-starter-label">
                {starters.map((s, i) => {
                  const active = activeStarter === i;
                  return (
                    <button
                      key={s.label}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setActiveStarter(i)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-[#FF8A8D]"
                      style={
                        active
                          ? { background: "rgba(227,11,16,0.15)", border: "1px solid rgba(227,11,16,0.35)", color: "#FFB3B4" }
                          : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", color: "var(--muted-foreground)" }
                      }
                    >
                      <span aria-hidden="true">{s.icon}</span>
                      {s.label}
                    </button>
                  );
                })}
              </div>
              <textarea
                aria-label={starters[activeStarter].label}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={starters[activeStarter].placeholder}
                rows={activeStarter >= 3 ? 10 : 6}
                className="input-glass w-full rounded-xl px-4 py-3 text-sm resize-y min-h-[120px]"
              />
              <div className="flex items-start justify-between gap-3 mt-1.5">
                <p className="text-[11px]" style={{ color: content.trim() ? "var(--muted-foreground)" : "rgba(251,191,36,0.85)" }}>
                  {content.trim()
                    ? "Cuanto más concreto (datos, tono, duración), mejor sale el guion."
                    : "Si lo dejás vacío, el guion se genera solo a partir del título — va a salir más genérico."}
                </p>
                {content.length > 0 && (
                  <span className="text-[11px] shrink-0 tabular-nums" style={labelStyle}>
                    {content.trim().split(/\s+/).filter(Boolean).length} palabras
                  </span>
                )}
              </div>
            </div>
          </Section>

          {showSettings && (
            <Section step={steps.content + 1} title="Ajustes" hint="Opcional: si no tocás nada, se usa la plantilla del canal.">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {workspaces.length > 1 && (
                  <div>
                    <label htmlFor="np-ws" className={labelClass} style={labelStyle}>
                      Workspace
                    </label>
                    <select
                      id="np-ws"
                      value={workspaceId}
                      onChange={(e) => setWorkspaceId(e.target.value)}
                      className="input-glass w-full rounded-xl px-4 py-3 text-sm"
                    >
                      {workspaces.map((ws) => (
                        <option key={ws.id} value={ws.isPersonal ? "" : ws.id}>
                          {ws.name}
                          {ws.isPersonal ? " (personal)" : ` · ${ws.memberCount} miembros`}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {styleOptions.length > 0 && (
                  <div className={workspaces.length > 1 ? "" : "sm:col-span-2"}>
                    <label htmlFor="np-style" className={labelClass} style={labelStyle}>
                      Estilo de guion
                    </label>
                    <select
                      id="np-style"
                      value={scriptStyleId}
                      onChange={(e) => setScriptStyleId(e.target.value)}
                      className="input-glass w-full rounded-xl px-4 py-3 text-sm"
                    >
                      <option value="">Sin estilo</option>
                      {styleOptions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} {s.status !== "READY" ? `(${s.status})` : ""}
                          {s.id === channel?.scriptStyleId ? " · del canal" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              {channel && (channel.voiceId || channel.channelLanguage || channel.visualStylePrompt) && (
                <p className="text-[11px]" style={labelStyle}>
                  Este workspace también aplica su plantilla del canal:
                  {[
                    channel.channelLanguage && ` idioma ${channel.channelLanguage}`,
                    channel.voiceId && " voz",
                    channel.visualStylePrompt && " diseño visual",
                  ]
                    .filter(Boolean)
                    .join(",")}
                  .
                </p>
              )}
            </Section>
          )}

          <div className="space-y-2 pt-1">
            <button
              type="button"
              onClick={handleCreate}
              disabled={!canCreate}
              className="btn-primary w-full flex items-center justify-center gap-2 py-3 text-sm font-medium rounded-xl"
            >
              {creating ? (
                <>
                  <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Creando proyecto...
                </>
              ) : (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  Crear {effectiveKind === "documental" ? "documental" : "proyecto"}
                </>
              )}
            </button>
            <p className="text-[11px] text-center" style={labelStyle}>
              {title.trim() ? "Ctrl + Enter para crear" : "Poné un título para crear el proyecto"}
            </p>
            {error && (
              <p className="text-xs text-center" role="alert" style={{ color: "#f87171" }}>
                {error}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
