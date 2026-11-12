import { useEffect, useMemo, useRef, useState } from "react";
import { CATEGORY_LABELS, documentalService, type DocumentalCategory, type DocumentalStyle } from "@/services/documental.service";

// Galeria de estilos del formato documental ("¿Que video queres hacer?").
// - Agrupada por intencion (ley de Hick): 6 categorias en vez de 12 opciones sueltas.
// - Reconocer antes que recordar: cada tarjeta dice para que sirve y da ejemplos.
// - Accesible: radiogroup con flechas, foco visible y estado aria-checked.

interface Props {
  value: string | null;
  onChange: (styleId: string) => void;
  compact?: boolean;
}

const ORDER: DocumentalCategory[] = ["general", "historia", "misterio", "biografias", "datos", "geografia"];

export default function StyleGallery({ value, onChange, compact = false }: Props) {
  const [styles, setStyles] = useState<DocumentalStyle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refs = useRef<Map<string, HTMLButtonElement>>(new Map());

  useEffect(() => {
    documentalService
      .listStyles()
      .then(setStyles)
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudieron cargar los estilos"));
  }, []);

  const flat = useMemo(() => (styles ? ORDER.flatMap((c) => styles.filter((s) => s.category === c)) : []), [styles]);

  const move = (current: string, delta: number) => {
    const index = flat.findIndex((s) => s.id === current);
    const next = flat[(index + delta + flat.length) % flat.length];
    if (!next) return;
    onChange(next.id);
    refs.current.get(next.id)?.focus();
  };

  if (error) {
    return (
      <p role="alert" className="text-xs" style={{ color: "#FF8A8D" }}>
        {error}. Probá recargar la página.
      </p>
    );
  }
  if (!styles) {
    return (
      <div className="grid grid-cols-2 gap-2" aria-busy="true" aria-label="Cargando estilos">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-20 rounded-xl animate-pulse" style={{ background: "rgba(255,255,255,0.04)" }} />
        ))}
      </div>
    );
  }

  const selected = flat.find((s) => s.id === value) ?? null;

  return (
    <div className="flex flex-col gap-4 w-full">
      <div role="radiogroup" aria-label="Estilo del documental" className="flex flex-col gap-4">
        {ORDER.map((category) => {
          const group = flat.filter((s) => s.category === category);
          if (group.length === 0) return null;
          return (
            <section key={category} aria-label={CATEGORY_LABELS[category]} className="flex flex-col gap-2">
              <h3 className="text-[10px] font-medium uppercase tracking-widest" style={{ color: "var(--muted-foreground)" }}>
                {CATEGORY_LABELS[category]}
              </h3>
              <div className={compact ? "grid grid-cols-2 gap-2" : "grid grid-cols-1 sm:grid-cols-2 gap-2"}>
                {group.map((style) => {
                  const active = style.id === value;
                  return (
                    <button
                      key={style.id}
                      ref={(el) => {
                        if (el) refs.current.set(style.id, el);
                      }}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      tabIndex={active || (!value && style.id === flat[0]?.id) ? 0 : -1}
                      onClick={() => onChange(style.id)}
                      onKeyDown={(e) => {
                        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                          e.preventDefault();
                          move(style.id, 1);
                        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                          e.preventDefault();
                          move(style.id, -1);
                        }
                      }}
                      className="text-left rounded-xl px-3 py-2.5 transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-[#FF8A8D]"
                      style={
                        active
                          ? { background: "rgba(227,11,16,0.15)", border: "1px solid rgba(227,11,16,0.45)" }
                          : { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }
                      }
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
                          {style.name}
                        </span>
                        {style.id === "documental" && (
                          <span className="text-[9px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: "rgba(52,211,153,0.12)", color: "#34d399" }}>
                            Recomendado
                          </span>
                        )}
                      </span>
                      {!compact && (
                        <span className="block text-[11px] mt-1 leading-snug" style={{ color: "var(--muted-foreground)" }}>
                          {style.description}
                        </span>
                      )}
                      <span className="block text-[11px] mt-1" style={{ color: "rgba(255,255,255,0.55)" }}>
                        Ideal para: {style.idealFor}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {selected && (
        <div className="rounded-xl px-3 py-2.5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }} aria-live="polite">
          <p className="text-xs font-medium" style={{ color: "var(--foreground)" }}>
            {selected.name}: {selected.description}
          </p>
          <p className="text-[11px] mt-1" style={{ color: "var(--muted-foreground)" }}>
            Ejemplos: {selected.examples.join(" · ")}
          </p>
        </div>
      )}
    </div>
  );
}
