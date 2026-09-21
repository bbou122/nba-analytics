import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import CourtShotChart from "../components/CourtShotChart";
import Loading from "../components/Loading";

const HOME_AWAY_OPTIONS = [
  { key: "all", label: "All" },
  { key: "home", label: "Home" },
  { key: "away", label: "Away" },
];

const HEADLINE_STATS = [
  { label: "GP", key: "gp" },
  { label: "PTS", key: "pts" },
  { label: "REB", key: "reb" },
  { label: "AST", key: "ast" },
  { label: "STL", key: "stl" },
  { label: "BLK", key: "blk" },
  { label: "TOV", key: "tov" },
  { label: "FG%", key: "fg_pct", suffix: "%" },
  { label: "3P%", key: "fg3_pct", suffix: "%" },
];

const ADVANCED_STATS = [
  { label: "Def Rtg", key: "def_rating", lowerIsBetter: true },
  { label: "DREB%", key: "dreb_pct", suffix: "%" },
  { label: "STL%", key: "pct_stl", suffix: "%" },
  { label: "BLK%", key: "pct_blk", suffix: "%" },
  { label: "Pts in Paint", key: "pts_paint" },
  { label: "Fastbreak Pts", key: "pts_fb" },
];

const CLUTCH_STATS = [
  { label: "Clutch GP", key: "clutch_games" },
  { label: "PTS", key: "pts" },
  { label: "REB", key: "reb" },
  { label: "AST", key: "ast" },
  { label: "FG% (time-only)", key: "fg_pct_time_only", suffix: "%" },
];

function PlayerPicker({ label, query, setQuery, results, onPick }) {
  return (
    <div className="relative">
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <input
        className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2"
        placeholder="Search player..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {results.length > 0 && (
        <ul className="absolute z-10 bg-slate-800 border border-slate-700 rounded mt-1 w-full max-h-56 overflow-auto">
          {results.map((p) => (
            <li
              key={p.id}
              className="px-3 py-2 hover:bg-slate-700 cursor-pointer text-sm"
              onClick={() => onPick(p)}
            >
              {p.full_name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function usePlayerSlot() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [playerId, setPlayerId] = useState(null);
  const [bio, setBio] = useState(null);
  const [seasons, setSeasons] = useState([]);
  const [averages, setAverages] = useState(null);
  const [advanced, setAdvanced] = useState(null);
  const [clutch, setClutch] = useState(null);
  const [shots, setShots] = useState([]);
  const [sevenZones, setSevenZones] = useState([]);

  useEffect(() => {
    if (!query || query.length < 2) {
      setResults([]);
      return;
    }
    const handle = setTimeout(() => {
      api.searchPlayers(query).then(setResults).catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    if (!playerId) return;
    api.player(playerId).then(setBio).catch(() => setBio(null));
    api.playerSeasons(playerId).then(setSeasons).catch(() => setSeasons([]));
  }, [playerId]);

  return {
    query, setQuery, results, playerId, setPlayerId, bio, seasons,
    averages, setAverages, advanced, setAdvanced, clutch, setClutch,
    shots, setShots, sevenZones, setSevenZones,
  };
}

export default function Compare() {
  const a = usePlayerSlot();
  const b = usePlayerSlot();
  const [isCareer, setIsCareer] = useState(true);
  const [selectedSeasons, setSelectedSeasons] = useState([]);
  const [homeAway, setHomeAway] = useState("all");
  const [error, setError] = useState(null);
  const [compareLoading, setCompareLoading] = useState(false);

  const seasonOptions = useMemo(
    () => [...new Set([...a.seasons, ...b.seasons])].sort(),
    [a.seasons, b.seasons]
  );

  function toggleSeason(s) {
    setIsCareer(false);
    setSelectedSeasons((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s].sort()));
  }

  useEffect(() => {
    const pending = [];
    [a, b].forEach((slot) => {
      if (!slot.playerId) return;
      if (!isCareer && selectedSeasons.length === 0) {
        slot.setAverages(null);
        slot.setAdvanced(null);
        slot.setClutch(null);
        return;
      }
      const seasonsParam = isCareer ? undefined : selectedSeasons.join(",");
      const homeAwayParam = homeAway === "all" ? undefined : homeAway;
      pending.push(
        api
          .playerGameAverages(slot.playerId, { seasons: seasonsParam, homeAway: homeAwayParam })
          .then(slot.setAverages)
          .catch((e) => {
            setError(e.message);
            slot.setAverages(null);
          })
      );
      pending.push(api.playerAdvanced(slot.playerId, { seasons: seasonsParam }).then(slot.setAdvanced).catch(() => slot.setAdvanced(null)));
      pending.push(api.playerClutch(slot.playerId, { seasons: seasonsParam }).then(slot.setClutch).catch(() => slot.setClutch(null)));
      pending.push(
        api
          .shots({ playerId: slot.playerId, seasons: seasonsParam, homeAway: homeAwayParam, limit: 3000 })
          .then(slot.setShots)
          .catch(() => slot.setShots([]))
      );
      pending.push(
        api
          .sevenZones({ playerId: slot.playerId, seasons: seasonsParam, homeAway: homeAwayParam })
          .then(slot.setSevenZones)
          .catch(() => slot.setSevenZones([]))
      );
    });
    if (pending.length > 0) {
      setCompareLoading(true);
      Promise.allSettled(pending).finally(() => setCompareLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.playerId, b.playerId, isCareer, selectedSeasons, homeAway]);

  function StatRow({ label, aVal, bVal, suffix = "", lowerIsBetter = false }) {
    const aNum = typeof aVal === "number" ? aVal : null;
    const bNum = typeof bVal === "number" ? bVal : null;
    const aWins = aNum != null && bNum != null && (lowerIsBetter ? aNum < bNum : aNum > bNum);
    const bWins = aNum != null && bNum != null && (lowerIsBetter ? bNum < aNum : bNum > aNum);
    return (
      <tr className="border-b border-slate-900">
        <td className={`py-2 pr-4 text-right w-24 ${aWins ? "text-green-400 font-medium" : ""}`}>
          {aVal != null ? `${aVal}${suffix}` : "--"}
        </td>
        <td className="py-2 px-4 text-center text-slate-400 text-xs">{label}</td>
        <td className={`py-2 pl-4 w-24 ${bWins ? "text-green-400 font-medium" : ""}`}>
          {bVal != null ? `${bVal}${suffix}` : "--"}
        </td>
      </tr>
    );
  }

  const bothPicked = a.playerId && b.playerId;

  return (
    <div className="p-6 space-y-4 max-w-5xl mx-auto">
      <h2 className="text-xl font-semibold">Compare Players</h2>
      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="grid sm:grid-cols-2 gap-4">
        <PlayerPicker
          label="Player A"
          query={a.query}
          setQuery={a.setQuery}
          results={a.results}
          onPick={(p) => {
            a.setPlayerId(p.id);
            a.setQuery(p.full_name);
            a.setResults([]);
          }}
        />
        <PlayerPicker
          label="Player B"
          query={b.query}
          setQuery={b.setQuery}
          results={b.results}
          onPick={(p) => {
            b.setPlayerId(p.id);
            b.setQuery(p.full_name);
            b.setResults([]);
          }}
        />
      </div>

      {bothPicked && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <button
              className={`px-3 py-1.5 rounded text-sm ${isCareer ? "bg-slate-700" : "bg-slate-800 text-slate-400 hover:text-slate-200"}`}
              onClick={() => setIsCareer((v) => !v)}
            >
              Career (all seasons)
            </button>
            <div className="flex gap-1 bg-slate-800 rounded p-1">
              {HOME_AWAY_OPTIONS.map((o) => (
                <button
                  key={o.key}
                  className={`px-3 py-1.5 rounded text-sm ${homeAway === o.key ? "bg-slate-700" : "text-slate-400 hover:text-slate-200"}`}
                  onClick={() => setHomeAway(o.key)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          {!isCareer && (
            <div className="flex flex-wrap gap-2 max-h-28 overflow-auto">
              {seasonOptions.map((s) => (
                <label
                  key={s}
                  className={`px-2 py-1 rounded text-xs cursor-pointer border ${
                    selectedSeasons.includes(s)
                      ? "bg-sky-900/50 border-sky-700 text-sky-300"
                      : "bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <input type="checkbox" className="hidden" checked={selectedSeasons.includes(s)} onChange={() => toggleSeason(s)} />
                  {s}
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {bothPicked && compareLoading && !(a.averages && b.averages) && <Loading label="Loading comparison..." />}
      {bothPicked && a.averages && b.averages && (
        <section className="bg-slate-900 border border-slate-800 rounded-lg p-5">
          <div className="flex justify-between text-sm font-medium mb-2">
            <span>{a.bio?.display_first_last}</span>
            <span>{b.bio?.display_first_last}</span>
          </div>
          <table className="w-full">
            <tbody>
              {HEADLINE_STATS.map(({ label, key, suffix }) => (
                <StatRow key={key} label={label} aVal={a.averages[key]} bVal={b.averages[key]} suffix={suffix ?? ""} />
              ))}
            </tbody>
          </table>
        </section>
      )}

      {bothPicked && a.advanced && b.advanced && (
        <section className="bg-slate-900 border border-slate-800 rounded-lg p-5">
          <h3 className="text-base font-semibold mb-3">Defense &amp; Role</h3>
          <table className="w-full">
            <tbody>
              {ADVANCED_STATS.map(({ label, key, suffix, lowerIsBetter }) => (
                <StatRow
                  key={key}
                  label={label}
                  aVal={a.advanced[key]}
                  bVal={b.advanced[key]}
                  suffix={suffix ?? ""}
                  lowerIsBetter={!!lowerIsBetter}
                />
              ))}
            </tbody>
          </table>
        </section>
      )}

      {bothPicked && a.clutch && b.clutch && (
        <section className="bg-slate-900 border border-slate-800 rounded-lg p-5">
          <h3 className="text-base font-semibold mb-1">Clutch Performance</h3>
          <p className="text-xs text-slate-500 mb-3">{a.clutch.clutch_definition}</p>
          <table className="w-full">
            <tbody>
              {CLUTCH_STATS.map(({ label, key, suffix }) => (
                <StatRow key={key} label={label} aVal={a.clutch[key]} bVal={b.clutch[key]} suffix={suffix ?? ""} />
              ))}
            </tbody>
          </table>
        </section>
      )}

      {bothPicked && (a.shots.length > 0 || b.shots.length > 0) && (
        <section className="bg-slate-900 border border-slate-800 rounded-lg p-5">
          <h3 className="text-base font-semibold mb-3">Shot Charts</h3>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-slate-500 mb-2">{a.bio?.display_first_last}</p>
              <CourtShotChart shots={a.shots} sevenZones={a.sevenZones} />
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-2">{b.bio?.display_first_last}</p>
              <CourtShotChart shots={b.shots} sevenZones={b.sevenZones} />
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
