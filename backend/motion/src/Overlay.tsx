import "./fonts";
import type { OverlayProps } from "./spec";
import { resolveTheme } from "./theme";
import { BigNumber } from "./components/BigNumber";
import { TitleCard } from "./components/TitleCard";
import { KineticQuote } from "./components/KineticQuote";
import { BarChart } from "./components/BarChart";
import { Versus } from "./components/Versus";
import { ScaleCompare } from "./components/ScaleCompare";
import { Timeline } from "./components/Timeline";
import { LowerThird } from "./components/LowerThird";
import { ListReveal } from "./components/ListReveal";
import { RankReveal } from "./components/RankReveal";
import { ProfileCard } from "./components/ProfileCard";
import { Location } from "./components/Location";
import { MythFact } from "./components/MythFact";
import { CornerBadge } from "./components/CornerBadge";
import { CallToAction } from "./components/CallToAction";

export function Overlay({ spec, theme: themeName, exit, locale }: OverlayProps) {
  const theme = resolveTheme(themeName);
  switch (spec.type) {
    case "big_number":
      return <BigNumber spec={spec} theme={theme} exit={exit} locale={locale} />;
    case "title_card":
      return <TitleCard spec={spec} theme={theme} exit={exit} />;
    case "kinetic_quote":
      return <KineticQuote spec={spec} theme={theme} exit={exit} />;
    case "data_viz_single":
      return <BarChart spec={spec} theme={theme} exit={exit} locale={locale} />;
    case "versus":
      return <Versus spec={spec} theme={theme} exit={exit} locale={locale} />;
    case "scale_compare":
      return <ScaleCompare spec={spec} theme={theme} exit={exit} />;
    case "timeline":
      return <Timeline spec={spec} theme={theme} exit={exit} />;
    case "lower_third":
      return <LowerThird spec={spec} theme={theme} exit={exit} />;
    case "list":
      return <ListReveal spec={spec} theme={theme} exit={exit} />;
    case "rank_reveal":
      return <RankReveal spec={spec} theme={theme} exit={exit} />;
    case "profile_card":
      return <ProfileCard spec={spec} theme={theme} exit={exit} />;
    case "location":
      return <Location spec={spec} theme={theme} exit={exit} />;
    case "myth_fact":
      return <MythFact spec={spec} theme={theme} exit={exit} locale={locale} />;
    case "badge":
      return <CornerBadge spec={spec} theme={theme} exit={exit} />;
    case "cta":
      return <CallToAction spec={spec} theme={theme} exit={exit} />;
    default:
      return null;
  }
}
