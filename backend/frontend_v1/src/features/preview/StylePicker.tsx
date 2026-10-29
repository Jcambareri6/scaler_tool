import { useState } from "react";
import type { OverlayStyle, PaletteTheme } from "@/types";

interface Props {
  style: OverlayStyle;
  // Paleta que se esta viendo ahora en el preview (puede ser una que todavia
  // no se guardo).
  activeKey: string;
  saving: boolean;
  onPreview: (key: string, theme: PaletteTheme) => void;
  onSave: (scope: "channel" | "video") => void;
}

// Estilo de los graficos en la revision de stock. "Tu primer video define el
// estilo": si el canal todavia no eligio paleta, se ofrecen las 3 del nicho
// detectado y el preview cambia en vivo al tocarlas -- se elige viendo el
// propio video. Una vez elegida, queda una linea compacta para cambiarla.
export default function StylePicker({ style, activeKey, saving, onPreview, onSave }: Props) {
  const [open, setOpen] = useState(style.source === "default");
  const active = style.options.find((o) => o.key === activeKey);
  const dirty = activeKey !== style.paletteKey;

  if (!open) {
    return (
      <div className="flex items-center justify-center gap-2 text-xs mt-2" style={{ color: "var(--muted-foreground)" }}>
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: active?.theme.accent ?? "#E8B65A" }} />
        <span>
          {style.source === "video" ? "Estilo de este video" : "Estilo del canal"}: {style.paletteName} · nicho {style.nicheName}
        </span>
        <button type="button" onClick={() => setOpen(true)} className="underline underline-offset-2" style={{ color: "var(--foreground)" }}>
          Cambiar
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 inline-flex flex-col items-center gap-2 rounded-xl px-4 py-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <p className="text-xs" style={{ color: "var(--foreground)" }}>
        {style.source === "default" ? "Elegí el estilo de tu canal" : "Cambiar el estilo"}
        <span style={{ color: "var(--muted-foreground)" }}> · nicho detectado: {style.nicheName}</span>
      </p>
      <div className="flex flex-wrap justify-center gap-2" role="radiogroup" aria-label="Paleta de los gráficos">
        {style.options.map((option) => {
          const selected = option.key === activeKey;
          return (
            <button
              key={option.key}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onPreview(option.key, option.theme)}
              className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs transition-colors"
              style={{
                background: selected ? "rgba(255,255,255,0.1)" : "transparent",
                border: `1px solid ${selected ? option.theme.accent : "rgba(255,255,255,0.12)"}`,
                color: "var(--foreground)",
              }}
            >
              <span className="w-3 h-3 rounded-full" style={{ background: option.theme.accent, boxShadow: `0 0 8px ${option.theme.accent}80` }} />
              {option.name}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-3">
        {style.canSaveChannel ? (
          <button
            type="button"
            disabled={saving || (!dirty && style.source === "channel")}
            onClick={() => onSave("channel")}
            className="rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            style={{ background: active?.theme.accent ?? "#E8B65A", color: "#111" }}
          >
            {saving ? "Guardando..." : "Usar para el canal"}
          </button>
        ) : null}
        <button
          type="button"
          disabled={saving}
          onClick={() => onSave("video")}
          className={style.canSaveChannel ? "text-xs underline underline-offset-2 disabled:opacity-50" : "rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50"}
          style={style.canSaveChannel ? { color: "var(--muted-foreground)" } : { background: active?.theme.accent ?? "#E8B65A", color: "#111" }}
        >
          Solo en este video
        </button>
        {style.source !== "default" && (
          <button type="button" onClick={() => setOpen(false)} className="text-xs" style={{ color: "var(--muted-foreground)" }}>
            Cerrar
          </button>
        )}
      </div>
      {!style.canSaveChannel && (
        <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
          Solo un admin del canal puede fijar su estilo.
        </p>
      )}
    </div>
  );
}
