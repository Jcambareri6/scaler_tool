export class ProviderNotConfiguredError extends Error {
  constructor(toolName: string) {
    super(
      `Tool "${toolName}" needs a Provider that is not wired up yet (Etapa 9 — Providers).`
    );
    this.name = "ProviderNotConfiguredError";
  }
}

// Error pensado para mostrarse tal cual al usuario (ej: "el guion supera el
// maximo de caracteres"): tool.service.ts lo devuelve con su mensaje en vez
// del generico, igual que ProviderNotConfiguredError.
export class ToolUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolUserError";
  }
}
