import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import Plot from "react-plotly.js";
import CourtShotChart from "../components/CourtShotChart";
import GameShotChart from "../components/GameShotChart";
import Loading from "../components/Loading";

function Card({ title, subtitle, children }) {
  return (
    <section className="bg-slate-900 border border-slate-800 rounded-lg p-5">
      <h3 className="text-base font-semibold mb-1">{title}</h3>
      {subtitle && <p className="text-xs text-slate-500 mb-3">{subtitle}</p>}
      {children}
    </section>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="bg-slate-800 rounded p-3">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function pct(v) {
  return v != null ? `${(v * 100).toFixed(1)}%` : "--";
}

function Diff({ value, suffix = "" }) {
  if (value == null) return <span>--</span>;
  return (
    <span className={value >= 0 ? "text-green-400" : "text-red-400"}>
      {value >= 0 ? "+" : ""}
      {value}
      {suffix}
    </span>
  );
}

function FourFactorRow({ label, team, opp, higherIsBetter = true }) {
  const better = team != null && opp != null && (higherIsBetter ? team > opp : team < opp);
  const worse = team != null && opp != null && (higherIsBetter ? team < opp : team > opp);
  return (
    <tr className="border-b border-slate-900">
      <td className="py-2 pr-4 text-slate-400">{label}</td>
      <td className={`py-2 pr-4 font-medium ${better ? "text-green-400" : worse ? "text-red-400" : ""}`}>
        {pct(team)}
      </td>
      <td className="py-2 pr-4 text-slate-400">{pct(opp)}</td>
    </tr>
  );
}

function hottestZoneNote(zones) {
  const qualifying = zones.filter((z) => z.attempts >= 3);
  if (qualifying.length === 0) return null;
  const hottest = [...qualifying].sort((a, b) => b.fg_pct - a.fg_pct)[0];
  const coldest = [...qualifying].sort((a, b) => a.fg_pct - b.fg_pct)[0];
  return { hottest, coldest };
}

const SUB_TABS = [
  { key: "overview", label: "Overview" },
  { key: "context", label: "Context Stats" },
  { key: "gamelog", label: "Game Log" },
  { key: "roster", label: "Roster" },
  { key: "impact", label: "Teammate Impact" },
  { key: "identity", label: "Team Identity" },
];

const HOME_AWAY_OPTIONS = [
  { key: "all", label: "All" },
  { key: "home", label: "Home" },
  { key: "away", label: "Away" },
];

const STRETCH_PRESETS = [
  { key: "5", label: "Last 5" },
  { key: "10", label: "Last 10" },
  { key: "20", label: "Last 20" },
  { key: "all", label: "Full Season" },
];

export default function ExecutiveDashboard() {
  const [teams, setTeams] = useState([]);
  const [teamId, setTeamId] = useState(null);
  const [seasons, setSeasons] = useState([]);
  const [season, setSeason] = useState("");
  const [homeAway, setHomeAway] = useState("all");
  const [seasonType, setSeasonType] = useState("Regular Season");
  const [subTab, setSubTab] = useState("overview");
  const [error, setError] = useState(null);

  const [data, setData] = useState(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);

  const [statType, setStatType] = useState("traditional");
  const [fullStats, setFullStats] = useState(null);
  const [showFullStats, setShowFullStats] = useState(false);

  const [games, setGames] = useState([]);
  const [stretch, setStretch] = useState("10");
  const [rangeStart, setRangeStart] = useState(null);
  const [rangeEnd, setRangeEnd] = useState(null);
  const [b2bOnly, setB2bOnly] = useState(false);

  const [roster, setRoster] = useState([]);
  const [rosterSort, setRosterSort] = useState("MIN");
  const [winShares, setWinShares] = useState(null);
  const [identity, setIdentity] = useState(null);
  const [quarterTrends, setQuarterTrends] = useState(null);
  const [teamClutch, setTeamClutch] = useState(null);
  const [netRatingTrend, setNetRatingTrend] = useState(null);

  const [impactPlayerId, setImpactPlayerId] = useState(null);
  const [impactTeammateId, setImpactTeammateId] = useState(null);
  const [impactData, setImpactData] = useState(null);
  const [impactWithShots, setImpactWithShots] = useState([]);
  const [impactWithoutShots, setImpactWithoutShots] = useState([]);

  const [stretchPlayerStats, setStretchPlayerStats] = useState([]);
  const [hotPlayerId, setHotPlayerId] = useState(null);
  const [hotPlayerShots, setHotPlayerShots] = useState([]);
  const [hotPlayerZones, setHotPlayerZones] = useState([]);

  const [shotChartGameId, setShotChartGameId] = useState(null);
  const [gameShots, setGameShots] = useState([]);
  const [gameShotFilter, setGameShotFilter] = useState("both");

  useEffect(() => {
    api.teams().then(setTeams).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!teamId) return;
    setError(null);
    api
      .teamSeasons(teamId)
      .then((s) => {
        setSeasons(s);
        setSeason(s[s.length - 1] || "");
      })
      .catch((e) => setError(e.message));
  }, [teamId]);

  useEffect(() => {
    if (!teamId || !season) return;
    setError(null);
    setDashboardLoading(true);
    api.teamDashboard(teamId, season, homeAway, seasonType).then(setData).catch((e) => {
      setError(e.message);
      setData(null);
    }).finally(() => setDashboardLoading(false));
    api.teamGames(teamId, { season }).then(setGames).catch((e) => {
      setError(e.message);
      setGames([]);
    });
    api.teamRoster(teamId, season, seasonType).then(setRoster).catch(() => setRoster([]));
    api.winShares(teamId, season, seasonType).then(setWinShares).catch(() => setWinShares(null));
    api.teamIdentity(teamId, season, seasonType).then(setIdentity).catch(() => setIdentity(null));
  }, [teamId, season, homeAway, seasonType]);

  useEffect(() => {
    if (!teamId || !season) return;
    api.quarterTrends(teamId, { season, homeAway: homeAway === "all" ? undefined : homeAway, seasonType })
      .then(setQuarterTrends)
      .catch(() => setQuarterTrends(null));
  }, [teamId, season, homeAway, seasonType]);

  // Team clutch identity + net rating trend, shown on the Team Identity tab.
  useEffect(() => {
    if (!teamId || !season) return;
    api.teamClutch(teamId, { season, seasonType }).then(setTeamClutch).catch(() => setTeamClutch(null));
    api
      .netRatingTrend(teamId, { season, homeAway: homeAway === "all" ? undefined : homeAway, seasonType })
      .then(setNetRatingTrend)
      .catch(() => setNetRatingTrend(null));
  }, [teamId, season, homeAway, seasonType]);

  const winSharesMap = useMemo(() => {
    const m = new Map();
    (winShares?.players ?? []).forEach((p) => m.set(p.player_id, p.est_win_shares));
    return m;
  }, [winShares]);

  useEffect(() => {
    if (!teamId || !season || !showFullStats) return;
    api.teamStats(teamId, { season, statType }).then((rows) => setFullStats(rows[0])).catch((e) => setError(e.message));
  }, [teamId, season, statType, showFullStats]);

  // Games this team played, narrowed to the active home/away filter --
  // everything in the Game Log tab (stretches, "who's hot", per-game shot
  // chart) is derived from this rather than the raw fetched `games` list.
  const filteredGames = useMemo(() => {
    if (homeAway === "all") return games;
    return games.filter((g) => (homeAway === "home") === g.is_home);
  }, [games, homeAway]);

  // Reset the game-log custom range whenever the filtered game list changes.
  useEffect(() => {
    setRangeStart(0);
    setRangeEnd(Math.max(filteredGames.length - 1, 0));
  }, [filteredGames]);

  const stretchGames = useMemo(() => {
    let base;
    if (filteredGames.length === 0) base = [];
    else if (stretch === "all") base = filteredGames;
    else if (stretch === "custom") base = filteredGames.slice(rangeStart, rangeEnd + 1);
    else {
      const n = Number(stretch);
      base = filteredGames.slice(Math.max(filteredGames.length - n, 0));
    }
    return b2bOnly ? base.filter((g) => g.is_back_to_back) : base;
  }, [filteredGames, stretch, rangeStart, rangeEnd, b2bOnly]);

  const stretchSummary = useMemo(() => {
    if (stretchGames.length === 0) return null;
    const n = stretchGames.length;
    const sum = (key) => stretchGames.reduce((acc, g) => acc + (g[key] ?? 0), 0);
    const avg = (key) => sum(key) / n;
    const wins = stretchGames.filter((g) => g.result_for_team === "W").length;
    const oppPts = stretchGames.reduce((acc, g) => acc + (g.is_home ? g.pts_away : g.pts_home), 0);
    return {
      n,
      w: wins,
      l: n - wins,
      pts: avg("pts").toFixed(1),
      oppPts: (oppPts / n).toFixed(1),
      margin: (avg("pts") - oppPts / n).toFixed(1),
      fgPct: ((sum("fgm") / sum("fga")) * 100).toFixed(1),
      fg3Pct: ((sum("fg3m") / sum("fg3a")) * 100).toFixed(1),
      reb: avg("reb").toFixed(1),
      ast: avg("ast").toFixed(1),
      tov: avg("tov").toFixed(1),
      ptsPaint: avg("pts_paint").toFixed(1),
      ptsFb: avg("pts_fb").toFixed(1),
      pts2ndChance: avg("pts_2nd_chance").toFixed(1),
      opponents: [...new Set(stretchGames.map((g) => g.opponent))],
    };
  }, [stretchGames]);

  const stretchGameIdsCsv = useMemo(() => stretchGames.map((g) => g.game_id).join(","), [stretchGames]);

  // Per-player averages for exactly the games in the selected stretch --
  // this is the "who's hot right now" view.
  useEffect(() => {
    if (!teamId || !stretchGameIdsCsv) {
      setStretchPlayerStats([]);
      return;
    }
    api
      .playerStretch(teamId, stretchGameIdsCsv)
      .then(setStretchPlayerStats)
      .catch(() => setStretchPlayerStats([]));
    setHotPlayerId(null);
  }, [teamId, stretchGameIdsCsv]);

  useEffect(() => {
    if (!hotPlayerId || !stretchGameIdsCsv) {
      setHotPlayerShots([]);
      setHotPlayerZones([]);
      return;
    }
    api
      .shots({ playerId: hotPlayerId, gameIds: stretchGameIdsCsv, limit: 1000 })
      .then(setHotPlayerShots)
      .catch(() => setHotPlayerShots([]));
    api
      .sevenZones({ playerId: hotPlayerId, gameIds: stretchGameIdsCsv })
      .then(setHotPlayerZones)
      .catch(() => setHotPlayerZones([]));
  }, [hotPlayerId, stretchGameIdsCsv]);

  // Full-game shot chart drill-in for a specific game picked from the log.
  useEffect(() => {
    if (!shotChartGameId) {
      setGameShots([]);
      return;
    }
    api
      .shots({ gameId: shotChartGameId, limit: 1000 })
      .then(setGameShots)
      .catch(() => setGameShots([]));
  }, [shotChartGameId]);

  useEffect(() => {
    if (!teamId || !impactPlayerId || !impactTeammateId || impactPlayerId === impactTeammateId) {
      setImpactData(null);
      return;
    }
    api
      .teammateImpact(teamId, { playerId: impactPlayerId, teammateId: impactTeammateId, seasons: season })
      .then(setImpactData)
      .catch((e) => {
        setError(e.message);
        setImpactData(null);
      });
  }, [teamId, impactPlayerId, impactTeammateId, season]);

  // Dot-level shot charts for each split, using the exact game_id lists
  // the impact endpoint returns alongside its zone-aggregate summary.
  useEffect(() => {
    if (!impactData || !impactPlayerId) {
      setImpactWithShots([]);
      setImpactWithoutShots([]);
      return;
    }
    if (impactData.with_teammate_game_ids?.length) {
      api
        .shots({ playerId: impactPlayerId, gameIds: impactData.with_teammate_game_ids.join(","), limit: 1000 })
        .then(setImpactWithShots)
        .catch(() => setImpactWithShots([]));
    } else {
      setImpactWithShots([]);
    }
    if (impactData.without_teammate_game_ids?.length) {
      api
        .shots({ playerId: impactPlayerId, gameIds: impactData.without_teammate_game_ids.join(","), limit: 1000 })
        .then(setImpactWithoutShots)
        .catch(() => setImpactWithoutShots([]));
    } else {
      setImpactWithoutShots([]);
    }
  }, [impactData, impactPlayerId]);

  const sortedRoster = useMemo(() => {
    if (rosterSort === "EST_WS") {
      return [...roster].sort(
        (a, b) => (winSharesMap.get(b.PLAYER_ID) ?? 0) - (winSharesMap.get(a.PLAYER_ID) ?? 0)
      );
    }
    return [...roster].sort((a, b) => (b[rosterSort] ?? 0) - (a[rosterSort] ?? 0));
  }, [roster, rosterSort, winSharesMap]);

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h2 className="text-xl font-semibold mb-1">Executive Dashboard</h2>
        <p className="text-xs text-slate-500">
          Team-season command center: record, ratings, context stats, game-by-game trends, and roster averages.
        </p>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="flex flex-wrap gap-3">
        <select
          className="bg-slate-800 border border-slate-700 rounded px-3 py-2"
          value={teamId ?? ""}
          onChange={(e) => setTeamId(Number(e.target.value))}
        >
          <option value="" disabled>
            Select a team
          </option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.full_name}
            </option>
          ))}
        </select>

        {seasons.length > 0 && (
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
        )}

        {teamId && (
          <div className="flex gap-1 bg-slate-800 rounded p-1">
            {HOME_AWAY_OPTIONS.map((o) => (
              <button
                key={o.key}
                className={`px-3 py-1.5 rounded text-sm ${
                  homeAway === o.key ? "bg-slate-700" : "text-slate-400 hover:text-slate-200"
                }`}
                onClick={() => setHomeAway(o.key)}
                title="Filters Overview, Context Stats, Game Log, and Who's Hot to just home or away games"
              >
                {o.label}
              </button>
            ))}
          </div>
        )}

        {teamId && (
          <div className="flex gap-1 bg-slate-800 rounded p-1">
            {["Regular Season", "Playoffs"].map((st) => (
              <button
                key={st}
                className={`px-3 py-1.5 rounded text-sm ${
                  seasonType === st ? "bg-slate-700" : "text-slate-400 hover:text-slate-200"
                }`}
                onClick={() => setSeasonType(st)}
                title="Switches the whole dashboard between regular-season and playoff data for this team/season"
              >
                {st}
              </button>
            ))}
          </div>
        )}
      </div>

      {teamId && (
        <div className="flex gap-2 border-b border-slate-800 pb-2 flex-wrap">
          {SUB_TABS.map((t) => (
            <button
              key={t.key}
              className={`px-3 py-1.5 rounded text-sm ${
                subTab === t.key ? "bg-slate-800" : "text-slate-400 hover:text-slate-200"
              }`}
              onClick={() => setSubTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {dashboardLoading && !data && <Loading label="Loading dashboard..." />}
      {data && subTab === "overview" && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Record" value={`${data.record.w}-${data.record.l}`} sub={`${(data.record.w_pct * 100).toFixed(1)}% win rate`} />
            {data.advanced && (
              <>
                <Stat label="Off Rating" value={data.advanced.OFF_RATING?.toFixed(1)} />
                <Stat label="Def Rating" value={data.advanced.DEF_RATING?.toFixed(1)} />
                <Stat label="Net Rating" value={<Diff value={data.advanced.NET_RATING?.toFixed(1)} />} />
              </>
            )}
          </div>

          <Card
            title="Four Factors"
            subtitle="Team vs. opponent, per Dean Oliver's framework. Green = team's edge on that factor. TOV% is 'lower is better'."
          >
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400 border-b border-slate-800">
                  <th className="py-2 pr-4">Factor</th>
                  <th className="py-2 pr-4">Team</th>
                  <th className="py-2 pr-4">Opponent</th>
                </tr>
              </thead>
              <tbody>
                <FourFactorRow label="eFG%" team={data.four_factors.team.efg_pct} opp={data.four_factors.opponent.efg_pct} />
                <FourFactorRow
                  label="TOV%"
                  team={data.four_factors.team.tov_pct}
                  opp={data.four_factors.opponent.tov_pct}
                  higherIsBetter={false}
                />
                <FourFactorRow label="OREB%" team={data.four_factors.team.oreb_pct} opp={data.four_factors.opponent.oreb_pct} />
                <FourFactorRow label="FT Rate" team={data.four_factors.team.fta_rate} opp={data.four_factors.opponent.fta_rate} />
              </tbody>
            </table>
            {data.four_factors_estimated && (
              <p className="text-xs text-amber-500/80 mt-3">
                Home/away splits aren't published officially -- these are computed live from box-score columns using
                the standard formulas. eFG% and FT Rate match the official season numbers exactly; TOV% and OREB% can
                drift a couple points from stats.nba.com's own (undocumented) version.
              </p>
            )}
          </Card>

          <div className="grid sm:grid-cols-2 gap-4">
            {data.home_away && (
              <Card title="Home / Away Split">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-400 border-b border-slate-800">
                      <th className="py-2 pr-4"></th>
                      <th className="py-2 pr-4">Record</th>
                      <th className="py-2 pr-4">Avg Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {["home", "away"].map(
                      (k) =>
                        data.home_away[k] && (
                          <tr key={k} className="border-b border-slate-900">
                            <td className="py-2 pr-4 capitalize text-slate-400">{k}</td>
                            <td className="py-2 pr-4">
                              {data.home_away[k].w}-{data.home_away[k].l}
                            </td>
                            <td className="py-2 pr-4">
                              <Diff value={data.home_away[k].avg_margin} />
                            </td>
                          </tr>
                        )
                    )}
                  </tbody>
                </table>
              </Card>
            )}

            {data.last10 && (
              <Card title="Last 10 Games" subtitle="Trailing form -- most recent games in the season.">
                <p className="text-sm mb-2">
                  {data.last10.w}-{data.last10.l}, avg margin <Diff value={data.last10.avg_margin} />
                </p>
                <div className="flex gap-1 flex-wrap">
                  {data.last10.games.map((g) => (
                    <span
                      key={g.game_id}
                      title={`${g.game_date}: ${g.margin >= 0 ? "+" : ""}${g.margin}`}
                      className={`w-7 h-7 flex items-center justify-center rounded text-xs font-medium ${
                        g.result === "W" ? "bg-green-900 text-green-300" : "bg-red-900 text-red-300"
                      }`}
                    >
                      {g.result}
                    </span>
                  ))}
                </div>
              </Card>
            )}
          </div>

          <Card title="Full Season Stats" subtitle="Raw season totals/averages straight from the stats table.">
            <div className="flex items-center gap-3 mb-3">
              <button
                className="text-xs text-slate-400 hover:text-slate-200 underline"
                onClick={() => setShowFullStats((v) => !v)}
              >
                {showFullStats ? "Hide" : "Show"} full stat grid
              </button>
              {showFullStats && (
                <select
                  className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm"
                  value={statType}
                  onChange={(e) => setStatType(e.target.value)}
                >
                  <option value="traditional">Traditional</option>
                  <option value="advanced">Advanced</option>
                </select>
              )}
            </div>
            {showFullStats && fullStats && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {Object.entries(fullStats)
                  .filter(([k]) => !k.endsWith("_RANK") && k !== "TEAM_ID" && k !== "TEAM_NAME" && k !== "SEASON")
                  .map(([k, v]) => (
                    <div key={k} className="bg-slate-800 rounded p-3">
                      <div className="text-xs text-slate-400">{k}</div>
                      <div className="text-lg font-medium">{typeof v === "number" ? v : String(v)}</div>
                    </div>
                  ))}
              </div>
            )}
          </Card>
        </>
      )}

      {data && subTab === "context" && (
        <Card
          title="Context Stats"
          subtitle="Per-game averages this season, team vs. opponent. Points in the paint, second-chance points, and fast-break points show where scoring actually comes from beyond the box score."
        >
          {data.context_stats ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Pts in Paint" value={data.context_stats.pts_paint} sub={`Opp: ${data.context_stats.opp_pts_paint}`} />
              <Stat label="2nd Chance Pts" value={data.context_stats.pts_2nd_chance} sub={`Opp: ${data.context_stats.opp_pts_2nd_chance}`} />
              <Stat label="Fast Break Pts" value={data.context_stats.pts_fb} sub={`Opp: ${data.context_stats.opp_pts_fb}`} />
              <Stat label="Avg Largest Lead" value={data.context_stats.largest_lead} />
            </div>
          ) : (
            <p className="text-slate-400 text-sm">No context-stats coverage for this team/season.</p>
          )}
          {data.context_stats && (
            <p className="text-xs text-slate-500 mt-3">
              Based on {data.context_stats.gp} of {data.record.gp} games with context-stats coverage.
            </p>
          )}
        </Card>
      )}

      {subTab === "gamelog" && filteredGames.length > 0 && (
        <>
          <Card
            title="Game Log & Stretches"
            subtitle="Pick a stretch of games to see how the team's own stats -- and who they played -- shift over that span."
          >
            <div className="flex flex-wrap gap-2 mb-4">
              {STRETCH_PRESETS.map((p) => (
                <button
                  key={p.key}
                  className={`px-3 py-1.5 rounded text-sm ${
                    stretch === p.key ? "bg-slate-700" : "bg-slate-800 text-slate-400 hover:text-slate-200"
                  }`}
                  onClick={() => setStretch(p.key)}
                >
                  {p.label}
                </button>
              ))}
              <button
                className={`px-3 py-1.5 rounded text-sm ${
                  stretch === "custom" ? "bg-slate-700" : "bg-slate-800 text-slate-400 hover:text-slate-200"
                }`}
                onClick={() => setStretch("custom")}
              >
                Custom Range
              </button>
              <button
                className={`px-3 py-1.5 rounded text-sm ${
                  b2bOnly ? "bg-amber-900/50 text-amber-300 border border-amber-700" : "bg-slate-800 text-slate-400 hover:text-slate-200"
                }`}
                onClick={() => setB2bOnly((v) => !v)}
                title="Show only games played on zero days' rest (the second night of a back-to-back)"
              >
                B2B Only
              </button>
              {stretch === "custom" && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-slate-400">Game</span>
                  <input
                    type="number"
                    className="w-16 bg-slate-800 border border-slate-700 rounded px-2 py-1"
                    min={1}
                    max={filteredGames.length}
                    value={rangeStart + 1}
                    onChange={(e) => setRangeStart(Math.min(Math.max(Number(e.target.value) - 1, 0), rangeEnd))}
                  />
                  <span className="text-slate-400">to</span>
                  <input
                    type="number"
                    className="w-16 bg-slate-800 border border-slate-700 rounded px-2 py-1"
                    min={1}
                    max={filteredGames.length}
                    value={rangeEnd + 1}
                    onChange={(e) =>
                      setRangeEnd(Math.max(Math.min(Number(e.target.value) - 1, filteredGames.length - 1), rangeStart))
                    }
                  />
                </div>
              )}
            </div>

            {stretchSummary && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                  <Stat label="Record" value={`${stretchSummary.w}-${stretchSummary.l}`} sub={`${stretchSummary.n} games`} />
                  <Stat label="Avg Margin" value={<Diff value={Number(stretchSummary.margin)} />} sub={`${stretchSummary.pts} - ${stretchSummary.oppPts}`} />
                  <Stat label="FG% / 3P%" value={`${stretchSummary.fgPct}% / ${stretchSummary.fg3Pct}%`} />
                  <Stat label="REB / AST / TOV" value={`${stretchSummary.reb} / ${stretchSummary.ast} / ${stretchSummary.tov}`} />
                </div>
                <p className="text-xs text-slate-500 mb-4">
                  Paint {stretchSummary.ptsPaint} -- Fast break {stretchSummary.ptsFb} -- 2nd chance {stretchSummary.pts2ndChance}
                  <br />
                  Opponents faced: {stretchSummary.opponents.join(", ")}
                </p>
              </>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-400 border-b border-slate-800">
                    <th className="py-2 pr-4">Date</th>
                    <th className="py-2 pr-4">Opp</th>
                    <th className="py-2 pr-4">Result</th>
                    <th className="py-2 pr-4">PTS</th>
                    <th className="py-2 pr-4">OPP PTS</th>
                    <th className="py-2 pr-4">FG%</th>
                    <th className="py-2 pr-4">REB</th>
                    <th className="py-2 pr-4">AST</th>
                    <th className="py-2 pr-4">TOV</th>
                    <th className="py-2 pr-4">Rest</th>
                  </tr>
                </thead>
                <tbody>
                  {stretchGames
                    .slice()
                    .reverse()
                    .map((g) => (
                      <tr
                        key={g.game_id}
                        className={`border-b border-slate-900 cursor-pointer hover:bg-slate-800/60 ${
                          shotChartGameId === g.game_id ? "bg-slate-800" : ""
                        }`}
                        onClick={() => setShotChartGameId(shotChartGameId === g.game_id ? null : g.game_id)}
                        title="Click to view this game's shot chart"
                      >
                        <td className="py-2 pr-4">{String(g.game_date).slice(0, 10)}</td>
                        <td className="py-2 pr-4">
                          {g.is_home ? "vs" : "@"} {g.opponent}
                        </td>
                        <td className={`py-2 pr-4 ${g.result_for_team === "W" ? "text-green-400" : "text-red-400"}`}>
                          {g.result_for_team}
                        </td>
                        <td className="py-2 pr-4">{g.pts}</td>
                        <td className="py-2 pr-4">{g.is_home ? g.pts_away : g.pts_home}</td>
                        <td className="py-2 pr-4">{g.fga ? ((g.fgm / g.fga) * 100).toFixed(1) : "--"}</td>
                        <td className="py-2 pr-4">{g.reb}</td>
                        <td className="py-2 pr-4">{g.ast}</td>
                        <td className="py-2 pr-4">{g.tov}</td>
                        <td className="py-2 pr-4">
                          {g.rest_days == null ? (
                            <span className="text-slate-600">--</span>
                          ) : g.is_back_to_back ? (
                            <span className="text-amber-400">B2B</span>
                          ) : (
                            <span className="text-slate-400">{g.rest_days}d</span>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-500 mt-2">Click any row to pull up that game's full shot chart, both teams.</p>
          </Card>

          {shotChartGameId && gameShots.length > 0 && (() => {
            const row = stretchGames.find((g) => g.game_id === shotChartGameId);
            const oppAbbr = row?.opponent;
            const oppTeam = teams.find((t) => t.abbreviation === oppAbbr);
            const homeTeamId = row?.is_home ? teamId : oppTeam?.id;
            const awayTeamId = row?.is_home ? oppTeam?.id : teamId;
            const homeAbbr = row?.is_home ? teams.find((t) => t.id === teamId)?.abbreviation : oppAbbr;
            const awayAbbr = row?.is_home ? oppAbbr : teams.find((t) => t.id === teamId)?.abbreviation;
            return (
              <Card
                title={`Shot Chart -- ${String(row?.game_date).slice(0, 10)} ${row?.is_home ? "vs" : "@"} ${oppAbbr}`}
                subtitle="Both teams' shots for this specific game -- useful for seeing how the game actually played out shot by shot."
              >
                <div className="flex gap-2 mb-3">
                  {["both", "home", "away"].map((f) => (
                    <button
                      key={f}
                      className={`px-3 py-1.5 rounded text-sm capitalize ${
                        gameShotFilter === f ? "bg-slate-700" : "bg-slate-800 text-slate-400 hover:text-slate-200"
                      }`}
                      onClick={() => setGameShotFilter(f)}
                    >
                      {f === "both" ? "Both Teams" : f === "home" ? homeAbbr : awayAbbr}
                    </button>
                  ))}
                </div>
                <GameShotChart
                  homeShots={gameShots.filter((s) => s.TEAM_ID === homeTeamId)}
                  awayShots={gameShots.filter((s) => s.TEAM_ID === awayTeamId)}
                  homeLabel={homeAbbr}
                  awayLabel={awayAbbr}
                  filter={gameShotFilter}
                />
              </Card>
            );
          })()}

          <Card
            title="Who's Hot Right Now"
            subtitle="Each roster player's averages over exactly the games in the stretch selected above, derived from play-by-play (fact_player_boxscore_game) since the warehouse only otherwise tracks season-long player totals. Season Δ compares to that player's full-season scoring average."
          >
            {stretchPlayerStats.length === 0 ? (
              <p className="text-slate-400 text-sm">No derived box-score data for this stretch.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-400 border-b border-slate-800">
                      <th className="py-2 pr-4">Player</th>
                      <th className="py-2 pr-4">GP</th>
                      <th className="py-2 pr-4">PTS</th>
                      <th className="py-2 pr-4">Season Δ</th>
                      <th className="py-2 pr-4">REB</th>
                      <th className="py-2 pr-4">AST</th>
                      <th className="py-2 pr-4">STL</th>
                      <th className="py-2 pr-4">BLK</th>
                      <th className="py-2 pr-4">TOV</th>
                      <th className="py-2 pr-4">FG% / 3P%</th>
                      <th className="py-2 pr-4"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {stretchPlayerStats.map((p) => {
                      const seasonRow = roster.find((r) => r.PLAYER_ID === p.player_id);
                      const delta = seasonRow ? Math.round((p.pts - seasonRow.PTS) * 10) / 10 : null;
                      return (
                        <tr key={p.player_id} className="border-b border-slate-900">
                          <td className="py-2 pr-4">{p.player_name}</td>
                          <td className="py-2 pr-4">{p.gp}</td>
                          <td className="py-2 pr-4 font-medium">{p.pts}</td>
                          <td className="py-2 pr-4">{delta != null ? <Diff value={delta} /> : "--"}</td>
                          <td className="py-2 pr-4">{p.reb}</td>
                          <td className="py-2 pr-4">{p.ast}</td>
                          <td className="py-2 pr-4">{p.stl}</td>
                          <td className="py-2 pr-4">{p.blk}</td>
                          <td className="py-2 pr-4">{p.tov}</td>
                          <td className="py-2 pr-4">
                            {p.fg_pct != null ? p.fg_pct : "--"}% / {p.fg3_pct != null ? p.fg3_pct : "--"}%
                          </td>
                          <td className="py-2 pr-4">
                            <button
                              className="text-xs text-sky-400 hover:text-sky-300 underline"
                              onClick={() => setHotPlayerId(hotPlayerId === p.player_id ? null : p.player_id)}
                            >
                              {hotPlayerId === p.player_id ? "Hide chart" : "Shot chart"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {hotPlayerId && hotPlayerShots.length > 0 && (() => {
            const p = stretchPlayerStats.find((x) => x.player_id === hotPlayerId);
            const note = hottestZoneNote(hotPlayerZones);
            return (
              <Card
                title={`${p?.player_name ?? "Player"} -- Shot Chart This Stretch`}
                subtitle="Where this player has actually been scoring from over the selected games -- use it to game-plan defensive coverage."
              >
                {note && (
                  <p className="text-sm text-slate-300 mb-3">
                    Hottest zone: <span className="text-red-400 font-medium">{note.hottest.zone}</span> at{" "}
                    {note.hottest.fg_pct}% ({note.hottest.makes}/{note.hottest.attempts}) -- consider steering him away
                    from there. Coldest: <span className="text-blue-400 font-medium">{note.coldest.zone}</span> at{" "}
                    {note.coldest.fg_pct}% ({note.coldest.makes}/{note.coldest.attempts}) -- fine to concede that look.
                  </p>
                )}
                <CourtShotChart shots={hotPlayerShots} sevenZones={hotPlayerZones} />
              </Card>
            );
          })()}
        </>
      )}

      {subTab === "impact" && (
        <Card
          title="Teammate Impact"
          subtitle="How a player's production shifts in games a given teammate missed entirely vs. games they played -- shot volume and zone shifts are usually the clearest signal of who picks up the usage. 'Missed' covers injury, rest, and a healthy DNP alike; the warehouse has no injury-designation data to tell them apart."
        >
          {roster.length < 2 ? (
            <p className="text-slate-400 text-sm">Roster not loaded yet -- pick a team and season above.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-3 mb-4">
                <select
                  className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm"
                  value={impactPlayerId ?? ""}
                  onChange={(e) => setImpactPlayerId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="" disabled>
                    Player A (whose stats to see)
                  </option>
                  {roster.map((p) => (
                    <option key={p.PLAYER_ID} value={p.PLAYER_ID}>
                      {p.PLAYER_NAME}
                    </option>
                  ))}
                </select>
                <select
                  className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm"
                  value={impactTeammateId ?? ""}
                  onChange={(e) => setImpactTeammateId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="" disabled>
                    Teammate B (who's in / out)
                  </option>
                  {roster
                    .filter((p) => p.PLAYER_ID !== impactPlayerId)
                    .map((p) => (
                      <option key={p.PLAYER_ID} value={p.PLAYER_ID}>
                        {p.PLAYER_NAME}
                      </option>
                    ))}
                </select>
              </div>

              {impactPlayerId && impactTeammateId && impactPlayerId === impactTeammateId && (
                <p className="text-red-400 text-sm">Player A and Teammate B must be different players.</p>
              )}

              {impactData && (
                <>
                  <div className="grid sm:grid-cols-2 gap-4 mb-4">
                    {[
                      { key: "with_teammate", label: `${impactData.player_name} -- With ${impactData.teammate_name}`, split: impactData.with_teammate },
                      { key: "without_teammate", label: `${impactData.player_name} -- Without ${impactData.teammate_name}`, split: impactData.without_teammate },
                    ].map(({ key, label, split }) => (
                      <div key={key} className="bg-slate-800 rounded p-4">
                        <div className="text-sm font-medium mb-2">{label}</div>
                        {split ? (
                          <>
                            <p className="text-xs text-slate-500 mb-3">{split.gp} games</p>
                            <div className="grid grid-cols-3 gap-3 text-sm">
                              <Stat label="PTS" value={split.pts} />
                              <Stat label="REB" value={split.reb} />
                              <Stat label="AST" value={split.ast} />
                              <Stat label="STL" value={split.stl} />
                              <Stat label="BLK" value={split.blk} />
                              <Stat label="TOV" value={split.tov} />
                              <Stat label="FGA/gm" value={split.fga_per_game} />
                              <Stat label="FG%" value={split.fg_pct != null ? `${split.fg_pct}%` : "--"} />
                              <Stat label="3PA/gm" value={split.fg3a_per_game} />
                            </div>
                          </>
                        ) : (
                          <p className="text-slate-500 text-sm">No games in this split.</p>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-slate-500 mb-2">Shot chart -- with {impactData.teammate_name}</p>
                      <CourtShotChart shots={impactWithShots} sevenZones={impactData.with_teammate?.zones ?? []} />
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 mb-2">Shot chart -- without {impactData.teammate_name}</p>
                      <CourtShotChart shots={impactWithoutShots} sevenZones={impactData.without_teammate?.zones ?? []} />
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </Card>
      )}

      {subTab === "roster" && roster.length > 0 && (
        <Card title="Roster -- Season Averages" subtitle="Per-game averages for every player who suited up for this team this season.">
          <div className="mb-3">
            <select
              className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm"
              value={rosterSort}
              onChange={(e) => setRosterSort(e.target.value)}
            >
              <option value="MIN">Sort: Minutes</option>
              <option value="PTS">Sort: Points</option>
              <option value="REB">Sort: Rebounds</option>
              <option value="AST">Sort: Assists</option>
              <option value="PLUS_MINUS">Sort: +/-</option>
              <option value="EST_WS">Sort: Est. Win Shares</option>
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400 border-b border-slate-800">
                  <th className="py-2 pr-4">Player</th>
                  <th className="py-2 pr-4">GP</th>
                  <th className="py-2 pr-4">MIN</th>
                  <th className="py-2 pr-4">PTS</th>
                  <th className="py-2 pr-4">REB</th>
                  <th className="py-2 pr-4">AST</th>
                  <th className="py-2 pr-4">STL</th>
                  <th className="py-2 pr-4">BLK</th>
                  <th className="py-2 pr-4">TOV</th>
                  <th className="py-2 pr-4">FG%</th>
                  <th className="py-2 pr-4">3P%</th>
                  <th className="py-2 pr-4">+/-</th>
                  <th className="py-2 pr-4">Est. WS</th>
                </tr>
              </thead>
              <tbody>
                {sortedRoster.map((p) => (
                  <tr key={p.PLAYER_ID} className="border-b border-slate-900">
                    <td className="py-2 pr-4">{p.PLAYER_NAME}</td>
                    <td className="py-2 pr-4">{p.GP}</td>
                    <td className="py-2 pr-4">{p.MIN}</td>
                    <td className="py-2 pr-4">{p.PTS}</td>
                    <td className="py-2 pr-4">{p.REB}</td>
                    <td className="py-2 pr-4">{p.AST}</td>
                    <td className="py-2 pr-4">{p.STL}</td>
                    <td className="py-2 pr-4">{p.BLK}</td>
                    <td className="py-2 pr-4">{p.TOV}</td>
                    <td className="py-2 pr-4">{(p.FG_PCT * 100).toFixed(1)}</td>
                    <td className="py-2 pr-4">{p.FG3_PCT != null ? (p.FG3_PCT * 100).toFixed(1) : "--"}</td>
                    <td className="py-2 pr-4">
                      <Diff value={p.PLUS_MINUS} />
                    </td>
                    <td className="py-2 pr-4">
                      {winSharesMap.has(p.PLAYER_ID) ? winSharesMap.get(p.PLAYER_ID).toFixed(2) : "--"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {winShares && (
            <p className="text-xs text-slate-500 mt-3">
              Est. WS is a from-scratch estimate (not the NBA stats API's DEF_WS, not Basketball-Reference Win
              Shares) allocated from box-score production so it sums to the team's actual win total
              ({winShares.team_wins}) -- allocated {winShares.allocated_win_shares_total} of {winShares.team_wins}.
              See methodology on hover of the column, or the /win-shares endpoint docs.
            </p>
          )}
        </Card>
      )}

      {subTab === "identity" && (
        <>
          {identity?.style && (
            <Card
              title="Shot Selection & Ball Movement"
              subtitle="Share of the team's total points/shots coming from each source, season-long."
            >
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                <Stat label="Pts in Paint" value={pct(identity.style.PCT_PTS_PAINT)} />
                <Stat label="Pts Mid-Range" value={pct(identity.style.PCT_PTS_2PT_MR)} />
                <Stat label="Pts on 3s" value={pct(identity.style.PCT_PTS_3PT)} />
                <Stat label="Pts on Fast Break" value={pct(identity.style.PCT_PTS_FB)} />
                <Stat label="Pts off Turnovers" value={pct(identity.style.PCT_PTS_OFF_TOV)} />
                <Stat label="FGA -- 2PT rate" value={pct(identity.style.PCT_FGA_2PT)} />
                <Stat label="FGA -- 3PT rate" value={pct(identity.style.PCT_FGA_3PT)} />
                <Stat label="Assisted FGM%" value={pct(identity.style.PCT_AST_FGM)} />
                <Stat label="Unassisted FGM%" value={pct(identity.style.PCT_UAST_FGM)} />
              </div>
            </Card>
          )}

          {netRatingTrend && netRatingTrend.games.length > 0 && (
            <Card
              title="Net Rating Trend"
              subtitle={`Estimated net rating (points per 100 possessions) game by game, with a ${netRatingTrend.rolling_window}-game rolling average -- possessions are estimated from box-score components, so treat this as directionally trustworthy, not to the decimal.`}
            >
              <Plot
                data={[
                  {
                    x: netRatingTrend.games.map((g) => g.game_num),
                    y: netRatingTrend.games.map((g) => g.net_rating_est),
                    type: "scatter",
                    mode: "markers",
                    name: "Game net rating",
                    marker: { color: "#475569", size: 5, opacity: 0.6 },
                    hovertemplate: "Game %{x}: %{y:.1f}<extra></extra>",
                  },
                  {
                    x: netRatingTrend.games.map((g) => g.game_num),
                    y: netRatingTrend.games.map((g) => g.net_rating_rolling),
                    type: "scatter",
                    mode: "lines",
                    name: `${netRatingTrend.rolling_window}-game rolling avg`,
                    line: { color: "#38bdf8", width: 2.5 },
                  },
                  {
                    x: [netRatingTrend.games[0].game_num, netRatingTrend.games[netRatingTrend.games.length - 1].game_num],
                    y: [0, 0],
                    type: "scatter",
                    mode: "lines",
                    name: "Even",
                    line: { color: "#334155", width: 1, dash: "dot" },
                    hoverinfo: "skip",
                  },
                ]}
                layout={{
                  paper_bgcolor: "#0f172a",
                  plot_bgcolor: "#0f172a",
                  font: { color: "#e2e8f0" },
                  xaxis: { title: "Game #", gridcolor: "#1e293b" },
                  yaxis: { title: "Net rating (est.)", gridcolor: "#1e293b" },
                  margin: { l: 55, r: 10, t: 10, b: 45 },
                  height: 340,
                  legend: { font: { size: 10 }, orientation: "h", y: 1.15 },
                }}
                config={{ displayModeBar: false, responsive: true }}
                style={{ width: "100%" }}
                useResizeHandler
              />
            </Card>
          )}

          {teamClutch && (
            <Card
              title="Clutch Identity"
              subtitle={teamClutch.clutch_definition}
            >
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat label="Clutch Record" value={teamClutch.clutch_record} sub={`${teamClutch.clutch_games} clutch games`} />
                <Stat
                  label="Avg Clutch Margin"
                  value={teamClutch.avg_clutch_margin != null ? <Diff value={teamClutch.avg_clutch_margin} /> : "--"}
                />
              </div>
            </Card>
          )}

          {quarterTrends && (
            <Card
              title="Quarter-by-Quarter Scoring"
              subtitle={`Average points scored per quarter this season (${quarterTrends.gp} games)${
                quarterTrends.home_away_filter && quarterTrends.home_away_filter !== "all" ? ` -- ${quarterTrends.home_away_filter} games only` : ""
              }.`}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-400 border-b border-slate-800">
                      <th className="py-2 pr-4"></th>
                      <th className="py-2 pr-4">Q1</th>
                      <th className="py-2 pr-4">Q2</th>
                      <th className="py-2 pr-4">Q3</th>
                      <th className="py-2 pr-4">Q4</th>
                      <th className="py-2 pr-4">OT</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-slate-900">
                      <td className="py-2 pr-4 text-slate-400">This Team</td>
                      <td className="py-2 pr-4">{quarterTrends.team.q1?.toFixed(1)}</td>
                      <td className="py-2 pr-4">{quarterTrends.team.q2?.toFixed(1)}</td>
                      <td className="py-2 pr-4">{quarterTrends.team.q3?.toFixed(1)}</td>
                      <td className="py-2 pr-4">{quarterTrends.team.q4?.toFixed(1)}</td>
                      <td className="py-2 pr-4">{quarterTrends.team.ot?.toFixed(1) ?? "--"}</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 text-slate-400">Opponent</td>
                      <td className="py-2 pr-4">{quarterTrends.opponent.q1?.toFixed(1)}</td>
                      <td className="py-2 pr-4">{quarterTrends.opponent.q2?.toFixed(1)}</td>
                      <td className="py-2 pr-4">{quarterTrends.opponent.q3?.toFixed(1)}</td>
                      <td className="py-2 pr-4">{quarterTrends.opponent.q4?.toFixed(1)}</td>
                      <td className="py-2 pr-4">{quarterTrends.opponent.ot?.toFixed(1) ?? "--"}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {identity && (
            <Card
              title="Opponent Zone Efficiency Allowed"
              subtitle="How opponents shoot against this team by zone, vs. the league-average FG% in that same zone -- positive diff means this team is a soft spot there."
            >
              <div className="overflow-x-auto mb-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-400 border-b border-slate-800">
                      <th className="py-2 pr-4">Zone</th>
                      <th className="py-2 pr-4">Opp Attempts</th>
                      <th className="py-2 pr-4">Opp FG%</th>
                      <th className="py-2 pr-4">League FG%</th>
                      <th className="py-2 pr-4">Diff</th>
                    </tr>
                  </thead>
                  <tbody>
                    {identity.opponent_zone_efficiency.map((z) => (
                      <tr key={z.zone} className="border-b border-slate-900">
                        <td className="py-2 pr-4">{z.zone}</td>
                        <td className="py-2 pr-4">{z.attempts}</td>
                        <td className="py-2 pr-4">{z.fg_pct}%</td>
                        <td className="py-2 pr-4 text-slate-400">{z.league_fg_pct != null ? `${z.league_fg_pct}%` : "--"}</td>
                        <td className="py-2 pr-4">
                          <Diff value={z.diff_vs_league} suffix="%" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {identity.weaknesses.length > 0 && (
                <p className="text-sm text-slate-400">
                  Biggest weaknesses (min. 20 opponent attempts):{" "}
                  {identity.weaknesses.map((w) => `${w.zone} (+${w.diff_vs_league}% vs lg)`).join(", ")}
                </p>
              )}
              <p className="text-sm text-slate-400 mt-2">
                Close-game record (final margin &le;5): {identity.close_game_record.w}-{identity.close_game_record.l}{" "}
                ({identity.close_game_record.gp} games)
              </p>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
