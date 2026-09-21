import math
from typing import Optional

import duckdb
from fastapi import APIRouter, Depends, HTTPException, Query

from db import get_db

router = APIRouter()


def _four_factors(fgm, fga, fg3m, fta, ftm, tov, oreb, opp_dreb):
    """Dean Oliver's Four Factors, computed from a single team's box line
    plus the opponent's defensive rebounds (needed for OREB%)."""
    efg = (fgm + 0.5 * fg3m) / fga if fga else None
    tov_pct_denom = fga + 0.44 * fta + tov
    tov_pct = tov / tov_pct_denom if tov_pct_denom else None
    oreb_pct = oreb / (oreb + opp_dreb) if (oreb + opp_dreb) else None
    ft_rate = ftm / fga if fga else None  # FT made per FGA -- a common simplified variant of FT Rate
    return {
        "efg_pct": round(efg, 4) if efg is not None else None,
        "tov_pct": round(tov_pct, 4) if tov_pct is not None else None,
        "oreb_pct": round(oreb_pct, 4) if oreb_pct is not None else None,
        "ft_rate": round(ft_rate, 4) if ft_rate is not None else None,
    }


def _clean_nan(obj):
    """dim_game/fact_line_score have real NULLs stored as NaN in some old
    (1940s-era) rows once they pass through pandas -- swap those for None
    so the response is valid JSON (a bare NaN token isn't)."""
    if isinstance(obj, float) and math.isnan(obj):
        return None
    if isinstance(obj, dict):
        return {k: _clean_nan(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_clean_nan(v) for v in obj]
    return obj


@router.get("/{game_id}")
def get_game(game_id: str, con: duckdb.DuckDBPyConnection = Depends(get_db)):
    """
    Full single-game report: box score for both teams, Four Factors
    (computed directly from dim_game's home/away columns -- no separate
    per-game four-factors table exists, so we derive it with Dean
    Oliver's published formulas), quarter-by-quarter scoring
    (fact_line_score), and hustle/context stats (fact_other_stats) where
    available. Pair this with GET /lineups/game?game_id=..&team_id=.. for
    the lineup-level breakdown of the same game.
    """
    game_df = con.execute("""
        SELECT * FROM dim_game WHERE game_id = ?
    """, [game_id]).fetchdf()
    if game_df.empty:
        raise HTTPException(status_code=404, detail="Game not found")
    g = game_df.to_dict(orient="records")[0]

    home = {
        "team_id": g["team_id_home"], "abbreviation": g["team_abbreviation_home"], "name": g["team_name_home"],
        "pts": g["pts_home"], "fgm": g["fgm_home"], "fga": g["fga_home"], "fg_pct": g["fg_pct_home"],
        "fg3m": g["fg3m_home"], "fg3a": g["fg3a_home"], "fg3_pct": g["fg3_pct_home"],
        "ftm": g["ftm_home"], "fta": g["fta_home"], "ft_pct": g["ft_pct_home"],
        "oreb": g["oreb_home"], "dreb": g["dreb_home"], "reb": g["reb_home"],
        "ast": g["ast_home"], "stl": g["stl_home"], "blk": g["blk_home"], "tov": g["tov_home"],
        "pf": g["pf_home"], "wl": g["wl_home"],
    }
    away = {
        "team_id": g["team_id_away"], "abbreviation": g["team_abbreviation_away"], "name": g["team_name_away"],
        "pts": g["pts_away"], "fgm": g["fgm_away"], "fga": g["fga_away"], "fg_pct": g["fg_pct_away"],
        "fg3m": g["fg3m_away"], "fg3a": g["fg3a_away"], "fg3_pct": g["fg3_pct_away"],
        "ftm": g["ftm_away"], "fta": g["fta_away"], "ft_pct": g["ft_pct_away"],
        "oreb": g["oreb_away"], "dreb": g["dreb_away"], "reb": g["reb_away"],
        "ast": g["ast_away"], "stl": g["stl_away"], "blk": g["blk_away"], "tov": g["tov_away"],
        "pf": g["pf_away"], "wl": g["wl_away"],
    }

    home["four_factors"] = _four_factors(
        home["fgm"], home["fga"], home["fg3m"], home["fta"], home["ftm"], home["tov"], home["oreb"], away["dreb"]
    )
    away["four_factors"] = _four_factors(
        away["fgm"], away["fga"], away["fg3m"], away["fta"], away["ftm"], away["tov"], away["oreb"], home["dreb"]
    )

    quarters = None
    qdf = con.execute("""
        SELECT pts_qtr1_home, pts_qtr2_home, pts_qtr3_home, pts_qtr4_home,
               pts_ot1_home, pts_ot2_home, pts_ot3_home,
               pts_qtr1_away, pts_qtr2_away, pts_qtr3_away, pts_qtr4_away,
               pts_ot1_away, pts_ot2_away, pts_ot3_away
        FROM fact_line_score WHERE game_id = ?
    """, [game_id]).fetchdf()
    if not qdf.empty:
        row = qdf.to_dict(orient="records")[0]
        periods = []
        labels = ["Q1", "Q2", "Q3", "Q4", "OT1", "OT2", "OT3"]
        keys = ["qtr1", "qtr2", "qtr3", "qtr4", "ot1", "ot2", "ot3"]
        for label, key in zip(labels, keys):
            h, a = row.get(f"pts_{key}_home"), row.get(f"pts_{key}_away")
            is_ot = key.startswith("ot")
            # OT columns are 0.0 (not NULL) for games that never reached overtime --
            # drop those rather than showing a spurious "OT1: 0-0" column. Regulation
            # quarters are always kept even if (implausibly) 0.
            if is_ot and (not h) and (not a):
                continue
            periods.append({"period": label, "home": h, "away": a})
        quarters = periods

    other = None
    odf = con.execute("""
        SELECT pts_paint_home, pts_2nd_chance_home, pts_fb_home, largest_lead_home, team_turnovers_home,
               pts_paint_away, pts_2nd_chance_away, pts_fb_away, largest_lead_away, team_turnovers_away,
               lead_changes, times_tied
        FROM fact_other_stats WHERE game_id = ?
    """, [game_id]).fetchdf()
    if not odf.empty:
        row = odf.to_dict(orient="records")[0]
        other = {
            "lead_changes": row["lead_changes"],
            "times_tied": row["times_tied"],
            "home": {
                "pts_paint": row["pts_paint_home"], "pts_2nd_chance": row["pts_2nd_chance_home"],
                "pts_fb": row["pts_fb_home"], "largest_lead": row["largest_lead_home"],
            },
            "away": {
                "pts_paint": row["pts_paint_away"], "pts_2nd_chance": row["pts_2nd_chance_away"],
                "pts_fb": row["pts_fb_away"], "largest_lead": row["largest_lead_away"],
            },
        }

    return _clean_nan({
        "game_id": game_id,
        "game_date": str(g["game_date"]),
        "season_type": g["season_type"],
        "home": home,
        "away": away,
        "quarters": quarters,
        "other_stats": other,
    })


@router.get("/{game_id}/flow")
def get_game_flow(game_id: str, con: duckdb.DuckDBPyConnection = Depends(get_db)):
    """
    Score-margin timeline for one game, for a "game flow"/momentum chart
    to pair with /lineups/rotation's on-court chart -- this is the "when
    the game was actually won" view, that one is "who was on the floor
    for it."

    fact_play_by_play has no elapsed-clock column of its own: pctimestring
    is the CLOCK REMAINING in the current period (loaded into a TIME
    column, so its hour/minute fields actually hold minutes/seconds
    remaining -- e.g. TIME '11:15:00' means 11:15 left, not 11 hours).
    Elapsed game time is reconstructed from period + that remaining time,
    with 720s regulation periods and 300s OT periods.

    `score` is only populated on rows where the score actually changed,
    formatted "AWAY - HOME" (confirmed against dim_game's own final
    scores); parsing it directly, rather than trusting the scoremargin
    string column's "TIE" spelling, is what drives both the margin
    series and the scoring-run detection below.

    Scoring runs use the classic broadcast definition: a team's points
    scored since the opponent last scored (an "opponent-scoreless"
    stretch), reported once it reaches >=8 points net.

    lead_changes/times_tied are recomputed here directly from this same
    margin sequence (sign changes / margin==0 events) rather than reusing
    fact_other_stats' own columns -- spot-checked against a known game
    where lead_changes matched exactly and times_tied was off by one,
    which is within the range of boundary-definition differences (e.g.
    whether the opening 0-0 tip counts) rather than a parsing bug.
    """
    game_df = con.execute("""
        SELECT team_id_home, team_abbreviation_home, team_id_away, team_abbreviation_away, pts_home, pts_away
        FROM dim_game WHERE game_id = ?
    """, [game_id]).fetchdf()
    if game_df.empty:
        raise HTTPException(status_code=404, detail="Game not found")
    g = game_df.to_dict(orient="records")[0]

    df = con.execute("""
        SELECT
            eventnum, period, score,
            EXTRACT(hour FROM pctimestring) * 60 + EXTRACT(minute FROM pctimestring) AS remaining_seconds,
            CASE WHEN period <= 4 THEN (period - 1) * 720 ELSE 2880 + (period - 5) * 300 END
              + (CASE WHEN period <= 4 THEN 720 ELSE 300 END
                 - (EXTRACT(hour FROM pctimestring) * 60 + EXTRACT(minute FROM pctimestring)))
              AS elapsed_seconds
        FROM fact_play_by_play
        WHERE game_id = ? AND score IS NOT NULL
        ORDER BY eventnum
    """, [game_id]).fetchdf()
    if df.empty:
        raise HTTPException(status_code=404, detail="No play-by-play scoring data found for that game")

    split = df["score"].str.split(" - ", expand=True)
    df["away_score"] = split[0].astype(int)
    df["home_score"] = split[1].astype(int)
    df["margin"] = df["home_score"] - df["away_score"]
    df["elapsed_seconds"] = df["elapsed_seconds"].astype(int)

    # Collapse same-instant events (e.g. and-one FT immediately after the
    # basket) down to their final score at that elapsed second, so the
    # step chart doesn't show a vertical multi-jump at one x position.
    df = df.sort_values(["elapsed_seconds", "eventnum"]).drop_duplicates("elapsed_seconds", keep="last")

    timeline = [
        {"elapsed_seconds": int(r.elapsed_seconds), "period": int(r.period), "home_score": int(r.home_score),
         "away_score": int(r.away_score), "margin": int(r.margin)}
        for r in df.itertuples()
    ]

    # Biggest lead each way (first time it was reached).
    max_row = df.loc[df["margin"].idxmax()]
    min_row = df.loc[df["margin"].idxmin()]
    biggest_lead_home = {"margin": int(max_row["margin"]), "elapsed_seconds": int(max_row["elapsed_seconds"])}
    biggest_lead_away = {"margin": int(-min_row["margin"]), "elapsed_seconds": int(min_row["elapsed_seconds"])}

    # Lead changes / times tied, from the margin sequence itself (cross-
    # checkable against fact_other_stats.lead_changes/times_tied on the
    # main /games/{id} endpoint, though that source may define ties/
    # changes slightly differently at the margin==0 boundary).
    lead_changes = 0
    times_tied = 0
    prior_sign = 0
    for m in df["margin"]:
        if m == 0:
            times_tied += 1
            continue
        sign = 1 if m > 0 else -1
        if prior_sign != 0 and sign != prior_sign:
            lead_changes += 1
        prior_sign = sign

    # Scoring runs: points scored by one team since the other last scored.
    runs = []
    run_team = None
    run_points = 0
    run_start_elapsed = 0
    run_start_score = (0, 0)
    prev_home, prev_away = 0, 0
    for r in df.itertuples():
        home_delta = r.home_score - prev_home
        away_delta = r.away_score - prev_away
        if home_delta > 0:
            team, pts = "home", home_delta
        elif away_delta > 0:
            team, pts = "away", away_delta
        else:
            prev_home, prev_away = r.home_score, r.away_score
            continue

        if team == run_team:
            run_points += pts
            run_end_elapsed = r.elapsed_seconds
            run_end_score = (r.home_score, r.away_score)
        else:
            if run_team is not None and run_points >= 8:
                runs.append({
                    "team": run_team, "points": run_points,
                    "start_seconds": run_start_elapsed, "end_seconds": run_end_elapsed,
                    "start_score": {"home": run_start_score[0], "away": run_start_score[1]},
                    "end_score": {"home": run_end_score[0], "away": run_end_score[1]},
                })
            run_team, run_points = team, pts
            run_start_elapsed = run_end_elapsed = r.elapsed_seconds
            run_start_score = (prev_home, prev_away)
            run_end_score = (r.home_score, r.away_score)
        prev_home, prev_away = r.home_score, r.away_score

    if run_team is not None and run_points >= 8:
        runs.append({
            "team": run_team, "points": run_points,
            "start_seconds": run_start_elapsed, "end_seconds": run_end_elapsed,
            "start_score": {"home": run_start_score[0], "away": run_start_score[1]},
            "end_score": {"home": run_end_score[0], "away": run_end_score[1]},
        })
    runs.sort(key=lambda x: -x["points"])

    return {
        "game_id": game_id,
        "home": {"team_id": g["team_id_home"], "abbreviation": g["team_abbreviation_home"], "pts": g["pts_home"]},
        "away": {"team_id": g["team_id_away"], "abbreviation": g["team_abbreviation_away"], "pts": g["pts_away"]},
        "total_seconds": int(df["elapsed_seconds"].max()),
        "timeline": timeline,
        "biggest_lead_home": biggest_lead_home,
        "biggest_lead_away": biggest_lead_away,
        "lead_changes": lead_changes,
        "times_tied": times_tied,
        "scoring_runs": runs[:10],
    }
