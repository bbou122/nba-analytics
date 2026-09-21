from typing import Optional

import duckdb
from fastapi import APIRouter, Depends, HTTPException, Query

from db import get_db
from routers.shots import _SEVEN_ZONE_CASE
from routers.games import _clean_nan

_SEASON_TYPE_PATTERN = "^(Regular Season|Playoffs)$"


def _season_table(base, season_type):
    """e.g. _season_table("fact_team_advanced", "Playoffs") -> "fact_team_advanced_po" """
    return f"{base}_po" if season_type == "Playoffs" else f"{base}_rs"


# Process-level cache for /win-shares -- it re-scans two tables and does a
# full per-player allocation pass every call, and the underlying warehouse
# data doesn't change during the server's lifetime, so caching by
# (team_id, season, season_type) is safe and makes the Roster tab snappier
# on repeat visits.
_WIN_SHARES_CACHE = {}

router = APIRouter()

VALID_STAT_TYPES = ("traditional", "advanced")
VALID_SEGMENTS = ("rs", "po")  # regular season / playoffs


@router.get("")
def list_teams(con: duckdb.DuckDBPyConnection = Depends(get_db)):
    """All 30 franchises with basic identity info."""
    df = con.execute("""
        SELECT id, full_name, abbreviation, nickname, city, state, year_founded
        FROM dim_team
        ORDER BY full_name
    """).fetchdf()
    return df.to_dict(orient="records")


@router.get("/compare")
def compare_teams(
    team_a: int = Query(..., description="First team's id"),
    team_b: int = Query(..., description="Second team's id"),
    season: str = Query(..., description='e.g. "2022-23"'),
    season_type: str = Query("Regular Season", pattern=_SEASON_TYPE_PATTERN),
    con: duckdb.DuckDBPyConnection = Depends(get_db),
):
    """
    Head-to-head 'scouting sheet' for two teams in the same season: record,
    four factors, advanced ratings, context stats, and home/away splits
    (from get_team_dashboard), shot-selection/ball-movement identity and
    opponent-zone weaknesses (from get_team_identity), and clutch record
    (from get_team_clutch) -- side by side. This is purely a fan-out to
    those three existing endpoints for each team; see their docstrings for
    methodology/accuracy notes on any individual field.
    """
    def _one(team_id):
        info = get_team(team_id, con=con)
        dashboard = get_team_dashboard(team_id, season=season, home_away="all", season_type=season_type, con=con)
        identity = get_team_identity(team_id, season=season, season_type=season_type, con=con)
        clutch = get_team_clutch(team_id, season=season, season_type=season_type, con=con)
        return {**info, "dashboard": dashboard, "identity": identity, "clutch": clutch}

    try:
        team_a_data = _one(team_a)
    except HTTPException as e:
        raise HTTPException(status_code=e.status_code, detail=f"team_a: {e.detail}")
    try:
        team_b_data = _one(team_b)
    except HTTPException as e:
        raise HTTPException(status_code=e.status_code, detail=f"team_b: {e.detail}")

    return {
        "season": season,
        "season_type": season_type,
        "team_a": team_a_data,
        "team_b": team_b_data,
    }


@router.get("/{team_id}")
def get_team(team_id: int, con: duckdb.DuckDBPyConnection = Depends(get_db)):
    df = con.execute("""
        SELECT id, full_name, abbreviation, nickname, city, state, year_founded
        FROM dim_team WHERE id = ?
    """, [team_id]).fetchdf()
    if df.empty:
        raise HTTPException(status_code=404, detail="Team not found")
    return df.to_dict(orient="records")[0]


@router.get("/{team_id}/seasons")
def get_team_seasons(team_id: int, con: duckdb.DuckDBPyConnection = Depends(get_db)):
    """Every season this team has a traditional-stats row for (regular season)."""
    df = con.execute("""
        SELECT DISTINCT SEASON FROM fact_team_traditional_rs WHERE TEAM_ID = ? ORDER BY SEASON
    """, [team_id]).fetchdf()
    if df.empty:
        raise HTTPException(status_code=404, detail="No seasons found for that team")
    return df["SEASON"].tolist()


@router.get("/{team_id}/stats")
def get_team_stats(
    team_id: int,
    season: Optional[str] = Query(None, description='e.g. "2023-24". Omit for all seasons.'),
    stat_type: str = Query("traditional", pattern="^(traditional|advanced)$"),
    season_segment: str = Query("rs", pattern="^(rs|po)$"),
    con: duckdb.DuckDBPyConnection = Depends(get_db),
):
    """
    Season-level team stats.
    stat_type: "traditional" (box score totals) or "advanced" (ratings/pace/PIE).
    season_segment: "rs" (regular season) or "po" (playoffs).
    """
    table = f"fact_team_{stat_type}_{season_segment}"
    where = "WHERE TEAM_ID = ?"
    params = [team_id]
    if season:
        where += " AND SEASON = ?"
        params.append(season)

    df = con.execute(f"SELECT * FROM {table} {where} ORDER BY SEASON", params).fetchdf()
    if df.empty:
        raise HTTPException(status_code=404, detail="No stats found for that team/season/type")
    return df.to_dict(orient="records")


@router.get("/{team_id}/games")
def get_team_games(
    team_id: int,
    season: str = Query(..., description='e.g. "2022-23" -- same format as /teams/{id}/seasons'),
    season_type: Optional[str] = Query(None, description='"Regular Season", "Playoffs", etc. Omit for all.'),
    con: duckdb.DuckDBPyConnection = Depends(get_db),
):
    """
    Every game this team played in a given season, for picking a specific
    game to drill into (see /lineups/game). dim_game.season_id encodes the
    season as <type digit><start year> (e.g. 22022 -> "2022-23"), so we
    derive the "YYYY-YY" string here to match the format used everywhere
    else in the API.
    """
    season_expr = """
        (CAST(season_id % 10000 AS VARCHAR) || '-' ||
         LPAD(CAST((season_id % 10000 + 1) % 100 AS VARCHAR), 2, '0'))
    """
    where = f"WHERE (team_id_home = ? OR team_id_away = ?) AND {season_expr} = ?"
    params = [team_id, team_id, season]
    if season_type:
        where += " AND season_type = ?"
        params.append(season_type)

    df = con.execute(f"""
        WITH base AS (
            SELECT g.game_id, g.game_date, g.season_type,
                   g.team_abbreviation_home, g.pts_home, g.team_abbreviation_away, g.pts_away,
                   CASE WHEN g.team_id_home = ? THEN g.wl_home ELSE g.wl_away END AS result_for_team,
                   CASE WHEN g.team_id_home = ? THEN g.team_abbreviation_away ELSE g.team_abbreviation_home END AS opponent,
                   CASE WHEN g.team_id_home = ? THEN true ELSE false END AS is_home,
                   -- this team's own box line, regardless of home/away side
                   CASE WHEN g.team_id_home = ? THEN g.pts_home ELSE g.pts_away END AS pts,
                   CASE WHEN g.team_id_home = ? THEN g.fgm_home ELSE g.fgm_away END AS fgm,
                   CASE WHEN g.team_id_home = ? THEN g.fga_home ELSE g.fga_away END AS fga,
                   CASE WHEN g.team_id_home = ? THEN g.fg3m_home ELSE g.fg3m_away END AS fg3m,
                   CASE WHEN g.team_id_home = ? THEN g.fg3a_home ELSE g.fg3a_away END AS fg3a,
                   CASE WHEN g.team_id_home = ? THEN g.ftm_home ELSE g.ftm_away END AS ftm,
                   CASE WHEN g.team_id_home = ? THEN g.fta_home ELSE g.fta_away END AS fta,
                   CASE WHEN g.team_id_home = ? THEN g.oreb_home ELSE g.oreb_away END AS oreb,
                   CASE WHEN g.team_id_home = ? THEN g.dreb_home ELSE g.dreb_away END AS dreb,
                   CASE WHEN g.team_id_home = ? THEN g.reb_home ELSE g.reb_away END AS reb,
                   CASE WHEN g.team_id_home = ? THEN g.ast_home ELSE g.ast_away END AS ast,
                   CASE WHEN g.team_id_home = ? THEN g.stl_home ELSE g.stl_away END AS stl,
                   CASE WHEN g.team_id_home = ? THEN g.blk_home ELSE g.blk_away END AS blk,
                   CASE WHEN g.team_id_home = ? THEN g.tov_home ELSE g.tov_away END AS tov,
                   CASE WHEN g.team_id_home = ? THEN g.pf_home ELSE g.pf_away END AS pf,
                   CASE WHEN g.team_id_home = ? THEN o.pts_paint_home ELSE o.pts_paint_away END AS pts_paint,
                   CASE WHEN g.team_id_home = ? THEN o.pts_2nd_chance_home ELSE o.pts_2nd_chance_away END AS pts_2nd_chance,
                   CASE WHEN g.team_id_home = ? THEN o.pts_fb_home ELSE o.pts_fb_away END AS pts_fb
            FROM dim_game g
            LEFT JOIN fact_other_stats o ON o.game_id = g.game_id
            {where.replace("team_id_home", "g.team_id_home").replace("team_id_away", "g.team_id_away")}
        )
        SELECT *,
               DATE_DIFF('day', LAG(game_date) OVER (ORDER BY game_date), game_date) AS rest_days,
               (DATE_DIFF('day', LAG(game_date) OVER (ORDER BY game_date), game_date) = 1) AS is_back_to_back
        FROM base
        ORDER BY game_date
    """, [team_id] * 21 + params).fetchdf()
    if df.empty:
        raise HTTPException(status_code=404, detail="No games found for that team/season")
    return df.to_dict(orient="records")


@router.get("/{team_id}/dashboard")
def get_team_dashboard(
    team_id: int,
    season: str = Query(..., description='e.g. "2023-24"'),
    home_away: str = Query("all", pattern="^(all|home|away)$"),
    season_type: str = Query("Regular Season", pattern=_SEASON_TYPE_PATTERN),
    con: duckdb.DuckDBPyConnection = Depends(get_db),
):
    """
    Executive-summary view for one team/season: record, four factors
    (own + opponent), advanced ratings/pace, home-vs-away split, and a
    last-10-games trend.

    home_away="all" (the default) reads record + four factors from the
    official season-aggregate table (fact_team_four_factors_rs), exactly
    as before. home_away="home"/"away" instead computes record and four
    factors live from dim_game's own home/away box-score columns, since
    NBA doesn't publish a home/away split of that aggregate. eFG% and FTA
    Rate reproduce the official formula exactly (verified against the
    all-games case); TOV% and OREB% use the standard Dean-Oliver
    approximations and can drift a couple points from stats.nba.com's own
    (undocumented) formula -- flagged via four_factors_estimated so the
    UI only shows that caveat when it actually applies. Context stats and
    the last-10 trend were already computed live from dim_game/
    fact_other_stats before this change, so they filter the same way for
    all three home_away values with no accuracy caveat.
    """
    adv_df = con.execute(f"""
        SELECT OFF_RATING, DEF_RATING, NET_RATING, PACE, TS_PCT, PIE
        FROM {_season_table("fact_team_advanced", season_type)} WHERE TEAM_ID = ? AND SEASON = ?
    """, [team_id, season]).fetchdf()
    advanced = adv_df.to_dict(orient="records")[0] if not adv_df.empty else None

    season_expr = """
        (CAST(season_id % 10000 AS VARCHAR) || '-' ||
         LPAD(CAST((season_id % 10000 + 1) % 100 AS VARCHAR), 2, '0'))
    """
    games_df = con.execute(f"""
        SELECT game_id, game_date,
               CASE WHEN team_id_home = ? THEN true ELSE false END AS is_home,
               CASE WHEN team_id_home = ? THEN wl_home ELSE wl_away END AS result,
               CASE WHEN team_id_home = ? THEN pts_home ELSE pts_away END AS pts_for,
               CASE WHEN team_id_home = ? THEN pts_away ELSE pts_home END AS pts_against,
               CASE WHEN team_id_home = ? THEN fgm_home ELSE fgm_away END AS fgm,
               CASE WHEN team_id_home = ? THEN fga_home ELSE fga_away END AS fga,
               CASE WHEN team_id_home = ? THEN fg3m_home ELSE fg3m_away END AS fg3m,
               CASE WHEN team_id_home = ? THEN fta_home ELSE fta_away END AS fta,
               CASE WHEN team_id_home = ? THEN tov_home ELSE tov_away END AS tov,
               CASE WHEN team_id_home = ? THEN oreb_home ELSE oreb_away END AS oreb,
               CASE WHEN team_id_home = ? THEN dreb_home ELSE dreb_away END AS dreb,
               CASE WHEN team_id_home = ? THEN fgm_away ELSE fgm_home END AS opp_fgm,
               CASE WHEN team_id_home = ? THEN fga_away ELSE fga_home END AS opp_fga,
               CASE WHEN team_id_home = ? THEN fg3m_away ELSE fg3m_home END AS opp_fg3m,
               CASE WHEN team_id_home = ? THEN fta_away ELSE fta_home END AS opp_fta,
               CASE WHEN team_id_home = ? THEN tov_away ELSE tov_home END AS opp_tov,
               CASE WHEN team_id_home = ? THEN oreb_away ELSE oreb_home END AS opp_oreb,
               CASE WHEN team_id_home = ? THEN dreb_away ELSE dreb_home END AS opp_dreb
        FROM dim_game
        WHERE (team_id_home = ? OR team_id_away = ?) AND {season_expr} = ? AND season_type = ?
        ORDER BY game_date
    """, [team_id] * 18 + [team_id, team_id, season, season_type]).fetchdf()
    if games_df.empty:
        raise HTTPException(status_code=404, detail="No games for that team/season")

    other_df = con.execute(f"""
        SELECT
            CASE WHEN g.team_id_home = ? THEN true ELSE false END AS is_home,
            CASE WHEN g.team_id_home = ? THEN o.pts_paint_home ELSE o.pts_paint_away END AS pts_paint,
            CASE WHEN g.team_id_home = ? THEN o.pts_2nd_chance_home ELSE o.pts_2nd_chance_away END AS pts_2nd_chance,
            CASE WHEN g.team_id_home = ? THEN o.pts_fb_home ELSE o.pts_fb_away END AS pts_fb,
            CASE WHEN g.team_id_home = ? THEN o.largest_lead_home ELSE o.largest_lead_away END AS largest_lead,
            CASE WHEN g.team_id_home = ? THEN o.pts_paint_away ELSE o.pts_paint_home END AS opp_pts_paint,
            CASE WHEN g.team_id_home = ? THEN o.pts_2nd_chance_away ELSE o.pts_2nd_chance_home END AS opp_pts_2nd_chance,
            CASE WHEN g.team_id_home = ? THEN o.pts_fb_away ELSE o.pts_fb_home END AS opp_pts_fb
        FROM dim_game g
        JOIN fact_other_stats o ON o.game_id = g.game_id
        WHERE (g.team_id_home = ? OR g.team_id_away = ?) AND {season_expr} = ? AND g.season_type = ?
    """, [team_id] * 8 + [team_id, team_id, season, season_type]).fetchdf()

    # Unfiltered home/away split -- always shown as a reference card
    # regardless of the active home_away filter below.
    games_df["margin"] = games_df["pts_for"] - games_df["pts_against"]
    home_away_split = {}
    for label, sub in games_df.groupby("is_home"):
        key = "home" if label else "away"
        home_away_split[key] = {
            "gp": len(sub),
            "w": int((sub["result"] == "W").sum()),
            "l": int((sub["result"] == "L").sum()),
            "avg_margin": round(float(sub["margin"].mean()), 1),
        }

    # Apply the active filter to the game-level views below.
    filtered_games = games_df
    filtered_other = other_df
    if home_away == "home":
        filtered_games = games_df[games_df["is_home"]]
        if not other_df.empty:
            filtered_other = other_df[other_df["is_home"]]
    elif home_away == "away":
        filtered_games = games_df[~games_df["is_home"]]
        if not other_df.empty:
            filtered_other = other_df[~other_df["is_home"]]
    if filtered_games.empty:
        raise HTTPException(status_code=404, detail="No games for that team/season/home_away filter")

    four_factors_estimated = home_away != "all"
    if home_away == "all":
        ff_df = con.execute(f"""
            SELECT GP, W, L, W_PCT, EFG_PCT, FTA_RATE, TM_TOV_PCT, OREB_PCT,
                   OPP_EFG_PCT, OPP_FTA_RATE, OPP_TOV_PCT, OPP_OREB_PCT
            FROM {_season_table("fact_team_four_factors", season_type)} WHERE TEAM_ID = ? AND SEASON = ?
        """, [team_id, season]).fetchdf()
        if ff_df.empty:
            raise HTTPException(status_code=404, detail="No four-factors data for that team/season")
        ff = ff_df.to_dict(orient="records")[0]
        record = {"gp": ff["GP"], "w": ff["W"], "l": ff["L"], "w_pct": ff["W_PCT"]}
        four_factors = {
            "team": {
                "efg_pct": ff["EFG_PCT"], "tov_pct": ff["TM_TOV_PCT"],
                "oreb_pct": ff["OREB_PCT"], "fta_rate": ff["FTA_RATE"],
            },
            "opponent": {
                "efg_pct": ff["OPP_EFG_PCT"], "tov_pct": ff["OPP_TOV_PCT"],
                "oreb_pct": ff["OPP_OREB_PCT"], "fta_rate": ff["OPP_FTA_RATE"],
            },
        }
    else:
        def _sum(col):
            return float(filtered_games[col].sum())

        gp = len(filtered_games)
        w = int((filtered_games["result"] == "W").sum())
        record = {"gp": gp, "w": w, "l": gp - w, "w_pct": round(w / gp, 3) if gp else None}

        def _factors(fgm, fga, fg3m, fta, tov, oreb, opp_dreb):
            efg = (fgm + 0.5 * fg3m) / fga if fga else None
            denom = fga + 0.44 * fta + tov
            tov_pct = tov / denom if denom else None
            oreb_pct = oreb / (oreb + opp_dreb) if (oreb + opp_dreb) else None
            fta_rate = fta / fga if fga else None
            return efg, tov_pct, oreb_pct, fta_rate

        team_efg, team_tov_pct, team_oreb_pct, team_fta_rate = _factors(
            _sum("fgm"), _sum("fga"), _sum("fg3m"), _sum("fta"), _sum("tov"), _sum("oreb"), _sum("opp_dreb")
        )
        opp_efg, opp_tov_pct, opp_oreb_pct, opp_fta_rate = _factors(
            _sum("opp_fgm"), _sum("opp_fga"), _sum("opp_fg3m"), _sum("opp_fta"), _sum("opp_tov"), _sum("opp_oreb"), _sum("dreb")
        )
        four_factors = {
            "team": {
                "efg_pct": round(team_efg, 3) if team_efg is not None else None,
                "tov_pct": round(team_tov_pct, 3) if team_tov_pct is not None else None,
                "oreb_pct": round(team_oreb_pct, 3) if team_oreb_pct is not None else None,
                "fta_rate": round(team_fta_rate, 3) if team_fta_rate is not None else None,
            },
            "opponent": {
                "efg_pct": round(opp_efg, 3) if opp_efg is not None else None,
                "tov_pct": round(opp_tov_pct, 3) if opp_tov_pct is not None else None,
                "oreb_pct": round(opp_oreb_pct, 3) if opp_oreb_pct is not None else None,
                "fta_rate": round(opp_fta_rate, 3) if opp_fta_rate is not None else None,
            },
        }

    context_stats = None
    if not filtered_other.empty:
        context_stats = {
            "gp": len(filtered_other),
            "pts_paint": round(float(filtered_other["pts_paint"].mean()), 1),
            "pts_2nd_chance": round(float(filtered_other["pts_2nd_chance"].mean()), 1),
            "pts_fb": round(float(filtered_other["pts_fb"].mean()), 1),
            "largest_lead": round(float(filtered_other["largest_lead"].mean()), 1),
            "opp_pts_paint": round(float(filtered_other["opp_pts_paint"].mean()), 1),
            "opp_pts_2nd_chance": round(float(filtered_other["opp_pts_2nd_chance"].mean()), 1),
            "opp_pts_fb": round(float(filtered_other["opp_pts_fb"].mean()), 1),
        }

    tail = filtered_games.tail(10)
    last10 = {
        "w": int((tail["result"] == "W").sum()),
        "l": int((tail["result"] == "L").sum()),
        "avg_margin": round(float(tail["margin"].mean()), 1) if len(tail) else None,
        "games": [
            {"game_id": r["game_id"], "game_date": str(r["game_date"]), "result": r["result"], "margin": r["margin"]}
            for r in tail.to_dict(orient="records")
        ],
    }

    return {
        "team_id": team_id,
        "season": season,
        "season_type": season_type,
        "home_away_filter": home_away,
        "record": record,
        "four_factors": four_factors,
        "four_factors_estimated": four_factors_estimated,
        "advanced": advanced,
        "context_stats": context_stats,
        "home_away": home_away_split,
        "last10": last10,
    }


@router.get("/{team_id}/player-stretch")
def get_player_stretch(
    team_id: int,
    game_ids: str = Query(..., description="Comma-separated game_ids, e.g. the games in a Last 10 stretch"),
    con: duckdb.DuckDBPyConnection = Depends(get_db),
):
    """
    Per-player averages for this team over an exact set of games -- the
    "who's hot right now" view for a Game Log stretch (Last 5/10/20, or a
    custom range). Built from fact_player_boxscore_game, a per-player
    per-game box score derived from play-by-play (see
    derive_player_boxscore.py) since the warehouse only otherwise has
    season-long player aggregates. Shooting splits come from
    fact_shot_chart over the same games. Also returns each player's
    season averages (from fact_team_games -> fact_player_traditional_rs)
    so the frontend can flag who's running hot or cold vs. their own
    baseline.
    """
    ids = [g.strip() for g in game_ids.split(",") if g.strip()]
    if not ids:
        raise HTTPException(status_code=400, detail="game_ids must contain at least one game_id")

    id_placeholders = ", ".join("?" for _ in ids)

    box = con.execute(f"""
        SELECT player_id,
               COUNT(*) AS gp,
               ROUND(AVG(pts), 1) AS pts,
               ROUND(AVG(reb), 1) AS reb,
               ROUND(AVG(ast), 1) AS ast,
               ROUND(AVG(stl), 1) AS stl,
               ROUND(AVG(blk), 1) AS blk,
               ROUND(AVG(tov), 1) AS tov,
               ROUND(AVG(pf), 1) AS pf
        FROM fact_player_boxscore_game
        WHERE team_id = ? AND game_id IN ({id_placeholders})
        GROUP BY player_id
    """, [team_id] + ids).fetchdf()
    if box.empty:
        raise HTTPException(status_code=404, detail="No derived box-score data for that team/games")

    shooting = con.execute(f"""
        SELECT PLAYER_ID AS player_id,
               COUNT(*) AS fga,
               SUM(CASE WHEN SHOT_MADE THEN 1 ELSE 0 END) AS fgm,
               SUM(CASE WHEN SHOT_TYPE = '3PT Field Goal' THEN 1 ELSE 0 END) AS fg3a,
               SUM(CASE WHEN SHOT_TYPE = '3PT Field Goal' AND SHOT_MADE THEN 1 ELSE 0 END) AS fg3m
        FROM fact_shot_chart
        WHERE TEAM_ID = ? AND CAST(GAME_ID AS VARCHAR) IN ({id_placeholders})
        GROUP BY PLAYER_ID
    """, [team_id] + [str(int(i)) for i in ids]).fetchdf()

    names = con.execute("""
        SELECT id, full_name FROM dim_player WHERE id IN (SELECT player_id FROM fact_player_boxscore_game WHERE team_id = ?)
    """, [team_id]).fetchdf()
    id_to_name = dict(zip(names["id"], names["full_name"]))

    merged = box.merge(shooting, on="player_id", how="left")
    records = merged.to_dict(orient="records")
    for r in records:
        r["player_name"] = id_to_name.get(r["player_id"], f"#{r['player_id']}")
        fga, fgm = r.get("fga") or 0, r.get("fgm") or 0
        fg3a, fg3m = r.get("fg3a") or 0, r.get("fg3m") or 0
        r["fg_pct"] = round(100.0 * fgm / fga, 1) if fga else None
        r["fg3_pct"] = round(100.0 * fg3m / fg3a, 1) if fg3a else None

    records.sort(key=lambda r: r["pts"], reverse=True)
    return records


@router.get("/{team_id}/roster")
def get_team_roster(
    team_id: int,
    season: str = Query(..., description='e.g. "2023-24"'),
    season_type: str = Query("Regular Season", pattern=_SEASON_TYPE_PATTERN),
    con: duckdb.DuckDBPyConnection = Depends(get_db),
):
    """
    Season-long per-game averages for every player who suited up for this
    team that season, from fact_player_traditional_rs/_po (already
    per-game averages, not totals). A player traded mid-season only shows
    the stint with this TEAM_ID -- their stats elsewhere aren't blended in.
    """
    table = _season_table("fact_player_traditional", season_type)
    df = con.execute(f"""
        SELECT PLAYER_ID, PLAYER_NAME, AGE, GP, MIN, PTS, REB, AST, STL, BLK, TOV,
               FG_PCT, FG3M, FG3A, FG3_PCT, FTM, FTA, FT_PCT, PLUS_MINUS
        FROM {table}
        WHERE TEAM_ID = ? AND SEASON = ?
        ORDER BY MIN DESC
    """, [team_id, season]).fetchdf()
    if df.empty:
        raise HTTPException(status_code=404, detail="No roster stats found for that team/season/season_type")
    return df.to_dict(orient="records")


@router.get("/{team_id}/teammate-impact")
def get_teammate_impact(
    team_id: int,
    player_id: int = Query(..., description="The player whose stats you want to see (Player A)"),
    teammate_id: int = Query(..., description="The teammate whose presence/absence splits the games (Player B)"),
    seasons: Optional[str] = Query(None, description='Comma-separated "YYYY-YY" seasons to restrict to. Omit for every season both were teammates.'),
    con: duckdb.DuckDBPyConnection = Depends(get_db),
):
    """
    How does player A's production change in games a given teammate (B)
    missed entirely, vs. games B played in? Built for the "who picks up
    the slack when X is out" question -- shot volume/zone shifts are
    often the clearest signal of a usage bump.

    "Missed" means B never checked into a lineup stint for this team that
    game (fact_lineup_stints) -- this covers injury, rest, and a healthy
    DNP alike, since the warehouse has no injury-designation data to tell
    them apart. Only games where player A themselves appear in
    fact_player_boxscore_game count toward either split (a game A also
    missed contributes to neither side).
    """
    if player_id == teammate_id:
        raise HTTPException(status_code=400, detail="player_id and teammate_id must be different players")

    season_clause = ""
    season_params = []
    if seasons:
        season_list = [s.strip() for s in seasons.split(",") if s.strip()]
        if season_list:
            season_expr = """
                (CAST(g.season_id % 10000 AS VARCHAR) || '-' ||
                 LPAD(CAST((g.season_id % 10000 + 1) % 100 AS VARCHAR), 2, '0'))
            """
            placeholders = ", ".join("?" for _ in season_list)
            season_clause = f"AND {season_expr} IN ({placeholders})"
            season_params = season_list

    # Every game this team played (respecting the season filter), tagged
    # with whether the teammate appeared in any lineup stint that game.
    games_df = con.execute(f"""
        WITH team_games AS (
            SELECT g.game_id
            FROM dim_game g
            WHERE (g.team_id_home = ? OR g.team_id_away = ?)
              AND g.season_type = 'Regular Season'
              {season_clause}
        ),
        teammate_on AS (
            SELECT DISTINCT game_id
            FROM fact_lineup_stints
            WHERE team_id = ?
              AND list_contains(string_split(lineup, '|'), CAST(? AS VARCHAR))
        )
        SELECT tg.game_id, (t.game_id IS NOT NULL) AS teammate_played
        FROM team_games tg
        LEFT JOIN teammate_on t ON t.game_id = tg.game_id
    """, [team_id, team_id] + season_params + [team_id, teammate_id]).fetchdf()

    if games_df.empty:
        raise HTTPException(status_code=404, detail="No games found for that team/season filter")

    with_ids = games_df.loc[games_df["teammate_played"], "game_id"].astype(str).tolist()
    without_ids = games_df.loc[~games_df["teammate_played"], "game_id"].astype(str).tolist()

    def _split_summary(game_ids):
        if not game_ids:
            return None
        ph = ", ".join("?" for _ in game_ids)
        box_df = con.execute(f"""
            SELECT COUNT(*) AS gp, ROUND(AVG(pts), 1) AS pts, ROUND(AVG(reb), 1) AS reb,
                   ROUND(AVG(ast), 1) AS ast, ROUND(AVG(stl), 1) AS stl, ROUND(AVG(blk), 1) AS blk,
                   ROUND(AVG(tov), 1) AS tov, ROUND(AVG(pf), 1) AS pf
            FROM fact_player_boxscore_game
            WHERE player_id = ? AND team_id = ? AND game_id IN ({ph})
        """, [player_id, team_id] + game_ids).fetchdf()
        if box_df.empty or box_df["gp"].iloc[0] == 0:
            return None
        row = box_df.to_dict(orient="records")[0]

        bigint_ph = ", ".join("CAST(? AS BIGINT)" for _ in game_ids)
        shoot_df = con.execute(f"""
            SELECT COUNT(*) AS fga,
                   SUM(CASE WHEN SHOT_MADE THEN 1 ELSE 0 END) AS fgm,
                   SUM(CASE WHEN SHOT_TYPE = '3PT Field Goal' THEN 1 ELSE 0 END) AS fg3a,
                   SUM(CASE WHEN SHOT_TYPE = '3PT Field Goal' AND SHOT_MADE THEN 1 ELSE 0 END) AS fg3m
            FROM fact_shot_chart
            WHERE PLAYER_ID = ? AND TEAM_ID = ? AND GAME_ID IN ({bigint_ph})
        """, [player_id, team_id] + game_ids).fetchdf()
        shoot = shoot_df.to_dict(orient="records")[0]

        zones = con.execute(f"""
            SELECT {_SEVEN_ZONE_CASE} AS zone, COUNT(*) AS attempts,
                   SUM(CASE WHEN SHOT_MADE THEN 1 ELSE 0 END) AS makes,
                   ROUND(100.0 * SUM(CASE WHEN SHOT_MADE THEN 1 ELSE 0 END) / COUNT(*), 1) AS fg_pct
            FROM fact_shot_chart
            WHERE PLAYER_ID = ? AND TEAM_ID = ? AND GAME_ID IN ({bigint_ph})
            GROUP BY zone
            HAVING zone IS NOT NULL
            ORDER BY attempts DESC
        """, [player_id, team_id] + game_ids).fetchdf().to_dict(orient="records")

        fga, fgm = shoot.get("fga") or 0, shoot.get("fgm") or 0
        fg3a, fg3m = shoot.get("fg3a") or 0, shoot.get("fg3m") or 0
        gp = row["gp"]
        return {
            "gp": gp, "pts": row["pts"], "reb": row["reb"], "ast": row["ast"], "stl": row["stl"],
            "blk": row["blk"], "tov": row["tov"], "pf": row["pf"],
            "fga_per_game": round(fga / gp, 1) if gp else None,
            "fg_pct": round(100.0 * fgm / fga, 1) if fga else None,
            "fg3a_per_game": round(fg3a / gp, 1) if gp else None,
            "fg3_pct": round(100.0 * fg3m / fg3a, 1) if fg3a else None,
            "zones": zones,
        }

    with_summary = _split_summary(with_ids)
    without_summary = _split_summary(without_ids)
    if with_summary is None and without_summary is None:
        raise HTTPException(status_code=404, detail="No games found where player_id appeared, in either split")

    names = con.execute("SELECT id, full_name FROM dim_player WHERE id IN (?, ?)", [player_id, teammate_id]).fetchdf()
    name_map = dict(zip(names["id"], names["full_name"]))

    return {
        "team_id": team_id,
        "player_id": player_id,
        "player_name": name_map.get(player_id, f"#{player_id}"),
        "teammate_id": teammate_id,
        "teammate_name": name_map.get(teammate_id, f"#{teammate_id}"),
        "with_teammate": with_summary,
        "without_teammate": without_summary,
        # Exact game_id lists for each split, so the frontend can pull a
        # dot-level shot chart (via /shots?game_ids=...) on top of the
        # zone-aggregate summary already included above.
        "with_teammate_game_ids": with_ids,
        "without_teammate_game_ids": without_ids,
    }


@router.get("/{team_id}/quarter-trends")
def get_quarter_trends(
    team_id: int,
    season: str = Query(..., description='e.g. "2023-24"'),
    home_away: str = Query("all", pattern="^(all|home|away)$"),
    season_type: str = Query("Regular Season", pattern=_SEASON_TYPE_PATTERN),
    con: duckdb.DuckDBPyConnection = Depends(get_db),
):
    """
    Average points scored per quarter (team vs. opponent), plus overtime
    collapsed into one bucket, across a season -- shows whether a team is a
    slow starter, fades in the 4th, or the reverse. From fact_line_score,
    joined to dim_game only for the season/season_type filter (fact_line_score
    already carries its own team_id_home/team_id_away and per-quarter columns).
    """
    season_expr = """
        (CAST(g.season_id % 10000 AS VARCHAR) || '-' ||
         LPAD(CAST((g.season_id % 10000 + 1) % 100 AS VARCHAR), 2, '0'))
    """
    df = con.execute(f"""
        SELECT
            CASE WHEN fl.team_id_home = ? THEN true ELSE false END AS is_home,
            CASE WHEN fl.team_id_home = ? THEN fl.pts_qtr1_home ELSE fl.pts_qtr1_away END AS q1,
            CASE WHEN fl.team_id_home = ? THEN fl.pts_qtr2_home ELSE fl.pts_qtr2_away END AS q2,
            CASE WHEN fl.team_id_home = ? THEN fl.pts_qtr3_home ELSE fl.pts_qtr3_away END AS q3,
            CASE WHEN fl.team_id_home = ? THEN fl.pts_qtr4_home ELSE fl.pts_qtr4_away END AS q4,
            CASE WHEN fl.team_id_home = ? THEN
                COALESCE(fl.pts_ot1_home,0)+COALESCE(fl.pts_ot2_home,0)+COALESCE(fl.pts_ot3_home,0)+COALESCE(fl.pts_ot4_home,0)+COALESCE(fl.pts_ot5_home,0)
            ELSE
                COALESCE(fl.pts_ot1_away,0)+COALESCE(fl.pts_ot2_away,0)+COALESCE(fl.pts_ot3_away,0)+COALESCE(fl.pts_ot4_away,0)+COALESCE(fl.pts_ot5_away,0)
            END AS ot,
            CASE WHEN fl.team_id_home = ? THEN fl.pts_qtr1_away ELSE fl.pts_qtr1_home END AS opp_q1,
            CASE WHEN fl.team_id_home = ? THEN fl.pts_qtr2_away ELSE fl.pts_qtr2_home END AS opp_q2,
            CASE WHEN fl.team_id_home = ? THEN fl.pts_qtr3_away ELSE fl.pts_qtr3_home END AS opp_q3,
            CASE WHEN fl.team_id_home = ? THEN fl.pts_qtr4_away ELSE fl.pts_qtr4_home END AS opp_q4,
            CASE WHEN fl.team_id_home = ? THEN
                COALESCE(fl.pts_ot1_away,0)+COALESCE(fl.pts_ot2_away,0)+COALESCE(fl.pts_ot3_away,0)+COALESCE(fl.pts_ot4_away,0)+COALESCE(fl.pts_ot5_away,0)
            ELSE
                COALESCE(fl.pts_ot1_home,0)+COALESCE(fl.pts_ot2_home,0)+COALESCE(fl.pts_ot3_home,0)+COALESCE(fl.pts_ot4_home,0)+COALESCE(fl.pts_ot5_home,0)
            END AS opp_ot
        FROM fact_line_score fl
        JOIN dim_game g ON g.game_id = fl.game_id
        WHERE (fl.team_id_home = ? OR fl.team_id_away = ?) AND g.season_type = ? AND {season_expr} = ?
    """, [team_id] * 13 + [season_type, season]).fetchdf()

    if df.empty:
        raise HTTPException(status_code=404, detail="No quarter-score data for that team/season")

    if home_away == "home":
        df = df[df["is_home"]]
    elif home_away == "away":
        df = df[~df["is_home"]]
    if df.empty:
        raise HTTPException(status_code=404, detail="No quarter-score data for that team/season/home_away filter")

    def avg(col):
        return round(float(df[col].mean()), 1)

    return {
        "team_id": team_id,
        "season": season,
        "season_type": season_type,
        "home_away_filter": home_away,
        "gp": len(df),
        "team": {"q1": avg("q1"), "q2": avg("q2"), "q3": avg("q3"), "q4": avg("q4"), "ot": avg("ot")},
        "opponent": {"q1": avg("opp_q1"), "q2": avg("opp_q2"), "q3": avg("opp_q3"), "q4": avg("opp_q4"), "ot": avg("opp_ot")},
    }


@router.get("/{team_id}/identity")
def get_team_identity(
    team_id: int,
    season: str = Query(..., description='e.g. "2023-24"'),
    season_type: str = Query("Regular Season", pattern=_SEASON_TYPE_PATTERN),
    con: duckdb.DuckDBPyConnection = Depends(get_db),
):
    """
    Team style/identity for a scouting-style page: shot-selection and
    ball-movement mix (fact_team_scoring_rs/_po), opponent zone efficiency
    allowed vs. league average (fact_shot_chart, since fact_team_defense_rs
    only has overall shooting splits, not zone-level), and close-game
    record (final margin of 5 points or fewer, computed live from dim_game).

    NOTE: fact_shot_chart has no season_type column of its own, so the
    opponent zone efficiency section always reflects that season's shots
    regardless of the season_type filter -- only the style mix and
    close-game record actually change between Regular Season and Playoffs.
    """
    style_table = _season_table("fact_team_scoring", season_type)
    style_df = con.execute(f"""
        SELECT PCT_PTS_PAINT, PCT_PTS_2PT_MR, PCT_PTS_3PT, PCT_PTS_FB, PCT_PTS_FT, PCT_PTS_OFF_TOV,
               PCT_AST_FGM, PCT_UAST_FGM, PCT_FGA_2PT, PCT_FGA_3PT
        FROM {style_table} WHERE TEAM_ID = ? AND SEASON = ?
    """, [team_id, season]).fetchdf()
    style = style_df.to_dict(orient="records")[0] if not style_df.empty else None

    abbr_df = con.execute("SELECT abbreviation FROM dim_team WHERE id = ?", [team_id]).fetchdf()
    abbr = abbr_df["abbreviation"].iloc[0] if not abbr_df.empty else None

    opp_zones_df = con.execute(f"""
        SELECT {_SEVEN_ZONE_CASE} AS zone,
               COUNT(*) AS attempts,
               SUM(CASE WHEN SHOT_MADE THEN 1 ELSE 0 END) AS makes,
               ROUND(100.0 * SUM(CASE WHEN SHOT_MADE THEN 1 ELSE 0 END) / COUNT(*), 1) AS fg_pct
        FROM fact_shot_chart
        WHERE SEASON_2 = ? AND TEAM_ID != ? AND (HOME_TEAM = ? OR AWAY_TEAM = ?)
        GROUP BY zone
        HAVING zone IS NOT NULL
        ORDER BY attempts DESC
    """, [season, team_id, abbr, abbr]).fetchdf()

    league_zones_df = con.execute(f"""
        SELECT {_SEVEN_ZONE_CASE} AS zone,
               ROUND(100.0 * SUM(CASE WHEN SHOT_MADE THEN 1 ELSE 0 END) / COUNT(*), 1) AS league_fg_pct
        FROM fact_shot_chart
        WHERE SEASON_2 = ?
        GROUP BY zone
        HAVING zone IS NOT NULL
    """, [season]).fetchdf()
    league_map = dict(zip(league_zones_df["zone"], league_zones_df["league_fg_pct"]))

    opp_zone_records = opp_zones_df.to_dict(orient="records")
    for r in opp_zone_records:
        lg = league_map.get(r["zone"])
        r["league_fg_pct"] = lg
        r["diff_vs_league"] = round(r["fg_pct"] - lg, 1) if lg is not None else None

    # Weaknesses: zones (min 20 opponent attempts for sample size) where
    # opponents shoot ABOVE the league average against this team, worst
    # (biggest positive diff) first.
    weaknesses = sorted(
        [r for r in opp_zone_records if r["diff_vs_league"] is not None and r["attempts"] >= 20],
        key=lambda r: -r["diff_vs_league"],
    )[:3]

    season_expr = """
        (CAST(season_id % 10000 AS VARCHAR) || '-' ||
         LPAD(CAST((season_id % 10000 + 1) % 100 AS VARCHAR), 2, '0'))
    """
    games_df = con.execute(f"""
        SELECT
            CASE WHEN team_id_home = ? THEN pts_home - pts_away ELSE pts_away - pts_home END AS margin,
            CASE WHEN team_id_home = ? THEN wl_home ELSE wl_away END AS result
        FROM dim_game
        WHERE (team_id_home = ? OR team_id_away = ?) AND {season_expr} = ? AND season_type = ?
    """, [team_id, team_id, team_id, team_id, season, season_type]).fetchdf()
    close_record = {"gp": 0, "w": 0, "l": 0}
    if not games_df.empty:
        close = games_df[games_df["margin"].abs() <= 5]
        close_record = {
            "gp": len(close),
            "w": int((close["result"] == "W").sum()),
            "l": int((close["result"] == "L").sum()),
        }

    return {
        "team_id": team_id,
        "season": season,
        "season_type": season_type,
        "style": style,
        "opponent_zone_efficiency": opp_zone_records,
        "zone_data_note": "Opponent zone data isn't split by season_type -- see docstring.",
        "weaknesses": weaknesses,
        "close_game_record": close_record,
    }


@router.get("/{team_id}/win-shares")
def get_team_win_shares(
    team_id: int,
    season: str = Query(..., description='e.g. "2022-23"'),
    season_type: str = Query("Regular Season", pattern=_SEASON_TYPE_PATTERN),
    con: duckdb.DuckDBPyConnection = Depends(get_db),
):
    """
    A from-scratch "Estimated Win Shares" allocation: each player's share
    of the team's win total, apportioned by their share of a simple
    linear-weights production score built from season box-score averages.

    This is NOT the NBA stats API's own "DEF_WS" field (see
    /players/{id}/advanced) and NOT Basketball-Reference's published Win
    Shares -- both use methodology this project doesn't have access to
    (BR's, in particular, relies on play-by-play-derived offensive/
    defensive "possessions" estimates and marginal points formulas that
    aren't reproducible from this warehouse alone). This is a simpler,
    fully transparent stand-in, calibrated only by construction to sum to
    the team's actual win total for the season -- useful for a relative
    "who mattered most to this team's wins" ranking, not for comparison
    to published Win Shares figures from other sources.

    Production score (per game, then scaled by GP to a season total):
        PROD = PTS + 0.7*REB + 0.7*AST + STL + BLK
               - 0.7*(FGA-FGM) - 0.4*(FTA-FTM) - TOV
    This is a common "value over missed opportunity" linear-weights style
    (rewards makes/board/playmaking/defense, penalizes empty possessions
    and turnovers), similar in spirit to older box-score-only win-share
    approximations. Any player with a season PROD total at or below zero
    is floored to zero for allocation purposes (can't hold a negative
    share of team wins) -- if that happens, estimated shares will sum to
    slightly less than the team's actual win total; that shortfall is
    reported explicitly rather than silently rescaled away.
    """
    cache_key = (team_id, season, season_type)
    if cache_key in _WIN_SHARES_CACHE:
        return _WIN_SHARES_CACHE[cache_key]

    season_expr = """
        (CAST(season_id % 10000 AS VARCHAR) || '-' ||
         LPAD(CAST((season_id % 10000 + 1) % 100 AS VARCHAR), 2, '0'))
    """
    games_df = con.execute(f"""
        SELECT CASE WHEN team_id_home = ? THEN wl_home ELSE wl_away END AS result
        FROM dim_game
        WHERE (team_id_home = ? OR team_id_away = ?) AND {season_expr} = ? AND season_type = ?
    """, [team_id, team_id, team_id, season, season_type]).fetchdf()
    if games_df.empty:
        raise HTTPException(status_code=404, detail="No games found for that team/season/season_type")
    team_wins = int((games_df["result"] == "W").sum())
    team_losses = int((games_df["result"] == "L").sum())

    roster_table = _season_table("fact_player_traditional", season_type)
    roster_df = con.execute(f"""
        SELECT PLAYER_ID, PLAYER_NAME, GP, MIN,
               PTS, REB, AST, STL, BLK, TOV, FGA, FGM, FTA, FTM
        FROM {roster_table}
        WHERE TEAM_ID = ? AND SEASON = ?
    """, [team_id, season]).fetchdf()
    if roster_df.empty:
        raise HTTPException(status_code=404, detail="No player stats found for that team/season/season_type")

    roster_df["prod_per_game"] = (
        roster_df["PTS"] + 0.7 * roster_df["REB"] + 0.7 * roster_df["AST"]
        + roster_df["STL"] + roster_df["BLK"]
        - 0.7 * (roster_df["FGA"] - roster_df["FGM"])
        - 0.4 * (roster_df["FTA"] - roster_df["FTM"])
        - roster_df["TOV"]
    )
    roster_df["prod_season_total"] = roster_df["prod_per_game"] * roster_df["GP"]
    roster_df["prod_clipped"] = roster_df["prod_season_total"].clip(lower=0)
    team_total_prod = roster_df["prod_clipped"].sum()

    players = []
    for _, r in roster_df.sort_values("prod_clipped", ascending=False).iterrows():
        share = (r["prod_clipped"] / team_total_prod) if team_total_prod else 0.0
        players.append({
            "player_id": int(r["PLAYER_ID"]),
            "player_name": r["PLAYER_NAME"],
            "gp": int(r["GP"]),
            "min_per_game": round(float(r["MIN"]), 1) if r["MIN"] is not None else None,
            "pts_per_game": round(float(r["PTS"]), 1),
            "reb_per_game": round(float(r["REB"]), 1),
            "ast_per_game": round(float(r["AST"]), 1),
            "prod_score_season_total": round(float(r["prod_season_total"]), 1),
            "prod_share_of_team": round(float(share), 4),
            "est_win_shares": round(float(team_wins * share), 2),
        })

    allocated_total = round(sum(p["est_win_shares"] for p in players), 1)

    result = {
        "team_id": team_id,
        "season": season,
        "season_type": season_type,
        "team_wins": team_wins,
        "team_losses": team_losses,
        "allocated_win_shares_total": allocated_total,
        "allocation_shortfall": round(team_wins - allocated_total, 1),
        "methodology": (
            "Self-built linear-weights production score (PTS + 0.7*REB + 0.7*AST + STL + BLK "
            "- 0.7*(FGA-FGM) - 0.4*(FTA-FTM) - TOV), allocated proportionally against team wins. "
            "Not the NBA stats API's DEF_WS field and not Basketball-Reference Win Shares -- "
            "see docstring / player advanced endpoint for why those aren't directly reproducible here."
        ),
        "players": players,
    }
    _WIN_SHARES_CACHE[cache_key] = result
    return result


@router.get("/{team_id}/clutch")
def get_team_clutch(
    team_id: int,
    season: str = Query(..., description='e.g. "2022-23"'),
    season_type: str = Query("Regular Season", description='"Regular Season" or "Playoffs"'),
    con: duckdb.DuckDBPyConnection = Depends(get_db),
):
    """
    Team-level clutch identity: record and average scoring margin during
    clutch windows (period >= 4, <=5:00 left, score within 5) across the
    season, built from fact_player_boxscore_clutch (see
    derive_player_boxscore_clutch.py) aggregated up to the team level per
    game. A game only counts here if fact_player_boxscore_clutch has at
    least one credited event for either team in it -- in practice this
    means the game actually reached a genuine clutch situation (with a
    full 5-minute window at 5-points-or-fewer, essentially every close
    game has at least one scored point in that span, so this is a solid
    proxy for "clutch games played," not an exact accounting).
    """
    season_expr = """
        (CAST(season_id % 10000 AS VARCHAR) || '-' ||
         LPAD(CAST((season_id % 10000 + 1) % 100 AS VARCHAR), 2, '0'))
    """
    games_df = con.execute(f"""
        SELECT game_id, team_id_home, team_id_away
        FROM dim_game
        WHERE (team_id_home = ? OR team_id_away = ?) AND {season_expr} = ? AND season_type = ?
    """, [team_id, team_id, season, season_type]).fetchdf()
    if games_df.empty:
        raise HTTPException(status_code=404, detail="No games found for that team/season/season_type")

    clutch_df = con.execute("""
        SELECT game_id, team_id, SUM(pts) AS clutch_pts
        FROM fact_player_boxscore_clutch
        WHERE game_id IN (SELECT game_id FROM (SELECT UNNEST(?) AS game_id))
        GROUP BY game_id, team_id
    """, [games_df["game_id"].tolist()]).fetchdf()

    if clutch_df.empty:
        return {
            "team_id": team_id, "season": season, "season_type": season_type,
            "clutch_games": 0, "clutch_record": "0-0-0",
            "clutch_wins": 0, "clutch_losses": 0, "clutch_ties": 0,
            "avg_clutch_margin": None,
            "clutch_definition": "Period >= 4 (Q4/OT), <=5:00 left, score within 5 points",
        }

    clutch_pivot = clutch_df.pivot(index="game_id", columns="team_id", values="clutch_pts").fillna(0)

    rows = []
    for _, g in games_df.iterrows():
        gid = g["game_id"]
        if gid not in clutch_pivot.index:
            continue
        opp_id = g["team_id_away"] if g["team_id_home"] == team_id else g["team_id_home"]
        team_pts = clutch_pivot.loc[gid].get(team_id, 0.0)
        opp_pts = clutch_pivot.loc[gid].get(opp_id, 0.0)
        rows.append(team_pts - opp_pts)

    if not rows:
        return {
            "team_id": team_id, "season": season, "season_type": season_type,
            "clutch_games": 0, "clutch_record": "0-0-0",
            "clutch_wins": 0, "clutch_losses": 0, "clutch_ties": 0,
            "avg_clutch_margin": None,
            "clutch_definition": "Period >= 4 (Q4/OT), <=5:00 left, score within 5 points",
        }

    wins = sum(1 for m in rows if m > 0)
    losses = sum(1 for m in rows if m < 0)
    ties = sum(1 for m in rows if m == 0)

    return {
        "team_id": team_id,
        "season": season,
        "season_type": season_type,
        "clutch_games": len(rows),
        "clutch_record": f"{wins}-{losses}-{ties}",
        "clutch_wins": wins,
        "clutch_losses": losses,
        "clutch_ties": ties,
        "avg_clutch_margin": round(sum(rows) / len(rows), 1),
        "clutch_definition": "Period >= 4 (Q4/OT), <=5:00 left, score within 5 points",
    }


@router.get("/{team_id}/net-rating-trend")
def get_team_net_rating_trend(
    team_id: int,
    season: str = Query(..., description='e.g. "2022-23"'),
    home_away: str = Query("all", pattern="^(all|home|away)$"),
    season_type: str = Query("Regular Season", description='"Regular Season" or "Playoffs"'),
    rolling_window: int = Query(10, ge=1, le=41),
    con: duckdb.DuckDBPyConnection = Depends(get_db),
):
    """
    Game-by-game point margin and an estimated net rating (per-100-possession
    margin) across a season, plus a rolling average -- the classic "is this
    team trending up or down" line chart.

    Possessions are estimated with the standard formula (0.5 * combined
    team+opponent FGA/FTA/OREB/TOV expression) since the warehouse has no
    play-level possession counter; this is the same formula box-score sites
    use, not something invented for this project, but it's still an
    estimate -- treat net rating here as directionally trustworthy, not to
    the decimal.
    """
    season_expr = """
        (CAST(season_id % 10000 AS VARCHAR) || '-' ||
         LPAD(CAST((season_id % 10000 + 1) % 100 AS VARCHAR), 2, '0'))
    """
    where = f"WHERE (team_id_home = ? OR team_id_away = ?) AND {season_expr} = ? AND season_type = ?"
    df = con.execute(f"""
        SELECT
            game_id, game_date,
            CASE WHEN team_id_home = ? THEN true ELSE false END AS is_home,
            CASE WHEN team_id_home = ? THEN pts_home ELSE pts_away END AS pts_for,
            CASE WHEN team_id_home = ? THEN pts_away ELSE pts_home END AS pts_against,
            CASE WHEN team_id_home = ? THEN fga_home ELSE fga_away END AS fga,
            CASE WHEN team_id_home = ? THEN fga_away ELSE fga_home END AS opp_fga,
            CASE WHEN team_id_home = ? THEN fgm_home ELSE fgm_away END AS fgm,
            CASE WHEN team_id_home = ? THEN fgm_away ELSE fgm_home END AS opp_fgm,
            CASE WHEN team_id_home = ? THEN fta_home ELSE fta_away END AS fta,
            CASE WHEN team_id_home = ? THEN fta_away ELSE fta_home END AS opp_fta,
            CASE WHEN team_id_home = ? THEN oreb_home ELSE oreb_away END AS oreb,
            CASE WHEN team_id_home = ? THEN oreb_away ELSE oreb_home END AS opp_oreb,
            CASE WHEN team_id_home = ? THEN dreb_home ELSE dreb_away END AS dreb,
            CASE WHEN team_id_home = ? THEN dreb_away ELSE dreb_home END AS opp_dreb,
            CASE WHEN team_id_home = ? THEN tov_home ELSE tov_away END AS tov,
            CASE WHEN team_id_home = ? THEN tov_away ELSE tov_home END AS opp_tov
        FROM dim_game
        {where}
        ORDER BY game_date
    """, [team_id] * 15 + [team_id, team_id, season, season_type]).fetchdf()

    if df.empty:
        raise HTTPException(status_code=404, detail="No games found for that team/season/season_type")

    if home_away == "home":
        df = df[df["is_home"]]
    elif home_away == "away":
        df = df[~df["is_home"]]
    if df.empty:
        raise HTTPException(status_code=404, detail="No games found for that team/season/season_type/home_away filter")

    df = df.reset_index(drop=True)
    df["poss_est"] = 0.5 * (
        (df["fga"] + 0.4 * df["fta"] - 1.07 * (df["oreb"] / (df["oreb"] + df["opp_dreb"]).replace(0, None)) * (df["fga"] - df["fgm"]) + df["tov"])
        + (df["opp_fga"] + 0.4 * df["opp_fta"] - 1.07 * (df["opp_oreb"] / (df["opp_oreb"] + df["dreb"]).replace(0, None)) * (df["opp_fga"] - df["opp_fgm"]) + df["opp_tov"])
    )
    df["margin"] = df["pts_for"] - df["pts_against"]
    df["net_rating_est"] = 100.0 * df["margin"] / df["poss_est"]
    df["net_rating_rolling"] = df["net_rating_est"].rolling(rolling_window, min_periods=1).mean()
    df["game_num"] = df.index + 1

    games = df[["game_num", "game_date", "margin", "net_rating_est", "net_rating_rolling"]].copy()
    games["game_date"] = games["game_date"].astype(str)
    games["net_rating_est"] = games["net_rating_est"].round(1)
    games["net_rating_rolling"] = games["net_rating_rolling"].round(1)

    return {
        "team_id": team_id,
        "season": season,
        "season_type": season_type,
        "home_away_filter": home_away,
        "rolling_window": rolling_window,
        "games": games.to_dict(orient="records"),
    }


@router.get("/{team_id}/record-calculator")
def get_team_record_calculator(
    team_id: int,
    seasons: Optional[str] = Query(None, description='Comma-separated "YYYY-YY" seasons. Omit for every season on record.'),
    season_type: str = Query("Regular Season", pattern=_SEASON_TYPE_PATTERN),
    con: duckdb.DuckDBPyConnection = Depends(get_db),
):
    """
    Per-game rows for this team: own result/margin plus the OPPONENT's
    full box-score line that game (FG%, 3PA, OREB, FTA, etc.) -- built
    for the Record Calculator page, which lets a coach ask "how does this
    team do when the opponent shoots well / rebounds well / gets to the
    line a lot." All filtering (home/away, opponent FG% range, opponent
    3PA/OREB/FTA thresholds) happens client-side against this one
    payload rather than round-tripping to the API on every slider move,
    since a season's worth of games for one team is a small, cheap
    dataset (dim_game already carries both teams' full box lines, so no
    extra join is needed).

    is_back_to_back mirrors the same rest_days=1 definition used in
    /teams/{id}/games, in case a coach also wants to isolate fatigue
    spots ("do we struggle when the opponent shot well on a road
    back-to-back").
    """
    season_expr = """
        (CAST(season_id % 10000 AS VARCHAR) || '-' ||
         LPAD(CAST((season_id % 10000 + 1) % 100 AS VARCHAR), 2, '0'))
    """
    where = "WHERE (team_id_home = ? OR team_id_away = ?) AND season_type = ?"
    params = [team_id, team_id, season_type]
    if seasons:
        season_list = [s.strip() for s in seasons.split(",") if s.strip()]
        if season_list:
            placeholders = ", ".join("?" for _ in season_list)
            where += f" AND {season_expr} IN ({placeholders})"
            params += season_list

    df = con.execute(f"""
        WITH base AS (
            SELECT
                game_id, game_date, {season_expr} AS season,
                CASE WHEN team_id_home = ? THEN true ELSE false END AS is_home,
                CASE WHEN team_id_home = ? THEN wl_home ELSE wl_away END AS result,
                CASE WHEN team_id_home = ? THEN team_abbreviation_away ELSE team_abbreviation_home END AS opponent,
                CASE WHEN team_id_home = ? THEN pts_home ELSE pts_away END AS team_pts,
                CASE WHEN team_id_home = ? THEN pts_away ELSE pts_home END AS opp_pts,
                CASE WHEN team_id_home = ? THEN pts_home - pts_away ELSE pts_away - pts_home END AS margin,
                CASE WHEN team_id_home = ? THEN fg_pct_away ELSE fg_pct_home END AS opp_fg_pct,
                CASE WHEN team_id_home = ? THEN fga_away ELSE fga_home END AS opp_fga,
                CASE WHEN team_id_home = ? THEN fg3a_away ELSE fg3a_home END AS opp_fg3a,
                CASE WHEN team_id_home = ? THEN fg3_pct_away ELSE fg3_pct_home END AS opp_fg3_pct,
                CASE WHEN team_id_home = ? THEN oreb_away ELSE oreb_home END AS opp_oreb,
                CASE WHEN team_id_home = ? THEN dreb_away ELSE dreb_home END AS opp_dreb,
                CASE WHEN team_id_home = ? THEN fta_away ELSE fta_home END AS opp_fta,
                CASE WHEN team_id_home = ? THEN ft_pct_away ELSE ft_pct_home END AS opp_ft_pct,
                CASE WHEN team_id_home = ? THEN tov_away ELSE tov_home END AS opp_tov,
                CASE WHEN team_id_home = ? THEN ast_away ELSE ast_home END AS opp_ast
            FROM dim_game
            {where}
        )
        SELECT *,
               (DATE_DIFF('day', LAG(game_date) OVER (ORDER BY game_date), game_date) = 1) AS is_back_to_back
        FROM base
        ORDER BY game_date
    """, [team_id] * 16 + params).fetchdf()

    if df.empty:
        raise HTTPException(status_code=404, detail="No games found for that team/season selection")

    df["game_date"] = df["game_date"].astype(str)
    df["is_back_to_back"] = df["is_back_to_back"].fillna(False)

    games = _clean_nan(df.to_dict(orient="records"))
    return {
        "team_id": team_id,
        "seasons_requested": seasons,
        "season_type": season_type,
        "game_count": len(games),
        "games": games,
    }
