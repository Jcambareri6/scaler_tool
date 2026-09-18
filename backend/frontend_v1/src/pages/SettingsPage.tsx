import { useAuth } from "@/lib/authContext";

// Antes el link "Configuración" del sidebar apuntaba a una ruta inexistente
// (pantalla en blanco, ver auditoria seccion 4). Todavia no hay ajustes de
// cuenta reales que exponer, asi que esto es un placeholder honesto en vez
// de un link roto.
export default function SettingsPage() {
  const { user } = useAuth();

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--foreground)" }}>
          Configuración
        </h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--muted-foreground)" }}>
          Datos de tu cuenta
        </p>
      </div>

      <div
        className="rounded-2xl p-6 space-y-4"
        style={{ background: "rgba(255,255,255,0.04)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.08)" }}
      >
        <div>
          <p className="text-[11px] font-medium uppercase tracking-widest mb-1" style={{ color: "var(--muted-foreground)" }}>
            Email
          </p>
          <p className="text-sm" style={{ color: "var(--foreground)" }}>{user?.email ?? "—"}</p>
        </div>
      </div>

      <p className="text-xs mt-4" style={{ color: "var(--muted-foreground)" }}>
        Más opciones de configuración (proveedores, notificaciones, equipo) llegan próximamente.
      </p>
    </div>
  );
}
