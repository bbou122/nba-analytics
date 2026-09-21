import { useEffect, useState } from "react";
import { api } from "../api";

export default function TeamExplorer() {
  const [teams, setTeams] = useState([]);
  const [teamId, setTeamId] = useState(null);
  const [seasons, setSeasons] = useState([]);
  const [season, setSeason] = useState("");
  const [statType, setStatType] = useState("traditional");
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.teams().then(setTeams).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!teamId) return;
    setError(null);
    api.teamSeasons(teamId)
      .then((s) => {
        setSeasons(s);
        setSeason(s[s.length - 1] || "");
      })
      .catch((e) => setError(e.message));
  }, [teamId]);

  useEffect(() => {
    if (!teamId || !season) return;
    setError(null);
    api.teamStats(teamId, { season, statType })
      .then((rows) => setStats(rows[0]))
      .catch((e) => setError(e.message));
  }, [teamId, season, statType]);

  return (
    <div className="p-6 space-y-4 max-w-5xl mx-auto">
      <h2 className="text-xl font-semibold">Team Explorer</h2>
      {error && <p className="text-red-400 text-sm">{error}</p>}

      <select
        className="bg-slate-800 border border-slate-700 rounded px-3 py-2"
        value={teamId ?? ""}
        onChange={(e) => setTeamId(Number(e.target.value))}
      >
        <option value="" disabled>Select a team</option>
        {teams.map((t) => (
          <option key={t.id} value={t.id}>{t.full_name}</option>
        ))}
      </select>

      {teamId && seasons.length > 0 && (
        <div className="flex flex-wrap gap-3">
          <select
            className="bg-slate-800 border border-slate-700 rounded px-3 py-2"
            value={season}
            onChange={(e) => setSeason(e.target.value)}
          >
            {seasons.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select
            className="bg-slate-800 border border-slate-700 rounded px-3 py-2"
            value={statType}
            onChange={(e) => setStatType(e.target.value)}
          >
            <option value="traditional">Traditional</option>
            <option value="advanced">Advanced</option>
          </select>
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          {Object.entries(stats)
            .filter(([k]) => !k.endsWith("_RANK") && k !== "TEAM_ID" && k !== "TEAM_NAME" && k !== "SEASON")
            .map(([k, v]) => (
              <div key={k} className="bg-slate-800 rounded p-3">
                <div className="text-xs text-slate-400">{k}</div>
                <div className="text-lg font-medium">{typeof v === "number" ? v : String(v)}</div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
