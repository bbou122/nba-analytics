"""
Derives a per-player, per-game CLUTCH box score (PTS/OREB/DREB/REB/AST/STL/
BLK/TOV/PF) from fact_play_by_play, the same event-crediting method as
derive_player_boxscore.py, restricted to clutch-window events only.

Clutch window, standard definition: period >= 4 (Q4 or any OT) AND 5:00 or
less remaining in that period AND the score margin at that moment is 5
points or fewer either way. Time comes from pctimestring (stored as a TIME
value where the hour component is actually minutes-remaining and the
minute component is seconds-remaining -- confirmed against sample rows).
Margin comes from scoremargin ("TIE" or a signed string, home minus away --
confirmed against the score field on the same rows), forward-filled across
events the same way the running score is in derive_player_boxscore.py,
since it's only populated on scoring plays.

Same limitations as the full-game version apply here (approximate, not an
official box score; no FTA tracking; PF lumps all foul types together).
"""

import time

import duckdb

DB_PATH = r"C:\Users\15042\Downloads\nba data\warehouse.duckdb"


def main():
    con = duckdb.connect(DB_PATH, read_only=False)
    t0 = time.time()

    print("Building per-event point deltas + rebound context + clutch flag...")
    con.execute("""
        CREATE OR REPLACE TEMP TABLE events AS
        WITH parsed AS (
            SELECT game_id, eventnum, eventmsgtype, period, pctimestring,
                   player1_id, player1_team_id,
                   player2_id, player2_team_id,
                   player3_id,
                   CASE WHEN score IS NOT NULL THEN CAST(split_part(score, ' - ', 1) AS INTEGER) END AS away_score,
                   CASE WHEN score IS NOT NULL THEN CAST(split_part(score, ' - ', 2) AS INTEGER) END AS home_score,
                   CASE
                       WHEN scoremargin IS NULL THEN NULL
                       WHEN scoremargin = 'TIE' THEN 0
                       ELSE TRY_CAST(scoremargin AS INTEGER)
                   END AS margin_raw
            FROM fact_play_by_play
        ),
        run AS (
            SELECT *,
                COALESCE(LAST_VALUE(away_score IGNORE NULLS) OVER (PARTITION BY game_id ORDER BY eventnum), 0) AS run_away,
                COALESCE(LAST_VALUE(home_score IGNORE NULLS) OVER (PARTITION BY game_id ORDER BY eventnum), 0) AS run_home,
                LAST_VALUE(margin_raw IGNORE NULLS) OVER (PARTITION BY game_id ORDER BY eventnum) AS run_margin
            FROM parsed
        ),
        deltas AS (
            SELECT *,
                (run_away - COALESCE(LAG(run_away) OVER (PARTITION BY game_id ORDER BY eventnum), 0)) +
                (run_home - COALESCE(LAG(run_home) OVER (PARTITION BY game_id ORDER BY eventnum), 0)) AS pts_delta,
                COALESCE(EXTRACT(hour FROM pctimestring) * 60 + EXTRACT(minute FROM pctimestring), 9999) AS secs_left_in_period
            FROM run
        ),
        miss_marked AS (
            SELECT *,
                CASE
                    WHEN eventmsgtype = 2 THEN player1_team_id
                    WHEN eventmsgtype = 3 AND pts_delta = 0 THEN player1_team_id
                    ELSE NULL
                END AS miss_team_id
            FROM deltas
        )
        SELECT *,
            LAST_VALUE(miss_team_id IGNORE NULLS) OVER (PARTITION BY game_id ORDER BY eventnum) AS last_miss_team_id,
            (period >= 4 AND secs_left_in_period <= 300 AND run_margin IS NOT NULL AND ABS(run_margin) <= 5) AS is_clutch
        FROM miss_marked
    """)
    n_clutch_events = con.execute("SELECT COUNT(*) FROM events WHERE is_clutch").fetchone()[0]
    print(f"  done ({time.time() - t0:.1f}s) -- {n_clutch_events:,} clutch-window events")

    print("Building per-player team-for-game map (reused from the full-game derivation)...")
    con.execute("""
        CREATE OR REPLACE TEMP TABLE player_team_game AS
        SELECT game_id, player_id, team_id
        FROM (
            SELECT game_id, player_id, team_id,
                   ROW_NUMBER() OVER (PARTITION BY game_id, player_id ORDER BY COUNT(*) DESC) AS rn
            FROM (
                SELECT game_id, player1_id AS player_id, player1_team_id AS team_id
                FROM fact_play_by_play WHERE player1_id IS NOT NULL AND player1_id != 0 AND player1_team_id IS NOT NULL
                UNION ALL
                SELECT game_id, player2_id, player2_team_id
                FROM fact_play_by_play WHERE player2_id IS NOT NULL AND player2_id != 0 AND player2_team_id IS NOT NULL
                UNION ALL
                SELECT game_id, player3_id, player3_team_id
                FROM fact_play_by_play WHERE player3_id IS NOT NULL AND player3_id != 0 AND player3_team_id IS NOT NULL
            )
            GROUP BY game_id, player_id, team_id
        )
        WHERE rn = 1
    """)
    print(f"  done ({time.time() - t0:.1f}s)")

    print("Building clutch stat credits and pivoting...")
    con.execute("""
        CREATE OR REPLACE TABLE fact_player_boxscore_clutch AS
        WITH credits AS (
            SELECT game_id, player1_id AS player_id, 'PTS' AS stat, CAST(pts_delta AS DOUBLE) AS value
            FROM events WHERE is_clutch AND eventmsgtype IN (1, 3) AND pts_delta > 0 AND player1_id IS NOT NULL AND player1_id != 0

            UNION ALL
            SELECT game_id, player2_id, 'AST', 1.0
            FROM events WHERE is_clutch AND eventmsgtype = 1 AND player2_id IS NOT NULL AND player2_id != 0

            UNION ALL
            SELECT game_id, player3_id, 'BLK', 1.0
            FROM events WHERE is_clutch AND eventmsgtype = 2 AND player3_id IS NOT NULL AND player3_id != 0

            UNION ALL
            SELECT game_id, player1_id,
                   CASE WHEN last_miss_team_id IS NOT NULL AND player1_team_id = last_miss_team_id THEN 'OREB' ELSE 'DREB' END,
                   1.0
            FROM events WHERE is_clutch AND eventmsgtype = 4 AND player1_id IS NOT NULL AND player1_id != 0

            UNION ALL
            SELECT game_id, player1_id, 'TOV', 1.0
            FROM events WHERE is_clutch AND eventmsgtype = 5 AND player1_id IS NOT NULL AND player1_id != 0

            UNION ALL
            SELECT game_id, player2_id, 'STL', 1.0
            FROM events WHERE is_clutch AND eventmsgtype = 5 AND player2_id IS NOT NULL AND player2_id != 0

            UNION ALL
            SELECT game_id, player1_id, 'PF', 1.0
            FROM events WHERE is_clutch AND eventmsgtype = 6 AND player1_id IS NOT NULL AND player1_id != 0
        ),
        pivoted AS (
            SELECT game_id, player_id,
                   SUM(CASE WHEN stat = 'PTS' THEN value ELSE 0 END) AS pts,
                   SUM(CASE WHEN stat = 'OREB' THEN value ELSE 0 END) AS oreb,
                   SUM(CASE WHEN stat = 'DREB' THEN value ELSE 0 END) AS dreb,
                   SUM(CASE WHEN stat = 'AST' THEN value ELSE 0 END) AS ast,
                   SUM(CASE WHEN stat = 'STL' THEN value ELSE 0 END) AS stl,
                   SUM(CASE WHEN stat = 'BLK' THEN value ELSE 0 END) AS blk,
                   SUM(CASE WHEN stat = 'TOV' THEN value ELSE 0 END) AS tov,
                   SUM(CASE WHEN stat = 'PF' THEN value ELSE 0 END) AS pf
            FROM credits
            GROUP BY game_id, player_id
        )
        SELECT p.game_id, p.player_id, t.team_id,
               p.pts, p.oreb, p.dreb, (p.oreb + p.dreb) AS reb,
               p.ast, p.stl, p.blk, p.tov, p.pf
        FROM pivoted p
        LEFT JOIN player_team_game t ON t.game_id = p.game_id AND t.player_id = p.player_id
    """)
    n = con.execute("SELECT COUNT(*) FROM fact_player_boxscore_clutch").fetchone()[0]
    print(f"  done ({time.time() - t0:.1f}s) -- {n:,} player-game clutch rows")

    con.execute("CREATE INDEX IF NOT EXISTS idx_pbc_game ON fact_player_boxscore_clutch(game_id)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_pbc_player ON fact_player_boxscore_clutch(player_id)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_pbc_team ON fact_player_boxscore_clutch(team_id)")

    print("\n--- Spot check: top clutch scorers by total clutch points, 2022-23 ---")
    check = con.execute("""
        SELECT c.player_id, pl.full_name, COUNT(*) AS clutch_games,
               ROUND(AVG(c.pts), 1) AS avg_clutch_pts, SUM(c.pts) AS total_clutch_pts
        FROM fact_player_boxscore_clutch c
        JOIN dim_game g ON g.game_id = c.game_id AND g.season_type = 'Regular Season'
        JOIN dim_player pl ON pl.id = c.player_id
        WHERE (CAST(g.season_id % 10000 AS VARCHAR) || '-' || LPAD(CAST((g.season_id % 10000 + 1) % 100 AS VARCHAR), 2, '0')) = '2022-23'
        GROUP BY c.player_id, pl.full_name
        ORDER BY total_clutch_pts DESC
        LIMIT 10
    """).fetchdf()
    print(check.to_string())

    con.close()
    print(f"\nTotal time: {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
