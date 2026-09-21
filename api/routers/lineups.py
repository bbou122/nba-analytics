from typing import Optional

import duckdb
from fastapi import APIRouter, Depends, HTTPException, Query

from db import get_db

router = APIRouter()


@router.get("")
def get_lineups(
    team_id: int = Query(..., description="Required -- there are 500k+ distinct lineup combos league-wide"),
    min_seconds: int = Query(300, description="Minimum total on-court seconds to include (filters out small-sample noise)"),
    sort_by: str = Query("total_seconds", pattern="^(total_seconds|net_rating_est|off_rating_est|def_rating_est|point_differential|n_stints)$"),
    limit: int = Query(25, le=200),
    season: Optional[str] = Query(None, description='e.g. "2023-24". Omit for career (all seasons combined, the original behavior).'),
    season_type: Optional[str] = Query(None, description='"Regular Season", "Playoffs", etc. Only used when season is set. Omit for all types.'),
    con: duckdb.DuckDBPyConnection = Depends(get_db),
):
    """
    Five-man lineup combos for a team. point_differential is exact;
    off/def/net_rating_est use a simplified possession estimator and should
    be read as approximate, especially for small n_stints/total_seconds.

    Without season: reads the precomputed agg_lineup_stats (derived from
    play-by-play across every season on record -- see derive_lineups.py),
    same as before this filter existed. With season: computed live by
    aggregating fact_lineup_stints joined to dim_game for just that one
    season, since agg_lineup_stats itself isn't season-split -- fast
    enough for a single team-season's worth of stints (a few thousand
    rows at most).
    """
    if season:
        season_expr = """
            (CAST(g.season_id % 10000 AS VARCHAR) || '-' ||
             LPAD(CAST((g.season_id % 10000 + 1) % 100 AS VARCHAR), 2, '0'))
        """
        where = f"WHERE s.team_id = ? AND {season_expr} = ?"
        params = [team_id, season]
        if season_type:
            where += " AND g.season_type = ?"
            params.append(season_type)
        df = con.execute(f"""
            SELECT s.team_id, s.lineup,
                   COUNT(*) AS n_stints,
                   SUM(s.seconds) AS total_seconds,
                   SUM(s.points_for) AS points_for,
                   SUM(s.points_against) AS points_against,
                   SUM(s.points_for) - SUM(s.points_against) AS point_differential,
                   SUM(s.possessions_est) AS possessions_est,
                   ROUND(100.0 * SUM(s.points_for) / NULLIF(SUM(s.possessions_est), 0), 1) AS off_rating_est,
                   ROUND(100.0 * SUM(s.points_against) / NULLIF(SUM(s.possessions_est), 0), 1) AS def_rating_est,
                   ROUND(100.0 * (SUM(s.points_for) - SUM(s.points_against)) / NULLIF(SUM(s.possessions_est), 0), 1) AS net_rating_est
            FROM fact_lineup_stints s
            JOIN dim_game g ON g.game_id = s.game_id
            {where}
            GROUP BY s.team_id, s.lineup
            HAVING SUM(s.seconds) >= ?
            ORDER BY {sort_by} DESC
            LIMIT ?
        """, params + [min_seconds, limit]).fetchdf()
    else:
        df = con.execute(f"""
            SELECT team_id, lineup, n_stints, total_seconds, points_for, points_against,
                   point_differential, possessions_est, off_rating_est, def_rating_est, net_rating_est
            FROM agg_lineup_stats
            WHERE team_id = ? AND total_seconds >= ?
            ORDER BY {sort_by} DESC
            LIMIT ?
        """, [team_id, min_seconds, limit]).fetchdf()
    if df.empty:
        raise HTTPException(status_code=404, detail="No lineups found for that team/filter")

    # Resolve the pipe-joined player-id lineup string into readable names.
    all_ids = set()
    for lineup in df["lineup"]:
        all_ids.update(int(p) for p in lineup.split("|") if p)
    id_to_name = {}
    if all_ids:
        ids_sql = ",".join(str(i) for i in all_ids)  # our own derived ids, not user input
        names_df = con.execute(f"SELECT id, full_name FROM dim_player WHERE id IN ({ids_sql})").fetchdf()
        id_to_name = dict(zip(names_df["id"], names_df["full_name"]))

    records = df.to_dict(orient="records")
    for r in records:
        ids = [int(p) for p in r["lineup"].split("|") if p]
        r["player_ids"] = ids
        r["player_names"] = [id_to_name.get(i, f"#{i}") for i in ids]
    return records


@router.get("/game")
def get_game_lineups(
    game_id: str = Query(...),
    team_id: int = Query(...),
    con: duckdb.DuckDBPyConnection = Depends(get_db),
):
    """
    Single-game lineup report, grouped by distinct five-man unit (not by
    individual substitution stint): if the same five players check back in
    together later in the game, that's the same lineup and its minutes/
    points/shooting are summed into one row, not listed twice. n_stints
    shows how many separate stretches that unit played together.

    Opponent FGA/FGM aren't in fact_lineup_stints (that table only tracks
    each team's own shots, keyed to that team's own stint boundaries -- the
    opponent's stints don't line up with this team's substitutions).
    Computed here instead by joining each stint's event range against the
    opponent's shot events for this one game -- cheap since it's scoped to
    a single game (~450 play-by-play rows).
    """
    opp_row = con.execute("""
        SELECT CASE WHEN team_id_home = ? THEN team_id_away ELSE team_id_home END AS opponent_team_id
        FROM dim_game WHERE game_id = ?
    """, [team_id, game_id]).fetchone()
    opponent_team_id = opp_row[0] if opp_row else None

    df = con.execute("""
        WITH stints AS (
            SELECT start_event, end_event, seconds, lineup, points_for, points_against,
                   fga, made_fg, final_ft, tov, possessions_est
            FROM fact_lineup_stints
            WHERE game_id = ? AND team_id = ?
        ),
        opp_shots AS (
            SELECT eventnum, eventmsgtype
            FROM fact_play_by_play
            WHERE game_id = ? AND player1_team_id = ? AND eventmsgtype IN (1, 2)
        ),
        stints_with_opp AS (
            SELECT s.*,
                   COUNT(o.eventnum) AS opp_fga,
                   SUM(CASE WHEN o.eventmsgtype = 1 THEN 1 ELSE 0 END) AS opp_fgm
            FROM stints s
            LEFT JOIN opp_shots o ON o.eventnum > s.start_event AND o.eventnum <= s.end_event
            GROUP BY s.start_event, s.end_event, s.seconds, s.lineup, s.points_for, s.points_against,
                     s.fga, s.made_fg, s.final_ft, s.tov, s.possessions_est
        )
        SELECT lineup,
               COUNT(*) AS n_stints,
               MIN(start_event) AS first_start_event,
               SUM(seconds) AS seconds,
               SUM(points_for) AS points_for,
               SUM(points_against) AS points_against,
               SUM(points_for) - SUM(points_against) AS point_differential,
               SUM(fga) AS fga,
               SUM(made_fg) AS made_fg,
               SUM(final_ft) AS final_ft,
               SUM(tov) AS tov,
               SUM(possessions_est) AS possessions_est,
               SUM(opp_fga) AS opp_fga,
               SUM(opp_fgm) AS opp_fgm
        FROM stints_with_opp
        GROUP BY lineup
        ORDER BY seconds DESC
    """, [game_id, team_id, game_id, opponent_team_id]).fetchdf()
    if df.empty:
        raise HTTPException(status_code=404, detail="No lineup stints found for that game/team")

    df["opp_fga"] = df["opp_fga"].fillna(0).astype(int)
    df["opp_fgm"] = df["opp_fgm"].fillna(0).astype(int)

    all_ids = set()
    for lineup in df["lineup"]:
        all_ids.update(int(p) for p in lineup.split("|") if p)
    id_to_name = {}
    if all_ids:
        ids_sql = ",".join(str(i) for i in all_ids)  # our own derived ids, not user input
        names_df = con.execute(f"SELECT id, full_name FROM dim_player WHERE id IN ({ids_sql})").fetchdf()
        id_to_name = dict(zip(names_df["id"], names_df["full_name"]))

    lineups_out = df.to_dict(orient="records")
    for r in lineups_out:
        ids = [int(p) for p in r["lineup"].split("|") if p]
        r["player_ids"] = ids
        r["player_names"] = [id_to_name.get(i, f"#{i}") for i in ids]

    # Surface the QA data-quality flag rather than silently hiding it -- see
    # qa_excluded_team_games / derive_lineups.py's tolerance filter.
    flag_df = con.execute("""
        SELECT total_seconds, nearest_valid, diff
        FROM qa_excluded_team_games
        WHERE game_id = ? AND team_id = ?
    """, [game_id, team_id]).fetchdf()
    flagged = not flag_df.empty
    flag_info = flag_df.to_dict(orient="records")[0] if flagged else None

    return {"flagged": flagged, "flag_info": flag_info, "opponent_team_id": opponent_team_id, "stints": lineups_out}


@router.get("/excluded")
def get_excluded_team_games(
    team_id: Optional[int] = Query(None),
    limit: int = Query(50, le=500),
    con: duckdb.DuckDBPyConnection = Depends(get_db),
):
    """
    QA transparency endpoint: team-games left out of the lineup aggregates
    because their total on-court time didn't land within tolerance of a
    valid regulation/OT length (see qa_excluded_team_games / derive_lineups.py).
    """
    where = "WHERE team_id = ?" if team_id is not None else ""
    params = [team_id] if team_id is not None else []
    df = con.execute(f"""
        SELECT team_id, game_id, total_seconds, nearest_valid, diff
        FROM qa_excluded_team_games
        {where}
        ORDER BY diff DESC
        LIMIT ?
    """, params + [limit]).fetchdf()
    return df.to_dict(orient="records")


@router.get("/rotation")
def get_game_rotation(
    game_id: str = Query(...),
    con: duckdb.DuckDBPyConnection = Depends(get_db),
):
    """
    Per-player on-court rotation for one game, for a minutes-rotation
    chart: for each player, the sequence of fact_lineup_stints rows they
    were part of, each carrying its own plus-minus (points_for -
    points_against for that player's own team during that stint) and its
    ELAPSED GAME-CLOCK position in seconds.

    start_event/end_event in fact_lineup_stints are play-by-play event
    indices, not clock time -- elapsed time is reconstructed here as a
    running cumulative sum of each stint's `seconds` duration, in
    start_event order, per team. Segments for the same player are NOT
    merged across adjacent stints: a teammate substitution ends one
    lineup-stint and starts the next even if this player never left the
    floor, so a continuous on-court stretch can render as several
    back-to-back segments -- this matches how courtsketch.com's own
    rotation chart renders it, and keeps each segment's plus-minus tied
    to an actual lineup-stint rather than an invented merge.
    """
    game_df = con.execute("""
        SELECT game_id, game_date, team_id_home, team_abbreviation_home, team_name_home, pts_home,
               team_id_away, team_abbreviation_away, team_name_away, pts_away
        FROM dim_game WHERE game_id = ?
    """, [game_id]).fetchdf()
    if game_df.empty:
        raise HTTPException(status_code=404, detail="Game not found")
    g = game_df.to_dict(orient="records")[0]

    def _team_rotation(team_id):
        stints_df = con.execute("""
            SELECT lineup, start_event, end_event, seconds, points_for, points_against
            FROM fact_lineup_stints
            WHERE game_id = ? AND team_id = ?
            ORDER BY start_event
        """, [game_id, team_id]).fetchdf()
        if stints_df.empty:
            return {"team_id": team_id, "players": [], "total_seconds": 0, "flagged": False, "flag_info": None}

        stints_df["elapsed_end"] = stints_df["seconds"].cumsum()
        stints_df["elapsed_start"] = stints_df["elapsed_end"] - stints_df["seconds"]
        stints_df["player_id"] = stints_df["lineup"].str.split("|")
        exploded = stints_df.explode("player_id")
        exploded = exploded[exploded["player_id"] != ""]
        exploded["player_id"] = exploded["player_id"].astype(int)
        exploded["margin"] = exploded["points_for"] - exploded["points_against"]

        total_seconds = int(stints_df["seconds"].sum())

        all_ids = exploded["player_id"].unique().tolist()
        id_to_name = {}
        if all_ids:
            ids_sql = ",".join(str(i) for i in all_ids)  # our own derived ids, not user input
            names_df = con.execute(f"SELECT id, full_name FROM dim_player WHERE id IN ({ids_sql})").fetchdf()
            id_to_name = dict(zip(names_df["id"], names_df["full_name"]))

        players = []
        for pid, grp in exploded.groupby("player_id"):
            grp = grp.sort_values("elapsed_start")
            segments = [
                {
                    "start_seconds": int(r["elapsed_start"]),
                    "end_seconds": int(r["elapsed_end"]),
                    "margin": int(r["margin"]),
                }
                for _, r in grp.iterrows()
            ]
            players.append({
                "player_id": int(pid),
                "player_name": id_to_name.get(pid, f"#{pid}"),
                "total_seconds": int(grp["seconds"].sum()),
                "segments": segments,
            })
        players.sort(key=lambda p: -p["total_seconds"])

        flag_df = con.execute("""
            SELECT total_seconds, nearest_valid, diff
            FROM qa_excluded_team_games
            WHERE game_id = ? AND team_id = ?
        """, [game_id, team_id]).fetchdf()
        flagged = not flag_df.empty
        flag_info = flag_df.to_dict(orient="records")[0] if flagged else None

        return {
            "team_id": team_id,
            "players": players,
            "total_seconds": total_seconds,
            "flagged": flagged,
            "flag_info": flag_info,
        }

    home = _team_rotation(g["team_id_home"])
    away = _team_rotation(g["team_id_away"])
    if not home["players"] and not away["players"]:
        raise HTTPException(status_code=404, detail="No lineup-stint data found for that game")

    home.update({"abbreviation": g["team_abbreviation_home"], "name": g["team_name_home"], "pts": g["pts_home"]})
    away.update({"abbreviation": g["team_abbreviation_away"], "name": g["team_name_away"], "pts": g["pts_away"]})

    total_seconds = max(home["total_seconds"], away["total_seconds"])
    # OT period count derived from actual on-court time rather than
    # fact_line_score's OT columns, which store 0 (not NULL) for periods
    # that never happened -- reconstructing from total_seconds is exact.
    ot_periods = max(0, round((total_seconds - 2880) / 300)) if total_seconds > 2880 else 0

    return {
        "game_id": game_id,
        "game_date": str(g["game_date"]),
        "home": home,
        "away": away,
        "regulation_seconds": 2880,
        "period_seconds": 720,
        "ot_period_seconds": 300,
        "ot_periods": ot_periods,
        "total_seconds": total_seconds,
    }
