import { useEffect, useMemo, useState } from "react";
import Plot from "react-plotly.js";
import { api } from "../api";
import Loading from "../components/Loading";

const STAT_LABELS = {
  min: "MIN", pts: "PTS", reb: "REB", oreb: "OREB", dreb: "DREB", ast: "AST",
  stl: "STL", blk: "BLK", tov: "TOV", pf: "PF",
  fgm: "FGM", fga: "FGA", fg_pct: "FG%", fg3m: "3PM", fg3a: "3PA", fg3_pct: "3P%",
  ftm: "FTM", fta: "FTA", ft_pct: "FT%", plus_minus: "+/-",
  off_rating: "OFF RTG", def_rating: "DEF RTG", net_rating: "NET RTG",
  ast_pct: "AST%", oreb_pct: "OREB%", dreb_pct: "DREB%", reb_pct: "REB%",
  tov_pct: "TOV%", efg_pct: "EFG%", ts_pct: "TS%", usg_pct: "USG%",
  pace: "PACE", pie: "PIE",
};

const PERCENT_STATS = new Set([
  "fg_pct", "fg3_pct", "ft_pct", "ast_pct", "oreb_pct", "dreb_pct", "reb_pct",
  "tov_pct", "efg_pct", "ts_pct", "usg_pct",
]);

const TRADITIONAL_STATS = [
  "min", "pts", "reb", "oreb", "dreb", "ast", "stl", "blk", "tov", "pf",
  "fgm", "fga", "fg_pct", "fg3m", "fg3a", "fg3_pct", "ftm", "fta", "ft_pct", "plus_minus",
];
const ADVANCED_STATS = [
  "off_rating", "def_rating", "net_rating", "ast_pct", "oreb_pct", "dreb_pct",
  "reb_pct", "tov_pct", "efg_pct", "ts_pct", "usg_pct", "pace", "pie",
];
const DEFAULT_VISIBLE_STATS = ["pts", "reb", "ast", "stl", "blk", "tov", "fg_pct", "ts_pct", "usg_pct"];
const HIGHLIGHT_SYMBOLS = ["star", "diamond", "cross", "square", "triangle-up", "hexagon", "pentagon", "star-triangle-up"];
const HIGHLIGHT_COLORS = ["#facc15", "#38bdf8", "#f472b6", "#34d399", "#fb7185", "#a78bfa", "#fb923c", "#2dd4bf"];
const POSITIONS = ["", "Guard", "Forward", "Center"];

function formatStat(key, value) {
  if (value == null) return "--";
  if (PERCENT_STATS.has(key)) return (value * 100).toFixed(1);
  return value.toFixed(1);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Red (low percentile) -> yellow (mid) -> green (high), matching a
// "traffic light" percentile scale.
function percentileColor(pct, alpha = 0.35) {
  if (pct == null) return "transparent";
  const p = Math.max(0, Math.min(100, pct)) / 100;
  const stops = [
    [217, 88, 88],
    [222, 189, 76],
    [69, 186, 116],
  ];
  const [c0, c1, t] = p < 0.5 ? [stops[0], stops[1], p / 0.5] : [stops[1], stops[2], (p - 0.5) / 0.5];
  const r = Math.round(lerp(c0[0], c1[0], t));
  const g = Math.round(lerp(c0[1], c1[1], t));
  const b = Math.round(lerp(c0[2], c1[2], t));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  return sorted[base];
}

const selectCls = "bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm";
const labelCls = "text-xs text-slate-400 mb-1";

function FilterBar({
  seasons, fromSeason, setFromSeason, toSeason, setToSeason, allSeasons, setAllSeasons,
  seasonType, setSeasonType, position, setPosition, minGp, setMinGp, minMpg, setMinMpg,
}) {
  return (
    <div className="flex flex-wrap items-end gap-4 bg-slate-900 border border-slate-800 rounded-lg p-4">
      <label className="text-sm">
        <div className={labelCls}>Seasons</div>
        <div className="flex items-center gap-2">
          <select
            className={selectCls}
            value={fromSeason}
            disabled={allSeasons}
            onChange={(e) => setFromSeason(e.target.value)}
          >
            {seasons.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <span className="text-slate-500 text-xs">to</span>
          <select
            className={selectCls}
            value={toSeason}
            disabled={allSeasons}
            onChange={(e) => setToSeason(e.target.value)}
          >
            {seasons.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </label>
      <label className="text-sm flex items-center gap-2 pb-2">
        <input type="checkbox" checked={allSeasons} onChange={(e) => setAllSeasons(e.target.checked)} />
        All seasons on record
      </label>
      <label className="text-sm">
        <div className={labelCls}>Type</div>
        <select className={selectCls} value={seasonType} onChange={(e) => setSeasonType(e.target.value)}>
          <option value="Regular Season">Regular Season</option>
          <option value="Playoffs">Playoffs</option>
        </select>
      </label>
      <label className="text-sm">
        <div className={labelCls}>Position</div>
        <select className={selectCls} value={position} onChange={(e) => setPosition(e.target.value)}>
          {POSITIONS.map((p) => (
            <option key={p} value={p}>{p || "All"}</option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        <div className={labelCls}>Min GP</div>
        <input
          type="number" className="w-20 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm"
          min={0} value={minGp} onChange={(e) => setMinGp(Number(e.target.value) || 0)}
        />
      </label>
      <label className="text-sm">
        <div className={labelCls}>Min MPG</div>
        <input
          type="number" className="w-20 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm"
          min={0} value={minMpg} onChange={(e) => setMinMpg(Number(e.target.value) || 0)}
        />
      </label>
    </div>
  );
}

function HighlightBar({ players, highlighted, setHighlighted }) {
  const [query, setQuery] = useState("");
  const suggestions = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return players
      .filter((p) => p.player_name.toLowerCase().includes(q) && !highlighted.includes(p.player_id))
      .slice(0, 8);
  }, [query, players, highlighted]);

  function add(playerId) {
    if (highlighted.length >= 8) return;
    setHighlighted([...highlighted, playerId]);
    setQuery("");
  }
  function remove(playerId) {
    setHighlighted(highlighted.filter((id) => id !== playerId));
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide text-slate-400">Highlight players ({highlighted.length}/8)</div>
        {highlighted.length > 0 && (
          <button className="text-xs text-red-400 hover:text-red-300" onClick={() => setHighlighted([])}>
            Clear all
          </button>
        )}
      </div>
      <div className="relative">
        <input
          className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm"
          placeholder="Search player name..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {suggestions.length > 0 && (
          <div className="absolute z-10 mt-1 w-full bg-slate-800 border border-slate-700 rounded shadow-lg max-h-48 overflow-y-auto">
            {suggestions.map((p) => (
              <button
                key={p.player_id}
                className="block w-full text-left px-3 py-1.5 text-sm hover:bg-slate-700"
                onClick={() => add(p.player_id)}
              >
                {p.player_name} <span className="text-slate-500">({p.team})</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {highlighted.map((id, i) => {
          const p = players.find((pp) => pp.player_id === id);
          if (!p) return null;
          return (
            <span
              key={id}
              className="flex items-center gap-1.5 text-xs rounded-full pl-2.5 pr-1.5 py-1 border"
              style={{ borderColor: HIGHLIGHT_COLORS[i % HIGHLIGHT_COLORS.length], color: HIGHLIGHT_COLORS[i % HIGHLIGHT_COLORS.length] }}
            >
              {p.player_name}
              <button className="hover:text-white" onClick={() => remove(id)}>
                &times;
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function Leaderboard({ players, visibleStats, setVisibleStats, highlighted, setHighlighted }) {
  const [sortBy, setSortBy] = useState("pts");
  const [sortDir, setSortDir] = useState("desc");
  const [nameFilter, setNameFilter] = useState("");
  const [teamFilter, setTeamFilter] = useState("");

  const teamOptions = useMemo(() => [...new Set(players.map((p) => p.team))].sort(), [players]);

  const rows = useMemo(() => {
    let out = players;
    if (nameFilter.trim()) out = out.filter((p) => p.player_name.toLowerCase().includes(nameFilter.toLowerCase()));
    if (teamFilter) out = out.filter((p) => p.team === teamFilter);
    const sorted = [...out].sort((a, b) => {
      const av = a.stats[sortBy]?.value;
      const bv = b.stats[sortBy]?.value;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return sortDir === "desc" ? bv - av : av - bv;
    });
    return sorted;
  }, [players, nameFilter, teamFilter, sortBy, sortDir]);

  function toggleSort(key) {
    if (sortBy === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSortBy(key);
      setSortDir("desc");
    }
  }

  function toggleStat(key) {
    setVisibleStats((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  return (
    <div className="space-y-4">
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
        <div className="flex flex-wrap gap-4">
          <input
            className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm flex-1 min-w-[200px]"
            placeholder="Filter by player name..."
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
          />
          <select className={selectCls} value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
            <option value="">All teams</option>
            {teamOptions.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <div className={labelCls}>Columns</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {[...TRADITIONAL_STATS, ...ADVANCED_STATS].map((key) => (
              <label key={key} className="text-xs flex items-center gap-1 text-slate-300">
                <input type="checkbox" checked={visibleStats.includes(key)} onChange={() => toggleStat(key)} />
                {STAT_LABELS[key]}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400 border-b border-slate-800">
              <th className="py-2 pl-4 pr-2 font-medium">#</th>
              <th className="py-2 pr-4 font-medium">Player</th>
              <th className="py-2 pr-4 font-medium">Team</th>
              <th className="py-2 pr-4 font-medium">GP</th>
              {visibleStats.map((key) => (
                <th
                  key={key}
                  className="py-2 pr-4 font-medium text-right cursor-pointer select-none hover:text-slate-200"
                  onClick={() => toggleSort(key)}
                >
                  {STAT_LABELS[key]}
                  {sortBy === key && (sortDir === "desc" ? " ↓" : " ↑")}
                </th>
              ))}
              <th className="py-2 pr-4 font-medium text-center">Highlight</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => (
              <tr key={p.player_id} className="border-b border-slate-900 even:bg-slate-800/20 hover:bg-slate-800/40">
                <td className="py-1.5 pl-4 pr-2 text-slate-500">{i + 1}</td>
                <td className="py-1.5 pr-4">{p.player_name}</td>
                <td className="py-1.5 pr-4 text-slate-400">{p.team}</td>
                <td className="py-1.5 pr-4 text-slate-400">{p.gp}</td>
                {visibleStats.map((key) => (
                  <td
                    key={key}
                    className="py-1.5 pr-4 text-right tabular-nums"
                    style={{ backgroundColor: percentileColor(p.stats[key]?.percentile) }}
                    title={p.stats[key]?.percentile != null ? `${p.stats[key].percentile.toFixed(0)}th pct` : ""}
                  >
                    {formatStat(key, p.stats[key]?.value)}
                  </td>
                ))}
                <td className="py-1.5 pr-4 text-center">
                  <input
                    type="checkbox"
                    checked={highlighted.includes(p.player_id)}
                    disabled={!highlighted.includes(p.player_id) && highlighted.length >= 8}
                    onChange={(e) => {
                      if (e.target.checked) setHighlighted((prev) => [...prev, p.player_id]);
                      else setHighlighted((prev) => prev.filter((id) => id !== p.player_id));
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        Cell shading is percentile within the current filtered pool (red = low, green = high). It's always "higher
        raw value = higher percentile," even for stats where lower is conventionally better (TOV, DEF RTG) -- read
        the number itself for those.
      </p>
    </div>
  );
}

function ScatterPlotView({ players, highlighted }) {
  const allStats = [...TRADITIONAL_STATS, ...ADVANCED_STATS];
  const [xStat, setXStat] = useState("usg_pct");
  const [yStat, setYStat] = useState("ts_pct");
  const [colorStat, setColorStat] = useState("pts");

  const field = players.filter((p) => !highlighted.includes(p.player_id));
  const highlightedPlayers = highlighted.map((id) => players.find((p) => p.player_id === id)).filter(Boolean);

  const xs = field.map((p) => p.stats[xStat]?.value).filter((v) => v != null).sort((a, b) => a - b);
  const ys = field.map((p) => p.stats[yStat]?.value).filter((v) => v != null).sort((a, b) => a - b);
  const xMedian = quantile(xs, 0.5);
  const yMedian = quantile(ys, 0.5);

  const shapes = [];
  if (xMedian != null) {
    shapes.push({ type: "line", x0: xMedian, x1: xMedian, y0: 0, y1: 1, yref: "paper", line: { color: "#475569", width: 1, dash: "dot" } });
  }
  if (yMedian != null) {
    shapes.push({ type: "line", y0: yMedian, y1: yMedian, x0: 0, x1: 1, xref: "paper", line: { color: "#475569", width: 1, dash: "dot" } });
  }

  const fieldTrace = {
    x: field.map((p) => p.stats[xStat]?.value),
    y: field.map((p) => p.stats[yStat]?.value),
    text: field.map((p) => `${p.player_name} (${p.team})<br>${STAT_LABELS[xStat]}: ${formatStat(xStat, p.stats[xStat]?.value)}<br>${STAT_LABELS[yStat]}: ${formatStat(yStat, p.stats[yStat]?.value)}`),
    mode: "markers",
    type: "scatter",
    name: "Field",
    marker: {
      color: field.map((p) => percentileColor(p.stats[colorStat]?.percentile, 0.85)),
      size: 8,
      line: { color: "#0f172a", width: 1 },
    },
    hovertemplate: "%{text}<extra></extra>",
    showlegend: false,
  };

  const highlightTraces = highlightedPlayers.map((p, i) => ({
    x: [p.stats[xStat]?.value],
    y: [p.stats[yStat]?.value],
    text: [p.player_name],
    mode: "markers+text",
    type: "scatter",
    name: p.player_name,
    textposition: "top center",
    textfont: { color: HIGHLIGHT_COLORS[i % HIGHLIGHT_COLORS.length], size: 11 },
    marker: {
      symbol: HIGHLIGHT_SYMBOLS[i % HIGHLIGHT_SYMBOLS.length],
      color: HIGHLIGHT_COLORS[i % HIGHLIGHT_COLORS.length],
      size: 16,
      line: { color: "#0f172a", width: 1.5 },
    },
    hovertemplate: `<b>${p.player_name}</b><br>${STAT_LABELS[xStat]}: ${formatStat(xStat, p.stats[xStat]?.value)}<br>${STAT_LABELS[yStat]}: ${formatStat(yStat, p.stats[yStat]?.value)}<extra></extra>`,
  }));

  return (
    <div className="space-y-4">
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 flex flex-wrap gap-4">
        <label className="text-sm">
          <div className={labelCls}>X-Axis</div>
          <select className={selectCls} value={xStat} onChange={(e) => setXStat(e.target.value)}>
            {allStats.map((k) => (
              <option key={k} value={k}>{STAT_LABELS[k]}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <div className={labelCls}>Y-Axis</div>
          <select className={selectCls} value={yStat} onChange={(e) => setYStat(e.target.value)}>
            {allStats.map((k) => (
              <option key={k} value={k}>{STAT_LABELS[k]}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <div className={labelCls}>Color By</div>
          <select className={selectCls} value={colorStat} onChange={(e) => setColorStat(e.target.value)}>
            {allStats.map((k) => (
              <option key={k} value={k}>{STAT_LABELS[k]}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
        <Plot
          data={[fieldTrace, ...highlightTraces]}
          layout={{
            paper_bgcolor: "#0f172a",
            plot_bgcolor: "#0f172a",
            font: { color: "#e2e8f0" },
            xaxis: { title: STAT_LABELS[xStat], gridcolor: "#1e293b" },
            yaxis: { title: STAT_LABELS[yStat], gridcolor: "#1e293b" },
            margin: { l: 55, r: 10, t: 10, b: 50 },
            height: 520,
            shapes,
            legend: { font: { size: 10 } },
          }}
          config={{ displayModeBar: true, responsive: true, displaylogo: false }}
          style={{ width: "100%" }}
          useResizeHandler
        />
        <p className="text-xs text-slate-500 mt-2">
          Dot color reflects the "Color By" stat's percentile in this pool (red = low, green = high). Dotted lines
          mark the median for each axis. Highlighted players get their own marker shape and label.
        </p>
      </div>
    </div>
  );
}

export default function Statboard() {
  const [teams, setTeams] = useState([]);
  const [seasons, setSeasons] = useState([]);
  const [fromSeason, setFromSeason] = useState("");
  const [toSeason, setToSeason] = useState("");
  const [allSeasons, setAllSeasons] = useState(false);
  const [seasonType, setSeasonType] = useState("Regular Season");
  const [position, setPosition] = useState("");
  const [minGp, setMinGp] = useState(20);
  const [minMpg, setMinMpg] = useState(10);

  const [subTab, setSubTab] = useState("leaderboard");
  const [visibleStats, setVisibleStats] = useState(DEFAULT_VISIBLE_STATS);
  const [highlighted, setHighlighted] = useState([]);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.teams().then(setTeams).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (teams.length === 0) return;
    api
      .teamSeasons(teams[0].id)
      .then((s) => {
        setSeasons(s);
        setFromSeason(s[s.length - 1] || "");
        setToSeason(s[s.length - 1] || "");
      })
      .catch((e) => setError(e.message));
  }, [teams]);

  const seasonsParam = useMemo(() => {
    if (allSeasons) return undefined;
    if (!fromSeason || !toSeason || seasons.length === 0) return undefined;
    const fromIdx = seasons.indexOf(fromSeason);
    const toIdx = seasons.indexOf(toSeason);
    if (fromIdx === -1 || toIdx === -1) return undefined;
    const [lo, hi] = fromIdx <= toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
    return seasons.slice(lo, hi + 1).join(",");
  }, [allSeasons, fromSeason, toSeason, seasons]);

  useEffect(() => {
    if (!allSeasons && !seasonsParam) return;
    setLoading(true);
    setError(null);
    api
      .statboard({ seasons: seasonsParam, seasonType, position: position || undefined, minGp, minMpg })
      .then(setData)
      .catch((e) => {
        setError(e.message);
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [seasonsParam, allSeasons, seasonType, position, minGp, minMpg]);

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <h2 className="text-xl font-semibold">Statboard</h2>
      <p className="text-sm text-slate-400 max-w-3xl">
        A sortable, percentile-shaded leaderboard and a configurable scatter plot over Traditional + Advanced
        per-game stats, GP-weighted across any season range you pick. Pick a few players to highlight and they'll
        stay highlighted across both views below.
      </p>
      {error && <p className="text-red-400 text-sm">{error}</p>}

      <FilterBar
        seasons={seasons} fromSeason={fromSeason} setFromSeason={setFromSeason}
        toSeason={toSeason} setToSeason={setToSeason} allSeasons={allSeasons} setAllSeasons={setAllSeasons}
        seasonType={seasonType} setSeasonType={setSeasonType} position={position} setPosition={setPosition}
        minGp={minGp} setMinGp={setMinGp} minMpg={minMpg} setMinMpg={setMinMpg}
      />

      {data && (
        <HighlightBar players={data.players} highlighted={highlighted} setHighlighted={setHighlighted} />
      )}

      <div className="flex gap-2 border-b border-slate-800">
        {[
          { key: "leaderboard", label: "Leaderboard" },
          { key: "scatter", label: "Scatter Plot" },
        ].map((t) => (
          <button
            key={t.key}
            className={`px-3 py-2 text-sm border-b-2 -mb-px ${
              subTab === t.key ? "border-sky-500 text-sky-400" : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
            onClick={() => setSubTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && !data && <Loading label="Loading statboard..." />}
      {data && data.players.length > 0 && subTab === "leaderboard" && (
        <Leaderboard
          players={data.players} visibleStats={visibleStats} setVisibleStats={setVisibleStats}
          highlighted={highlighted} setHighlighted={setHighlighted}
        />
      )}
      {data && data.players.length > 0 && subTab === "scatter" && (
        <ScatterPlotView players={data.players} highlighted={highlighted} />
      )}
      {data && data.players.length === 0 && (
        <p className="text-slate-500 text-sm">No players qualify for this combination of filters.</p>
      )}
    </div>
  );
}
