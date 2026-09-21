// Points at the FastAPI backend. Configurable via VITE_API_BASE_URL (set this
// in a .env file or your hosting platform's env vars for a deployed build) so
// the same frontend build can point at a local API during development and a
// deployed API in production. Falls back to local dev default. Run the local
// backend persistently in a terminal with:
//   uvicorn main:app --reload --port 8000
const BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

async function apiGet(path, params = {}) {
  const url = new URL(BASE_URL + path);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  });
  const res = await fetch(url);
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `Request failed: ${res.status}`);
  }
  return res.json();
}

export const api = {
  teams: () => apiGet("/teams"),
  team: (teamId) => apiGet(`/teams/${teamId}`),
  teamSeasons: (teamId) => apiGet(`/teams/${teamId}/seasons`),
  teamStats: (teamId, { season, statType = "traditional", seasonSegment = "rs" } = {}) =>
    apiGet(`/teams/${teamId}/stats`, { season, stat_type: statType, season_segment: seasonSegment }),
  teamGames: (teamId, { season, seasonType } = {}) =>
    apiGet(`/teams/${teamId}/games`, { season, season_type: seasonType }),
  teamLineups: (teamId, { minSeconds, sortBy, limit, season, seasonType } = {}) =>
    apiGet("/lineups", {
      team_id: teamId, min_seconds: minSeconds, sort_by: sortBy, limit,
      season, season_type: seasonType,
    }),
  gameLineups: (gameId, teamId) => apiGet("/lineups/game", { game_id: gameId, team_id: teamId }),

  searchPlayers: (q) => apiGet("/players", { q }),
  player: (playerId) => apiGet(`/players/${playerId}`),
  playerSeasons: (playerId) => apiGet(`/players/${playerId}/seasons`),
  playerStats: (playerId, { season, statType = "traditional", seasonSegment = "rs" } = {}) =>
    apiGet(`/players/${playerId}/stats`, { season, stat_type: statType, season_segment: seasonSegment }),
  // Per-game averages across a multi-season selection or full career
  // (omit seasons), optionally split home/away -- powers Player Explorer.
  playerGameAverages: (playerId, { seasons, homeAway } = {}) =>
    apiGet(`/players/${playerId}/game-averages`, { seasons, home_away: homeAway }),
  playerOnOff: (playerId, { teamId, gameId, seasons, homeAway } = {}) =>
    apiGet(`/players/${playerId}/on-off`, {
      team_id: teamId, game_id: gameId, seasons, home_away: homeAway,
    }),

  shotZones: ({ playerId, teamId, gameId, gameIds, opponentTeamId, season, seasons, homeAway } = {}) =>
    apiGet("/shots/zones", {
      player_id: playerId, team_id: teamId, game_id: gameId, game_ids: gameIds,
      opponent_team_id: opponentTeamId, season, seasons, home_away: homeAway,
    }),
  sevenZones: ({ playerId, teamId, gameId, gameIds, opponentTeamId, season, seasons, homeAway } = {}) =>
    apiGet("/shots/zones/seven", {
      player_id: playerId, team_id: teamId, game_id: gameId, game_ids: gameIds,
      opponent_team_id: opponentTeamId, season, seasons, home_away: homeAway,
    }),
  shots: ({ playerId, teamId, gameId, gameIds, opponentTeamId, season, seasons, homeAway, madeOnly, limit } = {}) =>
    apiGet("/shots", {
      player_id: playerId, team_id: teamId, game_id: gameId, game_ids: gameIds,
      opponent_team_id: opponentTeamId, season, seasons, home_away: homeAway,
      made_only: madeOnly, limit,
    }),

  teamDashboard: (teamId, season, homeAway, seasonType) =>
    apiGet(`/teams/${teamId}/dashboard`, { season, home_away: homeAway, season_type: seasonType }),
  teamRoster: (teamId, season, seasonType) => apiGet(`/teams/${teamId}/roster`, { season, season_type: seasonType }),
  playerStretch: (teamId, gameIds) => apiGet(`/teams/${teamId}/player-stretch`, { game_ids: gameIds }),
  // With/without-a-teammate impact split, e.g. "how does player A's
  // production change in games player B missed entirely."
  teammateImpact: (teamId, { playerId, teammateId, seasons } = {}) =>
    apiGet(`/teams/${teamId}/teammate-impact`, { player_id: playerId, teammate_id: teammateId, seasons }),
  game: (gameId) => apiGet(`/games/${gameId}`),
  dataQualitySummary: () => apiGet("/data-quality/summary"),
  dataQualityExcluded: (teamId) => apiGet("/data-quality/excluded", { team_id: teamId }),

  // -- Player Explorer additions (clutch, shot-creation, defense/role) --
  playerClutch: (playerId, { seasons } = {}) => apiGet(`/players/${playerId}/clutch`, { seasons }),
  playerAdvanced: (playerId, { seasons } = {}) => apiGet(`/players/${playerId}/advanced`, { seasons }),
  creationTypes: ({ playerId, teamId, gameId, gameIds, opponentTeamId, season, seasons, homeAway } = {}) =>
    apiGet("/shots/creation-types", {
      player_id: playerId, team_id: teamId, game_id: gameId, game_ids: gameIds,
      opponent_team_id: opponentTeamId, season, seasons, home_away: homeAway,
    }),

  // -- Executive Dashboard additions (team identity, quarter trends, rest/B2B, win shares) --
  teamIdentity: (teamId, season, seasonType) => apiGet(`/teams/${teamId}/identity`, { season, season_type: seasonType }),
  quarterTrends: (teamId, { season, homeAway, seasonType } = {}) =>
    apiGet(`/teams/${teamId}/quarter-trends`, { season, home_away: homeAway, season_type: seasonType }),
  winShares: (teamId, season, seasonType) => apiGet(`/teams/${teamId}/win-shares`, { season, season_type: seasonType }),
  // Team-level clutch record + avg clutch scoring margin.
  teamClutch: (teamId, { season, seasonType } = {}) =>
    apiGet(`/teams/${teamId}/clutch`, { season, season_type: seasonType }),
  // Game-by-game + rolling-average estimated net rating, for a trend line.
  netRatingTrend: (teamId, { season, homeAway, seasonType, rollingWindow } = {}) =>
    apiGet(`/teams/${teamId}/net-rating-trend`, {
      season, home_away: homeAway, season_type: seasonType, rolling_window: rollingWindow,
    }),

  // -- New pages: Archetypes, Compare --
  archetypes: ({ season, minGp, nClusters } = {}) =>
    apiGet("/players/archetypes", { season, min_gp: minGp, n_clusters: nClusters }),
  // Nearest neighbors in the archetype feature space -- "who plays like this player."
  similarPlayers: (playerId, { season, minGp, n } = {}) =>
    apiGet(`/players/${playerId}/similar`, { season, min_gp: minGp, n }),
};
