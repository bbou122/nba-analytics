import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import CourtShotChart from "../components/CourtShotChart";
import Loading from "../components/Loading";

const HEADLINE_STATS = [
  { label: "GP", key: "gp" },
  { label: "PTS", key: "pts" },
  { label: "REB", key: "reb" },
  { label: "AST", key: "ast" },
  { label: "STL", key: "stl" },
  { label: "BLK", key: "blk" },
  { label: "FG%", key: "fg_pct", suffix: "%" },
  { label: "3P%", key: "fg3_pct", suffix: "%" },
];

const HOME_AWAY_OPTIONS = [
  { key: "all", label: "All" },
  { key: "home", label: "Home" },
  { key: "away", label: "Away" },
];

export default function PlayerExplorer() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [playerId, setPlayerId] = useState(null);
  const [bio, setBio] = useState(null);
  const [error, setError] = useState(null);

  // Season selection: a multi-select of individual seasons, or "Career"
  // (every season on record) which overrides it. Everything on the page --
  // averages, shot chart, zones -- reacts to whichever is active.
  const [seasons, setSeasons] = useState([]);
  const [selectedSeasons, setSelectedSeasons] = useState([]);
  const [isCareer, setIsCareer] = useState(false);
  const [homeAway, setHomeAway] = useState("all");
  const [averages, setAverages] = useState(null);
  const [averagesLoading, setAveragesLoading] = useState(false);

  const [teams, setTeams] = useState([]);
  const [opponentTeamId, setOpponentTeamId] = useState(null);
  const [seasonTeamId, setSeasonTeamId] = useState(null);
  const [games, setGames] = useState([]);
  const [gameId, setGameId] = useState(null);
  const [shots, setShots] = useState([]);
  const [shotSummary, setShotSummary] = useState(null);
  const [sevenZones, setSevenZones] = useState([]);

  // Clutch / creation-type / defense-and-role -- career or multi-season
  // scoped the same way as the headline averages above (these endpoints
  // don't support a home/away split).
  const [clutch, setClutch] = useState(null);
  const [advanced, setAdvanced] = useState(null);
  const [creationTypes, setCreationTypes] = useState([]);
  const [similarPlayers, setSimilarPlayers] = useState(null);

  // A single game / opponent filter only makes sense pinned to one
  // specific season (we need to know which team the player was on that
  // year to look up its schedule) -- career and multi-season views show
  // the aggregate shot chart across everything instead.
  const singleSeasonMode = !isCareer && selectedSeasons.length === 1;

  useEffect(() => {
    api.teams().then(setTeams).catch((e) => setError(e.message));
  }, []);

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
    if (!playerId) return;
    setError(null);
    api.player(playerId).then(setBio).catch((e) => setError(e.message));
    api.playerSeasons(playerId)
      .then((s) => {
        setSeasons(s);
        setSelectedSeasons(s.length ? [s[s.length - 1]] : []);
        setIsCareer(false);
      })
      .catch((e) => setError(e.message));
  }, [playerId]);

  // Headline averages panel -- career (all seasons), a multi-season
  // selection, or a single season, optionally split home/away.
  useEffect(() => {
    if (!playerId) return;
    if (!isCareer && selectedSeasons.length === 0) {
      setAverages(null);
      return;
    }
    setError(null);
    setAveragesLoading(true);
    api
      .playerGameAverages(playerId, {
        seasons: isCareer ? undefined : selectedSeasons.join(","),
        homeAway: homeAway === "all" ? undefined : homeAway,
      })
      .then(setAverages)
      .catch((e) => {
        setError(e.message);
        setAverages(null);
      })
      .finally(() => setAveragesLoading(false));
  }, [playerId, selectedSeasons, isCareer, homeAway]);

  // Clutch performance + shot-creation-type breakdown + defense/role stats
  // -- same career/multi-season scope as the headline averages, but these
  // source tables are season-level and don't support a home/away split.
  useEffect(() => {
    if (!playerId) return;
    if (!isCareer && selectedSeasons.length === 0) {
      setClutch(null);
      setAdvanced(null);
      setCreationTypes([]);
      return;
    }
    const seasonsParam = isCareer ? undefined : selectedSeasons.join(",");
    api.playerClutch(playerId, { seasons: seasonsParam }).then(setClutch).catch(() => setClutch(null));
    api.playerAdvanced(playerId, { seasons: seasonsParam }).then(setAdvanced).catch(() => setAdvanced(null));
    api
      .creationTypes({ playerId, seasons: seasonsParam, homeAway: homeAway === "all" ? undefined : homeAway })
      .then(setCreationTypes)
      .catch(() => setCreationTypes([]));
  }, [playerId, selectedSeasons, isCareer, homeAway]);

  // Similarity search only makes sense pinned to one season (the same way
  // /archetypes works) -- resets whenever we leave single-season mode.
  useEffect(() => {
    if (!playerId || !singleSeasonMode) {
      setSimilarPlayers(null);
      return;
    }
    api
      .similarPlayers(playerId, { season: selectedSeasons[0], minGp: 20, n: 6 })
      .then(setSimilarPlayers)
      .catch(() => setSimilarPlayers(null));
  }, [playerId, singleSeasonMode, selectedSeasons]);

  // Team for the single selected season (for the game-filter dropdown
  // only) -- a player's TEAM_ID can change season to season via trades,
  // so this is looked up per-season rather than reused from bio.
  useEffect(() => {
    if (!playerId || !singleSeasonMode) {
      setSeasonTeamId(null);
      return;
    }
    api
      .playerStats(playerId, { season: selectedSeasons[0] })
      .then((rows) => setSeasonTeamId(rows[0]?.TEAM_ID ?? null))
      .catch(() => setSeasonTeamId(null));
  }, [playerId, singleSeasonMode, selectedSeasons]);

  useEffect(() => {
    if (!singleSeasonMode || !seasonTeamId) {
      setGames([]);
      return;
    }
    api
      .teamGames(seasonTeamId, { season: selectedSeasons[0] })
      .then(setGames)
      .catch(() => setGames([]));
  }, [singleSeasonMode, seasonTeamId, selectedSeasons]);

  useEffect(() => {
    setGameId(null);
  }, [opponentTeamId, selectedSeasons, isCareer]);

  // Shot chart + 7-zone breakdown -- same season/career/home-away scope as
  // the averages panel above, plus the opponent/single-game drill-in when
  // exactly one season is active.
  useEffect(() => {
    if (!playerId) return;
    if (!isCareer && selectedSeasons.length === 0) return;
    setError(null);
    const filters = {
      playerId,
      seasons: isCareer ? undefined : selectedSeasons.join(","),
      homeAway: homeAway === "all" ? undefined : homeAway,
      opponentTeamId: singleSeasonMode && !gameId ? opponentTeamId : null,
      gameId: singleSeasonMode ? gameId : null,
    };
    api
      .shots({ ...filters, limit: 3000 })
      .then((s) => {
        setShots(s);
        const attempts = s.length;
        const makes = s.filter((x) => x.SHOT_MADE).length;
        setShotSummary(attempts ? { attempts, makes, fgPct: ((makes / attempts) * 100).toFixed(1) } : null);
      })
      .catch((e) => {
        setError(e.message);
        setShots([]);
        setShotSummary(null);
      });
    api
      .sevenZones(filters)
      .then(setSevenZones)
      .catch(() => setSevenZones([]));
  }, [playerId, selectedSeasons, isCareer, homeAway, singleSeasonMode, opponentTeamId, gameId]);

  const seasonLabel = useMemo(() => {
    if (isCareer) return "Career";
    if (selectedSeasons.length === 0) return "";
    if (selectedSeasons.length === 1) return selectedSeasons[0];
    return `${selectedSeasons.length} seasons selected`;
  }, [isCareer, selectedSeasons]);

  function toggleSeason(s) {
    setIsCareer(false);
    setSelectedSeasons((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s].sort()));
  }

  return (
    <div className="p-6 space-y-4 max-w-5xl mx-auto">
      <h2 className="text-xl font-semibold">Player Explorer</h2>
      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="relative w-72">
        <input
          className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2"
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
                  setPlayerId(p.id);
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

      {bio && (
        <div className="flex flex-wrap gap-4 text-sm text-slate-300">
          <span className="font-medium text-slate-100">{bio.display_first_last}</span>
          <span>{bio.position}</span>
          <span>{bio.height}, {bio.weight} lbs</span>
          <span>{bio.team_name}</span>
        </div>
      )}

      {playerId && seasons.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <button
              className={`px-3 py-1.5 rounded text-sm ${
                isCareer ? "bg-slate-700" : "bg-slate-800 text-slate-400 hover:text-slate-200"
              }`}
              onClick={() => setIsCareer((v) => !v)}
            >
              Career (all seasons)
            </button>

            <div className="flex gap-1 bg-slate-800 rounded p-1">
              {HOME_AWAY_OPTIONS.map((o) => (
                <button
                  key={o.key}
                  className={`px-3 py-1.5 rounded text-sm ${
                    homeAway === o.key ? "bg-slate-700" : "text-slate-400 hover:text-slate-200"
                  }`}
                  onClick={() => setHomeAway(o.key)}
                >
                  {o.label}
                </button>
              ))}
            </div>

            <span className="text-xs text-slate-500">Showing: {seasonLabel}</span>
          </div>

          {!isCareer && (
            <div className="flex flex-wrap gap-2 max-h-28 overflow-auto">
              {seasons.map((s) => (
                <label
                  key={s}
                  className={`px-2 py-1 rounded text-xs cursor-pointer border ${
                    selectedSeasons.includes(s)
                      ? "bg-sky-900/50 border-sky-700 text-sky-300"
                      : "bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="hidden"
                    checked={selectedSeasons.includes(s)}
                    onChange={() => toggleSeason(s)}
                  />
                  {s}
                </label>
              ))}
            </div>
          )}
          {!isCareer && (
            <p className="text-xs text-slate-500">
              Pick one season to unlock the opponent/single-game shot-chart filters below, or several for a
              multi-season average.
            </p>
          )}
        </div>
      )}

      {averagesLoading && !averages && <Loading label="Loading player stats..." />}
      {averages && (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-8 gap-3">
          {HEADLINE_STATS.map(({ label, key, suffix }) => (
            <div key={key} className="bg-slate-800 rounded p-3">
              <div className="text-xs text-slate-400">{label}</div>
              <div className="text-lg font-medium">
                {averages[key] != null ? `${averages[key]}${suffix ?? ""}` : "--"}
              </div>
            </div>
          ))}
        </div>
      )}

      {playerId && (averages || isCareer || selectedSeasons.length > 0) && (
        <section className="bg-slate-900 border border-slate-800 rounded-lg p-5 mt-4">
          <h3 className="text-base font-semibold mb-1">Shot Chart</h3>
          <p className="text-xs text-slate-500 mb-3">
            Every shot attempt across the season(s) selected above -- green circle for a make, red X for a miss.
            {singleSeasonMode
              ? " Filter to a specific opponent or single game below."
              : " Opponent/single-game filters need exactly one season selected."}{" "}
            For a full-game shot chart with both teams, see Game Analysis.
          </p>

          {singleSeasonMode && (
            <div className="flex flex-wrap gap-3 mb-3">
              <select
                className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm"
                value={opponentTeamId ?? ""}
                onChange={(e) => setOpponentTeamId(e.target.value ? Number(e.target.value) : null)}
                disabled={!!gameId}
              >
                <option value="">All opponents</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    vs. {t.full_name}
                  </option>
                ))}
              </select>

              <select
                className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm min-w-[14rem]"
                value={gameId ?? ""}
                onChange={(e) => setGameId(e.target.value || null)}
              >
                <option value="">All games this season</option>
                {games
                  .filter((g) => !opponentTeamId || g.opponent === teams.find((t) => t.id === opponentTeamId)?.abbreviation)
                  .map((g) => (
                    <option key={g.game_id} value={g.game_id}>
                      {String(g.game_date).slice(0, 10)} -- {g.is_home ? "vs" : "@"} {g.opponent}
                    </option>
                  ))}
              </select>
            </div>
          )}

          {shotSummary && (
            <p className="text-sm text-slate-400 mb-3">
              {shotSummary.makes}/{shotSummary.attempts} ({shotSummary.fgPct}%) on this filter
            </p>
          )}

          <CourtShotChart shots={shots} sevenZones={sevenZones} />
        </section>
      )}

      {clutch && (
        <section className="bg-slate-900 border border-slate-800 rounded-lg p-5">
          <h3 className="text-base font-semibold mb-1">Clutch Performance</h3>
          <p className="text-xs text-slate-500 mb-3">{clutch.clutch_definition} -- {clutch.clutch_games} clutch games in this selection.</p>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-7 gap-3">
            {[
              { label: "PTS", value: clutch.pts },
              { label: "REB", value: clutch.reb },
              { label: "AST", value: clutch.ast },
              { label: "STL", value: clutch.stl },
              { label: "BLK", value: clutch.blk },
              { label: "TOV", value: clutch.tov },
              { label: "FG%", value: clutch.fg_pct_time_only, suffix: "%" },
            ].map(({ label, value, suffix }) => (
              <div key={label} className="bg-slate-800 rounded p-3">
                <div className="text-xs text-slate-400">{label}</div>
                <div className="text-lg font-medium">{value != null ? `${value}${suffix ?? ""}` : "--"}</div>
              </div>
            ))}
          </div>
          {clutch.fg_pct_time_only != null && (
            <p className="text-xs text-slate-500 mt-2">FG% caveat: {clutch.fg_pct_time_only_definition}</p>
          )}
        </section>
      )}

      {creationTypes.length > 0 && (
        <section className="bg-slate-900 border border-slate-800 rounded-lg p-5">
          <h3 className="text-base font-semibold mb-1">Shot Creation Type</h3>
          <p className="text-xs text-slate-500 mb-3">
            A text-based classification of each shot's ACTION_TYPE description into six buckets -- a proxy for shot
            creation, not official tracking-based play-type data.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 border-b border-slate-800">
                <th className="py-1.5 font-medium">Type</th>
                <th className="py-1.5 font-medium text-right">Attempts</th>
                <th className="py-1.5 font-medium text-right">Makes</th>
                <th className="py-1.5 font-medium text-right">FG%</th>
              </tr>
            </thead>
            <tbody>
              {creationTypes
                .slice()
                .sort((a, b) => b.attempts - a.attempts)
                .map((c) => (
                  <tr key={c.creation_type} className="border-b border-slate-800/60">
                    <td className="py-1.5">{c.creation_type}</td>
                    <td className="py-1.5 text-right">{c.attempts}</td>
                    <td className="py-1.5 text-right">{c.makes}</td>
                    <td className="py-1.5 text-right">{c.fg_pct}%</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      )}

      {advanced && (
        <section className="bg-slate-900 border border-slate-800 rounded-lg p-5">
          <h3 className="text-base font-semibold mb-1">Defense &amp; Role</h3>
          <p className="text-xs text-slate-500 mb-3">
            Season-aggregate defense and scoring-role stats, GP-weighted across the selected seasons.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
            {[
              { label: "Def Rtg", value: advanced.def_rating },
              { label: "DREB%", value: advanced.dreb_pct, suffix: "%" },
              { label: "STL%", value: advanced.pct_stl, suffix: "%" },
              { label: "BLK%", value: advanced.pct_blk, suffix: "%" },
              { label: "Pts in Paint", value: advanced.pts_paint },
              { label: "Fastbreak Pts", value: advanced.pts_fb },
            ].map(({ label, value, suffix }) => (
              <div key={label} className="bg-slate-800 rounded p-3">
                <div className="text-xs text-slate-400">{label}</div>
                <div className="text-lg font-medium">{value != null ? `${value}${suffix ?? ""}` : "--"}</div>
              </div>
            ))}
          </div>
          {advanced.def_ws_total != null && (
            <p className="text-xs text-slate-500 mt-3">
              NBA stats API DEF_WS (this selection, summed): {advanced.def_ws_total}. {advanced.def_ws_note}
            </p>
          )}
        </section>
      )}

      {similarPlayers && similarPlayers.similar_players.length > 0 && (
        <section className="bg-slate-900 border border-slate-800 rounded-lg p-5">
          <h3 className="text-base font-semibold mb-1">Similar Players -- {selectedSeasons[0]}</h3>
          <p className="text-xs text-slate-500 mb-3">
            Nearest statistical neighbors this season (usage, efficiency, playmaking, rebounding, turnovers, 3PA
            rate, paint share, block/steal rate) -- purely statistical, not a scouting judgment. Click a name to
            look them up.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {similarPlayers.similar_players.map((p) => (
              <button
                key={p.player_id}
                className="text-left bg-slate-800 hover:bg-slate-700 rounded p-3"
                onClick={() => {
                  setPlayerId(p.player_id);
                  setQuery(p.player_name);
                  setResults([]);
                }}
              >
                <div className="text-sm font-medium">{p.player_name}</div>
                <div className="text-xs text-slate-400">{p.team}</div>
                <div className="text-xs text-slate-500 mt-1">distance {p.similarity_distance}</div>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
