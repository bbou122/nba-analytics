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
