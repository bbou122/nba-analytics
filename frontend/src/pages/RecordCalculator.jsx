import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import Loading from "../components/Loading";

const HOME_AWAY_OPTIONS = [
  { key: "all", label: "All" },
  { key: "home", label: "Home" },
  { key: "away", label: "Away" },
];

const SEASON_TYPES = [
  { key: "Regular Season", label: "Regular Season" },
  { key: "Playoffs", label: "Playoffs" },
];

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
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

// A single numeric threshold filter: "no minimum" unless the user types a
// value. min="0" plus an explicit enabled flag avoids the classic "0 means
// unset vs 0 means the actual filter" ambiguity.
function MinFilter({ label, value, onChange, suffix = "" }) {
  return (
    <div>
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <input
        type="number"
        min="0"
        placeholder="No minimum"
        className="w-32 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
      />
      {suffix && <span className="text-xs text-slate-500 ml-1">{suffix}</span>}
    </div>
  );
}

function signedNum(v, digits = 1) {
  if (v == null || Number.isNaN(v)) return "--";
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;
}

export default function RecordCalculator() {
  const [teams, setTeams] = useState([]);
  const [teamId, setTeamId] = useState(null);
  const [seasons, setSeasons] = useState([]);
  const [seasonScope, setSeasonScope] = useState("single"); // "single" | "all"
  const [season, setSeason] = useState("");
  const [seasonType, setSeasonType] = useState("Regular Season");

  const [games, setGames] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // -- Filters (all client-side against the fetched per-game payload) --
  const [homeAway, setHomeAway] = useState("all");
  const [oppFgPctMin, setOppFgPctMin] = useState("");
  const [oppFgPctMax, setOppFgPctMax] = useState("");
  const [opp3paMin, setOpp3paMin] = useState("");
  const [oppOrebMin, setOppOrebMin] = useState("");
  const [oppFtaMin, setOppFtaMin] = useState("");
  const [b2bOnly, setB2bOnly] = useState(false);

  useEffect(() => {
    api.teams().then(setTeams).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!teamId) {
      setSeasons([]);
      return;
    }
    api
      .teamSeasons(teamId)
      .then((s) => {
        setSeasons(s);
        setSeason(s[s.length - 1] || "");
      })
      .catch(() => setSeasons([]));
  }, [teamId]);

  useEffect(() => {
    if (!teamId) {
      setGames(null);
      return;
    }
    if (seasonScope === "single" && !season) return;
    setError(null);
    setLoading(true);
    api
      .teamRecordCalculator(teamId, { seasons: seasonScope === "single" ? season : undefined, seasonType })
      .then((d) => setGames(d.games))
      .catch((e) => {
        setError(e.message);
        setGames(null);
      })
      .finally(() => setLoading(false));
  }, [teamId, seasonScope, season, seasonType]);

  const filteredGames = useMemo(() => {
    if (!games) return [];
    return games.filter((g) => {
      if (homeAway === "home" && !g.is_home) return false;
      if (homeAway === "away" && g.is_home) return false;
      if (oppFgPctMin !== "" && (g.opp_fg_pct == null || g.opp_fg_pct * 100 < oppFgPctMin)) return false;
      if (oppFgPctMax !== "" && (g.opp_fg_pct == null || g.opp_fg_pct * 100 > oppFgPctMax)) return false;
      if (opp3paMin !== "" && (g.opp_fg3a == null || g.opp_fg3a < opp3paMin)) return false;
      if (oppOrebMin !== "" && (g.opp_oreb == null || g.opp_oreb < oppOrebMin)) return false;
      if (oppFtaMin !== "" && (g.opp_fta == null || g.opp_fta < oppFtaMin)) return false;
      if (b2bOnly && !g.is_back_to_back) return false;
      return true;
    });
  }, [games, homeAway, oppFgPctMin, oppFgPctMax, opp3paMin, oppOrebMin, oppFtaMin, b2bOnly]);

  const summary = useMemo(() => {
    const gp = filteredGames.length;
    if (gp === 0) return null;
    const wins = filteredGames.filter((g) => g.result === "W");
    const losses = filteredGames.filter((g) => g.result === "L");
    const avg = (arr) => (arr.length ? arr.reduce((s, g) => s + g.margin, 0) / arr.length : null);
    return {
      gp,
      w: wins.length,
      l: losses.length,
      winPct: wins.length / gp,
      avgMargin: avg(filteredGames),
      avgMarginWins: avg(wins),
      avgMarginLosses: avg(losses),
      avgTeamPts: filteredGames.reduce((s, g) => s + g.team_pts, 0) / gp,
      avgOppPts: filteredGames.reduce((s, g) => s + g.opp_pts, 0) / gp,
    };
  }, [filteredGames]);

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h2 className="text-xl font-semibold mb-1">Record Calculator</h2>
        <p className="text-xs text-slate-500">
          How does this team actually do when the opponent shoots well, crashes the offensive glass, or gets to the
          line? Pick a team and season, then layer on filters -- record, average margin, and margin split by win/loss
          all recompute instantly against every game that matches, entirely in the browser.
        </p>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-[220px]">
          <div className="text-xs text-slate-400 mb-1">Team</div>
          <select
            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2"
            value={teamId ?? ""}
            onChange={(e) => setTeamId(Number(e.target.value) || null)}
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

        <div>
          <div className="text-xs text-slate-400 mb-1">Seasons</div>
          <div className="flex gap-1 bg-slate-800 rounded p-1">
            <button
              className={`px-3 py-1.5 rounded text-sm ${
                seasonScope === "single" ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200"
              }`}
              onClick={() => setSeasonScope("single")}
            >
              Single Season
            </button>
            <button
              className={`px-3 py-1.5 rounded text-sm ${
                seasonScope === "all" ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200"
              }`}
              onClick={() => setSeasonScope("all")}
            >
              All Seasons
            </button>
          </div>
        </div>

        {seasonScope === "single" && (
          <div>
            <div className="text-xs text-slate-400 mb-1">Season</div>
            <select
              className="bg-slate-800 border border-slate-700 rounded px-3 py-2"
              value={season}
              onChange={(e) => setSeason(e.target.value)}
              disabled={seasons.length === 0}
            >
              {seasons.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <div className="text-xs text-slate-400 mb-1">Season Type</div>
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

      {teamId && (
        <Card
          title="Opponent Weakness Filters"
          subtitle="Every filter is optional -- leave a field blank for 'no minimum'. Filters combine with AND."
        >
          <div className="flex flex-wrap gap-6">
            <div>
              <div className="text-xs text-slate-400 mb-1">Home / Away</div>
              <div className="flex gap-1 bg-slate-800 rounded p-1">
                {HOME_AWAY_OPTIONS.map((o) => (
                  <button
                    key={o.key}
                    className={`px-3 py-1.5 rounded text-sm ${
                      homeAway === o.key ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200"
                    }`}
                    onClick={() => setHomeAway(o.key)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="text-xs text-slate-400 mb-1">Opponent FG% Range</div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  max="100"
                  placeholder="Min"
                  className="w-20 bg-slate-800 border border-slate-700 rounded px-2 py-2 text-sm"
                  value={oppFgPctMin}
                  onChange={(e) => setOppFgPctMin(e.target.value === "" ? "" : Number(e.target.value))}
                />
                <span className="text-slate-500 text-sm">to</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  placeholder="Max"
                  className="w-20 bg-slate-800 border border-slate-700 rounded px-2 py-2 text-sm"
                  value={oppFgPctMax}
                  onChange={(e) => setOppFgPctMax(e.target.value === "" ? "" : Number(e.target.value))}
                />
                <span className="text-xs text-slate-500">%</span>
              </div>
            </div>

            <MinFilter label="Opponent 3PT Attempts" value={opp3paMin} onChange={setOpp3paMin} />
            <MinFilter label="Opponent Off. Rebounds" value={oppOrebMin} onChange={setOppOrebMin} />
            <MinFilter label="Opponent FT Attempts" value={oppFtaMin} onChange={setOppFtaMin} />

            <div>
              <div className="text-xs text-slate-400 mb-1">&nbsp;</div>
              <label className="flex items-center gap-2 text-sm text-slate-300 py-2">
                <input type="checkbox" checked={b2bOnly} onChange={(e) => setB2bOnly(e.target.checked)} />
                Back-to-back games only
              </label>
            </div>
          </div>
        </Card>
      )}

      {loading && <Loading label="Crunching games..." />}

      {!loading && teamId && games && (
        <>
          <Card title="Results" subtitle={`${filteredGames.length} of ${games.length} games match these filters.`}>
            {summary ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="Record" value={`${summary.w}-${summary.l}`} sub={`${(summary.winPct * 100).toFixed(1)}% win rate`} />
                <Stat label="Avg Point Diff" value={signedNum(summary.avgMargin)} sub={`over ${summary.gp} games`} />
                <Stat label="Avg Diff in Wins" value={signedNum(summary.avgMarginWins)} sub={`${summary.w} games`} />
                <Stat label="Avg Diff in Losses" value={signedNum(summary.avgMarginLosses)} sub={`${summary.l} games`} />
                <Stat label="Avg Points For" value={summary.avgTeamPts.toFixed(1)} />
                <Stat label="Avg Points Against" value={summary.avgOppPts.toFixed(1)} />
              </div>
            ) : (
              <p className="text-sm text-slate-500">No games match these filters.</p>
            )}
          </Card>

          {filteredGames.length > 0 && (
            <Card title="Matching Games">
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="text-slate-400 text-xs sticky top-0 bg-slate-900">
                    <tr className="text-left border-b border-slate-800">
                      <th className="py-2 pr-3">Date</th>
                      <th className="py-2 pr-3">Opp</th>
                      <th className="py-2 pr-3">Loc</th>
                      <th className="py-2 pr-3">Result</th>
                      <th className="py-2 pr-3">Margin</th>
                      <th className="py-2 pr-3">Opp FG%</th>
                      <th className="py-2 pr-3">Opp 3PA</th>
                      <th className="py-2 pr-3">Opp OREB</th>
                      <th className="py-2 pr-3">Opp FTA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...filteredGames].reverse().map((g) => (
                      <tr key={g.game_id} className="border-b border-slate-900">
                        <td className="py-1.5 pr-3 text-slate-400">{g.game_date}</td>
                        <td className="py-1.5 pr-3">{g.opponent}</td>
                        <td className="py-1.5 pr-3 text-slate-400">{g.is_home ? "vs" : "@"}</td>
                        <td className={`py-1.5 pr-3 font-medium ${g.result === "W" ? "text-green-400" : "text-red-400"}`}>
                          {g.result}
                        </td>
                        <td className="py-1.5 pr-3 tabular-nums">{signedNum(g.margin, 0)}</td>
                        <td className="py-1.5 pr-3 tabular-nums">{g.opp_fg_pct != null ? `${(g.opp_fg_pct * 100).toFixed(1)}%` : "--"}</td>
                        <td className="py-1.5 pr-3 tabular-nums">{g.opp_fg3a ?? "--"}</td>
                        <td className="py-1.5 pr-3 tabular-nums">{g.opp_oreb ?? "--"}</td>
                        <td className="py-1.5 pr-3 tabular-nums">{g.opp_fta ?? "--"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
