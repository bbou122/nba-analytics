import { useState } from "react";
import PlayerExplorer from "./pages/PlayerExplorer";
import LineupExplorer from "./pages/LineupExplorer";
import ExecutiveDashboard from "./pages/ExecutiveDashboard";
import GameAnalysis from "./pages/GameAnalysis";
import DataQuality from "./pages/DataQuality";
import Archetypes from "./pages/Archetypes";
import Compare from "./pages/Compare";
import Statboard from "./pages/Statboard";
import TeamCompare from "./pages/TeamCompare";
import RecordCalculator from "./pages/RecordCalculator";
import LeagueRanks from "./pages/LeagueRanks";
import Methodology from "./pages/Methodology";

const TABS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "players", label: "Players" },
  { key: "lineups", label: "Lineups" },
  { key: "games", label: "Game Analysis" },
  { key: "archetypes", label: "Archetypes" },
  { key: "compare", label: "Compare" },
  { key: "statboard", label: "Statboard" },
  { key: "teamcompare", label: "Team Compare" },
  { key: "recordcalc", label: "Record Calculator" },
  { key: "leagueranks", label: "League Ranks" },
  { key: "quality", label: "Data Quality" },
  { key: "methodology", label: "Methodology" },
];

export default function App() {
  const [tab, setTab] = useState("dashboard");

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 px-6 py-4 flex items-center gap-6">
        <h1 className="text-lg font-bold">NBA Analytics</h1>
        <nav className="flex gap-2 flex-wrap">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`px-3 py-1.5 rounded text-sm ${
                tab === t.key ? "bg-slate-800" : "text-slate-400 hover:text-slate-200"
              }`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {tab === "dashboard" && <ExecutiveDashboard />}
        {tab === "players" && <PlayerExplorer />}
        {tab === "lineups" && <LineupExplorer />}
        {tab === "games" && <GameAnalysis />}
        {tab === "archetypes" && <Archetypes />}
        {tab === "compare" && <Compare />}
        {tab === "statboard" && <Statboard />}
        {tab === "teamcompare" && <TeamCompare />}
        {tab === "recordcalc" && <RecordCalculator />}
        {tab === "leagueranks" && <LeagueRanks />}
        {tab === "quality" && <DataQuality />}
        {tab === "methodology" && <Methodology />}
      </main>
    </div>
  );
}
