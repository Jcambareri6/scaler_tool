import "./fonts";
import type { OverlayProps } from "./spec";
import { resolveTheme } from "./theme";
import { BigNumber } from "./components/BigNumber";
import { TitleCard } from "./components/TitleCard";

export function Overlay({ spec, theme: themeName, exit, locale }: OverlayProps) {
  const theme = resolveTheme(themeName);
  switch (spec.type) {
    case "big_number":
      return <BigNumber spec={spec} theme={theme} exit={exit} locale={locale} />;
    case "title_card":
      return <TitleCard spec={spec} theme={theme} exit={exit} />;
    default:
      return null;
  }
}
