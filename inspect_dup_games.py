"""
Investigates the 56 duplicate GAME_IDs flagged in dim_game during the
original build_warehouse.py validation run.

Run with: %run "C:/Users/15042/Downloads/nba data/inspect_dup_games.py"
"""

import duckdb

DB_PATH = r"C:\Users\15042\Downloads\nba data\warehouse.duckdb"
con = duckdb.connect(DB_PATH, read_only=True)

print("=== Column list for dim_game ===")
cols = [r[0] for r in con.execute("DESCRIBE dim_game").fetchall()]
print(cols)

print("\n=== The duplicated GAME_IDs themselves ===")
dupes = con.execute("""
    SELECT game_id, COUNT(*) AS n
    FROM dim_game
    GROUP BY game_id
    HAVING COUNT(*) > 1
    ORDER BY game_id
""").fetchdf()
print(dupes.to_string())
print(f"\nTotal distinct duplicated game_ids: {len(dupes)}")
print(f"Total extra rows caused by dupes: {(dupes['n'] - 1).sum()}")

print("\n=== Full rows for the first 5 duplicated game_ids (side by side) ===")
sample_ids = dupes["game_id"].head(5).tolist()
for gid in sample_ids:
    print(f"\n--- game_id {gid} ---")
    rows = con.execute(f"SELECT * FROM dim_game WHERE game_id = '{gid}'").fetchdf()
    print(rows.to_string())

print("\n=== Are the duplicate rows exact duplicates, or do they differ? ===")
# count distinct full rows per game_id among the dupes; if 1, they're exact dupes
check = con.execute(f"""
    SELECT game_id, COUNT(*) AS n_rows, COUNT(DISTINCT {', '.join(cols)}) AS n_distinct_rows
    FROM dim_game
    WHERE game_id IN ({', '.join("'" + g + "'" for g in dupes['game_id'])})
    GROUP BY game_id
""").fetchdf() if False else None
# (DuckDB doesn't support COUNT(DISTINCT col1, col2, ...) directly -- use a hash instead)
check = con.execute(f"""
    WITH d AS (
        SELECT *, md5(CAST(dim_game AS VARCHAR)) AS row_hash
        FROM (SELECT * FROM dim_game) AS dim_game
    )
    SELECT game_id, COUNT(*) AS n_rows, COUNT(DISTINCT row_hash) AS n_distinct_rows
    FROM d
    WHERE game_id IN ({', '.join("'" + g + "'" for g in dupes['game_id'])})
    GROUP BY game_id
    ORDER BY game_id
""").fetchdf()
print(check.to_string())
exact_dupe_count = (check["n_distinct_rows"] == 1).sum()
diff_count = (check["n_distinct_rows"] > 1).sum()
print(f"\nGame_ids where duplicate rows are byte-identical: {exact_dupe_count}")
print(f"Game_ids where duplicate rows actually differ: {diff_count}")

con.close()
