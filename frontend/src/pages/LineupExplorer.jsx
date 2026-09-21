import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import Loading from "../components/Loading";

function minutes(seconds) {
  return (seconds / 60).toFixed(1);
}

function pct(makes, attempts) {
  if (!attempts) return "--";
  return ((makes / attempts) * 100).toFixed(1) + "%";
}

function Diff({ value }) {
  if (value == null) return <span className="text-slate-500">--</span>;
  return (
    <span className={value >= 0 ? "text-green-400" : "text-red-400"}>
      {value >= 0 ? "+" : ""}
      {value}
    </span>
  );
}

function Rating({ value }) {
  if (value == null) return <span className="text-slate-500">--</span>;
  return <span>{value.toFixed(1)}</span>;
}

function Card({ title, subtitle, children }) {
  return (
    <section className="bg-slate-900/50 border border-slate-800 rounded-xl p-5">
      <h3 className="text-lg font-semibold text-slate-100">{title}</h3>
      {subtitle && <p className="text-xs text-slate-500 mt-1 mb-4 max-w-3xl">{subtitle}</p>}
      {!subtitle && <div className="mb-3" />}
      {children}
    </section>
  );
}

const selectCls = "bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm";
const thCls = "py-2 pr-4 font-medium text-right last:pr-0";
const thFirstCls = "py-2 pr-4 font-medium text-left";
const tdCls = "py-2 pr-4 text-right last:pr-0 tabular-nums";
const tdFirstCls = "py-2 pr-4 text-left";
const rowCls = "border-b border-slate-800/60 even:bg-slate-800/20 hover:bg-slate-800/40";

export default function LineupExplorer() {
  const [teams, setTeams] = useState([]);
  const [teamId, setTeamId] = useState(null);
  const [error, setError] = useState(null);

  // Top lineups (career by default; season narrows it to one year)
  const [sortBy, setSortBy] = useState("total_seconds");
  const [minSeconds, setMinSeconds] = useState(300);
  const [lineupSeason, setLineupSeason] = useState("");
  const [lineups, setLineups] = useState([]);

  // Game-by-game report
  const [seasons, setSeasons] = useState([]);
  const [season, setSeason] = useState("");
  const [games, setGames] = useState([]);
  const [gameId, setGameId] = useState("");
  const [gameReport, setGameReport] = useState(null);
  const [gameSort, setGameSort] = useState("minutes");

  // Player on/off
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [player, setPlayer] = useState(null);
  const [onOff, setOnOff] = useState([]);
  const [onOffScope, setOnOffScope] = useState("career"); // "career" | "season" | "game"
  const [onOffHomeAway, setOnOffHomeAway] = useState("all");
  const [lineupsLoading, setLineupsLoading] = useState(false);
  const [gameReportLoading, setGameReportLoading] = useState(false);
  const [onOffLoading, setOnOffLoading] = useState(false);

  const selectedTeam = teams.find((t) => t.id === teamId);
  const selectedGame = games.find((g) => g.game_id === gameId);

  useEffect(() => {
    api.teams().then(setTeams).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!teamId) return;
    setError(null);
    setLineupsLoading(true);
    api
      .teamLineups(teamId, { minSeconds, sortBy, limit: 25, season: lineupSeason || undefined })
      .then(setLineups)
      .catch((e) => {
        setError(e.message);
        setLineups([]);
      })
      .finally(() => setLineupsLoading(false));
    api
      .teamSeasons(teamId)
      .then((s) => {
        setSeasons(s);
        setSeason(s[s.length - 1] || "");
      })
      .catch((e) => setError(e.message));
  }, [teamId, minSeconds, sortBy, lineupSeason]);

  useEffect(() => {
    if (!teamId || !season) return;
    setError(null);
    setGameId("");
    setGameReport(null);
    api
      .teamGames(teamId, { season })
      .then((g) => setGames(g))
      .catch((e) => {
        setError(e.message);
        setGames([]);
      });
  }, [teamId, season]);

  useEffect(() => {
    if (!teamId || !gameId) return;
    setError(null);
    setGameReportLoading(true);
    api
      .gameLineups(gameId, teamId)
      .then(setGameReport)
      .catch((e) => {
        setError(e.message);
        setGameReport(null);
      })
      .finally(() => setGameReportLoading(false));
  }, [teamId, gameId]);

  const sortedStints = useMemo(() => {
    if (!gameReport) return [];
    if (gameSort === "first_appearance") {
      return [...gameReport.stints].sort((a, b) => a.first_start_event - b.first_start_event);
    }
    return [...gameReport.stints].sort((a, b) => b.seconds - a.seconds);
  }, [gameReport, gameSort]);

  useEffect(() => {
    if (!query || query.length < 2) {
      setResults([]);
      return;
    }
    const handle = setTimeout(() => {
      api.searchPlayers(query).then(setResults).catch((e) => setError(e.message));
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    if (!player) return;
    setError(null);
    const params = { teamId: teamId || undefined };
    if (onOffScope === "game" && gameId && teamId) {
      params.gameId = gameId;
    } else if (onOffScope === "season" && season && teamId) {
      params.seasons = season;
      if (onOffHomeAway !== "all") params.homeAway = onOffHomeAway;
    } else if (onOffScope === "career" && teamId && onOffHomeAway !== "all") {
      params.homeAway = onOffHomeAway;
    }
    setOnOffLoading(true);
    api
      .playerOnOff(player.id, params)
      .then(setOnOff)
      .catch((e) => {
        setError(e.message);
        setOnOff([]);
      })
      .finally(() => setOnOffLoading(false));
  }, [player, teamId, gameId, season, onOffScope, onOffHomeAway]);

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold mb-3">Lineups</h2>
        {error && (
          <p className="text-red-400 text-sm mb-3 bg-red-950/40 border border-red-900 rounded px-3 py-2">
            {error}
          </p>
        )}

        <select
          className={selectCls}
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
      </div>

      <Card
        title={`Top Lineups${selectedTeam ? " -- " + selectedTeam.full_name : ""}`}
        subtitle="Five-man combos derived from play-by-play, aggregated across all games. Point differential is exact; the rating columns use a simplified possession estimate -- read them as approximate, especially for lineups with few minutes."
      >
        <div className="flex flex-wrap gap-3 mb-4">
          <select className={selectCls} value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="total_seconds">Sort: Minutes</option>
            <option value="net_rating_est">Sort: Net rating (est.)</option>
            <option value="off_rating_est">Sort: Off rating (est.)</option>
            <option value="def_rating_est">Sort: Def rating (est.)</option>
            <option value="point_differential">Sort: Point differential</option>
            <option value="n_stints">Sort: # of stints</option>
          </select>

          <select className={selectCls} value={minSeconds} onChange={(e) => setMinSeconds(Number(e.target.value))}>
            <option value={60}>Min 1 min played</option>
            <option value={300}>Min 5 min played</option>
            <option value={1200}>Min 20 min played</option>
            <option value={3000}>Min 50 min played</option>
          </select>

          <select className={selectCls} value={lineupSeason} onChange={(e) => setLineupSeason(e.target.value)}>
            <option value="">All seasons (career)</option>
            {seasons.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {teamId && lineups.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-400 border-b border-slate-700">
                  <th className={thFirstCls}>Lineup</th>
                  <th className={thCls}>Min</th>
                  <th className={thCls}># Stints</th>
                  <th className={thCls}>+/-</th>
                  <th className={thCls}>Off Rtg</th>
                  <th className={thCls}>Def Rtg</th>
                  <th className={thCls}>Net Rtg</th>
                </tr>
              </thead>
              <tbody>
                {lineups.map((l) => (
                  <tr key={l.lineup} className={rowCls}>
                    <td className={tdFirstCls}>{l.player_names.join(", ")}</td>
                    <td className={tdCls}>{minutes(l.total_seconds)}</td>
                    <td className={tdCls}>{l.n_stints}</td>
                    <td className={tdCls}>
                      <Diff value={l.point_differential} />
                    </td>
                    <td className={tdCls}>
                      <Rating value={l.off_rating_est} />
                    </td>
                    <td className={tdCls}>
                      <Rating value={l.def_rating_est} />
                    </td>
                    <td className={tdCls}>
                      <Rating value={l.net_rating_est} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {teamId && lineupsLoading && lineups.length === 0 && <Loading label="Loading lineups..." />}
        {teamId && !lineupsLoading && lineups.length === 0 && !error && (
          <p className="text-slate-400 text-sm">No lineups found for this filter.</p>
        )}
        {!teamId && <p className="text-slate-500 text-sm">Select a team above to see its top lineups.</p>}
      </Card>

      <Card
        title="Game-by-Game Lineup Report"
        subtitle="Pick a season, then a specific game, to see every lineup that subbed in during that game, in order, with the exact point differential and opponent shooting while each unit was on the floor."
      >
        {teamId && (
          <div className="flex flex-wrap gap-3 mb-4">
            <select className={selectCls} value={season} onChange={(e) => setSeason(e.target.value)}>
              {seasons.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            <select
              className={`${selectCls} min-w-[18rem]`}
              value={gameId}
              onChange={(e) => setGameId(e.target.value)}
            >
              <option value="" disabled>
                Select a game
              </option>
              {games.map((g) => (
                <option key={g.game_id} value={g.game_id}>
                  {new Date(g.game_date).toLocaleDateString()} -- {g.is_home ? "vs" : "@"} {g.opponent} (
                  {g.result_for_team}, {g.pts_home}-{g.pts_away})
                </option>
              ))}
            </select>

            {gameReportLoading && !gameReport && <Loading label="Loading game report..." />}
        {gameReport && (
              <select className={selectCls} value={gameSort} onChange={(e) => setGameSort(e.target.value)}>
                <option value="minutes">Order: Minutes played</option>
                <option value="first_appearance">Order: First appearance</option>
              </select>
            )}
          </div>
        )}

        {selectedGame && (
          <p className="text-sm text-slate-300 mb-3">
            {selectedTeam?.abbreviation} {selectedGame.is_home ? "vs" : "@"} {selectedGame.opponent} --{" "}
            {new Date(selectedGame.game_date).toLocaleDateString()} -- Final {selectedGame.pts_home}-
            {selectedGame.pts_away} ({selectedGame.result_for_team})
          </p>
        )}

        {gameReport && gameReport.flagged && (
          <div className="bg-amber-950/60 border border-amber-800 text-amber-300 text-sm rounded px-3 py-2 mb-3">
            Data-quality note: this game's total on-court time ({minutes(gameReport.flag_info.total_seconds)} min)
            didn't land within tolerance of a valid game length ({minutes(gameReport.flag_info.nearest_valid)} min
            expected) -- likely incomplete play-by-play coverage. The stints below are the raw derived data;
            treat this one with extra caution.
          </div>
        )}

        {gameReport && sortedStints.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-400 border-b border-slate-700">
                  <th className={thFirstCls}>Lineup</th>
                  <th className={thCls}>Min</th>
                  <th className={thCls}># Stints</th>
                  <th className={thCls}>+/-</th>
                  <th className={thCls}>Team FGA-FGM</th>
                  <th className={thCls}>Opp FGA-FGM</th>
                  <th className={thCls}>Opp FG%</th>
                </tr>
              </thead>
              <tbody>
                {sortedStints.map((s) => (
                  <tr key={s.lineup} className={rowCls}>
                    <td className={tdFirstCls}>{s.player_names.join(", ")}</td>
                    <td className={tdCls}>{minutes(s.seconds)}</td>
                    <td className={tdCls}>{s.n_stints}</td>
                    <td className={tdCls}>
                      <Diff value={s.point_differential} />
                    </td>
                    <td className={tdCls}>
                      {s.fga}-{s.made_fg}
                    </td>
                    <td className={tdCls}>
                      {s.opp_fga}-{s.opp_fgm}
                    </td>
                    <td className={tdCls}>{pct(s.opp_fgm, s.opp_fga)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!teamId && <p className="text-slate-500 text-sm">Select a team above first.</p>}
        {teamId && !gameId && <p className="text-slate-500 text-sm">Pick a season and game to see the report.</p>}
      </Card>

      <Card
        title="Player On/Off"
        subtitle={`Team performance with this player on the floor vs. off it. Only counts games the player appeared in for that team -- games missed entirely aren't counted as "off" time.`}
      >
        <div className="relative w-72 mb-3">
          <input
            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm"
            placeholder="Search player..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {results.length > 0 && (
            <ul className="absolute z-10 bg-slate-800 border border-slate-700 rounded mt-1 w-full max-h-56 overflow-auto">
              {results.map((p) => (
                <li
                  key={p.id}
                  className="px-3 py-2 hover:bg-slate-700 cursor-pointer text-sm"
                  onClick={() => {
                    setPlayer(p);
                    setQuery(p.full_name);
                    setResults([]);
                  }}
                >
                  {p.full_name}
                </li>
              ))}
            </ul>
          )}
        </div>

        {player && (
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <div className="flex gap-1 bg-slate-800 rounded p-1">
              {[
                { key: "career", label: "Career" },
                { key: "season", label: "This Season", disabled: !teamId || !season },
                { key: "game", label: "This Game", disabled: !teamId || !gameId },
              ].map((o) => (
                <button
                  key={o.key}
                  disabled={o.disabled}
                  className={`px-3 py-1.5 rounded text-sm ${
                    onOffScope === o.key
                      ? "bg-slate-700"
                      : o.disabled
                      ? "text-slate-600 cursor-not-allowed"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                  onClick={() => setOnOffScope(o.key)}
                >
                  {o.label}
                </button>
              ))}
            </div>

            {onOffScope !== "game" && (
              <div className="flex gap-1 bg-slate-800 rounded p-1">
                {["all", "home", "away"].map((k) => (
                  <button
                    key={k}
                    disabled={!teamId}
                    className={`px-3 py-1.5 rounded text-sm capitalize ${
                      onOffHomeAway === k
                        ? "bg-slate-700"
                        : !teamId
                        ? "text-slate-600 cursor-not-allowed"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                    onClick={() => setOnOffHomeAway(k)}
                    title={!teamId ? "Pick a team above to filter by home/away" : undefined}
                  >
                    {k}
                  </button>
                ))}
              </div>
            )}

            {onOffScope === "season" && <span className="text-xs text-slate-500">Season: {season || "--"}</span>}
            {onOffScope === "game" && selectedGame && (
              <span className="text-xs text-slate-500">Game: {new Date(selectedGame.game_date).toLocaleDateString()}</span>
            )}
          </div>
        )}

        {player && !teamId && (
          <p className="text-sm text-slate-400 mb-2">
            Showing every team this player has on/off data for -- pick a team above to narrow it.
          </p>
        )}

        {onOffLoading && onOff.length === 0 && <Loading label="Loading on/off splits..." />}
        {onOff.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-400 border-b border-slate-700">
                  <th className={thFirstCls}>Team</th>
                  <th className={thCls}>On: Min</th>
                  <th className={thCls}>On: +/-</th>
                  <th className={thCls}>On: Net Rtg</th>
                  <th className={thCls}>Off: Min</th>
                  <th className={thCls}>Off: +/-</th>
                  <th className={thCls}>Off: Net Rtg</th>
                </tr>
              </thead>
              <tbody>
                {onOff.map((row, i) => (
                  <tr key={row.team_id ?? i} className={rowCls}>
                    <td className={tdFirstCls}>
                      {teams.find((t) => t.id === row.team_id)?.abbreviation || row.team_id}
                    </td>
                    <td className={tdCls}>{minutes(row.on_seconds)}</td>
                    <td className={tdCls}>
                      <Diff value={row.on_point_differential} />
                    </td>
                    <td className={tdCls}>
                      <Rating value={row.on_net_rating_est} />
                    </td>
                    <td className={tdCls}>{minutes(row.off_seconds)}</td>
                    <td className={tdCls}>
                      <Diff value={row.off_point_differential} />
                    </td>
                    <td className={tdCls}>
                      <Rating value={row.off_net_rating_est} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
