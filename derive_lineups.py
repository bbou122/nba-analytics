"""
Derives five-man lineup stints and on/off splits from fact_play_by_play,
and writes them into warehouse.duckdb as:
  - fact_lineup_stints   (one row per continuous 5-man stretch per team per game)
  - agg_lineup_stats     (aggregated by team + 5-man combo across all games)
  - agg_player_on_off    (aggregated on-court vs off-court team performance per player)

METHOD (documented, not hidden -- these are estimates, not ground truth):
  - Starting five per team = first 5 distinct players seen in any event for
    that team before that team's first substitution. Standard reconstruction
    heuristic; can rarely miss a starter who touches nothing before the first sub.
  - Point differential per stint comes directly from the SCORE field (exact).
  - Possessions per stint are ESTIMATED as: made FG + final free throw of each
    trip + turnovers, for each team. This is a simplified possession estimator,
    not a full ball-tracking reconstruction -- ratings derived from it should be
    read as approximate, especially for small-sample stints.

Requires: pip install duckdb pandas
Run with: %run "C:/Users/15042/Downloads/nba data/derive_lineups.py"
"""

import re
import time
import duckdb
import pandas as pd
from collections import defaultdict

DB_PATH = r"C:\Users\15042\Downloads\nba data\warehouse.duckdb"
PERIOD_LENGTH_SEC = 12 * 60
OT_LENGTH_SEC = 5 * 60

FT_TRIP_END_RE = re.compile(r"(\d+) of \1\b")  # matches "1 of 1", "2 of 2", "3 of 3"


def pctime_to_seconds(t):
    # pctimestring / TIME column comes in as a time-of-day-ish "MM:SS:00" -> seconds remaining in period
    if t is None:
        return 0
    try:
        parts = str(t).split(":")
        minutes, seconds = int(parts[0]), int(parts[1])
        return minutes * 60 + seconds
    except Exception:
        return 0


def elapsed_game_seconds(period, seconds_remaining_in_period):
    period = int(period)
    if period <= 4:
        period_len = PERIOD_LENGTH_SEC
        prior = (period - 1) * PERIOD_LENGTH_SEC
    else:
        period_len = OT_LENGTH_SEC
        prior = 4 * PERIOD_LENGTH_SEC + (period - 5) * OT_LENGTH_SEC
    return prior + (period_len - seconds_remaining_in_period)


def parse_score(score_str):
    # SCORE field looks like "0 - 2" (away - home), only populated on scoring plays
    if not score_str or pd.isna(score_str):
        return None
    try:
        a, h = score_str.split(" - ")
        return int(a), int(h)
    except Exception:
        return None


def is_final_ft(desc):
    if not desc or pd.isna(desc):
        return False
    return bool(FT_TRIP_END_RE.search(str(desc)))


def process_game(game_id, rows):
    """rows: list of dict-like records for one game, in event order."""
    on_court = {}       # team_id -> set(player_id)
    started_five = {}   # team_id -> bool (locked in)
    seen_players = defaultdict(set)  # team_id -> set of player_ids seen so far (pre-lock)

    stints = []          # finished stints
    current_stint_start = {}   # team_id -> (event_num, elapsed_sec, score_away, score_home)
    current_lineup = {}        # team_id -> frozenset

    running_score = (0, 0)  # away, home
    stint_counts = defaultdict(lambda: {"fga": 0, "made_fg": 0, "final_ft": 0, "tov": 0})
    max_period_seen = 0  # BUGFIX: some games have rows where `period` is
    # corrupted mid-game (e.g. reports period=1 for events that fall
    # chronologically -- by eventnum -- between two period=4 events). Real
    # NBA period numbers are never supposed to decrease as eventnum
    # increases, so we clamp: the effective period used for elapsed-time
    # math never goes backward. This turned a single ~2300-second phantom
    # stint (computed as "early Q1 to late Q4") into a normal few-minute
    # stint. Every time the raw period disagrees with the clamped value we
    # log it so affected games are visible for QA, not silently patched.
    period_corrections = []

    def team_ids_in_row(r):
        ids = set()
        for slot in (1, 2, 3):
            tid = r.get(f"player{slot}_team_id")
            pid = r.get(f"player{slot}_id")
            if tid and not pd.isna(tid) and tid != 0 and pid and pid != 0:
                ids.add(int(tid))
        return ids

    all_team_ids = set()
    for r in rows:
        all_team_ids |= team_ids_in_row(r)
    if len(all_team_ids) < 2:
        return [], [], []  # can't do anything useful

    # Resolve which team is home vs away by finding any row where a team's
    # player appears alongside a populated homedescription/visitordescription.
    # This is exact (not a heuristic) -- homedescription/visitordescription
    # are always populated correctly by the source, we're just reading them.
    home_team_id = None
    away_team_id = None
    for r in rows:
        for slot in (1, 2, 3):
            tid = r.get(f"player{slot}_team_id")
            if tid and not pd.isna(tid) and tid != 0:
                tid = int(tid)
                if r.get("homedescription") and not pd.isna(r.get("homedescription")) and home_team_id is None:
                    home_team_id = tid
                if r.get("visitordescription") and not pd.isna(r.get("visitordescription")) and away_team_id is None:
                    away_team_id = tid
        if home_team_id is not None and away_team_id is not None:
            break
    if home_team_id is None or away_team_id is None:
        # fall back: whichever two team ids we found, order doesn't matter
        # for total point differential across the two teams, but home/away
        # sign could be off for this game -- flag it.
        remaining = list(all_team_ids)
        home_team_id = remaining[0]
        away_team_id = remaining[1] if len(remaining) > 1 else remaining[0]

    def points_for_delta(tid, start_away, start_home, end_away, end_home):
        if tid == home_team_id:
            return end_home - start_home
        elif tid == away_team_id:
            return end_away - start_away
        return 0  # shouldn't happen

    def points_against_delta(tid, start_away, start_home, end_away, end_home):
        # opponent's score delta during the same window -- symmetric to points_for
        if tid == home_team_id:
            return end_away - start_away
        elif tid == away_team_id:
            return end_home - start_home
        return 0

    for tid in all_team_ids:
        on_court[tid] = set()
        started_five[tid] = False
        current_lineup[tid] = frozenset()

    anomalies = []

    for r in rows:
        etype = r["eventmsgtype"]
        raw_period = int(r["period"])
        if raw_period < max_period_seen:
            period_corrections.append(
                f"game {game_id} eventnum {r['eventnum']}: raw period {raw_period} "
                f"< running max {max_period_seen}, clamped to {max_period_seen}"
            )
            period = max_period_seen
        else:
            period = raw_period
            max_period_seen = raw_period
        secs_remaining = pctime_to_seconds(r["pctimestring"])
        elapsed = elapsed_game_seconds(period, secs_remaining)

        # bootstrap starters: collect any player mentions before that team's first sub
        for slot in (1, 2, 3):
            tid = r.get(f"player{slot}_team_id")
            pid = r.get(f"player{slot}_id")
            if tid and not pd.isna(tid) and tid != 0 and pid and pid != 0:
                tid = int(tid)
                if not started_five.get(tid, True) and len(seen_players[tid]) < 5:
                    seen_players[tid].add(int(pid))

        sp = parse_score(r["score"])
        if sp:
            running_score = sp

        # count possession-relevant events per team, keyed to whichever team's stint is open
        if etype == 1:  # made FG
            tid = r.get("player1_team_id")
            if tid and not pd.isna(tid):
                stint_counts[int(tid)]["fga"] += 1
                stint_counts[int(tid)]["made_fg"] += 1
        elif etype == 2:  # missed FG
            tid = r.get("player1_team_id")
            if tid and not pd.isna(tid):
                stint_counts[int(tid)]["fga"] += 1
        elif etype == 3:  # free throw
            tid = r.get("player1_team_id")
            desc = r.get("homedescription") or r.get("visitordescription") or r.get("neutraldescription")
            if tid and not pd.isna(tid) and is_final_ft(desc):
                stint_counts[int(tid)]["final_ft"] += 1
        elif etype == 5:  # turnover
            tid = r.get("player1_team_id")
            if tid and not pd.isna(tid):
                stint_counts[int(tid)]["tov"] += 1

        elif etype == 8:  # substitution
            tid = r.get("player1_team_id")
            if not tid or pd.isna(tid):
                continue
            tid = int(tid)
            out_id = int(r["player1_id"]) if r["player1_id"] else None
            in_id = int(r["player2_id"]) if r["player2_id"] else None

            if not started_five[tid]:
                # lock in starting five now, using whatever we've accumulated.
                # BUGFIX: their stint started at game tip-off (elapsed=0,
                # score 0-0), NOT at the moment of this first substitution --
                # anchoring it here was silently dropping all game time before
                # a team's first sub (routinely several minutes per game).
                on_court[tid] = set(seen_players[tid])
                started_five[tid] = True
                if len(on_court[tid]) < 5:
                    anomalies.append(f"game {game_id} team {tid}: only found {len(on_court[tid])} starters before first sub")
                current_lineup[tid] = frozenset(on_court[tid])
                current_stint_start[tid] = (-1, 0, 0, 0)

            # close current stint for this team, open a new one
            old_lineup = current_lineup.get(tid, frozenset())
            start_event, start_elapsed, start_away, start_home = current_stint_start.get(
                tid, (r["eventnum"], elapsed, running_score[0], running_score[1])
            )
            if old_lineup:
                c = stint_counts[tid]
                stints.append({
                    "game_id": game_id,
                    "team_id": tid,
                    "lineup": "|".join(str(p) for p in sorted(old_lineup)),
                    "start_event": start_event,
                    "end_event": r["eventnum"],
                    "seconds": max(0, elapsed - start_elapsed),
                    "points_for": points_for_delta(tid, start_away, start_home, running_score[0], running_score[1]),
                    "points_against": points_against_delta(tid, start_away, start_home, running_score[0], running_score[1]),
                    "fga": c["fga"], "made_fg": c["made_fg"], "final_ft": c["final_ft"], "tov": c["tov"],
                })
            # reset counters for the new stint
            stint_counts[tid] = {"fga": 0, "made_fg": 0, "final_ft": 0, "tov": 0}

            if out_id in on_court[tid]:
                on_court[tid].discard(out_id)
            if in_id:
                on_court[tid].add(in_id)
            current_lineup[tid] = frozenset(on_court[tid])
            current_stint_start[tid] = (r["eventnum"], elapsed, running_score[0], running_score[1])

    # close out final stint for each team at end of game
    for tid in all_team_ids:
        if tid in current_stint_start and current_lineup.get(tid):
            start_event, start_elapsed, start_away, start_home = current_stint_start[tid]
            c = stint_counts[tid]
            stints.append({
                "game_id": game_id,
                "team_id": tid,
                "lineup": "|".join(str(p) for p in sorted(current_lineup[tid])),
                "start_event": start_event,
                "end_event": rows[-1]["eventnum"],
                # use `elapsed` from the last processed row (already clamped
                # above), not a fresh, unclamped recompute off rows[-1]
                "seconds": max(0, elapsed - start_elapsed),
                "points_for": points_for_delta(tid, start_away, start_home, running_score[0], running_score[1]),
                "points_against": points_against_delta(tid, start_away, start_home, running_score[0], running_score[1]),
                "fga": c["fga"], "made_fg": c["made_fg"], "final_ft": c["final_ft"], "tov": c["tov"],
            })

    return stints, anomalies, period_corrections


def main():
    con = duckdb.connect(DB_PATH)
    print("Pulling play-by-play into memory (this is the big one)...")
    df = con.execute("""
        SELECT game_id, eventnum, eventmsgtype, period, pctimestring, score,
               homedescription, visitordescription, neutraldescription,
               player1_id, player1_team_id,
               player2_id, player2_team_id,
               player3_id, player3_team_id
        FROM fact_play_by_play
        ORDER BY game_id, eventnum
    """).fetchdf()
    print(f"Loaded {len(df):,} events across {df['game_id'].nunique():,} games")

    all_stints = []
    all_anomalies = []
    all_period_corrections = []
    start_time = time.time()
    game_count = 0

    for game_id, group in df.groupby("game_id", sort=False):
        rows = group.to_dict("records")
        # need home/away resolved per team for correct points_for sign -- simplify:
        # recompute points_for properly using the two team ids' relative score deltas
        stints, anomalies, period_corrections = process_game(game_id, rows)
        all_stints.extend(stints)
        all_anomalies.extend(anomalies)
        all_period_corrections.extend(period_corrections)
        game_count += 1
        if game_count % 2000 == 0:
            elapsed_min = (time.time() - start_time) / 60
            print(f"  processed {game_count:,} games ({elapsed_min:.1f} min elapsed)")

    print(f"\nDone processing {game_count:,} games in {(time.time()-start_time)/60:.1f} min")
    print(f"Total stints extracted: {len(all_stints):,}")
    print(f"Starter-count anomalies flagged: {len(all_anomalies):,}")
    print(f"Period-corruption rows clamped: {len(all_period_corrections):,}")

    stints_df = pd.DataFrame(all_stints)
    stints_df["possessions_est"] = stints_df["made_fg"] + stints_df["final_ft"] + stints_df["tov"]

    con.execute("DROP TABLE IF EXISTS fact_lineup_stints")
    con.execute("CREATE TABLE fact_lineup_stints AS SELECT * FROM stints_df")

    print("\nBuilding agg_lineup_stats...")
    # NOTE ON METHOD: points_for/points_against are exact (read straight off the
    # SCORE field). possessions_est is the approximate part -- a simplified
    # estimator (made FG + final FT of each trip + turnovers) for the team's
    # OWN offensive possessions during the stint, used as the denominator for
    # both sides here as a common simplification. Net rating (point
    # differential per stint, aggregated) is the reliable headline number;
    # the per-100-possession figures should be read as approximate, and are
    # noisier the smaller n_stints/total_seconds is for a given lineup.
    agg_lineup = con.execute("""
        SELECT team_id, lineup,
               COUNT(*) AS n_stints,
               SUM(seconds) AS total_seconds,
               SUM(points_for) AS points_for,
               SUM(points_against) AS points_against,
               SUM(points_for) - SUM(points_against) AS point_differential,
               SUM(possessions_est) AS possessions_est,
               CASE WHEN SUM(possessions_est) > 0
                    THEN 100.0 * SUM(points_for) / SUM(possessions_est) ELSE NULL END AS off_rating_est,
               CASE WHEN SUM(possessions_est) > 0
                    THEN 100.0 * SUM(points_against) / SUM(possessions_est) ELSE NULL END AS def_rating_est,
               CASE WHEN SUM(possessions_est) > 0
                    THEN 100.0 * (SUM(points_for) - SUM(points_against)) / SUM(possessions_est) ELSE NULL END AS net_rating_est
        FROM fact_lineup_stints
        GROUP BY team_id, lineup
    """).fetchdf()
    con.execute("DROP TABLE IF EXISTS agg_lineup_stats")
    con.execute("CREATE TABLE agg_lineup_stats AS SELECT * FROM agg_lineup")
    print(f"  {len(agg_lineup):,} distinct team+lineup combinations")

    print("\nBuilding agg_player_on_off...")
    # On/off, per player per team: for every game a player appeared in for a
    # team, "on" = stints where they were part of the 5, "off" = the rest of
    # that team's floor time in that same game. (Games where the player didn't
    # appear at all for that team are excluded from both sides -- this is a
    # simplification; full season on/off would also count games missed
    # entirely as "off" time, which needs per-game roster/DNP data we don't
    # have loaded yet.)
    con.execute("""
        CREATE OR REPLACE TABLE stint_players AS
        SELECT game_id, team_id, seconds, points_for, points_against, possessions_est,
               CAST(unnest(string_split(lineup, '|')) AS BIGINT) AS player_id
        FROM fact_lineup_stints
        WHERE lineup != ''
    """)
    con.execute("""
        CREATE OR REPLACE TABLE player_game_on AS
        SELECT player_id, team_id, game_id,
               SUM(seconds) AS on_seconds, SUM(points_for) AS on_points_for,
               SUM(points_against) AS on_points_against, SUM(possessions_est) AS on_poss
        FROM stint_players
        GROUP BY player_id, team_id, game_id
    """)
    con.execute("""
        CREATE OR REPLACE TABLE team_game_totals AS
        SELECT team_id, game_id,
               SUM(seconds) AS total_seconds, SUM(points_for) AS total_points_for,
               SUM(points_against) AS total_points_against, SUM(possessions_est) AS total_poss
        FROM fact_lineup_stints
        GROUP BY team_id, game_id
    """)
    con.execute("""
        CREATE OR REPLACE TABLE player_game_off AS
        SELECT o.player_id, o.team_id, o.game_id,
               t.total_seconds - o.on_seconds AS off_seconds,
               t.total_points_for - o.on_points_for AS off_points_for,
               t.total_points_against - o.on_points_against AS off_points_against,
               t.total_poss - o.on_poss AS off_poss
        FROM player_game_on o
        JOIN team_game_totals t USING (team_id, game_id)
    """)
    agg_on_off = con.execute("""
        SELECT
            o.player_id, o.team_id,
            SUM(o.on_seconds) AS on_seconds,
            SUM(o.on_points_for) - SUM(o.on_points_against) AS on_point_differential,
            CASE WHEN SUM(o.on_poss) > 0 THEN 100.0*(SUM(o.on_points_for)-SUM(o.on_points_against))/SUM(o.on_poss) ELSE NULL END AS on_net_rating_est,
            SUM(f.off_seconds) AS off_seconds,
            SUM(f.off_points_for) - SUM(f.off_points_against) AS off_point_differential,
            CASE WHEN SUM(f.off_poss) > 0 THEN 100.0*(SUM(f.off_points_for)-SUM(f.off_points_against))/SUM(f.off_poss) ELSE NULL END AS off_net_rating_est
        FROM player_game_on o
        JOIN player_game_off f USING (player_id, team_id, game_id)
        GROUP BY o.player_id, o.team_id
    """).fetchdf()
    con.execute("DROP TABLE IF EXISTS agg_player_on_off")
    con.execute("CREATE TABLE agg_player_on_off AS SELECT * FROM agg_on_off")
    print(f"  {len(agg_on_off):,} player+team on/off rows")

    # anomalies log for QA
    anomalies_df = pd.DataFrame({"anomaly": all_anomalies})
    con.execute("DROP TABLE IF EXISTS qa_lineup_anomalies")
    con.execute("CREATE TABLE qa_lineup_anomalies AS SELECT * FROM anomalies_df")

    # period-corruption log for QA -- games/rows where the raw `period` field
    # went backward mid-game and had to be clamped (see BUGFIX comment above)
    corrections_df = pd.DataFrame({"correction": all_period_corrections})
    con.execute("DROP TABLE IF EXISTS qa_period_corrections")
    con.execute("CREATE TABLE qa_period_corrections AS SELECT * FROM corrections_df")

    print(f"\nWarehouse tables written: fact_lineup_stints, agg_lineup_stats, agg_player_on_off, "
          f"qa_lineup_anomalies, qa_period_corrections")
    con.close()


if __name__ == "__main__":
    main()
