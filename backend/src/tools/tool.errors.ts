export class ProviderNotConfiguredError extends Error {
  constructor(toolName: string) {
    super(
      `Tool "${toolName}" needs a Provider that is not wired up yet (Etapa 9 — Providers).`
    );
    this.name = "ProviderNotConfiguredError";
  }
}
