"""
Dumps every stint for the single worst outlier team-game so we can see
exactly where the overcounting happens, instead of guessing from aggregates.

Run with: %run "C:/Users/15042/Downloads/nba data/inspect_worst_stint.py"
"""

import duckdb
import pandas as pd

DB_PATH = r"C:\Users\15042\Downloads\nba data\warehouse.duckdb"
con = duckdb.connect(DB_PATH, read_only=True)

pd.set_option("display.max_rows", 200)
pd.set_option("display.width", 200)

GAME_ID = "0029800593"
TEAM_ID = 1610612747

print(f"=== All stints for team {TEAM_ID} in game {GAME_ID} ===")
stints = con.execute(f"""
    SELECT start_event, end_event, seconds, lineup, points_for, points_against, fga, made_fg, final_ft, tov
    FROM fact_lineup_stints
    WHERE game_id = '{GAME_ID}' AND team_id = {TEAM_ID}
    ORDER BY start_event
""").fetchdf()
print(stints.to_string())

print(f"\nSum of seconds: {stints['seconds'].sum()}")
print(f"Number of stints: {len(stints)}")

print("\n=== Raw substitution events for this team in this game ===")
subs = con.execute(f"""
    SELECT eventnum, period, pctimestring, player1_id, player1_name, player2_id, player2_name, player1_team_id
    FROM fact_play_by_play
    WHERE game_id = '{GAME_ID}' AND eventmsgtype = 8 AND player1_team_id = {TEAM_ID}
    ORDER BY eventnum
""").fetchdf()
print(subs.to_string())

con.close()
