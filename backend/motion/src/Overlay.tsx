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
import { NavHeader } from "./components/NavHeader";
import { LineChart } from "./components/LineChart";
import { PivotQuestion } from "./components/PivotQuestion";
import { CardGrid } from "./components/CardGrid";
import { Scoreboard } from "./components/Scoreboard";
import { StrikeWord } from "./components/StrikeWord";
import { PhraseSwap } from "./components/PhraseSwap";
import { ChapterIndex } from "./components/ChapterIndex";
import { NumberPhrase } from "./components/NumberPhrase";
import { PersonCard } from "./components/PersonCard";
import { MilestoneTag } from "./components/MilestoneTag";
import { SubscribeCard } from "./components/SubscribeCard";
import { MapGlobe } from "./components/MapGlobe";
import { MapMarker } from "./components/MapMarker";

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
    case "nav_header":
      return <NavHeader spec={spec} theme={theme} exit={exit} />;
    case "line_chart":
      return <LineChart spec={spec} theme={theme} exit={exit} locale={locale} />;
    case "pivot_question":
      return <PivotQuestion spec={spec} theme={theme} exit={exit} />;
    case "card_grid":
      return <CardGrid spec={spec} theme={theme} exit={exit} />;
    case "scoreboard":
      return <Scoreboard spec={spec} theme={theme} exit={exit} />;
    case "strike_word":
      return <StrikeWord spec={spec} theme={theme} exit={exit} />;
    case "phrase_swap":
      return <PhraseSwap spec={spec} theme={theme} exit={exit} />;
    case "chapter_index":
      return <ChapterIndex spec={spec} theme={theme} exit={exit} />;
    case "number_phrase":
      return <NumberPhrase spec={spec} theme={theme} exit={exit} />;
    case "person_card":
      return <PersonCard spec={spec} theme={theme} exit={exit} />;
    case "milestone":
      return <MilestoneTag spec={spec} theme={theme} exit={exit} />;
    case "subscribe_cta":
      return <SubscribeCard spec={spec} theme={theme} exit={exit} locale={locale} />;
    case "map_globe":
      return <MapGlobe spec={spec} theme={theme} exit={exit} />;
    case "map_marker":
      return <MapMarker spec={spec} theme={theme} exit={exit} />;
    default:
      return null;
  }
}
