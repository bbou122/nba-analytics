import { useEffect, useMemo, useState } from "react";
import Plot from "react-plotly.js";
import { api } from "../api";
import Loading from "../components/Loading";

const CLUSTER_COLORS = [
  "#38bdf8", "#f97316", "#a78bfa", "#34d399", "#f472b6", "#facc15", "#fb7185",
  "#22d3ee", "#84cc16", "#c084fc", "#fbbf24", "#2dd4bf",
];

export default function Archetypes() {
  const [teams, setTeams] = useState([]);
  const [seasons, setSeasons] = useState([]);
  const [season, setSeason] = useState("");
  const [minGp, setMinGp] = useState(20);
  const [nClusters, setNClusters] = useState(7);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [teamFilter, setTeamFilter] = useState("");
  const [selectedCluster, setSelectedCluster] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.teams().then(setTeams).catch((e) => setError(e.message));
  }, []);

  // Reuse a team's season list as a stand-in for "every season on record"
  // -- there's no dedicated league-wide seasons endpoint, and every team's
  // range covers the same warehouse years.
  useEffect(() => {
    if (teams.length === 0) return;
    api
      .teamSeasons(teams[0].id)
      .then((s) => {
        setSeasons(s);
        setSeason(s[s.length - 1] || "");
      })
      .catch((e) => setError(e.message));
  }, [teams]);

  useEffect(() => {
    if (!season) return;
    setError(null);
    setSelectedCluster(null);
    setLoading(true);
    api
      .archetypes({ season, minGp, nClusters })
      .then(setData)
      .catch((e) => {
        setError(e.message);
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [season, minGp, nClusters]);

  const filteredPlayers = useMemo(() => {
    if (!data) return [];
    let players = data.players;
    if (teamFilter) players = players.filter((p) => p.team === teamFilter);
    if (selectedCluster != null) players = players.filter((p) => p.cluster === selectedCluster);
    return players;
  }, [data, teamFilter, selectedCluster]);

  const teamOptions = useMemo(() => [...new Set((data?.players ?? []).map((p) => p.team))].sort(), [data]);

  return (
    <div className="p-6 space-y-4 max-w-6xl mx-auto">
      <h2 className="text-xl font-semibold">Player Archetypes</h2>
      <p className="text-sm text-slate-400 max-w-3xl">
        An unsupervised, statistics-only grouping (KMeans on z-score-normalized usage, efficiency, playmaking,
        rebounding, turnovers, 3-point rate, paint-scoring share, and defensive activity) -- "who plays like whom,
        statistically, this season." Cluster count and labels are auto-generated heuristics, not a reproduction of
        any published archetype system.
      </p>
      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="flex flex-wrap items-end gap-4 bg-slate-900 border border-slate-800 rounded-lg p-4">
        <label className="text-sm">
          <div className="text-xs text-slate-400 mb-1">Season</div>
          <select
            className="bg-slate-800 border border-slate-700 rounded px-3 py-2"
            value={season}
            onChange={(e) => setSeason(e.target.value)}
          >
            {seasons.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <div className="text-xs text-slate-400 mb-1">Min GP</div>
          <input
            type="number"
            className="w-20 bg-slate-800 border border-slate-700 rounded px-3 py-2"
            min={1}
            max={82}
            value={minGp}
            onChange={(e) => setMinGp(Number(e.target.value) || 1)}
          />
        </label>
        <label className="text-sm">
          <div className="text-xs text-slate-400 mb-1"># Clusters</div>
          <input
            type="number"
            className="w-20 bg-slate-800 border border-slate-700 rounded px-3 py-2"
            min={2}
            max={12}
            value={nClusters}
            onChange={(e) => setNClusters(Number(e.target.value) || 2)}
          />
        </label>
        <label className="text-sm">
          <div className="text-xs text-slate-400 mb-1">Team</div>
          <select
            className="bg-slate-800 border border-slate-700 rounded px-3 py-2"
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
          >
            <option value="">All teams</option>
            {teamOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading && !data && <Loading label="Clustering players (this can take a moment)..." />}
      {data && (
        <>
          <section className="bg-slate-900 border border-slate-800 rounded-lg p-5">
            <h3 className="text-base font-semibold mb-1">Usage vs. Efficiency, by Cluster</h3>
            <p className="text-xs text-slate-500 mb-3">
              Click a legend entry to isolate a cluster; click again to bring it back. Marker size scales with 3PA
              rate.
            </p>
            <Plot
              data={data.clusters.map((c) => {
                const pts = data.players.filter((p) => p.cluster === c.cluster && (!teamFilter || p.team === teamFilter));
                return {
                  x: pts.map((p) => p.usg_pct),
                  y: pts.map((p) => p.ts_pct),
                  text: pts.map((p) => `${p.player_name} (${p.team})<br>${p.archetype}`),
                  mode: "markers",
                  type: "scatter",
                  name: c.archetype,
                  marker: {
                    color: CLUSTER_COLORS[c.cluster % CLUSTER_COLORS.length],
                    size: pts.map((p) => 6 + p.fg3a_rate * 18),
                    opacity: 0.8,
                    line: { color: "#0f172a", width: 1 },
                  },
                  hovertemplate: "%{text}<br>USG %{x}, TS %{y}<extra></extra>",
                };
              })}
              layout={{
                paper_bgcolor: "#0f172a",
                plot_bgcolor: "#0f172a",
                font: { color: "#e2e8f0" },
                xaxis: { title: "Usage %", gridcolor: "#1e293b" },
                yaxis: { title: "True Shooting %", gridcolor: "#1e293b" },
                margin: { l: 50, r: 10, t: 10, b: 45 },
                height: 480,
                legend: { font: { size: 10 } },
              }}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: "100%" }}
              useResizeHandler
              onLegendClick={(e) => {
                const clusterIdx = data.clusters[e.curveNumber]?.cluster;
                setSelectedCluster((prev) => (prev === clusterIdx ? null : clusterIdx));
                return false;
              }}
            />
          </section>

          <section className="bg-slate-900 border border-slate-800 rounded-lg p-5">
            <h3 className="text-base font-semibold mb-3">Clusters</h3>
            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3 mb-4">
              {data.clusters.map((c) => (
                <button
                  key={c.cluster}
                  onClick={() => setSelectedCluster((prev) => (prev === c.cluster ? null : c.cluster))}
                  className={`text-left rounded p-3 border ${
                    selectedCluster === c.cluster ? "border-sky-600 bg-sky-950/40" : "border-slate-800 bg-slate-800/60"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="w-2.5 h-2.5 rounded-full inline-block"
                      style={{ backgroundColor: CLUSTER_COLORS[c.cluster % CLUSTER_COLORS.length] }}
                    />
                    <span className="font-medium text-sm">{c.archetype}</span>
                  </div>
                  <div className="text-xs text-slate-500">{c.player_count} players</div>
                  <div className="text-xs text-slate-500">e.g. {c.example_players.join(", ")}</div>
                </button>
              ))}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-400 border-b border-slate-800">
                    <th className="py-2 pr-4">Player</th>
                    <th className="py-2 pr-4">Team</th>
                    <th className="py-2 pr-4">Archetype</th>
                    <th className="py-2 pr-4">GP</th>
                    <th className="py-2 pr-4">USG%</th>
                    <th className="py-2 pr-4">TS%</th>
                    <th className="py-2 pr-4">AST%</th>
                    <th className="py-2 pr-4">3PA Rate</th>
                    <th className="py-2 pr-4">Paint Share</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPlayers.map((p) => (
                    <tr key={p.player_id} className="border-b border-slate-900">
                      <td className="py-1.5 pr-4">{p.player_name}</td>
                      <td className="py-1.5 pr-4 text-slate-400">{p.team}</td>
                      <td className="py-1.5 pr-4">
                        <span
                          className="w-2 h-2 rounded-full inline-block mr-1.5"
                          style={{ backgroundColor: CLUSTER_COLORS[p.cluster % CLUSTER_COLORS.length] }}
                        />
                        {p.archetype}
                      </td>
                      <td className="py-1.5 pr-4">{p.gp}</td>
                      <td className="py-1.5 pr-4">{p.usg_pct != null ? (p.usg_pct * 100).toFixed(1) : "--"}</td>
                      <td className="py-1.5 pr-4">{p.ts_pct != null ? (p.ts_pct * 100).toFixed(1) : "--"}</td>
                      <td className="py-1.5 pr-4">{p.ast_pct != null ? (p.ast_pct * 100).toFixed(1) : "--"}</td>
                      <td className="py-1.5 pr-4">{(p.fg3a_rate * 100).toFixed(1)}</td>
                      <td className="py-1.5 pr-4">{(p.paint_share * 100).toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
