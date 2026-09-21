"""
Quick inspection of fact_play_by_play in the warehouse before we build
lineup/on-off derivation logic against it.

Run with: %run "C:/Users/15042/Downloads/nba data/inspect_pbp.py"
"""

import duckdb

DB_PATH = r"C:\Users\15042\Downloads\nba data\warehouse.duckdb"

con = duckdb.connect(DB_PATH, read_only=True)

print("=== Columns ===")
for row in con.execute("DESCRIBE fact_play_by_play").fetchall():
    print(row[0], "-", row[1])

print("\n=== Sample rows (first game found) ===")
first_game = con.execute("SELECT game_id FROM fact_play_by_play LIMIT 1").fetchone()
if first_game:
    gid = first_game[0]
    df = con.execute(
        f"SELECT * FROM fact_play_by_play WHERE game_id = '{gid}' ORDER BY eventnum LIMIT 15"
        if "game_id" in [c[0] for c in con.execute("DESCRIBE fact_play_by_play").fetchall()]
        else "SELECT * FROM fact_play_by_play LIMIT 15"
    ).fetchdf()
    print(df.to_string())

print("\n=== Distinct EVENTMSGTYPE values (or equivalent) and counts ===")
cols = [c[0].lower() for c in con.execute("DESCRIBE fact_play_by_play").fetchall()]
event_type_col = next((c for c in cols if "eventmsgtype" in c or c == "event_type"), None)
if event_type_col:
    print(con.execute(
        f"SELECT {event_type_col}, COUNT(*) FROM fact_play_by_play GROUP BY {event_type_col} ORDER BY {event_type_col}"
    ).fetchdf().to_string())
else:
    print("No obvious event-type column found. Columns were:", cols)

con.close()
