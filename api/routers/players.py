from typing import Optional

import duckdb
import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query

from db import get_db

router = APIRouter()


@router.get("")
def search_players(
    q: Optional[str] = Query(None, description="Case-insensitive substring match on player name"),
    active_only: bool = Query(False),
    limit: int = Query(50, le=500),
    con: duckdb.DuckDBPyConnection = Depends(get_db),
):
    where_clauses = []
    params = []
    if q:
        where_clauses.append("full_name ILIKE ?")
        params.append(f"%{q}%")
    if active_only:
        where_clauses.append("is_active = 1")
    where = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

    df = con.execute(f"""
        SELECT id, full_name, is_active FROM dim_player
        {where}
        ORDER BY full_name
        LIMIT ?
    """, params + [limit]).fetchdf()
    return df.to_dict(orient="records")


# Feature -> short descriptor used when auto-labeling a cluster from its
# center's most distinctive (highest and lowest z-scored) dimensions.
_ARCHETYPE_FEATURE_LABELS = {
    "usg_pct": ("High-Usage", "Low-Usage"),
    "ts_pct": ("Efficient Scorer", "Inefficient Scorer"),
    "ast_pct": ("Primary Playmaker", "Low-Assist"),
    "oreb_pct": ("Offensive Rebounder", "Off-Glass-Absent"),
    "dreb_pct": ("Defensive Rebounder", "Low-Rebounding"),
    "tm_tov_pct": ("Turnover-Prone", "Ball-Secure"),
    "fg3a_rate": ("3-Point-Reliant", "Rim/Mid-Range Scorer"),
    "paint_share": ("Paint Scorer", "Perimeter Scorer"),
    "blk_pg": ("Rim Protector", ""),
    "stl_pg": ("High-Activity Defender", ""),
}


def _label_cluster(center_z, feature_names):
    """
    Build a short, transparent label for a cluster from its center's two
    most above-average (positive z-score) traits, falling back to
    "Balanced / Role Player" when nothing stands out. This is a simple
    home-built heuristic, not a reproduction of any published archetype
    taxonomy (e.g. Cleaning the Glass's site-specific system) -- it's
    meant to make the raw cluster centers legible, not to claim parity
    with industry-standard archetype labels.
    """
    ranked = sorted(zip(feature_names, center_z), key=lambda t: -t[1])
    top_labels = []
    for name, z in ranked:
        if z <= 0.35 or len(top_labels) >= 2:
            break
        high_label = _ARCHETYPE_FEATURE_LABELS.get(name, (name, ""))[0]
        if high_label:
            top_labels.append(high_label)
    if not top_labels:
        return "Balanced / Role Player"
    return " + ".join(top_labels)


# Shared feature set for both /archetypes (clustering) and /{id}/similar
# (nearest-neighbor search) -- usage, efficiency, playmaking, rebounding,
# turnovers, 3-point rate, paint-scoring share, and block/steal rate per
# game, all season-aggregate stats.
_ARCHETYPE_FEATURE_COLS = [
    "USG_PCT", "TS_PCT", "AST_PCT", "OREB_PCT", "DREB_PCT", "TM_TOV_PCT",
    "fg3a_rate", "paint_share", "blk_pg", "stl_pg",
]
_ARCHETYPE_FEATURE_KEY_MAP = {
    "USG_PCT": "usg_pct", "TS_PCT": "ts_pct", "AST_PCT": "ast_pct",
    "OREB_PCT": "oreb_pct", "DREB_PCT": "dreb_pct", "TM_TOV_PCT": "tm_tov_pct",
    "fg3a_rate": "fg3a_rate", "paint_share": "paint_share",
    "blk_pg": "blk_pg", "stl_pg": "stl_pg",
}


# Process-level cache for the (season, min_gp) -> (df, Xz) feature frame
# shared by /archetypes and /{id}/similar -- it re-scans two season-aggregate
# tables and re-fits a StandardScaler on every call otherwise, and the
# underlying warehouse tables don't change during the server's lifetime, so
# caching this is safe and makes both endpoints noticeably snappier on
# repeat requests for the same season.
_FEATURE_FRAME_CACHE = {}


def _player_feature_frame(con, season, min_gp):
    """
    Builds the raw feature dataframe + z-scored feature matrix shared by
    /archetypes and /{id}/similar. Returns (df, Xz) where df has one row
    per qualifying player (PLAYER_ID, PLAYER_NAME, TEAM_ABBREVIATION, GP,
    plus the raw and engineered feature columns) and Xz is the matching
    z-score-normalized numpy matrix, column order == _ARCHETYPE_FEATURE_COLS.
    Cached per (season, min_gp) -- see _FEATURE_FRAME_CACHE.
    """
    cache_key = (season, min_gp)
    if cache_key in _FEATURE_FRAME_CACHE:
        cached_df, cached_Xz = _FEATURE_FRAME_CACHE[cache_key]
        return cached_df.copy(), cached_Xz

    from sklearn.preprocessing import StandardScaler

    df = con.execute("""
        SELECT
            a.PLAYER_ID, a.PLAYER_NAME, a.TEAM_ABBREVIATION, a.GP, a.MIN,
            a.USG_PCT, a.TS_PCT, a.AST_PCT, a.OREB_PCT, a.DREB_PCT, a.TM_TOV_PCT,
            t.FG3A, t.FGA, t.PTS, t.BLK AS blk_pg, t.STL AS stl_pg,
            m.PTS_PAINT
        FROM fact_player_advanced_rs a
        JOIN fact_player_traditional_rs t ON t.PLAYER_ID = a.PLAYER_ID AND t.SEASON = a.SEASON
        LEFT JOIN fact_player_misc_rs m ON m.PLAYER_ID = a.PLAYER_ID AND m.SEASON = a.SEASON
        WHERE a.SEASON = ? AND a.GP >= ?
    """, [season, min_gp]).fetchdf()

    if df.empty:
        return df, None

    df["fg3a_rate"] = np.where(df["FGA"] > 0, df["FG3A"] / df["FGA"], 0.0)
    df["paint_share"] = np.where(df["PTS"] > 0, df["PTS_PAINT"].fillna(0) / df["PTS"], 0.0)
    df[_ARCHETYPE_FEATURE_COLS] = df[_ARCHETYPE_FEATURE_COLS].fillna(0.0)

    X = df[_ARCHETYPE_FEATURE_COLS].to_numpy(dtype=float)
    scaler = StandardScaler()
    Xz = scaler.fit_transform(X)
    _FEATURE_FRAME_CACHE[cache_key] = (df.copy(), Xz)
    return df, Xz


@router.get("/{player_id}/similar")
def get_similar_players(
    player_id: int,
    season: str = Query(..., description='e.g. "2022-23"'),
    min_gp: int = Query(20, description="Minimum games played to be included, for sample-size sanity"),
    n: int = Query(5, ge=1, le=20),
    con: duckdb.DuckDBPyConnection = Depends(get_db),
):
    """
    Nearest neighbors to this player in the same z-score-normalized
    statistical feature space used by /players/archetypes (usage,
    efficiency, playmaking, rebounding, turnovers, 3PA rate, paint share,
    block/steal rate) -- "who played most like this player, statistically,
    this season," ranked by Euclidean distance. Same caveats as
    /archetypes: purely statistical, one season at a time, not a scouting
    judgment.
    """
    try:
        import numpy as _np
    except ImportError:
        raise HTTPException(status_code=500, detail="numpy is not installed on the server")

    df, Xz = _player_feature_frame(con, season, min_gp)
    if df.empty:
        raise HTTPException(status_code=404, detail="No qualifying players for that season/min_gp")
    if player_id not in df["PLAYER_ID"].values:
        raise HTTPException(status_code=404, detail="That player didn't meet min_gp for this season (or has no advanced stats on record)")

    idx = df.index[df["PLAYER_ID"] == player_id][0]
    target = Xz[df.index.get_loc(idx)]
    dists = _np.linalg.norm(Xz - target, axis=1)

    order = _np.argsort(dists)
    results = []
    for i in order:
        row = df.iloc[i]
        if int(row["PLAYER_ID"]) == player_id:
            continue
        results.append({
            "player_id": int(row["PLAYER_ID"]),
            "player_name": row["PLAYER_NAME"],
            "team": row["TEAM_ABBREVIATION"],
            "gp": int(row["GP"]),
            "similarity_distance": round(float(dists[i]), 3),
            "usg_pct": round(float(row["USG_PCT"]), 3) if row["USG_PCT"] is not None else None,
            "ts_pct": round(float(row["TS_PCT"]), 3) if row["TS_PCT"] is not None else None,
            "ast_pct": round(float(row["AST_PCT"]), 3) if row["AST_PCT"] is not None else None,
            "fg3a_rate": round(float(row["fg3a_rate"]), 3),
            "paint_share": round(float(row["paint_share"]), 3),
        })
        if len(results) >= n:
            break

    target_row = df[df["PLAYER_ID"] == player_id].iloc[0]
    return {
        "player_id": player_id,
        "player_name": target_row["PLAYER_NAME"],
        "season": season,
        "min_gp": min_gp,
        "methodology": (
            "Euclidean distance in the same z-score-normalized feature space as /players/archetypes "
            "(lower distance = more statistically similar this season). Not a scouting judgment."
        ),
        "similar_players": results,
    }


@router.get("/archetypes")
def get_player_archetypes(
    season: str = Query(..., description='e.g. "2022-23"'),
    min_gp: int = Query(20, description="Minimum games played to be included, for sample-size sanity"),
    n_clusters: int = Query(7, ge=2, le=12),
    con: duckdb.DuckDBPyConnection = Depends(get_db),
):
    """
    Groups every qualifying player in a season into style-based archetypes
    via KMeans clustering on a z-score-normalized feature set: usage,
    true shooting%, assist%, offensive/defensive rebound%, turnover%,
    3-point attempt rate, paint scoring share, and block/steal rate per
    game. This is an unsupervised, purely statistical grouping -- cluster
    count and labels are heuristic (see _label_cluster), not a reproduction
    of any specific published archetype system, and results can shift
    season to season or with a different k. Useful as an exploratory lens
    ("who plays like whom, statistically, this season"), not as a
    definitive scouting classification.
    """
    try:
        from sklearn.cluster import KMeans
    except ImportError:
        raise HTTPException(status_code=500, detail="scikit-learn is not installed on the server")

    df, Xz = _player_feature_frame(con, season, min_gp)
    if df.empty or len(df) < n_clusters:
        raise HTTPException(status_code=404, detail="Not enough qualifying players for that season/min_gp/n_clusters")

    feature_cols = _ARCHETYPE_FEATURE_COLS
    feature_key_map = _ARCHETYPE_FEATURE_KEY_MAP

    km = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
    labels = km.fit_predict(Xz)
    df["cluster"] = labels

    lookup_names = [feature_key_map[c] for c in feature_cols]
    cluster_labels = {
        i: _label_cluster(km.cluster_centers_[i], lookup_names) for i in range(n_clusters)
    }
    # de-duplicate identical auto-labels by appending a distinguishing tag
    seen = {}
    for i, lbl in cluster_labels.items():
        seen.setdefault(lbl, []).append(i)
    for lbl, idxs in seen.items():
        if len(idxs) > 1:
            for rank, i in enumerate(idxs, start=1):
                cluster_labels[i] = f"{lbl} ({rank})"

    players = []
    for _, r in df.sort_values(["cluster", "USG_PCT"], ascending=[True, False]).iterrows():
        players.append({
            "player_id": int(r["PLAYER_ID"]),
            "player_name": r["PLAYER_NAME"],
            "team": r["TEAM_ABBREVIATION"],
            "gp": int(r["GP"]),
            "cluster": int(r["cluster"]),
            "archetype": cluster_labels[int(r["cluster"])],
            "usg_pct": round(float(r["USG_PCT"]), 3) if r["USG_PCT"] is not None else None,
            "ts_pct": round(float(r["TS_PCT"]), 3) if r["TS_PCT"] is not None else None,
            "ast_pct": round(float(r["AST_PCT"]), 3) if r["AST_PCT"] is not None else None,
            "fg3a_rate": round(float(r["fg3a_rate"]), 3),
            "paint_share": round(float(r["paint_share"]), 3),
        })

    clusters_summary = []
    for i in range(n_clusters):
        members = [p for p in players if p["cluster"] == i]
        clusters_summary.append({
            "cluster": i,
            "archetype": cluster_labels[i],
            "player_count": len(members),
            "example_players": [p["player_name"] for p in members[:5]],
        })

    return {
        "season": season,
        "min_gp": min_gp,
        "n_clusters": n_clusters,
        "methodology": (
            "KMeans (scikit-learn) on z-score-normalized USG%, TS%, AST%, OREB%, DREB%, TOV%, "
            "3PA rate, paint-scoring share, and BLK/STL per game. Labels are auto-generated from "
            "each cluster's most distinctive stat(s), not a published archetype taxonomy."
        ),
        "clusters": clusters_summary,
        "players": players,
    }


# Stat keys exposed by /players/statboard -> (source table, source column).
# Traditional + Advanced only, per the project's scope for this feature.
# All of these are already per-game/rate figures in the warehouse (verified
# against known career averages), so they GP-weight-average cleanly across
# an arbitrary set of seasons the same way get_player_advanced() already
# does for a smaller column set.
_STATBOARD_TRAD_COLS = [
    "MIN", "PTS", "REB", "OREB", "DREB", "AST", "STL", "BLK", "TOV", "PF",
    "FGM", "FGA", "FG_PCT", "FG3M", "FG3A", "FG3_PCT", "FTM", "FTA", "FT_PCT", "PLUS_MINUS",
]
_STATBOARD_ADV_COLS = [
    "OFF_RATING", "DEF_RATING", "NET_RATING", "AST_PCT", "OREB_PCT", "DREB_PCT",
    "REB_PCT", "TOV_PCT", "EFG_PCT", "TS_PCT", "USG_PCT", "PACE", "PIE",
]
_STATBOARD_ALL_COLS = _STATBOARD_TRAD_COLS + _STATBOARD_ADV_COLS


@router.get("/statboard")
def get_statboard(
    seasons: Optional[str] = Query(None, description='Comma-separated "YYYY-YY" seasons. Omit for every season on record.'),
    season_type: str = Query("Regular Season", pattern="^(Regular Season|Playoffs)$"),
    position: Optional[str] = Query(None, description='Substring match on dim_common_player_info.position, e.g. "Guard" or "Center". Omit for all positions.'),
    min_gp: int = Query(10, ge=0, description="Minimum total games played across the selected seasons"),
    min_mpg: float = Query(10.0, ge=0, description="Minimum GP-weighted average minutes per game across the selected seasons"),
    con: duckdb.DuckDBPyConnection = Depends(get_db),
):
    """
    Backs the Statboard's Leaderboard and Scatter Plot views: one row per
    qualifying player with Traditional + Advanced per-game/rate stats
    GP-weight-averaged across an arbitrary set of seasons (or every season
    on record, if `seasons` is omitted), plus each stat's percentile
    within that same qualifying pool.

    Percentile is recomputed fresh against whoever currently qualifies
    (after the season/position/min_gp/min_mpg filters), not against a
    fixed all-time reference -- "how good is this number relative to
    everyone else in this view right now." It's always "higher raw value
    = higher percentile," even for stats where lower is conventionally
    better (TOV, DEF_RATING) -- read the stat itself for those, not just
    its percentile/color.

    GP-weighting a multi-season selection means a player who played 20
    games in one included season and 82 in another is weighted mostly by
    the 82-game season, same logic as get_player_advanced().
    """
    seg = "po" if season_type == "Playoffs" else "rs"
    trad_table = f"fact_player_traditional_{seg}"
    adv_table = f"fact_player_advanced_{seg}"

    season_clause = ""
    season_params = []
    if seasons:
        season_list = [s.strip() for s in seasons.split(",") if s.strip()]
        if season_list:
            placeholders = ", ".join("?" for _ in season_list)
            season_clause = f"AND SEASON IN ({placeholders})"
            season_params = season_list

    trad_cols_sql = ", ".join(_STATBOARD_TRAD_COLS)
    trad_df = con.execute(f"""
        SELECT PLAYER_ID, PLAYER_NAME, TEAM_ABBREVIATION, SEASON, GP, {trad_cols_sql}
        FROM {trad_table}
        WHERE GP > 0 {season_clause}
    """, season_params).fetchdf()
    if trad_df.empty:
        raise HTTPException(status_code=404, detail="No player stats found for that season selection")

    # The warehouse column is TM_TOV_PCT; rename it to TOV_PCT here to match
    # the flat key scheme in _STATBOARD_ADV_COLS.
    adv_select_cols = [("TM_TOV_PCT AS TOV_PCT" if c == "TOV_PCT" else c) for c in _STATBOARD_ADV_COLS]
    adv_cols_sql = ", ".join(adv_select_cols)
    adv_df = con.execute(f"""
        SELECT PLAYER_ID, SEASON, {adv_cols_sql}
        FROM {adv_table}
        WHERE 1=1 {season_clause}
    """, season_params).fetchdf()

    merged = trad_df.merge(adv_df, on=["PLAYER_ID", "SEASON"], how="left")

    # GP-weighted average of every stat column, per player, across the
    # selected seasons -- fully vectorized (no groupby.apply, whose
    # include_groups/keyword behavior has shifted across pandas versions)
    # so this doesn't depend on exactly which pandas gets installed.
    # For each column, weight_sum = sum(value * GP) over rows where that
    # column isn't null, and gp_sum = sum(GP) over those same rows, so a
    # player missing a stat in one season doesn't drag that stat's average
    # down with a phantom zero.
    weighted = pd.DataFrame({"PLAYER_ID": merged["PLAYER_ID"], "GP": merged["GP"]})
    for col in _STATBOARD_ALL_COLS:
        notna = merged[col].notna()
        weighted[f"{col}__wsum"] = (merged[col] * merged["GP"]).where(notna, 0.0)
        weighted[f"{col}__gpsum"] = merged["GP"].where(notna, 0)

    totals = weighted.groupby("PLAYER_ID").sum()
    total_gp = merged.groupby("PLAYER_ID")["GP"].sum()

    agg_df = pd.DataFrame({"PLAYER_ID": total_gp.index, "GP": total_gp.values})
    for col in _STATBOARD_ALL_COLS:
        gpsum = totals[f"{col}__gpsum"].values
        wsum = totals[f"{col}__wsum"].values
        with np.errstate(invalid="ignore", divide="ignore"):
            agg_df[col] = np.where(gpsum > 0, wsum / gpsum, np.nan)

    name_team = (
        merged.sort_values("SEASON")
        .groupby("PLAYER_ID")
        .agg(PLAYER_NAME=("PLAYER_NAME", "last"), TEAM_ABBREVIATION=("TEAM_ABBREVIATION", "last"))
        .reset_index()
    )
    agg_df = agg_df.merge(name_team, on="PLAYER_ID", how="left")

    agg_df = agg_df[agg_df["GP"] >= min_gp]
    agg_df = agg_df[agg_df["MIN"].fillna(0) >= min_mpg]

    if position:
        pos_df = con.execute(
            "SELECT person_id AS PLAYER_ID, position FROM dim_common_player_info WHERE position ILIKE ?",
            [f"%{position}%"],
        ).fetchdf()
        agg_df = agg_df[agg_df["PLAYER_ID"].isin(pos_df["PLAYER_ID"])]

    if agg_df.empty:
        raise HTTPException(status_code=404, detail="No players qualify for that combination of filters")

    # Percentile within this qualifying pool, per stat, "higher raw value = higher percentile."
    pct_df = agg_df[_STATBOARD_ALL_COLS].rank(pct=True) * 100

    players = []
    for i, row in agg_df.reset_index(drop=True).iterrows():
        stats = {}
        for col in _STATBOARD_ALL_COLS:
            key = col.lower()
            val = row[col]
            pct = pct_df.iloc[i][col]
            stats[key] = {
                "value": round(float(val), 3) if pd.notna(val) else None,
                "percentile": round(float(pct), 1) if pd.notna(pct) else None,
            }
        players.append({
            "player_id": int(row["PLAYER_ID"]),
            "player_name": row["PLAYER_NAME"],
            "team": row["TEAM_ABBREVIATION"],
            "gp": int(row["GP"]),
            "stats": stats,
        })

    return {
        "seasons_requested": seasons,
        "season_type": season_type,
        "position_filter": position,
        "min_gp": min_gp,
        "min_mpg": min_mpg,
        "qualifying_players": len(players),
        "available_stats": [c.lower() for c in _STATBOARD_ALL_COLS],
        "percentile_note": "Percentile is 'higher raw value = higher percentile' among the currently-qualifying pool, even for stats where lower is conventionally better (TOV, DEF_RATING).",
        "players": players,
    }


@router.get("/{player_id}")
def get_player(player_id: int, con: duckdb.DuckDBPyConnection = Depends(get_db)):
    """Bio info: height, weight, position, school, draft info, team, career span."""
    df = con.execute("""
        SELECT person_id, display_first_last, birthdate, school, country, height, weight,
               position, team_id, team_name, team_abbreviation, from_year, to_year,
               draft_year, draft_round, draft_number, greatest_75_flag
        FROM dim_common_player_info
        WHERE person_id = ?
    """, [player_id]).fetchdf()
    if df.empty:
        raise HTTPException(status_code=404, detail="Player not found")
    return df.to_dict(orient="records")[0]


@router.get("/{player_id}/seasons")
def get_player_seasons(player_id: int, con: duckdb.DuckDBPyConnection = Depends(get_db)):
    df = con.execute("""
        SELECT DISTINCT SEASON FROM fact_player_traditional_rs WHERE PLAYER_ID = ? ORDER BY SEASON
    """, [player_id]).fetchdf()
    if df.empty:
        raise HTTPException(status_code=404, detail="No seasons found for that player")
    return df["SEASON"].tolist()


@router.get("/{player_id}/stats")
def get_player_stats(
    player_id: int,
    season: Optional[str] = Query(None, description='e.g. "2023-24". Omit for all seasons.'),
    stat_type: str = Query("traditional", pattern="^(traditional|advanced)$"),
    season_segment: str = Query("rs", pattern="^(rs|po)$"),
    con: duckdb.DuckDBPyConnection = Depends(get_db),
):
    """
    Season-level player stats.
    stat_type: "traditional" (box score totals) or "advanced" (ratings/usage/PIE).
    season_segment: "rs" (regular season) or "po" (playoffs).
    """
    table = f"fact_player_{stat_type}_{season_segment}"
    where = "WHERE PLAYER_ID = ?"
    params = [player_id]
    if season:
        where += " AND SEASON = ?"
        params.append(season)

    df = con.execute(f"SELECT * FROM {table} {where} ORDER BY SEASON", params).fetchdf()
    if df.empty:
        raise HTTPException(status_code=404, detail="No stats found for that player/season/type")
    return df.to_dict(orient="records")


@router.get("/{player_id}/on-off")
def get_player_on_off(
    player_id: int,
    team_id: Optional[int] = Query(None, description="Filter to one team if the player has rows for more than one"),
    game_id: Optional[str] = Query(None, description="Restrict to a single game instead of the season-long aggregate (team_id required alongside it)"),
    seasons: Optional[str] = Query(None, description='Comma-separated "YYYY-YY" seasons (team_id required alongside it). Omit for career.'),
    home_away: Optional[str] = Query(None, pattern="^(home|away)$", description="Restrict to the team's home or away games (team_id required alongside it). Omit for both."),
    con: duckdb.DuckDBPyConnection = Depends(get_db),
):
    """
    On-court vs off-court team performance for this player.

    Without any filter: reads the career-long precomputed aggregate
    (agg_player_on_off), across every team the player has rows for. Only
    counts games the player actually appeared in for that team -- see
    derive_lineups.py for the documented DNP-games limitation.

    With game_id: computed live from fact_lineup_stints for just that one
    game (small enough -- a few dozen stints -- that this doesn't need a
    precomputed table).

    With seasons and/or home_away (and no game_id): computed live from
    fact_lineup_stints joined to dim_game, same on/off logic as the
    single-game case but summed across every stint in the filtered games
    -- requires team_id since, unlike the career aggregate, this path
    doesn't average across multiple teams at once.
    """
    if game_id:
        if team_id is None:
            raise HTTPException(status_code=400, detail="team_id is required when filtering by game_id")

        stints = con.execute("""
            SELECT seconds, points_for, points_against, possessions_est, lineup
            FROM fact_lineup_stints
            WHERE game_id = ? AND team_id = ?
        """, [game_id, team_id]).fetchdf()
        if stints.empty:
            raise HTTPException(status_code=404, detail="No lineup stints found for that game/team")

        on = {"seconds": 0, "pf": 0, "pa": 0, "poss": 0}
        off = {"seconds": 0, "pf": 0, "pa": 0, "poss": 0}
        for _, row in stints.iterrows():
            on_court = player_id in (int(p) for p in row["lineup"].split("|") if p)
            bucket = on if on_court else off
            bucket["seconds"] += row["seconds"]
            bucket["pf"] += row["points_for"]
            bucket["pa"] += row["points_against"]
            bucket["poss"] += row["possessions_est"]

        def net_rating(b):
            return round(100.0 * (b["pf"] - b["pa"]) / b["poss"], 1) if b["poss"] else None

        return [{
            "player_id": player_id,
            "team_id": team_id,
            "game_id": game_id,
            "on_seconds": on["seconds"],
            "on_point_differential": on["pf"] - on["pa"],
            "on_net_rating_est": net_rating(on),
            "off_seconds": off["seconds"],
            "off_point_differential": off["pf"] - off["pa"],
            "off_net_rating_est": net_rating(off),
        }]

    if seasons or home_away:
        if team_id is None:
            raise HTTPException(status_code=400, detail="team_id is required when filtering by seasons or home_away")

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

        home_away_clause = ""
        if home_away == "home":
            home_away_clause = "AND g.team_id_home = s.team_id"
        elif home_away == "away":
            home_away_clause = "AND g.team_id_away = s.team_id"

        scoped = con.execute(f"""
            SELECT
                list_contains(string_split(s.lineup, '|'), CAST(? AS VARCHAR)) AS on_court,
                s.seconds, s.points_for, s.points_against, s.possessions_est
            FROM fact_lineup_stints s
            JOIN dim_game g ON g.game_id = s.game_id
            WHERE s.team_id = ? AND g.season_type = 'Regular Season' {season_clause} {home_away_clause}
        """, [player_id, team_id] + season_params).fetchdf()

        if scoped.empty:
            raise HTTPException(status_code=404, detail="No lineup-stint data found for that team/season/home_away filter")

        def _bucket(sub):
            seconds = float(sub["seconds"].sum())
            pf = float(sub["points_for"].sum())
            pa = float(sub["points_against"].sum())
            poss = float(sub["possessions_est"].sum())
            return seconds, pf, pa, poss

        on_sub = scoped[scoped["on_court"]]
        off_sub = scoped[~scoped["on_court"]]
        on_seconds, on_pf, on_pa, on_poss = _bucket(on_sub)
        off_seconds, off_pf, off_pa, off_poss = _bucket(off_sub)

        def net_rating(pf, pa, poss):
            return round(100.0 * (pf - pa) / poss, 1) if poss else None

        return [{
            "player_id": player_id,
            "team_id": team_id,
            "seasons_filter": seasons,
            "home_away_filter": home_away or "all",
            "on_seconds": on_seconds,
            "on_point_differential": on_pf - on_pa,
            "on_net_rating_est": net_rating(on_pf, on_pa, on_poss),
            "off_seconds": off_seconds,
            "off_point_differential": off_pf - off_pa,
            "off_net_rating_est": net_rating(off_pf, off_pa, off_poss),
        }]

    where = "WHERE player_id = ?"
    params = [player_id]
    if team_id is not None:
        where += " AND team_id = ?"
        params.append(team_id)

    df = con.execute(f"SELECT * FROM agg_player_on_off {where}", params).fetchdf()
    if df.empty:
        raise HTTPException(status_code=404, detail="No on/off data found for that player")
    return df.to_dict(orient="records")


@router.get("/{player_id}/game-averages")
def get_player_game_averages(
    player_id: int,
    seasons: Optional[str] = Query(None, description='Comma-separated "YYYY-YY" seasons. Omit for career (every season on record).'),
    home_away: Optional[str] = Query(None, pattern="^(home|away)$", description="Restrict to this player's home or away games. Omit for both."),
    con: duckdb.DuckDBPyConnection = Depends(get_db),
):
    """
    Per-game averages for this player across an arbitrary set of seasons
    (career if seasons is omitted), optionally split by home/away -- the
    Player Explorer's multi-season/career view.

    Built from fact_player_boxscore_game (a per-game box score derived
    from play-by-play -- see derive_player_boxscore.py) joined to dim_game
    for the season/home-away filtering, since fact_player_traditional_rs
    is season-level only and never carries a home/away split. FG/FG3
    splits come from fact_shot_chart over the same filtered games, since
    the derived box score only tracks point totals, not FGA/FGM. FT makes
    aren't tracked separately at all (see derive_player_boxscore.py's
    documented limitation), so there's no FT% here.
    """
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

    home_away_clause = ""
    if home_away == "home":
        home_away_clause = "AND g.team_id_home = b.team_id"
    elif home_away == "away":
        home_away_clause = "AND g.team_id_away = b.team_id"

    box_df = con.execute(f"""
        SELECT COUNT(*) AS gp,
               ROUND(AVG(b.pts), 1) AS pts, ROUND(AVG(b.reb), 1) AS reb,
               ROUND(AVG(b.oreb), 1) AS oreb, ROUND(AVG(b.dreb), 1) AS dreb,
               ROUND(AVG(b.ast), 1) AS ast, ROUND(AVG(b.stl), 1) AS stl,
               ROUND(AVG(b.blk), 1) AS blk, ROUND(AVG(b.tov), 1) AS tov, ROUND(AVG(b.pf), 1) AS pf
        FROM fact_player_boxscore_game b
        JOIN dim_game g ON g.game_id = b.game_id
        WHERE b.player_id = ? AND g.season_type = 'Regular Season' {season_clause} {home_away_clause}
    """, [player_id] + season_params).fetchdf()
    if box_df.empty or box_df["gp"].iloc[0] == 0:
        raise HTTPException(status_code=404, detail="No derived box-score data for that player/filter")
    row = box_df.to_dict(orient="records")[0]
    gp = row["gp"]

    shot_season_clause = ""
    if season_params:
        placeholders = ", ".join("?" for _ in season_params)
        shot_season_clause = f"AND s.SEASON_2 IN ({placeholders})"
    shot_home_away_clause = ""
    if home_away == "home":
        shot_home_away_clause = "AND t.abbreviation = s.HOME_TEAM"
    elif home_away == "away":
        shot_home_away_clause = "AND t.abbreviation = s.AWAY_TEAM"

    shoot_df = con.execute(f"""
        SELECT COUNT(*) AS fga,
               SUM(CASE WHEN s.SHOT_MADE THEN 1 ELSE 0 END) AS fgm,
               SUM(CASE WHEN s.SHOT_TYPE = '3PT Field Goal' THEN 1 ELSE 0 END) AS fg3a,
               SUM(CASE WHEN s.SHOT_TYPE = '3PT Field Goal' AND s.SHOT_MADE THEN 1 ELSE 0 END) AS fg3m
        FROM fact_shot_chart s
        JOIN dim_team t ON t.id = s.TEAM_ID
        WHERE s.PLAYER_ID = ? {shot_season_clause} {shot_home_away_clause}
    """, [player_id] + season_params).fetchdf()
    shoot = shoot_df.to_dict(orient="records")[0]
    fga, fgm = shoot.get("fga") or 0, shoot.get("fgm") or 0
    fg3a, fg3m = shoot.get("fg3a") or 0, shoot.get("fg3m") or 0

    seasons_covered = con.execute(f"""
        SELECT DISTINCT
            (CAST(g.season_id % 10000 AS VARCHAR) || '-' ||
             LPAD(CAST((g.season_id % 10000 + 1) % 100 AS VARCHAR), 2, '0')) AS season
        FROM fact_player_boxscore_game b
        JOIN dim_game g ON g.game_id = b.game_id
        WHERE b.player_id = ? AND g.season_type = 'Regular Season' {season_clause} {home_away_clause}
        ORDER BY 1
    """, [player_id] + season_params).fetchdf()["season"].tolist()

    return {
        "player_id": player_id,
        "seasons_included": seasons_covered,
        "home_away_filter": home_away or "all",
        "gp": gp,
        "pts": row["pts"], "reb": row["reb"], "oreb": row["oreb"], "dreb": row["dreb"],
        "ast": row["ast"], "stl": row["stl"], "blk": row["blk"], "tov": row["tov"], "pf": row["pf"],
        "fga_per_game": round(fga / gp, 1) if gp else None,
        "fg_pct": round(100.0 * fgm / fga, 1) if fga else None,
        "fg3a_per_game": round(fg3a / gp, 1) if gp else None,
        "fg3_pct": round(100.0 * fg3m / fg3a, 1) if fg3a else None,
    }


@router.get("/{player_id}/clutch")
def get_player_clutch(
    player_id: int,
    seasons: Optional[str] = Query(None, description='Comma-separated "YYYY-YY" seasons. Omit for every season on record.'),
    con: duckdb.DuckDBPyConnection = Depends(get_db),
):
    """
    Clutch-time per-game averages: period 4 or later (Q4/OT), 5:00 or less
    left in the period, score within 5 points either way at that moment --
    the standard definition. Built the same way as
    /players/{id}/game-averages, but from fact_player_boxscore_clutch (see
    derive_player_boxscore_clutch.py), a play-by-play derivation restricted
    to clutch-window events.

    fg_pct here uses a looser, TIME-ONLY definition of "clutch shot" (Q4/OT,
    <=5:00 left, no score-margin condition) since fact_shot_chart doesn't
    carry a live score margin to join against -- flagged via
    fg_pct_time_only_definition so the UI can caveat it. The counting stats
    above (pts/reb/ast/etc.) use the full, stricter definition.
    """
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

    box_df = con.execute(f"""
        SELECT COUNT(*) AS clutch_games,
               ROUND(AVG(b.pts), 1) AS pts, ROUND(AVG(b.reb), 1) AS reb,
               ROUND(AVG(b.ast), 1) AS ast, ROUND(AVG(b.stl), 1) AS stl,
               ROUND(AVG(b.blk), 1) AS blk, ROUND(AVG(b.tov), 1) AS tov,
               SUM(b.pts) AS total_pts
        FROM fact_player_boxscore_clutch b
        JOIN dim_game g ON g.game_id = b.game_id
        WHERE b.player_id = ? AND g.season_type = 'Regular Season' {season_clause}
    """, [player_id] + season_params).fetchdf()
    if box_df.empty or box_df["clutch_games"].iloc[0] == 0:
        raise HTTPException(status_code=404, detail="No clutch-window data found for that player/filter -- they may not have played any close-and-late minutes in this selection")
    row = box_df.to_dict(orient="records")[0]

    shot_season_clause = ""
    if season_params:
        placeholders = ", ".join("?" for _ in season_params)
        shot_season_clause = f"AND SEASON_2 IN ({placeholders})"
    shoot_df = con.execute(f"""
        SELECT COUNT(*) AS fga, SUM(CASE WHEN SHOT_MADE THEN 1 ELSE 0 END) AS fgm
        FROM fact_shot_chart
        WHERE PLAYER_ID = ? {shot_season_clause}
          AND QUARTER >= 4 AND (MINS_LEFT * 60 + SECS_LEFT) <= 300
    """, [player_id] + season_params).fetchdf()
    shoot = shoot_df.to_dict(orient="records")[0]
    fga, fgm = shoot.get("fga") or 0, shoot.get("fgm") or 0

    return {
        "player_id": player_id,
        "clutch_definition": "Period >= 4 (Q4/OT), <=5:00 left, score within 5 points",
        "clutch_games": row["clutch_games"],
        "pts": row["pts"], "reb": row["reb"], "ast": row["ast"],
        "stl": row["stl"], "blk": row["blk"], "tov": row["tov"],
        "total_clutch_pts": row["total_pts"],
        "fga_time_only": fga,
        "fg_pct_time_only": round(100.0 * fgm / fga, 1) if fga else None,
        "fg_pct_time_only_definition": "Q4/OT with <=5:00 left, NOT filtered by score margin (fact_shot_chart has no live margin to join against)",
    }


@router.get("/{player_id}/advanced")
def get_player_advanced(
    player_id: int,
    seasons: Optional[str] = Query(None, description='Comma-separated "YYYY-YY" seasons. Omit for every season on record.'),
    con: duckdb.DuckDBPyConnection = Depends(get_db),
):
    """
    Defense and offensive-role stats: DEF_RATING, STL%, BLK%, DREB%, and
    DEF_WS from fact_player_defense_rs; PTS_PAINT/PTS_FB/PTS_2ND_CHANCE
    (per-game scoring role) from fact_player_misc_rs. Both are
    season-aggregate tables, GP-weighted across the selected seasons (or
    every season on record) -- can't be split by home/away or a single
    game the way /game-averages can, since the source tables are
    season-level only. DEF_WS is a counting stat, so it's summed across
    seasons rather than averaged.

    IMPORTANT on DEF_WS: this is a real field pulled verbatim from the NBA
    stats API's own player-defense dashboard (not derived or estimated by
    this project) -- but it is NOT the same statistic as the commonly-cited
    Basketball-Reference "Defensive Win Shares" (confirmed by spot-check:
    Draymond Green's 2022-23 value here is 0.127, vs. roughly 2.5-3.0 on
    Basketball-Reference for the same season/player). It appears to be
    computed on a much smaller, undocumented internal scale. It's exposed
    here as a genuine NBA.com-sourced signal, not as a substitute for
    published Win Shares -- see /teams/{id}/win-shares for a from-scratch,
    clearly-labeled estimate calibrated to actually sum to team wins.
    """
    where = "WHERE PLAYER_ID = ?"
    params = [player_id]
    if seasons:
        season_list = [s.strip() for s in seasons.split(",") if s.strip()]
        if season_list:
            placeholders = ", ".join("?" for _ in season_list)
            where += f" AND SEASON IN ({placeholders})"
            params = [player_id] + season_list

    defense_df = con.execute(f"""
        SELECT SEASON, GP, DEF_RATING, DREB_PCT, PCT_STL, PCT_BLK, DEF_WS,
               OPP_PTS_PAINT, OPP_PTS_FB, OPP_PTS_2ND_CHANCE
        FROM fact_player_defense_rs {where}
    """, params).fetchdf()
    misc_df = con.execute(f"""
        SELECT SEASON, GP, PTS_PAINT, PTS_FB, PTS_2ND_CHANCE, PTS_OFF_TOV
        FROM fact_player_misc_rs {where}
    """, params).fetchdf()

    if defense_df.empty and misc_df.empty:
        raise HTTPException(status_code=404, detail="No defense/misc stats found for that player/season filter")

    def gp_weighted(df, col):
        if df.empty or col not in df or df[col].isna().all():
            return None
        valid = df.dropna(subset=[col])
        total_gp = valid["GP"].sum()
        if not total_gp:
            return None
        return round(float((valid[col] * valid["GP"]).sum() / total_gp), 1)

    seasons_included = sorted(set(defense_df["SEASON"].tolist()) | set(misc_df["SEASON"].tolist()))

    return {
        "player_id": player_id,
        "seasons_included": seasons_included,
        "def_rating": gp_weighted(defense_df, "DEF_RATING"),
        "dreb_pct": gp_weighted(defense_df, "DREB_PCT"),
        "pct_stl": gp_weighted(defense_df, "PCT_STL"),
        "pct_blk": gp_weighted(defense_df, "PCT_BLK"),
        "def_ws_total": round(float(defense_df["DEF_WS"].dropna().sum()), 1) if not defense_df.empty else None,
        "def_ws_source": "nba_stats_api_raw",
        "def_ws_note": "Pulled verbatim from the NBA stats API defense dashboard. NOT the same scale as Basketball-Reference Defensive Win Shares -- do not compare directly to published DWS figures.",
        "opp_pts_paint": gp_weighted(defense_df, "OPP_PTS_PAINT"),
        "opp_pts_fb": gp_weighted(defense_df, "OPP_PTS_FB"),
        "opp_pts_2nd_chance": gp_weighted(defense_df, "OPP_PTS_2ND_CHANCE"),
        "pts_paint": gp_weighted(misc_df, "PTS_PAINT"),
        "pts_fb": gp_weighted(misc_df, "PTS_FB"),
        "pts_2nd_chance": gp_weighted(misc_df, "PTS_2ND_CHANCE"),
        "pts_off_tov": gp_weighted(misc_df, "PTS_OFF_TOV"),
    }
