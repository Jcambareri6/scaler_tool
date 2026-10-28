import "./fonts";
import type { OverlayProps } from "./spec";
import { resolveTheme } from "./theme";
import { BigNumber } from "./components/BigNumber";

export function Overlay({ spec, theme: themeName }: OverlayProps) {
  const theme = resolveTheme(themeName);
  switch (spec.type) {
    case "big_number":
      return <BigNumber spec={spec} theme={theme} />;
  }
}
