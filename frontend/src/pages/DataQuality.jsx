import { useEffect, useState } from "react";
import { api } from "../api";

function Card({ title, subtitle, children }) {
  return (
    <section className="bg-slate-900 border border-slate-800 rounded-lg p-5">
      <h3 className="text-base font-semibold mb-1">{title}</h3>
      {subtitle && <p className="text-xs text-slate-500 mb-3">{subtitle}</p>}
      {children}
    </section>
  );
}

export default function DataQuality() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.dataQualitySummary().then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="text-red-400 text-sm p-6">{error}</p>;
  if (!data) return <p className="text-slate-400 text-sm p-6">Loading...</p>;

  const lp = data.lineup_pipeline;

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h2 className="text-xl font-semibold mb-1">Data Quality</h2>
        <p className="text-xs text-slate-500">
          Transparency into how the lineup-derivation pipeline handles messy play-by-play data. Nothing in the rest
          of the app hides these caveats -- this page just puts them in one place.
        </p>
      </div>

      <Card title="Warehouse Table Sizes">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Object.entries(data.table_counts).map(([t, n]) => (
            <div key={t} className="bg-slate-800 rounded p-3">
              <div className="text-xs text-slate-400 font-mono">{t}</div>
              <div className="text-lg font-semibold">{n.toLocaleString()}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card
        title="Lineup Derivation Coverage"
        subtitle="Team-games are excluded from the lineup tables entirely when the derived on-court time doesn't land within tolerance of a valid regulation/OT length -- rather than silently including a game with unreliable substitution parsing."
      >
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-slate-800 rounded p-3">
            <div className="text-xs text-slate-400">Total Team-Games</div>
            <div className="text-lg font-semibold">{lp.total_team_games.toLocaleString()}</div>
          </div>
          <div className="bg-slate-800 rounded p-3">
            <div className="text-xs text-slate-400">Excluded</div>
            <div className="text-lg font-semibold text-amber-400">{lp.excluded_team_games.toLocaleString()}</div>
          </div>
          <div className="bg-slate-800 rounded p-3">
            <div className="text-xs text-slate-400">Excluded %</div>
            <div className="text-lg font-semibold text-amber-400">{lp.excluded_pct}%</div>
          </div>
        </div>

        <h4 className="text-sm font-medium mb-2">Worst examples (by seconds off from a valid game length)</h4>
        <table className="w-full text-sm mb-4">
          <thead>
            <tr className="text-left text-slate-400 border-b border-slate-800">
              <th className="py-2 pr-4">Team</th>
              <th className="py-2 pr-4">Game</th>
              <th className="py-2 pr-4">Total Seconds</th>
              <th className="py-2 pr-4">Nearest Valid</th>
              <th className="py-2 pr-4">Diff</th>
            </tr>
          </thead>
          <tbody>
            {lp.excluded_worst_examples.map((r, i) => (
              <tr key={i} className="border-b border-slate-900">
                <td className="py-2 pr-4">{r.team_id}</td>
                <td className="py-2 pr-4">{r.game_id}</td>
                <td className="py-2 pr-4">{r.total_seconds}</td>
                <td className="py-2 pr-4">{r.nearest_valid}</td>
                <td className="py-2 pr-4 text-amber-400">{r.diff}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid sm:grid-cols-2 gap-4">
        <Card title="Substitution-Parsing Anomalies" subtitle="Flagged while walking play-by-play events to build lineups.">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 border-b border-slate-800">
                <th className="py-2 pr-4">Category</th>
                <th className="py-2 pr-4">Count</th>
              </tr>
            </thead>
            <tbody>
              {lp.anomaly_categories.map((c) => (
                <tr key={c.category} className="border-b border-slate-900">
                  <td className="py-2 pr-4">{c.category}</td>
                  <td className="py-2 pr-4">{c.n.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Period Corrections" subtitle="Out-of-order period numbers in raw play-by-play, auto-clamped during parsing.">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 border-b border-slate-800">
                <th className="py-2 pr-4">Category</th>
                <th className="py-2 pr-4">Count</th>
              </tr>
            </thead>
            <tbody>
              {lp.correction_categories.map((c) => (
                <tr key={c.category} className="border-b border-slate-900">
                  <td className="py-2 pr-4">{c.category}</td>
                  <td className="py-2 pr-4">{c.n.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
