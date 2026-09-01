import type { ProjectStatus, SceneVisualStatus } from "@/types";

type Status = ProjectStatus | SceneVisualStatus;

const config: Record<Status, { label: string; bg: string; text: string; border: string; dot?: string }> = {
  DRAFT: {
    label: "Borrador",
    bg: "rgba(255,255,255,0.04)",
    text: "rgba(160,163,180,0.9)",
    border: "rgba(255,255,255,0.09)",
  },
  IN_PROGRESS: {
    label: "En progreso",
    bg: "rgba(99,77,220,0.12)",
    text: "rgba(167,155,255,0.95)",
    border: "rgba(124,106,255,0.22)",
    dot: "#a78bfa",
  },
  GENERATING: {
    label: "Generando",
    bg: "rgba(109,77,220,0.14)",
    text: "rgba(196,181,253,0.95)",
    border: "rgba(139,92,246,0.25)",
    dot: "#c4b5fd",
  },
  DONE: {
    label: "Listo",
    bg: "rgba(16,185,129,0.08)",
    text: "rgba(52,211,153,0.95)",
    border: "rgba(52,211,153,0.18)",
  },
  ERROR: {
    label: "Error",
    bg: "rgba(239,68,68,0.09)",
    text: "rgba(252,165,165,0.95)",
    border: "rgba(239,68,68,0.2)",
  },
  PENDING: {
    label: "Pendiente",
    bg: "rgba(255,255,255,0.04)",
    text: "rgba(148,151,168,0.9)",
    border: "rgba(255,255,255,0.08)",
  },
};

interface Props {
  status: Status;
  size?: "sm" | "md";
}

export default function StatusBadge({ status, size = "sm" }: Props) {
  const c = config[status] ?? config.DRAFT;
  const sizeClass = size === "sm" ? "text-[10px] px-2 py-0.5" : "text-[11px] px-2.5 py-1";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-mono font-medium tracking-wide ${sizeClass}`}
      style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}`, backdropFilter: "blur(8px)" }}
    >
      {c.dot && (
        <span
          className="inline-block rounded-full"
          style={{
            width: 5,
            height: 5,
            background: c.dot,
            boxShadow: `0 0 6px ${c.dot}`,
            animation: "pulse 2s cubic-bezier(0.4,0,0.6,1) infinite",
          }}
        />
      )}
      {c.label}
    </span>
  );
}
