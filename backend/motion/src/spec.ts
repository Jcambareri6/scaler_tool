// Contrato entre el planificador (backend) y los componentes. En la Fase 0
// hay un solo tipo; el resto de los componentes se suman aca.
export interface BigNumberSpec {
  type: "big_number";
  // Cifra tal cual la dice el guion ("más de 1.000 km por hora").
  text: string;
  // Que es la cifra ("viento hacia el este").
  label?: string;
}

export type OverlaySpec = BigNumberSpec;

export interface OverlayProps {
  spec: OverlaySpec;
  theme?: string;
  durationSeconds: number;
  // Necesario para que <Composition> acepte los props (Record<string, unknown>).
  [key: string]: unknown;
}
