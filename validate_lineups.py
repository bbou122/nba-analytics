"""
Sanity-checks the lineup derivation: each team's total on-court seconds per
game should be close to 2880 (48 min regulation), a bit more with overtime.

Run with: %run "C:/Users/15042/Downloads/nba data/validate_lineups.py"
"""

import duckdb

DB_PATH = r"C:\Users\15042\Downloads\nba data\warehouse.duckdb"
con = duckdb.connect(DB_PATH, read_only=True)

print("=== Distribution of total seconds per team-game ===")
df = con.execute("""
    SELECT team_id, game_id, SUM(seconds) AS total_seconds
    FROM fact_lineup_stints
    GROUP BY team_id, game_id
""").fetchdf()

print(df["total_seconds"].describe())

print("\n=== % of team-games within +/- 60 sec of 2880 (regulation) ===")
close = ((df["total_seconds"] - 2880).abs() <= 60).mean()
print(f"{close*100:.1f}%")

print("\n=== Worst 10 outliers (furthest from a clean regulation/OT total) ===")
# valid totals: 2880, 3180 (1 OT), 3480 (2 OT), etc.
def nearest_valid(s):
    options = [2880 + 300 * i for i in range(0, 5)]
    return min(options, key=lambda x: abs(x - s))

df["nearest_valid"] = df["total_seconds"].apply(nearest_valid)
df["diff"] = (df["total_seconds"] - df["nearest_valid"]).abs()
print(df.sort_values("diff", ascending=False).head(10).to_string())

print("\n=== Sample of qa_lineup_anomalies (first 10) ===")
anomalies = con.execute("SELECT * FROM qa_lineup_anomalies LIMIT 10").fetchdf()
print(anomalies.to_string())

print("\n=== Top 10 lineups by minutes played (sanity read) ===")
top = con.execute("""
    SELECT team_id, lineup, n_stints, total_seconds/60.0 AS minutes,
           point_differential, net_rating_est
    FROM agg_lineup_stats
    ORDER BY total_seconds DESC
    LIMIT 10
""").fetchdf()
print(top.to_string())

con.close()
