import { useEffect, useState } from "react";
import { api } from "../api";
import GameShotChart from "../components/GameShotChart";
import Loading from "../components/Loading";
import Plot from "react-plotly.js";
import RotationChart from "../components/RotationChart";

function Card({ title, subtitle, children }) {
  return (
    <section className="bg-slate-900 border border-slate-800 rounded-lg p-5">
      <h3 className="text-base font-semibold mb-1">{title}</h3>
      {subtitle && <p className="text-xs text-slate-500 mb-3">{subtitle}</p>}
      {children}
    </section>
  );
}

const BOX_ROWS = [
  ["PTS", "pts"], ["FG", (t) => `${t.fgm}-${t.fga} (${(t.fg_pct * 100).toFixed(1)}%)`],
  ["3PT", (t) => `${t.fg3m}-${t.fg3a} (${(t.fg3_pct * 100).toFixed(1)}%)`],
  ["FT", (t) => `${t.ftm}-${t.fta} (${(t.ft_pct * 100).toFixed(1)}%)`],
  ["OREB", "oreb"], ["DREB", "dreb"], ["REB", "reb"],
  ["AST", "ast"], ["STL", "stl"], ["BLK", "blk"], ["TOV", "tov"], ["PF", "pf"],
];

function boxVal(team, spec) {
  return typeof spec === "function" ? spec(team) : team[spec];
}

export default function GameAnalysis() {
  const [teams, setTeams] = useState([]);
  const [teamId, setTeamId] = useState(null);
  const [seasons, setSeasons] = useState([]);
  const [season, setSeason] = useState("");
  const [games, setGames] = useState([]);
  const [gameId, setGameId] = useState(null);
  const [game, setGame] = useState(null);
  const [lineups, setLineups] = useState(null);
  const [gameShots, setGameShots] = useState([]);
  const [shotFilter, setShotFilter] = useState("both");
  const [rotation, setRotation] = useState(null);
  const [rotationTeamFilter, setRotationTeamFilter] = useState("both");
  const [flow, setFlow] = useState(null);
  const [error, setError] = useState(null);
  const [gameLoading, setGameLoading] = useState(false);

  useEffect(() => {
    api.teams().then(setTeams).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!teamId) return;
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
    api
      .teamGames(teamId, { season })
      .then((gs) => {
        setGames(gs);
        setGameId(gs.length ? gs[gs.length - 1].game_id : null);
      })
      .catch((e) => {
        setError(e.message);
        setGames([]);
      });
  }, [teamId, season]);

  useEffect(() => {
    if (!gameId) return;
    setError(null);
    setGameLoading(true);
    api.game(gameId).then(setGame).catch((e) => {
      setError(e.message);
      setGame(null);
    }).finally(() => setGameLoading(false));
    api
      .gameLineups(gameId, teamId)
      .then(setLineups)
      .catch(() => setLineups(null));
    api
      .shots({ gameId, limit: 1000 })
      .then(setGameShots)
      .catch(() => setGameShots([]));
    api.gameRotation(gameId).then(setRotation).catch(() => setRotation(null));
    api.gameFlow(gameId).then(setFlow).catch(() => setFlow(null));
  }, [gameId, teamId]);

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h2 className="text-xl font-semibold mb-1">Game Analysis</h2>
        <p className="text-xs text-slate-500">
          Full box score, Four Factors, quarter-by-quarter scoring, and context stats for a single game.
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

        {games.length > 0 && (
          <select
            className="bg-slate-800 border border-slate-700 rounded px-3 py-2 min-w-[16rem]"
            value={gameId ?? ""}
            onChange={(e) => setGameId(e.target.value)}
          >
            {games.map((g) => (
              <option key={g.game_id} value={g.game_id}>
                {g.game_date.slice(0, 10)} -- {g.is_home ? "vs" : "@"} {g.opponent} ({g.result_for_team})
              </option>
            ))}
          </select>
        )}
      </div>

      {gameLoading && !game && <Loading label="Loading game..." />}
      {game && (
        <>
          <Card title="Final Score">
            <div className="flex items-center gap-6 text-lg">
              <span className={game.away.pts > game.home.pts ? "font-bold text-green-400" : ""}>
                {game.away.abbreviation} {game.away.pts}
              </span>
              <span className="text-slate-500">at</span>
              <span className={game.home.pts > game.away.pts ? "font-bold text-green-400" : ""}>
                {game.home.abbreviation} {game.home.pts}
              </span>
              <span className="text-xs text-slate-500">{game.game_date?.slice(0, 10)} -- {game.season_type}</span>
            </div>
          </Card>

          {game.quarters && (
            <Card title="Quarter-by-Quarter Scoring">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-400 border-b border-slate-800">
                    <th className="py-2 pr-4">Team</th>
                    {game.quarters.map((q) => (
                      <th key={q.period} className="py-2 pr-4">{q.period}</th>
                    ))}
                    <th className="py-2 pr-4">Final</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-slate-900">
                    <td className="py-2 pr-4">{game.away.abbreviation}</td>
                    {game.quarters.map((q) => (
                      <td key={q.period} className="py-2 pr-4">{q.away}</td>
                    ))}
                    <td className="py-2 pr-4 font-medium">{game.away.pts}</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4">{game.home.abbreviation}</td>
                    {game.quarters.map((q) => (
                      <td key={q.period} className="py-2 pr-4">{q.home}</td>
                    ))}
                    <td className="py-2 pr-4 font-medium">{game.home.pts}</td>
                  </tr>
                </tbody>
              </table>
            </Card>
          )}

          <Card title="Box Score">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400 border-b border-slate-800">
                  <th className="py-2 pr-4">Stat</th>
                  <th className="py-2 pr-4">{game.away.abbreviation}</th>
                  <th className="py-2 pr-4">{game.home.abbreviation}</th>
                </tr>
              </thead>
              <tbody>
                {BOX_ROWS.map(([label, spec]) => (
                  <tr key={label} className="border-b border-slate-900">
                    <td className="py-2 pr-4 text-slate-400">{label}</td>
                    <td className="py-2 pr-4">{boxVal(game.away, spec)}</td>
                    <td className="py-2 pr-4">{boxVal(game.home, spec)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="Four Factors" subtitle="Computed directly from the box score (Dean Oliver's published formulas).">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400 border-b border-slate-800">
                  <th className="py-2 pr-4">Factor</th>
                  <th className="py-2 pr-4">{game.away.abbreviation}</th>
                  <th className="py-2 pr-4">{game.home.abbreviation}</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["eFG%", "efg_pct"], ["TOV%", "tov_pct"], ["OREB%", "oreb_pct"], ["FT Rate", "ft_rate"],
                ].map(([label, key]) => (
                  <tr key={key} className="border-b border-slate-900">
                    <td className="py-2 pr-4 text-slate-400">{label}</td>
                    <td className="py-2 pr-4">
                      {game.away.four_factors[key] != null ? `${(game.away.four_factors[key] * 100).toFixed(1)}%` : "--"}
                    </td>
                    <td className="py-2 pr-4">
                      {game.home.four_factors[key] != null ? `${(game.home.four_factors[key] * 100).toFixed(1)}%` : "--"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {game.other_stats && (
            <Card title="Context Stats">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-400 border-b border-slate-800">
                    <th className="py-2 pr-4">Stat</th>
                    <th className="py-2 pr-4">{game.away.abbreviation}</th>
                    <th className="py-2 pr-4">{game.home.abbreviation}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-slate-900">
                    <td className="py-2 pr-4 text-slate-400">Points in Paint</td>
                    <td className="py-2 pr-4">{game.other_stats.away.pts_paint}</td>
                    <td className="py-2 pr-4">{game.other_stats.home.pts_paint}</td>
                  </tr>
                  <tr className="border-b border-slate-900">
                    <td className="py-2 pr-4 text-slate-400">2nd Chance Pts</td>
                    <td className="py-2 pr-4">{game.other_stats.away.pts_2nd_chance}</td>
                    <td className="py-2 pr-4">{game.other_stats.home.pts_2nd_chance}</td>
                  </tr>
                  <tr className="border-b border-slate-900">
                    <td className="py-2 pr-4 text-slate-400">Fast Break Pts</td>
                    <td className="py-2 pr-4">{game.other_stats.away.pts_fb}</td>
                    <td className="py-2 pr-4">{game.other_stats.home.pts_fb}</td>
                  </tr>
                  <tr className="border-b border-slate-900">
                    <td className="py-2 pr-4 text-slate-400">Largest Lead</td>
                    <td className="py-2 pr-4">{game.other_stats.away.largest_lead}</td>
                    <td className="py-2 pr-4">{game.other_stats.home.largest_lead}</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4 text-slate-400">Lead Changes / Times Tied</td>
                    <td className="py-2 pr-4" colSpan={2}>
                      {game.other_stats.lead_changes} / {game.other_stats.times_tied}
                    </td>
                  </tr>
                </tbody>
              </table>
            </Card>
          )}

          {lineups && (
            <Card
              title="Lineup Performance (selected team)"
              subtitle="Every distinct 5-man unit this team used, merged across all its stints in this game -- see the Lineups tab for the full report and sorting options."
            >
              {lineups.flagged && (
                <p className="text-amber-400 text-xs mb-2">
                  Flagged by QA: total on-court time didn't land within tolerance of a valid game length -- treat with caution.
                </p>
              )}
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-400 border-b border-slate-800">
                    <th className="py-2 pr-4">Lineup</th>
                    <th className="py-2 pr-4">Min</th>
                    <th className="py-2 pr-4">+/-</th>
                  </tr>
                </thead>
                <tbody>
                  {lineups.stints
                    .slice()
                    .sort((a, b) => b.seconds - a.seconds)
                    .slice(0, 8)
                    .map((s) => (
                      <tr key={s.lineup} className="border-b border-slate-900">
                        <td className="py-2 pr-4">{s.player_names.join(", ")}</td>
                        <td className="py-2 pr-4">{(s.seconds / 60).toFixed(1)}</td>
                        <td className={`py-2 pr-4 ${s.point_differential >= 0 ? "text-green-400" : "text-red-400"}`}>
                          {s.point_differential >= 0 ? "+" : ""}
                          {s.point_differential}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </Card>
          )}

          {flow && (
            <Card
              title="Game Flow"
              subtitle="Score margin (home perspective) over the course of the game, from play-by-play. Positive is a home lead, negative is an away lead."
            >
              {(() => {
                const periodBoundaries = [720, 1440, 2160, 2880];
                for (let s = 2880 + 300; s < flow.total_seconds; s += 300) periodBoundaries.push(s);
                const xs = flow.timeline.map((t) => t.elapsed_seconds / 60);
                const ys = flow.timeline.map((t) => t.margin);
                return (
                  <>
                    <Plot
                      data={[
                        {
                          x: xs,
                          y: ys,
                          type: "scatter",
                          mode: "lines",
                          line: { color: "#38bdf8", width: 2, shape: "hv" },
                          fill: "tozeroy",
                          fillcolor: "rgba(56,189,248,0.12)",
                          name: "Margin",
                          hovertemplate: "%{x:.1f} min: %{y:+d}<extra></extra>",
                        },
                        {
                          x: [0, flow.total_seconds / 60],
                          y: [0, 0],
                          type: "scatter",
                          mode: "lines",
                          line: { color: "#475569", width: 1, dash: "dot" },
                          hoverinfo: "skip",
                          showlegend: false,
                        },
                      ]}
                      layout={{
                        paper_bgcolor: "#0f172a",
                        plot_bgcolor: "#0f172a",
                        font: { color: "#e2e8f0" },
                        xaxis: {
                          title: "Minute",
                          gridcolor: "#1e293b",
                          range: [0, flow.total_seconds / 60],
                        },
                        yaxis: { title: `Margin (${flow.home.abbreviation} - ${flow.away.abbreviation})`, gridcolor: "#1e293b" },
                        shapes: periodBoundaries
                          .filter((b) => b < flow.total_seconds)
                          .map((b) => ({
                            type: "line",
                            x0: b / 60,
                            x1: b / 60,
                            y0: 0,
                            y1: 1,
                            yref: "paper",
                            line: { color: "#334155", width: 1, dash: "dash" },
                          })),
                        margin: { l: 55, r: 10, t: 10, b: 45 },
                        height: 300,
                        showlegend: false,
                      }}
                      config={{ displayModeBar: false, responsive: true }}
                      style={{ width: "100%" }}
                      useResizeHandler
                    />
                    <div className="flex flex-wrap gap-6 mt-3 text-sm">
                      <div>
                        <span className="text-slate-500">Biggest {flow.home.abbreviation} lead: </span>
                        <span className="font-medium text-green-400">+{flow.biggest_lead_home.margin}</span>
                        <span className="text-slate-500"> at {(flow.biggest_lead_home.elapsed_seconds / 60).toFixed(1)} min</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Biggest {flow.away.abbreviation} lead: </span>
                        <span className="font-medium text-green-400">+{flow.biggest_lead_away.margin}</span>
                        <span className="text-slate-500"> at {(flow.biggest_lead_away.elapsed_seconds / 60).toFixed(1)} min</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Lead changes: </span>
                        <span className="font-medium">{flow.lead_changes}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Times tied: </span>
                        <span className="font-medium">{flow.times_tied}</span>
                      </div>
                    </div>
                    {flow.scoring_runs.length > 0 && (
                      <div className="mt-4">
                        <div className="text-xs text-slate-400 mb-2">Scoring Runs (8-0 or better)</div>
                        <div className="flex flex-wrap gap-2">
                          {flow.scoring_runs.map((run, i) => (
                            <div
                              key={i}
                              className={`text-xs rounded px-2.5 py-1.5 border ${
                                run.team === "home"
                                  ? "bg-sky-950/50 border-sky-800 text-sky-300"
                                  : "bg-orange-950/50 border-orange-800 text-orange-300"
                              }`}
                            >
                              {run.team === "home" ? flow.home.abbreviation : flow.away.abbreviation} {run.points}-0 run
                              <span className="text-slate-500">
                                {" "}
                                ({(run.start_seconds / 60).toFixed(1)}-{(run.end_seconds / 60).toFixed(1)} min)
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </Card>
          )}

          {rotation && (
            <Card
              title="Minutes Rotation (Plus/Minus)"
              subtitle="Each colored block is one lineup-stint this player was on court for, sized to its length and colored by that stint's point differential. Gaps are bench time."
            >
              <div className="flex gap-2 mb-3">
                {["both", "away", "home"].map((f) => (
                  <button
                    key={f}
                    className={`px-3 py-1.5 rounded text-sm capitalize ${
                      rotationTeamFilter === f ? "bg-slate-700" : "bg-slate-800 text-slate-400 hover:text-slate-200"
                    }`}
                    onClick={() => setRotationTeamFilter(f)}
                  >
                    {f === "both" ? "Both Teams" : f === "home" ? game.home.abbreviation : game.away.abbreviation}
                  </button>
                ))}
              </div>
              <RotationChart data={rotation} teamFilter={rotationTeamFilter} />
            </Card>
          )}

          {game.home.team_id && gameShots.length > 0 && (
            <Card
              title="Full Game Shot Chart"
              subtitle="Every shot attempt from both teams this game. Filter to one side, or leave both on to compare shot selection."
            >
              <div className="flex gap-2 mb-3">
                {["both", "home", "away"].map((f) => (
                  <button
                    key={f}
                    className={`px-3 py-1.5 rounded text-sm capitalize ${
                      shotFilter === f ? "bg-slate-700" : "bg-slate-800 text-slate-400 hover:text-slate-200"
                    }`}
                    onClick={() => setShotFilter(f)}
                  >
                    {f === "both" ? "Both Teams" : f === "home" ? game.home.abbreviation : game.away.abbreviation}
                  </button>
                ))}
              </div>
              <GameShotChart
                homeShots={gameShots.filter((s) => s.TEAM_ID === game.home.team_id)}
                awayShots={gameShots.filter((s) => s.TEAM_ID === game.away.team_id)}
                homeLabel={game.home.abbreviation}
                awayLabel={game.away.abbreviation}
                filter={shotFilter}
              />
            </Card>
          )}
        </>
      )}
    </div>
  );
}
