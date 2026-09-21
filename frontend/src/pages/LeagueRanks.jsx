import { useEffect, useMemo, useState } from "react";
import Plot from "react-plotly.js";
import { api } from "../api";
import Loading from "../components/Loading";

// A team with a stats row in every season since 1996-97 (when Advanced/
// Four Factors tracking starts in this warehouse) -- used purely to
// cheaply source the season dropdown's options via the existing
// /teams/{id}/seasons endpoint, rather than adding a new one.
const REFERENCE_TEAM_ID = 1610612738; // Boston Celtics

const STAT_LABELS = {
  w_pct: "W%", pts: "PTS", reb: "REB", oreb: "OREB", dreb: "DREB", ast: "AST",
  stl: "STL", blk: "BLK", tov: "TOV", pf: "PF",
  fg_pct: "FG%", fg3_pct: "3P%", ft_pct: "FT%", plus_minus: "+/-",
  off_rating: "OFF RTG", def_rating: "DEF RTG", net_rating: "NET RTG", pace: "PACE",
  ts_pct: "TS%", pie: "PIE", ast_pct: "AST%", ast_to: "AST/TO", ast_ratio: "AST RATIO",
  oreb_pct: "OREB%", dreb_pct: "DREB%", reb_pct: "REB%", tm_tov_pct: "TOV%",
  efg_pct: "EFG%", fta_rate: "FTA RATE",
  opp_efg_pct: "OPP EFG%", opp_fta_rate: "OPP FTA RATE", opp_tov_pct: "OPP TOV%", opp_oreb_pct: "OPP OREB%",
};

const PERCENT_STATS = new Set([
  "w_pct", "fg_pct", "fg3_pct", "ft_pct", "ts_pct", "pie", "ast_pct", "oreb_pct", "dreb_pct",
  "reb_pct", "tm_tov_pct", "efg_pct", "fta_rate", "opp_efg_pct", "opp_fta_rate", "opp_tov_pct", "opp_oreb_pct",
]);

const RECORD_STATS = ["w_pct"];
const TRADITIONAL_STATS = ["pts", "reb", "oreb", "dreb", "ast", "stl", "blk", "tov", "pf", "fg_pct", "fg3_pct", "ft_pct", "plus_minus"];
const ADVANCED_STATS = ["off_rating", "def_rating", "net_rating", "pace", "ts_pct", "pie", "ast_pct", "ast_to", "ast_ratio", "oreb_pct", "dreb_pct", "reb_pct", "tm_tov_pct"];
const FOUR_FACTOR_STATS = ["efg_pct", "fta_rate", "opp_efg_pct", "opp_fta_rate", "opp_tov_pct", "opp_oreb_pct"];
const ALL_STATS = [...RECORD_STATS, ...TRADITIONAL_STATS, ...ADVANCED_STATS, ...FOUR_FACTOR_STATS];
const DEFAULT_VISIBLE_STATS = ["w_pct", "off_rating", "def_rating", "net_rating", "pace", "ts_pct", "efg_pct", "oreb_pct"];

const SEASON_TYPES = [
  { key: "Regular Season", label: "Regular Season" },
  { key: "Playoffs", label: "Playoffs" },
];

function formatStat(key, value) {
  if (value == null) return "--";
  if (PERCENT_STATS.has(key)) return (value * 100).toFixed(1);
  return value.toFixed(1);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Same red -> yellow -> green "traffic light" percentile scale used on
// the player Statboard, so shading reads consistently across the app.
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

const selectCls = "bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm";
const labelCls = "text-xs text-slate-400 mb-1";

function shortLabel(team) {
  // "Boston Celtics" -> "BOS 22-23" -- compact enough for a table row or
  // scatter-plot point label without needing a separate abbreviation field.
  const words = team.team_name.split(" ");
  const abbr = (words.length > 1 ? words[0].slice(0, 3) : team.team_name.slice(0, 3)).toUpperCase();
  return `${abbr} ${team.season.slice(2)}`;
}

function Leaderboard({ teams, visibleStats, setVisibleStats }) {
  const [sortBy, setSortBy] = useState("net_rating");
  const [sortDir, setSortDir] = useState("desc");
  const [nameFilter, setNameFilter] = useState("");

  const rows = useMemo(() => {
    let out = teams;
    if (nameFilter.trim()) out = out.filter((t) => t.team_name.toLowerCase().includes(nameFilter.toLowerCase()));
    return [...out].sort((a, b) => {
      const av = a.stats[sortBy]?.value;
      const bv = b.stats[sortBy]?.value;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return sortDir === "desc" ? bv - av : av - bv;
    });
  }, [teams, nameFilter, sortBy, sortDir]);

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
        <input
          className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm w-full max-w-xs"
          placeholder="Filter by team name..."
          value={nameFilter}
          onChange={(e) => setNameFilter(e.target.value)}
        />
        <div>
          <div className={labelCls}>Columns</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {ALL_STATS.map((key) => (
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
              <th className="py-2 pr-4 font-medium">Team</th>
              <th className="py-2 pr-4 font-medium">Season</th>
              <th className="py-2 pr-4 font-medium">W-L</th>
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
            </tr>
          </thead>
          <tbody>
            {rows.map((t, i) => (
              <tr key={`${t.team_id}-${t.season}`} className="border-b border-slate-900 even:bg-slate-800/20 hover:bg-slate-800/40">
                <td className="py-1.5 pl-4 pr-2 text-slate-500">{i + 1}</td>
                <td className="py-1.5 pr-4">{t.team_name}</td>
                <td className="py-1.5 pr-4 text-slate-400">{t.season}</td>
                <td className="py-1.5 pr-4 text-slate-400">{t.w}-{t.l}</td>
                {visibleStats.map((key) => (
                  <td
                    key={key}
                    className="py-1.5 pr-4 text-right tabular-nums"
                    style={{ backgroundColor: percentileColor(t.stats[key]?.percentile) }}
                    title={t.stats[key]?.percentile != null ? `${t.stats[key].percentile.toFixed(0)}th pct` : ""}
                  >
                    {formatStat(key, t.stats[key]?.value)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        Cell shading is percentile within the current pool (red = low, green = high). It's always "higher raw value
        = higher percentile," even for stats where lower is conventionally better (DEF RTG, TOV%, OPP EFG%) -- read
        the number itself for those.
      </p>
    </div>
  );
}

function ScatterPlotView({ teams }) {
  const [xStat, setXStat] = useState("off_rating");
  const [yStat, setYStat] = useState("def_rating");
  const [colorStat, setColorStat] = useState("net_rating");

  const withData = teams.filter((t) => t.stats[xStat]?.value != null && t.stats[yStat]?.value != null);
  const showLabels = withData.length <= 35;

  const trace = {
    x: withData.map((t) => t.stats[xStat].value),
    y: withData.map((t) => t.stats[yStat].value),
    text: withData.map((t) => (showLabels ? shortLabel(t) : `${t.team_name} (${t.season})`)),
    mode: showLabels ? "markers+text" : "markers",
    type: "scatter",
    textposition: "top center",
    textfont: { size: 9, color: "#94a3b8" },
    marker: {
      size: showLabels ? 10 : 7,
      color: withData.map((t) => percentileColor(t.stats[colorStat]?.percentile, 0.9)),
      line: { color: "#0f172a", width: 1 },
    },
    hovertemplate: showLabels
      ? undefined
      : `%{text}<br>${STAT_LABELS[xStat]}: %{x}<br>${STAT_LABELS[yStat]}: %{y}<extra></extra>`,
  };

  return (
    <div className="space-y-4">
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 flex flex-wrap gap-4">
        <div>
          <div className={labelCls}>X Axis</div>
          <select className={selectCls} value={xStat} onChange={(e) => setXStat(e.target.value)}>
            {ALL_STATS.map((k) => (
              <option key={k} value={k}>{STAT_LABELS[k]}</option>
            ))}
          </select>
        </div>
        <div>
          <div className={labelCls}>Y Axis</div>
          <select className={selectCls} value={yStat} onChange={(e) => setYStat(e.target.value)}>
            {ALL_STATS.map((k) => (
              <option key={k} value={k}>{STAT_LABELS[k]}</option>
            ))}
          </select>
        </div>
        <div>
          <div className={labelCls}>Color By</div>
          <select className={selectCls} value={colorStat} onChange={(e) => setColorStat(e.target.value)}>
            {ALL_STATS.map((k) => (
              <option key={k} value={k}>{STAT_LABELS[k]}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <Plot
          data={[trace]}
          layout={{
            paper_bgcolor: "#0f172a",
            plot_bgcolor: "#0f172a",
            font: { color: "#e2e8f0" },
            xaxis: { title: STAT_LABELS[xStat], gridcolor: "#1e293b" },
            yaxis: { title: STAT_LABELS[yStat], gridcolor: "#1e293b" },
            margin: { l: 55, r: 20, t: 10, b: 45 },
            height: 520,
            showlegend: false,
          }}
          config={{ displayModeBar: false, responsive: true }}
          style={{ width: "100%" }}
          useResizeHandler
        />
      </div>
      <p className="text-xs text-slate-500">
        {showLabels
          ? "Labels shown since this pool is small enough to read directly."
          : "Hover a point for its team-season -- too many points to label permanently at this pool size."}
        {" "}Dot color is percentile on the "Color By" stat, same red-to-green scale as the Leaderboard.
      </p>
    </div>
  );
}

export default function LeagueRanks() {
  const [referenceSeasons, setReferenceSeasons] = useState([]);
  const [seasonScope, setSeasonScope] = useState("single"); // "single" | "all"
  const [season, setSeason] = useState("");
  const [seasonType, setSeasonType] = useState("Regular Season");
  const [subTab, setSubTab] = useState("leaderboard");
  const [visibleStats, setVisibleStats] = useState(DEFAULT_VISIBLE_STATS);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .teamSeasons(REFERENCE_TEAM_ID)
      .then((s) => {
        setReferenceSeasons(s);
        setSeason(s[s.length - 1] || "");
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (seasonScope === "single" && !season) return;
    setError(null);
    setLoading(true);
    api
      .teamLeaderboard({ seasons: seasonScope === "single" ? season : undefined, seasonType })
      .then(setData)
      .catch((e) => {
        setError(e.message);
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [seasonScope, season, seasonType]);

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h2 className="text-xl font-semibold mb-1">League Ranks</h2>
        <p className="text-xs text-slate-500">
          Every team-season, ranked. Compare this year's 30 teams head to head, or zoom out to every team-season on
          record since 1996-97 for historical context -- "is a +6 net rating actually elite, or just above average
          this particular year."
        </p>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <div className={labelCls}>Scope</div>
          <div className="flex gap-1 bg-slate-800 rounded p-1">
            <button
              className={`px-3 py-1.5 rounded text-sm ${
                seasonScope === "single" ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200"
              }`}
              onClick={() => setSeasonScope("single")}
            >
              This Season
            </button>
            <button
              className={`px-3 py-1.5 rounded text-sm ${
                seasonScope === "all" ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200"
              }`}
              onClick={() => setSeasonScope("all")}
            >
              All Team-Seasons
            </button>
          </div>
        </div>

        {seasonScope === "single" && (
          <div>
            <div className={labelCls}>Season</div>
            <select className={selectCls} value={season} onChange={(e) => setSeason(e.target.value)} disabled={referenceSeasons.length === 0}>
              {referenceSeasons.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <div className={labelCls}>Season Type</div>
          <div className="flex gap-1 bg-slate-800 rounded p-1">
            {SEASON_TYPES.map((o) => (
              <button
                key={o.key}
                className={`px-3 py-1.5 rounded text-sm ${
                  seasonType === o.key ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200"
                }`}
                onClick={() => setSeasonType(o.key)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex gap-1 border-b border-slate-800">
        {[
          { key: "leaderboard", label: "Leaderboard" },
          { key: "scatter", label: "Scatter Plot" },
        ].map((t) => (
          <button
            key={t.key}
            className={`px-4 py-2 text-sm ${
              subTab === t.key ? "border-b-2 border-sky-500 text-sky-400" : "text-slate-400 hover:text-slate-200"
            }`}
            onClick={() => setSubTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && <Loading label="Ranking teams..." />}

      {!loading && data && (
        <>
          <p className="text-xs text-slate-500">
            {data.team_season_count} team-season{data.team_season_count === 1 ? "" : "s"} in this pool.
          </p>
          {subTab === "leaderboard" && (
            <Leaderboard teams={data.teams} visibleStats={visibleStats} setVisibleStats={setVisibleStats} />
          )}
          {subTab === "scatter" && <ScatterPlotView teams={data.teams} />}
        </>
      )}
    </div>
  );
}
