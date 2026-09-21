import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import Loading from "../components/Loading";

const SEASON_TYPES = [
  { key: "Regular Season", label: "Regular Season" },
  { key: "Playoffs", label: "Playoffs" },
];

function pct(v, digits = 1) {
  return v != null ? `${(v * 100).toFixed(digits)}%` : "--";
}
function num(v, digits = 1) {
  return v != null ? v.toFixed(digits) : "--";
}
function signedNum(v, digits = 1) {
  if (v == null) return "--";
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;
}
function record(r) {
  if (!r) return "--";
  return `${r.w}-${r.l}`;
}

function TeamPicker({ label, teams, teamId, onChange, excludeId }) {
  return (
    <div>
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <select
        className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2"
        value={teamId ?? ""}
        onChange={(e) => onChange(Number(e.target.value) || null)}
      >
        <option value="" disabled>
          Select a team
        </option>
        {teams
          .filter((t) => t.id !== excludeId)
          .map((t) => (
            <option key={t.id} value={t.id}>
              {t.full_name}
            </option>
          ))}
      </select>
    </div>
  );
}

// A single "scouting sheet" row: Team A's value on the left, the stat
// label in the middle, Team B's value on the right -- pure A-vs-B, unlike
// ExecutiveDashboard's FourFactorRow which compares a team against its
// own opponents. compareA/compareB (numeric) decide who's highlighted
// green; displayA/displayB are the formatted strings actually shown, so a
// row like "Record" can compare by win% while displaying "W-L".
function Row({ label, sub, compareA, compareB, displayA, displayB, higherIsBetter = true }) {
  const canCompare = higherIsBetter != null && compareA != null && compareB != null && compareA !== compareB;
  const aBetter = canCompare && (higherIsBetter ? compareA > compareB : compareA < compareB);
  const bBetter = canCompare && (higherIsBetter ? compareB > compareA : compareB < compareA);
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 py-2 border-b border-slate-900 last:border-b-0">
      <div className={`text-right font-medium tabular-nums ${aBetter ? "text-green-400" : ""}`}>
        {displayA ?? "--"}
      </div>
      <div className="text-xs text-slate-500 text-center px-2 whitespace-nowrap">
        {label}
        {sub && <div className="text-[10px] text-slate-600">{sub}</div>}
      </div>
      <div className={`text-left font-medium tabular-nums ${bBetter ? "text-green-400" : ""}`}>
        {displayB ?? "--"}
      </div>
    </div>
  );
}

// Convenience wrapper for the common case: the same numeric value is both
// the comparison key and (after formatting) the display value.
function StatRow({ label, sub, a, b, format = (v) => (v != null ? String(v) : "--"), higherIsBetter = true }) {
  return (
    <Row
      label={label}
      sub={sub}
      compareA={a}
      compareB={b}
      displayA={format(a)}
      displayB={format(b)}
      higherIsBetter={higherIsBetter}
    />
  );
}

function SectionCard({ title, subtitle, children }) {
  return (
    <section className="bg-slate-900 border border-slate-800 rounded-lg p-5">
      <h3 className="text-base font-semibold mb-1">{title}</h3>
      {subtitle && <p className="text-xs text-slate-500 mb-3">{subtitle}</p>}
      {children}
    </section>
  );
}

function WeaknessList({ side, weaknesses }) {
  if (!weaknesses || weaknesses.length === 0) {
    return <p className="text-xs text-slate-500">No qualifying zones (min. 20 opponent attempts).</p>;
  }
  return (
    <ul className={`space-y-1.5 text-sm ${side === "a" ? "text-right" : "text-left"}`}>
      {weaknesses.map((w) => (
        <li key={w.zone}>
          <span className="font-medium">{w.zone}</span>{" "}
          <span className="text-red-400">{w.fg_pct}%</span>{" "}
          <span className="text-slate-500 text-xs">
            (league {w.league_fg_pct}%, +{w.diff_vs_league})
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function TeamCompare() {
  const [teams, setTeams] = useState([]);
  const [teamAId, setTeamAId] = useState(null);
  const [teamBId, setTeamBId] = useState(null);
  const [seasonsA, setSeasonsA] = useState([]);
  const [seasonsB, setSeasonsB] = useState([]);
  const [season, setSeason] = useState("");
  const [seasonType, setSeasonType] = useState("Regular Season");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.teams().then(setTeams).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!teamAId) {
      setSeasonsA([]);
      return;
    }
    api.teamSeasons(teamAId).then(setSeasonsA).catch(() => setSeasonsA([]));
  }, [teamAId]);

  useEffect(() => {
    if (!teamBId) {
      setSeasonsB([]);
      return;
    }
    api.teamSeasons(teamBId).then(setSeasonsB).catch(() => setSeasonsB([]));
  }, [teamBId]);

  // The compare endpoint takes one shared season, so only seasons BOTH
  // teams actually have a stats row for are valid choices.
  const commonSeasons = useMemo(() => {
    if (!seasonsA.length || !seasonsB.length) return [];
    const setB = new Set(seasonsB);
    return seasonsA.filter((s) => setB.has(s));
  }, [seasonsA, seasonsB]);

  useEffect(() => {
    if (commonSeasons.length === 0) {
      setSeason("");
      return;
    }
    setSeason((prev) => (commonSeasons.includes(prev) ? prev : commonSeasons[commonSeasons.length - 1]));
  }, [commonSeasons]);

  useEffect(() => {
    if (!teamAId || !teamBId || !season) {
      setData(null);
      return;
    }
    if (teamAId === teamBId) {
      setError("Pick two different teams.");
      setData(null);
      return;
    }
    setError(null);
    setLoading(true);
    api
      .compareTeams({ teamA: teamAId, teamB: teamBId, season, seasonType })
      .then(setData)
      .catch((e) => {
        setError(e.message);
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [teamAId, teamBId, season, seasonType]);

  const a = data?.team_a;
  const b = data?.team_b;

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h2 className="text-xl font-semibold mb-1">Team Compare</h2>
        <p className="text-xs text-slate-500">
          Two teams, one season, every split, side by side -- a head-to-head scouting sheet built from the same
          dashboard, identity, and clutch data behind the Executive Dashboard. Green marks whichever side has the
          better number in each row.
        </p>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex-1 min-w-[220px]">
          <TeamPicker label="Team A" teams={teams} teamId={teamAId} onChange={setTeamAId} excludeId={teamBId} />
        </div>
        <div className="flex-1 min-w-[220px]">
          <TeamPicker label="Team B" teams={teams} teamId={teamBId} onChange={setTeamBId} excludeId={teamAId} />
        </div>
        <div>
          <div className="text-xs text-slate-400 mb-1">Season</div>
          <select
            className="bg-slate-800 border border-slate-700 rounded px-3 py-2 disabled:opacity-50"
            value={season}
            onChange={(e) => setSeason(e.target.value)}
            disabled={commonSeasons.length === 0}
          >
            {commonSeasons.length === 0 && <option value="">--</option>}
            {commonSeasons.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div className="text-xs text-slate-400 mb-1">Season Type</div>
          <div className="flex gap-1 bg-slate-800 rounded p-1">
            {SEASON_TYPES.map((o) => (
              <button
                key={o.key}
                className={`px-3 py-1.5 rounded text-sm ${
                  seasonType === o.key ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200"
                }`}
                onClick={() => setSeasonType(o.key)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {teamAId && teamBId && commonSeasons.length === 0 && (
        <p className="text-xs text-amber-400">These two teams have no season in common on record.</p>
      )}

      {loading && <Loading label="Building scouting sheet..." />}

      {!loading && data && a && b && (
        <>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <div className="text-right">
              <div className="text-lg font-bold">{a.full_name}</div>
              <div className="text-xs text-slate-500">{a.abbreviation}</div>
            </div>
            <div className="text-xs text-slate-500 px-3 whitespace-nowrap">
              {season} &middot; {seasonType}
            </div>
            <div className="text-left">
              <div className="text-lg font-bold">{b.full_name}</div>
              <div className="text-xs text-slate-500">{b.abbreviation}</div>
            </div>
          </div>

          <SectionCard title="Record & Ratings">
            <Row
              label="Record"
              sub="W-L (win%)"
              compareA={a.dashboard?.record?.w_pct}
              compareB={b.dashboard?.record?.w_pct}
              displayA={a.dashboard?.record ? `${record(a.dashboard.record)} (${pct(a.dashboard.record.w_pct)})` : "--"}
              displayB={b.dashboard?.record ? `${record(b.dashboard.record)} (${pct(b.dashboard.record.w_pct)})` : "--"}
            />
            <Row
              label="Last 10"
              sub="W-L, avg margin"
              compareA={a.dashboard?.last10?.avg_margin}
              compareB={b.dashboard?.last10?.avg_margin}
              displayA={
                a.dashboard?.last10
                  ? `${a.dashboard.last10.w}-${a.dashboard.last10.l} (${signedNum(a.dashboard.last10.avg_margin)})`
                  : "--"
              }
              displayB={
                b.dashboard?.last10
                  ? `${b.dashboard.last10.w}-${b.dashboard.last10.l} (${signedNum(b.dashboard.last10.avg_margin)})`
                  : "--"
              }
            />
            <StatRow label="Off Rating" a={a.dashboard?.advanced?.OFF_RATING} b={b.dashboard?.advanced?.OFF_RATING} format={num} />
            <StatRow
              label="Def Rating"
              a={a.dashboard?.advanced?.DEF_RATING}
              b={b.dashboard?.advanced?.DEF_RATING}
              format={num}
              higherIsBetter={false}
            />
            <StatRow label="Net Rating" a={a.dashboard?.advanced?.NET_RATING} b={b.dashboard?.advanced?.NET_RATING} format={signedNum} />
            <StatRow label="Pace" a={a.dashboard?.advanced?.PACE} b={b.dashboard?.advanced?.PACE} format={num} higherIsBetter={null} />
            <StatRow label="TS%" a={a.dashboard?.advanced?.TS_PCT} b={b.dashboard?.advanced?.TS_PCT} format={pct} />
            <StatRow label="PIE" a={a.dashboard?.advanced?.PIE} b={b.dashboard?.advanced?.PIE} format={pct} />
          </SectionCard>

          <SectionCard title="Four Factors" subtitle="Own offense above, what each team allows on defense below.">
            <StatRow label="eFG%" a={a.dashboard?.four_factors?.team?.efg_pct} b={b.dashboard?.four_factors?.team?.efg_pct} format={pct} />
            <StatRow
              label="TOV%"
              a={a.dashboard?.four_factors?.team?.tov_pct}
              b={b.dashboard?.four_factors?.team?.tov_pct}
              format={pct}
              higherIsBetter={false}
            />
            <StatRow label="OREB%" a={a.dashboard?.four_factors?.team?.oreb_pct} b={b.dashboard?.four_factors?.team?.oreb_pct} format={pct} />
            <StatRow label="FTA Rate" a={a.dashboard?.four_factors?.team?.fta_rate} b={b.dashboard?.four_factors?.team?.fta_rate} format={pct} />

            <div className="mt-4 pt-3 border-t border-slate-800 text-[10px] uppercase tracking-wide text-slate-600 text-center">
              Allowed (opponent four factors)
            </div>
            <StatRow
              label="Opp eFG%"
              a={a.dashboard?.four_factors?.opponent?.efg_pct}
              b={b.dashboard?.four_factors?.opponent?.efg_pct}
              format={pct}
              higherIsBetter={false}
            />
            <StatRow
              label="Opp TOV%"
              a={a.dashboard?.four_factors?.opponent?.tov_pct}
              b={b.dashboard?.four_factors?.opponent?.tov_pct}
              format={pct}
            />
            <StatRow
              label="Opp OREB%"
              a={a.dashboard?.four_factors?.opponent?.oreb_pct}
              b={b.dashboard?.four_factors?.opponent?.oreb_pct}
              format={pct}
              higherIsBetter={false}
            />
            <StatRow
              label="Opp FTA Rate"
              a={a.dashboard?.four_factors?.opponent?.fta_rate}
              b={b.dashboard?.four_factors?.opponent?.fta_rate}
              format={pct}
              higherIsBetter={false}
            />
          </SectionCard>

          <SectionCard title="Scoring Identity" subtitle="Where points come from and how shots are created (per fact_team_scoring).">
            <StatRow label="Pts in Paint / gm" a={a.dashboard?.context_stats?.pts_paint} b={b.dashboard?.context_stats?.pts_paint} format={num} />
            <StatRow
              label="2nd Chance Pts / gm"
              a={a.dashboard?.context_stats?.pts_2nd_chance}
              b={b.dashboard?.context_stats?.pts_2nd_chance}
              format={num}
            />
            <StatRow label="Fastbreak Pts / gm" a={a.dashboard?.context_stats?.pts_fb} b={b.dashboard?.context_stats?.pts_fb} format={num} />
            <StatRow
              label="% Pts from 3"
              a={a.identity?.style?.PCT_PTS_3PT}
              b={b.identity?.style?.PCT_PTS_3PT}
              format={pct}
              higherIsBetter={null}
            />
            <StatRow
              label="% Pts in Paint"
              a={a.identity?.style?.PCT_PTS_PAINT}
              b={b.identity?.style?.PCT_PTS_PAINT}
              format={pct}
              higherIsBetter={null}
            />
            <StatRow
              label="% FGM Assisted"
              a={a.identity?.style?.PCT_AST_FGM}
              b={b.identity?.style?.PCT_AST_FGM}
              format={pct}
              higherIsBetter={null}
            />
            <StatRow
              label="% FGA from 3"
              a={a.identity?.style?.PCT_FGA_3PT}
              b={b.identity?.style?.PCT_FGA_3PT}
              format={pct}
              higherIsBetter={null}
            />
          </SectionCard>

          <SectionCard title="Home / Away Splits">
            <Row
              label="Home Record"
              sub="W-L, avg margin"
              compareA={a.dashboard?.home_away?.home?.avg_margin}
              compareB={b.dashboard?.home_away?.home?.avg_margin}
              displayA={
                a.dashboard?.home_away?.home
                  ? `${a.dashboard.home_away.home.w}-${a.dashboard.home_away.home.l} (${signedNum(a.dashboard.home_away.home.avg_margin)})`
                  : "--"
              }
              displayB={
                b.dashboard?.home_away?.home
                  ? `${b.dashboard.home_away.home.w}-${b.dashboard.home_away.home.l} (${signedNum(b.dashboard.home_away.home.avg_margin)})`
                  : "--"
              }
            />
            <Row
              label="Away Record"
              sub="W-L, avg margin"
              compareA={a.dashboard?.home_away?.away?.avg_margin}
              compareB={b.dashboard?.home_away?.away?.avg_margin}
              displayA={
                a.dashboard?.home_away?.away
                  ? `${a.dashboard.home_away.away.w}-${a.dashboard.home_away.away.l} (${signedNum(a.dashboard.home_away.away.avg_margin)})`
                  : "--"
              }
              displayB={
                b.dashboard?.home_away?.away
                  ? `${b.dashboard.home_away.away.w}-${b.dashboard.home_away.away.l} (${signedNum(b.dashboard.home_away.away.avg_margin)})`
                  : "--"
              }
            />
          </SectionCard>

          <SectionCard title="Situational Record">
            <Row
              label="Close Games"
              sub="margin <=5, W-L"
              compareA={
                a.identity?.close_game_record?.gp
                  ? a.identity.close_game_record.w / a.identity.close_game_record.gp
                  : null
              }
              compareB={
                b.identity?.close_game_record?.gp
                  ? b.identity.close_game_record.w / b.identity.close_game_record.gp
                  : null
              }
              displayA={a.identity?.close_game_record ? record(a.identity.close_game_record) : "--"}
              displayB={b.identity?.close_game_record ? record(b.identity.close_game_record) : "--"}
            />
            <Row
              label="Clutch Record"
              sub={a.clutch?.clutch_definition || "period >=4, <=5:00 left, within 5"}
              compareA={a.clutch?.avg_clutch_margin}
              compareB={b.clutch?.avg_clutch_margin}
              displayA={a.clutch ? `${a.clutch.clutch_record} (${signedNum(a.clutch.avg_clutch_margin)})` : "--"}
              displayB={b.clutch ? `${b.clutch.clutch_record} (${signedNum(b.clutch.avg_clutch_margin)})` : "--"}
            />
          </SectionCard>

          <SectionCard
            title="Opponent Zone Weaknesses"
            subtitle="Top 3 zones (min. 20 opponent attempts) where opponents shoot best against this team, vs. league average that zone. Not split by season type -- see docstring."
          >
            <div className="grid grid-cols-2 gap-6">
              <WeaknessList side="a" weaknesses={a.identity?.weaknesses} />
              <WeaknessList side="b" weaknesses={b.identity?.weaknesses} />
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
}
