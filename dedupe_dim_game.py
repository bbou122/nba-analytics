"""
Fixes the 56 duplicate GAME_IDs in dim_game. Investigation showed every
duplicate pair is an All-Star game where all columns are identical except
season_type ("All-Star" vs "All Star" -- a hyphen inconsistency in the
source data, not a real data conflict). Keeps one row per game_id.

Run with: %run "C:/Users/15042/Downloads/nba data/dedupe_dim_game.py"
"""

import duckdb

DB_PATH = r"C:\Users\15042\Downloads\nba data\warehouse.duckdb"
con = duckdb.connect(DB_PATH)

before = con.execute("SELECT COUNT(*) FROM dim_game").fetchone()[0]
dupes_before = con.execute("""
    SELECT COUNT(*) FROM (
        SELECT game_id FROM dim_game GROUP BY game_id HAVING COUNT(*) > 1
    )
""").fetchone()[0]
print(f"dim_game rows before: {before:,}  (duplicated game_ids: {dupes_before})")

con.execute("""
    CREATE OR REPLACE TABLE dim_game AS
    SELECT * EXCLUDE (rn) FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY game_id ORDER BY season_type) AS rn
        FROM dim_game
    )
    WHERE rn = 1
""")

after = con.execute("SELECT COUNT(*) FROM dim_game").fetchone()[0]
dupes_after = con.execute("""
    SELECT COUNT(*) FROM (
        SELECT game_id FROM dim_game GROUP BY game_id HAVING COUNT(*) > 1
    )
""").fetchone()[0]
print(f"dim_game rows after:  {after:,}  (duplicated game_ids: {dupes_after})")
print(f"Rows removed: {before - after}")

con.close()
