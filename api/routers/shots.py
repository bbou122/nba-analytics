from typing import Optional

import duckdb
from fastapi import APIRouter, Depends, HTTPException, Query

from db import get_db

router = APIRouter()


def _build_where(con, player_id, team_id, season, game_id=None, opponent_team_id=None, game_ids=None, seasons=None, home_away=None):
    if not player_id and not team_id and not game_id and not game_ids:
        raise HTTPException(status_code=400, detail="Provide at least one of player_id, team_id, game_id, game_ids")
    clauses = []
    params = []
    if player_id:
        clauses.append("PLAYER_ID = ?")
        params.append(player_id)
    if team_id:
        clauses.append("TEAM_ID = ?")
        params.append(team_id)
    if game_id:
        # dim_game.game_id is a zero-padded VARCHAR (e.g. "0022201225");
        # fact_shot_chart.GAME_ID is the same value as a BIGINT, which
        # drops the leading zeros but is numerically identical.
        clauses.append("GAME_ID = CAST(? AS BIGINT)")
        params.append(game_id)
    if game_ids:
        # Comma-separated list of dim_game-style game_ids -- e.g. every game
        # in a "last 10 games" stretch -- for stretch-level shot charts.
        ids = [g.strip() for g in game_ids.split(",") if g.strip()]
        if ids:
            placeholders = ", ".join("CAST(? AS BIGINT)" for _ in ids)
            clauses.append(f"GAME_ID IN ({placeholders})")
            params.extend(ids)
    if season:
        # SEASON_2 in fact_shot_chart is formatted like the SEASON column
        # elsewhere in the warehouse, e.g. "2023-24".
        clauses.append("SEASON_2 = ?")
        params.append(season)
    if opponent_team_id:
        abbr_df = con.execute("SELECT abbreviation FROM dim_team WHERE id = ?", [opponent_team_id]).fetchdf()
        if not abbr_df.empty:
            abbr = abbr_df["abbreviation"].iloc[0]
            clauses.append("(HOME_TEAM = ? OR AWAY_TEAM = ?)")
            params.extend([abbr, abbr])
    if seasons:
        # Multi-season / career filter -- takes precedence over the single
        # season= param above when both happen to be passed.
        season_list = [s.strip() for s in seasons.split(",") if s.strip()]
        if season_list:
            placeholders = ", ".join("?" for _ in season_list)
            clauses.append(f"SEASON_2 IN ({placeholders})")
            params.extend(season_list)
    if home_away in ("home", "away"):
        # fact_shot_chart stores HOME_TEAM/AWAY_TEAM as abbreviation
        # strings rather than team ids, so resolve the shooting team's own
        # abbreviation via a scalar subquery against dim_team (30 rows --
        # cheap regardless of query size).
        side_col = "HOME_TEAM" if home_away == "home" else "AWAY_TEAM"
        clauses.append(f"(SELECT abbreviation FROM dim_team WHERE id = TEAM_ID) = {side_col}")
    return "WHERE " + " AND ".join(clauses), params


@router.get("")
def get_shots(
    player_id: Optional[int] = Query(None),
    team_id: Optional[int] = Query(None),
    game_id: Optional[str] = Query(None),
    game_ids: Optional[str] = Query(None, description="Comma-separated game_ids, for a multi-game stretch"),
    opponent_team_id: Optional[int] = Query(None, description="Filter to games played against this team"),
    season: Optional[str] = Query(None, description='e.g. "2023-24"'),
    seasons: Optional[str] = Query(None, description='Comma-separated "YYYY-YY" seasons -- for a multi-season or career view. Takes precedence over season if both are passed.'),
    home_away: Optional[str] = Query(None, pattern="^(home|away)$", description="Restrict to the player/team's home or away games. Omit for both."),
    made_only: bool = Query(False),
    limit: int = Query(3000, le=20000),
    con: duckdb.DuckDBPyConnection = Depends(get_db),
):
    """
    Individual shot records -- one row per attempt, with court coordinates
    (LOC_X/LOC_Y) for plotting. Requires at least one of player_id, team_id,
    game_id, game_ids -- pass game_id (or team_id) alone (no player_id) to
    get every shot from both teams in that game, e.g. for a full-game shot
    chart, or game_ids for a multi-game stretch.
    """
    where_sql, params = _build_where(con, player_id, team_id, season, game_id, opponent_team_id, game_ids, seasons, home_away)
    if made_only:
        where_sql += " AND SHOT_MADE = true"

    df = con.execute(f"""
        SELECT GAME_ID, GAME_DATE, PLAYER_ID, PLAYER_NAME, TEAM_ID, TEAM_NAME,
               HOME_TEAM, AWAY_TEAM, EVENT_TYPE, SHOT_MADE, ACTION_TYPE, SHOT_TYPE,
               BASIC_ZONE, ZONE_NAME, ZONE_RANGE, LOC_X, LOC_Y, SHOT_DISTANCE,
               QUARTER, MINS_LEFT, SECS_LEFT
        FROM fact_shot_chart
        {where_sql}
        ORDER BY GAME_DATE
        LIMIT ?
    """, params + [limit]).fetchdf()
    return df.to_dict(orient="records")


@router.get("/zones")
def get_shot_zones(
    player_id: Optional[int] = Query(None),
    team_id: Optional[int] = Query(None),
    game_id: Optional[str] = Query(None),
    game_ids: Optional[str] = Query(None, description="Comma-separated game_ids, for a multi-game stretch"),
    opponent_team_id: Optional[int] = Query(None, description="Filter to games played against this team"),
    season: Optional[str] = Query(None, description='e.g. "2023-24"'),
    seasons: Optional[str] = Query(None, description='Comma-separated "YYYY-YY" seasons -- for a multi-season or career view. Takes precedence over season if both are passed.'),
    home_away: Optional[str] = Query(None, pattern="^(home|away)$", description="Restrict to the player/team's home or away games. Omit for both."),
    con: duckdb.DuckDBPyConnection = Depends(get_db),
):
    """
    Shooting efficiency aggregated by court zone (fine-grained -- ~19 buckets,
    matching the data's own BASIC_ZONE x ZONE_NAME x ZONE_RANGE split) --
    useful for a bubble/heatmap view. See /zones/seven for the simpler
    7-region breakdown (paint / 3 mid-range / 3 three-point) used on the
    court diagram's overlay labels. Requires at least one of player_id,
    team_id, game_id, game_ids.
    """
    where_sql, params = _build_where(con, player_id, team_id, season, game_id, opponent_team_id, game_ids, seasons, home_away)

    df = con.execute(f"""
        SELECT BASIC_ZONE, ZONE_NAME, ZONE_RANGE,
               COUNT(*) AS attempts,
               SUM(CASE WHEN SHOT_MADE THEN 1 ELSE 0 END) AS makes,
               ROUND(100.0 * SUM(CASE WHEN SHOT_MADE THEN 1 ELSE 0 END) / COUNT(*), 1) AS fg_pct,
               ROUND(AVG(LOC_X), 2) AS avg_loc_x,
               ROUND(AVG(LOC_Y), 2) AS avg_loc_y
        FROM fact_shot_chart
        {where_sql}
        GROUP BY BASIC_ZONE, ZONE_NAME, ZONE_RANGE
        ORDER BY attempts DESC
    """, params).fetchdf()
    return df.to_dict(orient="records")


# BASIC_ZONE/ZONE_NAME -> one of 7 coach-friendly regions. Backcourt shots
# (heaves, essentially) are dropped -- they're not a meaningful "zone".
_SEVEN_ZONE_CASE = """
    CASE
        WHEN BASIC_ZONE IN ('Restricted Area', 'In The Paint (Non-RA)') THEN 'Paint'
        WHEN BASIC_ZONE = 'Mid-Range' AND ZONE_NAME IN ('Left Side', 'Left Side Center') THEN 'Mid-Range Left'
        WHEN BASIC_ZONE = 'Mid-Range' AND ZONE_NAME = 'Center' THEN 'Mid-Range Center'
        WHEN BASIC_ZONE = 'Mid-Range' AND ZONE_NAME IN ('Right Side', 'Right Side Center') THEN 'Mid-Range Right'
        WHEN BASIC_ZONE = 'Left Corner 3' OR (BASIC_ZONE = 'Above the Break 3' AND ZONE_NAME = 'Left Side Center')
            THEN 'Three Left'
        WHEN BASIC_ZONE = 'Above the Break 3' AND ZONE_NAME = 'Center' THEN 'Three Center'
        WHEN BASIC_ZONE = 'Right Corner 3' OR (BASIC_ZONE = 'Above the Break 3' AND ZONE_NAME = 'Right Side Center')
            THEN 'Three Right'
        ELSE NULL
    END
"""


@router.get("/zones/seven")
def get_seven_zones(
    player_id: Optional[int] = Query(None),
    team_id: Optional[int] = Query(None),
    game_id: Optional[str] = Query(None),
    game_ids: Optional[str] = Query(None, description="Comma-separated game_ids, for a multi-game stretch"),
    opponent_team_id: Optional[int] = Query(None, description="Filter to games played against this team"),
    season: Optional[str] = Query(None, description='e.g. "2023-24"'),
    seasons: Optional[str] = Query(None, description='Comma-separated "YYYY-YY" seasons -- for a multi-season or career view. Takes precedence over season if both are passed.'),
    home_away: Optional[str] = Query(None, pattern="^(home|away)$", description="Restrict to the player/team's home or away games. Omit for both."),
    con: duckdb.DuckDBPyConnection = Depends(get_db),
):
    """
    FG% collapsed into 7 coach-friendly regions: Paint, Mid-Range Left/
    Center/Right, Three Left/Center/Right. This is what the court diagram
    overlays as text labels next to the shot dots.
    """
    where_sql, params = _build_where(con, player_id, team_id, season, game_id, opponent_team_id, game_ids, seasons, home_away)

    df = con.execute(f"""
        SELECT {_SEVEN_ZONE_CASE} AS zone,
               COUNT(*) AS attempts,
               SUM(CASE WHEN SHOT_MADE THEN 1 ELSE 0 END) AS makes,
               ROUND(100.0 * SUM(CASE WHEN SHOT_MADE THEN 1 ELSE 0 END) / COUNT(*), 1) AS fg_pct
        FROM fact_shot_chart
        {where_sql}
        GROUP BY zone
        HAVING zone IS NOT NULL
        ORDER BY attempts DESC
    """, params).fetchdf()

    # League-average FG% per zone over the same season scope (ignoring the
    # player/team/game filters above) -- lets the UI show "52% (+6 vs
    # league)" instead of a bare number. Season-scoped rather than
    # all-time so era-specific pace/3PT-rate shifts don't skew the compare.
    league_season_clause = ""
    league_params = []
    if seasons:
        season_list = [s.strip() for s in seasons.split(",") if s.strip()]
        if season_list:
            placeholders = ", ".join("?" for _ in season_list)
            league_season_clause = f"WHERE SEASON_2 IN ({placeholders})"
            league_params = season_list
    elif season:
        league_season_clause = "WHERE SEASON_2 = ?"
        league_params = [season]

    league_df = con.execute(f"""
        SELECT {_SEVEN_ZONE_CASE} AS zone,
               ROUND(100.0 * SUM(CASE WHEN SHOT_MADE THEN 1 ELSE 0 END) / COUNT(*), 1) AS league_fg_pct
        FROM fact_shot_chart
        {league_season_clause}
        GROUP BY zone
        HAVING zone IS NOT NULL
    """, league_params).fetchdf()
    league_map = dict(zip(league_df["zone"], league_df["league_fg_pct"]))

    records = df.to_dict(orient="records")
    for r in records:
        lg = league_map.get(r["zone"])
        r["league_fg_pct"] = lg
        r["diff_vs_league"] = round(r["fg_pct"] - lg, 1) if lg is not None else None
    return records


# ACTION_TYPE -> a coach-friendly shot-creation bucket. This is a proxy
# built from the shot description text, not true tracking-based play-type
# data (no touches/dribbles are recorded in this warehouse) -- "Catch &
# Shoot / Standard Jumper" in particular is a catch-all for plain "Jump
# Shot" rows, which can include some quick-trigger off-the-dribble looks
# the description doesn't distinguish. Order matters -- more specific
# patterns are checked first.
_CREATION_TYPE_CASE = """
    CASE
        WHEN ACTION_TYPE IN ('Tip Shot','Tip Layup Shot','Putback Layup Shot','Tip Dunk Shot',
                              'Putback Dunk Shot','Putback Slam Dunk Shot','Running Tip Shot','Putback Reverse Dunk Shot')
            THEN 'Putback / Tip'
        WHEN ACTION_TYPE IN ('Pullup Jump shot','Step Back Jump shot','Running Pull-Up Jump Shot',
                              'Step Back Bank Jump Shot','Driving Jump shot','Pullup Bank shot')
            THEN 'Pullup / Off-the-Dribble Jumper'
        WHEN ACTION_TYPE IN ('Hook Shot','Turnaround Hook Shot','Jump Hook Shot','Turnaround Bank Hook Shot',
                              'Hook Bank Shot','Jump Bank Hook Shot','Running Bank Hook Shot','Turnaround Finger Roll Shot',
                              'Turnaround Jump Shot','Turnaround Fadeaway shot','Turnaround Bank shot',
                              'Turnaround Fadeaway Bank Jump Shot','Fadeaway Jump Shot','Fadeaway Bank shot',
                              'Driving Hook Shot','Driving Bank Hook Shot')
            THEN 'Post-Up / Turnaround / Hook'
        WHEN ACTION_TYPE LIKE 'Driving%' OR ACTION_TYPE IN
            ('Running Layup Shot','Running Jump Shot','Running Dunk Shot','Running Hook Shot','Running Bank shot',
             'Running Reverse Layup Shot','Running Finger Roll Layup Shot','Floating Jump shot',
             'Finger Roll Layup Shot','Finger Roll Shot','Running Reverse Dunk Shot','Running Slam Dunk Shot')
            THEN 'Drive / Off-the-Dribble at Rim'
        WHEN ACTION_TYPE IN ('Layup Shot','Dunk Shot','Slam Dunk Shot','Alley Oop Dunk Shot','Alley Oop Layup shot',
                              'Cutting Layup Shot','Cutting Dunk Shot','Cutting Finger Roll Layup Shot',
                              'Reverse Layup Shot','Reverse Dunk Shot','Running Alley Oop Dunk Shot',
                              'Running Alley Oop Layup Shot','Follow Up Dunk Shot','Reverse Slam Dunk Shot')
            THEN 'Cut / Assisted Finish at Rim'
        WHEN ACTION_TYPE IN ('Jump Shot','Jump Bank Shot')
            THEN 'Catch & Shoot / Standard Jumper (proxy)'
        ELSE NULL
    END
"""


@router.get("/creation-types")
def get_shot_creation_types(
    player_id: Optional[int] = Query(None),
    team_id: Optional[int] = Query(None),
    game_id: Optional[str] = Query(None),
    game_ids: Optional[str] = Query(None, description="Comma-separated game_ids, for a multi-game stretch"),
    opponent_team_id: Optional[int] = Query(None, description="Filter to games played against this team"),
    season: Optional[str] = Query(None, description='e.g. "2023-24"'),
    seasons: Optional[str] = Query(None, description='Comma-separated "YYYY-YY" seasons -- takes precedence over season if both are passed.'),
    home_away: Optional[str] = Query(None, pattern="^(home|away)$"),
    con: duckdb.DuckDBPyConnection = Depends(get_db),
):
    """
    FGA/FG% broken down by how the shot was created -- a proxy built from
    fact_shot_chart's ACTION_TYPE description text (see _CREATION_TYPE_CASE),
    not true tracking-based play-type data. Requires at least one of
    player_id, team_id, game_id, game_ids, same as the other /shots endpoints.
    """
    where_sql, params = _build_where(con, player_id, team_id, season, game_id, opponent_team_id, game_ids, seasons, home_away)

    df = con.execute(f"""
        SELECT {_CREATION_TYPE_CASE} AS creation_type,
               COUNT(*) AS attempts,
               SUM(CASE WHEN SHOT_MADE THEN 1 ELSE 0 END) AS makes,
               ROUND(100.0 * SUM(CASE WHEN SHOT_MADE THEN 1 ELSE 0 END) / COUNT(*), 1) AS fg_pct
        FROM fact_shot_chart
        {where_sql}
        GROUP BY creation_type
        HAVING creation_type IS NOT NULL
        ORDER BY attempts DESC
    """, params).fetchdf()
    return df.to_dict(orient="records")
