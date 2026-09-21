import duckdb
from fastapi import APIRouter, Depends, Query

from db import get_db

router = APIRouter()


@router.get("/summary")
def get_data_quality_summary(con: duckdb.DuckDBPyConnection = Depends(get_db)):
    """
    Transparency page for the lineup-derivation pipeline (see
    derive_lineups.py): how many team-games were excluded, what kinds of
    anomalies and mid-stream corrections the parser hit, and how big the
    resulting warehouse tables are. Nothing here is hidden from the rest
    of the app -- this just surfaces it in one place instead of leaving
    it buried in QA tables no one looks at.
    """
    table_counts = {}
    for t in ["dim_game", "dim_team", "dim_player", "fact_play_by_play", "fact_shot_chart",
              "fact_lineup_stints", "agg_lineup_stats", "agg_player_on_off"]:
        table_counts[t] = con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]

    excluded_count = con.execute("SELECT COUNT(*) FROM qa_excluded_team_games").fetchone()[0]
    excluded_worst = con.execute("""
        SELECT team_id, game_id, total_seconds, nearest_valid, diff
        FROM qa_excluded_team_games ORDER BY diff DESC LIMIT 10
    """).fetchdf().to_dict(orient="records")

    total_team_games = con.execute("""
        SELECT COUNT(*) FROM (
            SELECT game_id, team_id_home AS team_id FROM dim_game
            UNION ALL
            SELECT game_id, team_id_away AS team_id FROM dim_game
        )
    """).fetchone()[0]

    anomalies_df = con.execute("""
        SELECT
            CASE
                WHEN anomaly LIKE '%starters before first sub%' THEN 'Missing starters before first substitution'
                ELSE 'Other'
            END AS category,
            COUNT(*) AS n
        FROM qa_lineup_anomalies
        GROUP BY 1 ORDER BY 2 DESC
    """).fetchdf()

    corrections_df = con.execute("""
        SELECT
            CASE
                WHEN correction LIKE '%clamped to%' THEN 'Out-of-order period clamped'
                ELSE 'Other'
            END AS category,
            COUNT(*) AS n
        FROM qa_period_corrections
        GROUP BY 1 ORDER BY 2 DESC
    """).fetchdf()

    return {
        "table_counts": table_counts,
        "lineup_pipeline": {
            "total_team_games": total_team_games,
            "excluded_team_games": excluded_count,
            "excluded_pct": round(100.0 * excluded_count / total_team_games, 2) if total_team_games else None,
            "excluded_worst_examples": excluded_worst,
            "anomaly_categories": anomalies_df.to_dict(orient="records"),
            "correction_categories": corrections_df.to_dict(orient="records"),
        },
    }


@router.get("/excluded")
def get_excluded(
    team_id: int = Query(None),
    limit: int = Query(50, le=500),
    con: duckdb.DuckDBPyConnection = Depends(get_db),
):
    """Same data as /lineups/excluded, kept here too so the Data Quality
    page doesn't need to reach into the lineups router's namespace."""
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
