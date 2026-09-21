"""
Derives a per-player, per-game box score (PTS/OREB/DREB/REB/AST/STL/BLK/TOV/PF)
directly from fact_play_by_play. No such table exists in the warehouse --
fact_player_traditional_rs etc. are season aggregates only -- so this fills
that gap for anything that needs "how did each player do in this specific
game / stretch of games" (e.g. the Executive Dashboard's game-log stretch
view).

Method, event by event (eventnum order within each game):
  - Points: the SCORE field ("away - home", only populated on scoring plays)
    diffed against a running score, same convention derive_lineups.py uses.
    The player who took the shot/FT (player1) gets the delta.
  - Assists: player2 on a made-shot event (eventmsgtype=1).
  - Blocks: player3 on a missed-shot event (eventmsgtype=2).
  - Rebounds: player1 on a rebound event (eventmsgtype=4); it's an offensive
    rebound if player1's team matches the team that just missed (tracked via
    a "last miss" running value), else defensive.
  - Turnovers: player1 on a turnover event (eventmsgtype=5).
  - Steals: player2 on a turnover event, when present (the NBA feed only
    populates player2 on a TOV row when a steal caused it).
  - Personal fouls: player1 on a foul event (eventmsgtype=6) -- this counts
    every foul type together (offensive fouls included), so it will run
    slightly higher than official "PF" on rare games with double/flagrant
    fouls counted differently by the NBA's own box score. Good enough for
    "who's hot / who's in foul trouble" dashboard use, not official record.

This is an approximation, not an official box score -- validated by summing
across a season and comparing to fact_player_traditional_rs's per-game
averages for a handful of high-minute players (see the checks printed at
the end -- run this script to see them). Missed free throws, and FTA in
general, are not tracked (fact_shot_chart already covers FG attempts/makes
by player/game for anyone who wants shooting splits -- this table is for
the box-score counting stats the shot chart doesn't cover).

Run from this folder with a duckdb-enabled Python (e.g. in Jupyter, or any
env with `pip install duckdb`):
    python derive_player_boxscore.py
"""

import time

import duckdb

DB_PATH = r"C:\Users\15042\Downloads\nba data\warehouse.duckdb"


def main():
    con = duckdb.connect(DB_PATH, read_only=False)
    t0 = time.time()

    print("Building per-event point deltas + rebound context...")
    con.execute("""
        CREATE OR REPLACE TEMP TABLE events AS
        WITH parsed AS (
            SELECT game_id, eventnum, eventmsgtype,
                   player1_id, player1_team_id,
                   player2_id, player2_team_id,
                   player3_id,
                   CASE WHEN score IS NOT NULL THEN CAST(split_part(score, ' - ', 1) AS INTEGER) END AS away_score,
                   CASE WHEN score IS NOT NULL THEN CAST(split_part(score, ' - ', 2) AS INTEGER) END AS home_score
            FROM fact_play_by_play
        ),
        run AS (
            SELECT *,
                COALESCE(LAST_VALUE(away_score IGNORE NULLS) OVER (PARTITION BY game_id ORDER BY eventnum), 0) AS run_away,
                COALESCE(LAST_VALUE(home_score IGNORE NULLS) OVER (PARTITION BY game_id ORDER BY eventnum), 0) AS run_home
            FROM parsed
        ),
        deltas AS (
            SELECT *,
                (run_away - COALESCE(LAG(run_away) OVER (PARTITION BY game_id ORDER BY eventnum), 0)) +
                (run_home - COALESCE(LAG(run_home) OVER (PARTITION BY game_id ORDER BY eventnum), 0)) AS pts_delta
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
            LAST_VALUE(miss_team_id IGNORE NULLS) OVER (PARTITION BY game_id ORDER BY eventnum) AS last_miss_team_id
        FROM miss_marked
    """)
    print(f"  done ({time.time() - t0:.1f}s)")

    print("Building per-player team-for-game map...")
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

    print("Building stat credits and pivoting...")
    con.execute("""
        CREATE OR REPLACE TABLE fact_player_boxscore_game AS
        WITH credits AS (
            SELECT game_id, player1_id AS player_id, 'PTS' AS stat, CAST(pts_delta AS DOUBLE) AS value
            FROM events WHERE eventmsgtype IN (1, 3) AND pts_delta > 0 AND player1_id IS NOT NULL AND player1_id != 0

            UNION ALL
            SELECT game_id, player2_id, 'AST', 1.0
            FROM events WHERE eventmsgtype = 1 AND player2_id IS NOT NULL AND player2_id != 0

            UNION ALL
            SELECT game_id, player3_id, 'BLK', 1.0
            FROM events WHERE eventmsgtype = 2 AND player3_id IS NOT NULL AND player3_id != 0

            UNION ALL
            SELECT game_id, player1_id,
                   CASE WHEN last_miss_team_id IS NOT NULL AND player1_team_id = last_miss_team_id THEN 'OREB' ELSE 'DREB' END,
                   1.0
            FROM events WHERE eventmsgtype = 4 AND player1_id IS NOT NULL AND player1_id != 0

            UNION ALL
            SELECT game_id, player1_id, 'TOV', 1.0
            FROM events WHERE eventmsgtype = 5 AND player1_id IS NOT NULL AND player1_id != 0

            UNION ALL
            SELECT game_id, player2_id, 'STL', 1.0
            FROM events WHERE eventmsgtype = 5 AND player2_id IS NOT NULL AND player2_id != 0

            UNION ALL
            SELECT game_id, player1_id, 'PF', 1.0
            FROM events WHERE eventmsgtype = 6 AND player1_id IS NOT NULL AND player1_id != 0
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
    n = con.execute("SELECT COUNT(*) FROM fact_player_boxscore_game").fetchone()[0]
    print(f"  done ({time.time() - t0:.1f}s) -- {n:,} player-game rows")

    con.execute("CREATE INDEX IF NOT EXISTS idx_pbg_game ON fact_player_boxscore_game(game_id)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_pbg_player ON fact_player_boxscore_game(player_id)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_pbg_team ON fact_player_boxscore_game(team_id)")

    print("\n--- Validation: compare derived per-game sums to season totals ---")
    check = con.execute("""
        SELECT d.player_id, p.PLAYER_NAME, p.SEASON,
               p.GP, p.PTS AS season_avg_pts, p.REB AS season_avg_reb, p.AST AS season_avg_ast,
               ROUND(AVG(d.pts), 1) AS derived_avg_pts,
               ROUND(AVG(d.reb), 1) AS derived_avg_reb,
               ROUND(AVG(d.ast), 1) AS derived_avg_ast,
               COUNT(*) AS derived_gp
        FROM fact_player_boxscore_game d
        JOIN dim_game g ON g.game_id = d.game_id AND g.season_type = 'Regular Season'
        JOIN fact_player_traditional_rs p
          ON p.PLAYER_ID = d.player_id
         AND p.SEASON = (CAST(g.season_id % 10000 AS VARCHAR) || '-' || LPAD(CAST((g.season_id % 10000 + 1) % 100 AS VARCHAR), 2, '0'))
        WHERE p.PLAYER_NAME IN ('Jayson Tatum', 'Nikola Jokic', 'Stephen Curry', 'Draymond Green')
          AND p.SEASON = '2022-23'
        GROUP BY d.player_id, p.PLAYER_NAME, p.SEASON, p.GP, p.PTS, p.REB, p.AST
    """).fetchdf()
    print(check.to_string())

    con.close()
    print(f"\nTotal time: {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
