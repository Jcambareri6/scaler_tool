// El value es lo que recibe el LLM ("escribi el guion en <value>"); vacio =
// automatico. Lo comparten el panel de guion y el idioma del canal
// (recursos compartidos del workspace).
export const LANGUAGES = [
  { value: "", label: "Automático" },
  { value: "español", label: "Español" },
  { value: "inglés", label: "Inglés" },
  { value: "portugués", label: "Portugués" },
  { value: "francés", label: "Francés" },
  { value: "italiano", label: "Italiano" },
  { value: "alemán", label: "Alemán" },
];

export function languageLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return LANGUAGES.find((l) => l.value === value)?.label ?? value;
}
