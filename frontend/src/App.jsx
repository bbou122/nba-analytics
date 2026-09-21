import { lazy, Suspense, useState } from "react";
import Loading from "./components/Loading";

// Each page is loaded on demand rather than bundled into the initial chunk --
// several pages pull in react-plotly.js (a multi-MB library on its own), so
// eagerly importing all 12 pages up front was the main driver of the
// project's oversized initial bundle. Only the tab someone actually clicks
// ever gets fetched.
const ExecutiveDashboard = lazy(() => import("./pages/ExecutiveDashboard"));
const PlayerExplorer = lazy(() => import("./pages/PlayerExplorer"));
const LineupExplorer = lazy(() => import("./pages/LineupExplorer"));
const GameAnalysis = lazy(() => import("./pages/GameAnalysis"));
const Archetypes = lazy(() => import("./pages/Archetypes"));
const Compare = lazy(() => import("./pages/Compare"));
const Statboard = lazy(() => import("./pages/Statboard"));
const TeamCompare = lazy(() => import("./pages/TeamCompare"));
const RecordCalculator = lazy(() => import("./pages/RecordCalculator"));
const LeagueRanks = lazy(() => import("./pages/LeagueRanks"));
const DataQuality = lazy(() => import("./pages/DataQuality"));
const Methodology = lazy(() => import("./pages/Methodology"));

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
      <header className="border-b border-slate-800 px-6 py-4">
        <div className="flex items-center gap-6 flex-wrap">
          <div>
            <h1 className="text-lg font-bold leading-tight">NBA Analytics</h1>
            <p className="text-xs text-slate-500">
              A front-office-style analytics platform built on 28 seasons of NBA box scores &amp; play-by-play.
            </p>
          </div>
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
        </div>
      </header>
      <main>
        <Suspense fallback={<Loading label="Loading page..." />}>
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
        </Suspense>
      </main>
    </div>
  );
}
