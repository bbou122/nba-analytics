"""
Inspects the exact columns of every table the FastAPI backend's first
endpoints (teams, players, shot charts) will need, so we build against
real column names instead of guessing.

Run with: %run "C:/Users/15042/Downloads/nba data/inspect_api_tables.py"
"""

import duckdb

DB_PATH = r"C:\Users\15042\Downloads\nba data\warehouse.duckdb"
con = duckdb.connect(DB_PATH, read_only=True)

TABLES = [
    "dim_team",
    "dim_player",
    "dim_common_player_info",
    "fact_team_traditional_rs",
    "fact_team_advanced_rs",
    "fact_player_traditional_rs",
    "fact_player_advanced_rs",
    "fact_shot_chart",
    "dim_game",
]

for t in TABLES:
    print(f"\n{'='*70}\n{t}\n{'='*70}")
    try:
        cols = con.execute(f"DESCRIBE {t}").fetchdf()
        print(cols.to_string())
        n = con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        print(f"\nrow count: {n:,}")
        sample = con.execute(f"SELECT * FROM {t} LIMIT 3").fetchdf()
        print("\nsample rows:")
        print(sample.to_string())
    except Exception as e:
        print(f"[error] {t}: {e}")

print("\n\n=== Distinct season values available (fact_player_traditional_rs) ===")
try:
    seasons = con.execute("""
        SELECT DISTINCT season FROM fact_player_traditional_rs ORDER BY season
    """).fetchdf()
    print(seasons.to_string())
except Exception as e:
    print(f"[error] listing seasons: {e}")
    cols = con.execute("DESCRIBE fact_player_traditional_rs").fetchdf()
    print("Columns were:", list(cols["column_name"]))

con.close()
