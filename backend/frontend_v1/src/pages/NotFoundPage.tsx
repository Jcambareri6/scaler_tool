import { Link } from "react-router-dom";

// Catch-all de rutas -- antes cualquier URL sin match (ej. el link roto a
// /settings) caia en pantalla en blanco total, sin sidebar ni forma de
// volver salvo el boton atras del navegador (ver auditoria seccion 4).
export default function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-8">
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5"
        style={{ background: "rgba(124,106,255,0.1)", border: "1px solid rgba(124,106,255,0.2)" }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(167,155,255,0.7)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <p className="text-sm font-medium mb-1" style={{ color: "var(--foreground)" }}>Página no encontrada</p>
      <p className="text-sm mb-6 max-w-xs leading-relaxed" style={{ color: "var(--muted-foreground)" }}>
        La página que buscás no existe o todavía no está disponible.
      </p>
      <Link to="/" className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl">
        Volver al dashboard
      </Link>
    </div>
  );
}
