import { useEffect, useState, type ReactNode } from "react";

// Manual de la extension de Chrome "Scaler Tool → Flow" (carpeta
// flow-extension/ del repo): genera en Google Flow la imagen de cada escena
// y la carga sola en su escena. Vive en la app (y no como documento suelto)
// para que el usuario lo tenga a mano mientras la instala.

const cardStyle = {
  background: "rgba(255,255,255,0.04)",
  backdropFilter: "blur(16px)",
  border: "1px solid rgba(255,255,255,0.08)",
};

function Section({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl p-6" style={cardStyle}>
      <div className="flex items-center gap-3 mb-4">
        <span
          className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
          style={{ background: "rgba(227,11,16,0.15)", border: "1px solid rgba(227,11,16,0.3)", color: "#FF8A8D" }}
        >
          {number}
        </span>
        <h2 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>
          {title}
        </h2>
      </div>
      <div className="text-sm leading-relaxed space-y-3" style={{ color: "var(--muted-foreground)" }}>
        {children}
      </div>
    </section>
  );
}

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="space-y-2 list-decimal pl-5 marker:text-[#FF8A8D]">
      {items.map((item, i) => (
        <li key={i} className="pl-1">
          {item}
        </li>
      ))}
    </ol>
  );
}

function Note({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  const warn = tone === "warn";
  return (
    <div
      className="rounded-xl px-4 py-3 text-[13px]"
      style={{
        background: warn ? "rgba(245,158,11,0.08)" : "rgba(227,11,16,0.06)",
        border: `1px solid ${warn ? "rgba(245,158,11,0.25)" : "rgba(227,11,16,0.18)"}`,
        color: "var(--foreground)",
      }}
    >
      {children}
    </div>
  );
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="px-1.5 py-0.5 rounded-md text-[12px] font-mono" style={{ background: "rgba(255,255,255,0.08)", color: "var(--foreground)" }}>
      {children}
    </code>
  );
}

function Strong({ children }: { children: ReactNode }) {
  return <strong style={{ color: "var(--foreground)" }}>{children}</strong>;
}

// El zip y su version los genera scripts/zip-extension.mjs antes de cada
// dev/build, a partir de la carpeta flow-extension/ del repo.
function DownloadCard() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    fetch("/flow-extension.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { version?: string } | null) => setVersion(data?.version ?? null))
      .catch(() => setVersion(null));
  }, []);

  return (
    <div
      className="rounded-xl p-4 flex items-center gap-4 flex-wrap"
      style={{ background: "rgba(227,11,16,0.07)", border: "1px solid rgba(227,11,16,0.22)" }}
    >
      <div className="flex-1 min-w-[180px]">
        <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
          Extensión Scaler Tool → Flow
        </p>
        <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>
          {version ? `Versión ${version} · ` : ""}archivo .zip para Google Chrome
        </p>
      </div>
      <a
        href="/flow-extension.zip"
        download="flow-extension.zip"
        className="btn-primary flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        Descargar extensión
      </a>
    </div>
  );
}

const TROUBLESHOOTING: { problem: string; fix: ReactNode }[] = [
  {
    problem: "El panel dice “Conectá la extensión con Scaler Tool”",
    fix: (
      <>
        Pasá a la pestaña de Scaler Tool (con la sesión iniciada) y tocá <Strong>Conectar con …</Strong> en el panel. Si dice que
        la pestaña no parece ser Scaler Tool, recargala con F5 y reintentá.
      </>
    ),
  },
  {
    problem: "El indicador Flow está en amarillo / “Abrí Google Flow en una pestaña”",
    fix: (
      <>
        Abrí <Code>flow.google.com</Code> en una pestaña de esta ventana y entrá a un proyecto.
      </>
    ),
  },
  {
    problem: "“No se encontró la caja de prompt”",
    fix: "Entrá a un proyecto de Flow (no la pantalla de inicio) y recargá la pestaña con F5.",
  },
  {
    problem: "“Flow no tomó el prompt”",
    fix: "Fijate que no haya un cartel o ventana abierta en Flow y que te queden créditos. Después reintentá.",
  },
  {
    problem: "“Flow no devolvió ningún resultado a tiempo”",
    fix: "Flow tardó más de lo normal o rechazó el prompt. Reintentá; si se repite, cambiá el prompt de esa escena en Escenas → Imágenes en lote.",
  },
  {
    problem: "“Sesión vencida”",
    fix: "Volvé a iniciar sesión en Scaler Tool. La corrida queda en pausa: tocá ▶ Seguir para continuar donde quedó.",
  },
  {
    problem: "Se cerró el aviso “está depurando este navegador” y la escena falló",
    fix: "Ese aviso es como la extensión aprieta enviar en Flow: si se cierra, corta ese envío. Tocá ↻ Reintentar fallidas y dejalo abierto.",
  },
  {
    problem: "Al tocar el ícono no se abre el panel / la extensión no hace nada",
    fix: (
      <>
        En <Code>chrome://extensions</Code> tocá <Strong>↻</Strong> en la tarjeta de la extensión, después recargá con F5 la pestaña
        de Flow y la de Scaler Tool.
      </>
    ),
  },
];

export default function FlowExtensionPage() {
  const [openProblem, setOpenProblem] = useState<number | null>(null);

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-5">
      <div className="mb-3">
        <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--foreground)" }}>
          Extensión para Google Flow
        </h1>
        <p className="text-sm mt-1 leading-relaxed" style={{ color: "var(--muted-foreground)" }}>
          Genera en Google Flow la imagen de cada escena de tu proyecto y la carga sola en su escena. Corre en tu Chrome con tu
          cuenta de Google: usa los créditos de tu plan de Flow, y Scaler Tool nunca ve tu cuenta.
        </p>
      </div>

      <Section number={1} title="Antes de empezar">
        <ul className="space-y-1.5 list-disc pl-5">
          <li>
            <Strong>Google Chrome</Strong> en la computadora (no funciona en el celular).
          </li>
          <li>
            Una cuenta de <Strong>Google Flow</Strong> con créditos.
          </li>
          <li>
            La extensión, que bajás acá:
          </li>
        </ul>
        <DownloadCard />
      </Section>

      <Section number={2} title="Instalar la extensión">
        <Steps
          items={[
            <>
              Descomprimí el <Code>flow-extension.zip</Code> que bajaste (clic derecho → <Strong>Extraer todo</Strong>). Queda una
              carpeta <Code>flow-extension</Code>.
            </>,
            <>
              Mové esa carpeta a un lugar <Strong>fijo</Strong>, por ejemplo <Code>Documentos\flow-extension</Code>. Chrome la lee desde
              ahí todo el tiempo: si la borrás o la movés, la extensión deja de funcionar.
            </>,
            <>
              Abrí Chrome y escribí en la barra de direcciones <Code>chrome://extensions</Code>.
            </>,
            <>
              Arriba a la derecha, activá <Strong>Modo de desarrollador</Strong>.
            </>,
            <>
              Tocá <Strong>Cargar descomprimida</Strong> y elegí la carpeta <Code>flow-extension</Code>.
            </>,
            <>
              Aparece la tarjeta <Strong>Scaler Tool → Flow</Strong>. Si Chrome pide permisos, aceptalos.
            </>,
            <>
              Tocá el ícono de la pieza de rompecabezas (arriba a la derecha de Chrome) y <Strong>fijá</Strong> la extensión, así queda a
              mano en la barra.
            </>,
            <>
              Tocá el ícono de la extensión: se abre su <Strong>panel al costado</Strong> de la pantalla. Queda abierto mientras
              trabajás; lo cerrás con la ✕ del panel.
            </>,
          ]}
        />
      </Section>

      <Section number={3} title="Conectar con tu cuenta">
        <p>
          No hace falta loguearse en la extensión: <Strong>toma sola tu sesión de Scaler Tool</Strong>.
        </p>
        <Steps
          items={[
            "Iniciá sesión en Scaler Tool en esta misma ventana de Chrome (ya lo estás si ves esta página).",
            "Abrí el panel de la extensión desde su ícono.",
            <>
              El indicador <Strong>Scaler</Strong> de arriba se pone en <Strong>verde</Strong>, ves tu email y aparece la sección{" "}
              <Strong>Proyecto y escenas</Strong>. Listo.
            </>,
          ]}
        />
        <p>
          <Strong>La primera vez</Strong> el panel dice <Strong>“Conectá la extensión con Scaler Tool”</Strong>. Estando en esta
          pestaña de Scaler Tool, tocá <Strong>Conectar con …</Strong> (aparece con la dirección de esta página) y aceptá el permiso
          que pide Chrome. Si te pide un segundo permiso para el servidor, volvé a tocar el botón y aceptalo también. Se hace una sola
          vez: desde ahí se conecta sola.
        </p>
        <Note>
          Si cerrás sesión en Scaler Tool, la extensión también se desconecta. Para cambiar de usuario, iniciá sesión con el otro
          en Scaler Tool.
        </Note>
      </Section>

      <Section number={4} title="Conocé el panel">
        <ul className="space-y-2.5 list-disc pl-5">
          <li>
            <Strong>Indicadores de arriba:</Strong> <Strong>Flow</Strong> se pone en verde cuando hay una pestaña de Google Flow abierta,
            y <Strong>Scaler</Strong> cuando tiene tu sesión. En amarillo, falta eso.
          </li>
          <li>
            <Strong>Proyecto y escenas:</Strong> el proyecto (detectado solo si lo tenés abierto en Scaler Tool) y qué escenas
            generar (ver el paso 6). Se pliega tocando su título.
          </li>
          <li>
            <Strong>Tarjeta de la corrida:</Strong> el nombre del proyecto, cuántas escenas van cargadas, pendientes y con error, una
            etiqueta de estado (<Strong>Lista</Strong>, <Strong>Corriendo</Strong>, <Strong>En pausa</Strong>,{" "}
            <Strong>Terminada</Strong>) y la barra de progreso. Ahí están los botones <Strong>▶ Empezar</Strong> (o{" "}
            <Strong>▶ Seguir</Strong> si está en pausa), <Strong>⏸ Pausar</Strong> y <Strong>↻ Reintentar fallidas</Strong>.
          </li>
          <li>
            <Strong>Escenas:</Strong> una tarjeta por escena con la <Strong>miniatura</Strong> de la imagen generada, su estado y el
            paso en que está. Tocá el prompt para leerlo completo. Arriba podés filtrar entre <Strong>Todas</Strong>,{" "}
            <Strong>Pendientes</Strong> y <Strong>Errores</Strong>.
          </li>
          <li>
            <Strong>Avanzado:</Strong> herramientas de diagnóstico. <Strong>Probar envío</Strong> manda un prompt de prueba a Flow
            (gasta 1 imagen) para comprobar que todo anda.
          </li>
        </ul>
      </Section>

      <Section number={5} title="Preparar Google Flow">
        <Steps
          items={[
            <>
              Abrí <Code>flow.google.com</Code> en otra pestaña y entrá a un proyecto (o creá uno).
            </>,
            <>
              En el botón de ajustes, al lado de la flecha de enviar, elegí <Strong>Imagen</Strong> (o <Strong>Video</Strong>) y el
              formato <Strong>16:9</Strong>.
            </>,
            <>
              Dejá la cantidad en <Strong>x1</Strong>.
            </>,
            "Dejá vacío el cuadro de texto de Flow.",
          ]}
        />
        <Note tone="warn">
          Con <Strong>x2</Strong> o más, cada escena gasta el doble de créditos.
        </Note>
      </Section>

      <Section number={6} title="Generar las imágenes">
        <Steps
          items={[
            <>
              Abrí en Scaler Tool el <Strong>proyecto</Strong> que querés generar: el panel lo detecta solo y lo muestra como{" "}
              <Strong>“Proyecto abierto en Scaler Tool”</Strong>. Si estás en el inicio, elegilo en el selector; para cambiar uno
              detectado, tocá <Strong>Elegir otro</Strong>.
            </>,
            <>
              En <Strong>Proyecto y escenas</Strong>, elegí si querés generar <Strong>Imágenes</Strong> o <Strong>Videos</Strong> (lo
              mismo que elegiste en Flow).
            </>,
            <>
              Elegí qué escenas:
              <ul className="list-disc pl-5 mt-1.5 space-y-1">
                <li>
                  <Strong>Desde escena:</Strong> arranca desde ese número.
                </li>
                <li>
                  <Strong>Cantidad:</Strong> cuántas generar, por ejemplo 60. Vacío = todas.
                </li>
                <li>
                  <Strong>Elegir al azar:</Strong> esas escenas se eligen al azar en vez de tomar las primeras. Cada vez que cargás los
                  prompts sale un sorteo nuevo.
                </li>
                <li>
                  <Strong>Solo escenas sin visual:</Strong> salta las que ya tienen imagen. Sirve para una segunda tanda sin repetir.
                </li>
                <li>
                  <Strong>Reintentos:</Strong> cuántas veces reintenta una escena que falla.
                </li>
              </ul>
            </>,
            <>
              Tocá <Strong>Cargar prompts del proyecto</Strong>. La primera vez tarda un poco: la IA arma un prompt por escena. Abajo
              te confirma cuántas escenas quedaron en cola.
            </>,
            <>
              Tocá <Strong>▶ Empezar</Strong>.
            </>,
          ]}
        />
        <Note>
          Cada vez que envía un prompt, Chrome muestra arriba el aviso{" "}
          <Strong>“Scaler Tool → Flow está depurando este navegador”</Strong>. Es normal: así la extensión escribe y aprieta enviar como
          si fueras vos. <Strong>No lo cierres</Strong>, porque corta el envío.
        </Note>
        <ul className="space-y-1.5 list-disc pl-5">
          <li>No cierres ni recargues la pestaña de Flow, y no escribas ni hagas clic en ella mientras corre.</li>
          <li>Dejá el panel abierto al costado para ver el avance. Si lo cerrás, la corrida sigue sola.</li>
          <li>
            Cada escena pasa por <Strong>En cola → Generando → ✓ Cargada</Strong>. Mientras genera, la tarjeta muestra el paso (enviando,
            esperando el resultado, subiendo) y al terminar aparece la miniatura. La imagen queda sola en la pestaña{" "}
            <Strong>Escenas</Strong> del proyecto.
          </li>
          <li>
            Si una escena falla queda en <Strong>✗ Error</Strong>, con el motivo en rojo en su tarjeta, y la corrida sigue con la
            siguiente. Filtrá por <Strong>Errores</Strong> para verlas juntas y tocá <Strong>↻ Reintentar fallidas</Strong>.
          </li>
          <li>
            Podés <Strong>⏸ Pausar</Strong> en cualquier momento y retomar con <Strong>▶ Seguir</Strong>: arranca desde la escena que
            quedó pendiente.
          </li>
        </ul>
      </Section>

      <Section number={7} title="Si algo falla">
        <div className="space-y-2">
          {TROUBLESHOOTING.map((item, i) => {
            const open = openProblem === i;
            return (
              <div key={item.problem} className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
                <button
                  onClick={() => setOpenProblem(open ? null : i)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left text-[13px] font-medium"
                  style={{ color: "var(--foreground)", background: open ? "rgba(255,255,255,0.04)" : "transparent" }}
                  aria-expanded={open}
                >
                  {item.problem}
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="flex-shrink-0 transition-transform"
                    style={{ transform: open ? "rotate(180deg)" : "none" }}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {open && (
                  <div className="px-4 pb-3 pt-1 text-[13px]" style={{ color: "var(--muted-foreground)" }}>
                    {item.fix}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      <Section number={8} title="Actualizar a una versión nueva">
        <Steps
          items={[
            <>
              Bajá la versión nueva con el botón <Strong>Descargar extensión</Strong> de arriba (muestra el número de versión).
            </>,
            <>
              Descomprimila y reemplazá el contenido de tu carpeta <Code>flow-extension</Code> por el nuevo, en el mismo lugar.
            </>,
            <>
              En <Code>chrome://extensions</Code>, tocá <Strong>↻</Strong> en la tarjeta de la extensión y verificá que cambió el número
              de versión.
            </>,
            "Recargá la pestaña de Flow con F5.",
          ]}
        />
      </Section>
    </div>
  );
}
