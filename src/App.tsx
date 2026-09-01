import { useEffect } from "react";
import { NavShell } from "@/ui/components/NavShell";
import { useAppStore } from "@/store/useAppStore";
import { useMatchStore } from "@/store/useMatchStore";
import { useSaveStore } from "@/store/useSaveStore";
import { eraForDate } from "@/data/rankSystem";
import { HomeScreen } from "@/ui/screens/HomeScreen";
import { StatsScreen } from "@/ui/screens/StatsScreen";
import { TrainingScreen } from "@/ui/screens/TrainingScreen";
import { RankedScreen } from "@/ui/screens/RankedScreen";
import { LockerScreen } from "@/ui/screens/LockerScreen";
import { SettingsScreen } from "@/ui/screens/SettingsScreen";
import { SocialScreen } from "@/ui/screens/SocialScreen";
import { TourneysScreen } from "@/ui/screens/TourneysScreen";
import { OrgScreen } from "@/ui/screens/OrgScreen";
import { MatchScreen } from "@/ui/screens/MatchScreen";
import { SeasonAnnouncementModal } from "@/ui/components/SeasonAnnouncementModal";

export default function App() {
  const screen = useAppStore((s) => s.screen);
  const matchPhase = useMatchStore((m) => m.phase);
  const currentDate = useSaveStore((s) => s.currentDate);
  const ensureOrgScouting = useSaveStore((s) => s.ensureOrgScouting);

  // Runs regardless of which screen is active (unlike ensureProgress/ensureShowmatchInvitations, which
  // only tick while their own screen is mounted) — the whole point of the nav-icon notification dot below
  // is that a scouting invite can show up without the player ever having opened the Org tab to trigger it.
  useEffect(() => {
    ensureOrgScouting(currentDate, eraForDate(currentDate), currentDate.year);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDate.year, currentDate.month, currentDate.day]);

  if (matchPhase === "found" || matchPhase === "in_match" || matchPhase === "post_match") {
    return <MatchScreen />;
  }

  return (
    <>
      <SeasonAnnouncementModal />
      <NavShell>
        <div key={screen} className="fade-in">
          {screen === "home" && <HomeScreen />}
          {screen === "stats" && <StatsScreen />}
          {screen === "training" && <TrainingScreen />}
          {screen === "ranked" && <RankedScreen />}
          {screen === "tournaments" && <TourneysScreen />}
          {screen === "org" && <OrgScreen />}
          {screen === "social" && <SocialScreen />}
          {screen === "locker" && <LockerScreen />}
          {screen === "settings" && <SettingsScreen />}
        </div>
      </NavShell>
    </>
  );
}
