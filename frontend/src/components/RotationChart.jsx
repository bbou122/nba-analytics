// Minutes-rotation / plus-minus chart: one row per player, one horizontal
// segment per lineup-stint they were part of, positioned along the game
// clock and colored by that segment's plus-minus. Modeled on
// courtsketch.com's "Player Game Rotation (Plus/Minus)" view -- gaps in a
// row are bench time, and a continuous on-court stretch can still show
// several back-to-back segments since a teammate substitution starts a
// new lineup-stint even if this player never left the floor.
//
// Plain absolutely-positioned divs rather than a charting library: the
// layout is just "position by elapsed seconds / total seconds", and this
// keeps per-segment text labels and hover tooltips simple.

const COLOR_STOPS_NEG = [13, 148, 136]; // teal-600 (bad stretches for this team)
const COLOR_STOPS_MID = [217, 119, 6]; // amber-600 (roughly even)
const COLOR_STOPS_POS = [220, 38, 38]; // red-600 (good stretches for this team)
const CLAMP = 10; // +/-10 is already a big stint swing; beyond that just saturates

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function marginColor(margin) {
  const clamped = Math.max(-CLAMP, Math.min(CLAMP, margin));
  const t = (clamped + CLAMP) / (2 * CLAMP); // 0..1
  const [c0, c1] = t < 0.5 ? [COLOR_STOPS_NEG, COLOR_STOPS_MID] : [COLOR_STOPS_MID, COLOR_STOPS_POS];
  const u = t < 0.5 ? t / 0.5 : (t - 0.5) / 0.5;
  const rgb = [0, 1, 2].map((i) => Math.round(lerp(c0[i], c1[i], u)));
  return `rgb(${rgb.join(",")})`;
}

function formatClock(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function TeamRotation({ team, totalSeconds, periodBoundaries }) {
  const players = team.players.filter((p) => p.total_seconds > 0);
  return (
    <div className="mb-6 last:mb-0">
      <div className="text-sm font-semibold mb-2">
        {team.abbreviation}
        {team.flagged && (
          <span className="text-amber-400 text-xs font-normal ml-2">
            flagged by QA -- on-court time didn't land within tolerance of a valid game length
          </span>
        )}
      </div>
      {players.map((p) => (
        <div key={p.player_id} className="flex items-center gap-2 h-6 mb-0.5">
          <div className="w-32 shrink-0 text-xs text-slate-300 truncate text-right pr-2">{p.player_name}</div>
          <div className="relative flex-1 h-5 bg-slate-950 rounded-sm">
            {periodBoundaries
              .filter((b) => b > 0 && b < totalSeconds)
              .map((b) => (
                <div
                  key={b}
                  className="absolute top-0 bottom-0 border-l border-dashed border-slate-700"
                  style={{ left: `${(b / totalSeconds) * 100}%` }}
                />
              ))}
            {p.segments.map((seg, i) => {
              const widthPct = ((seg.end_seconds - seg.start_seconds) / totalSeconds) * 100;
              if (widthPct <= 0) return null;
              return (
                <div
                  key={i}
                  className="absolute top-0 bottom-0 flex items-center justify-center text-[10px] font-medium text-white overflow-hidden border-r border-slate-950/60"
                  style={{
                    left: `${(seg.start_seconds / totalSeconds) * 100}%`,
                    width: `${widthPct}%`,
                    backgroundColor: marginColor(seg.margin),
                  }}
                  title={`${formatClock(seg.start_seconds)}-${formatClock(seg.end_seconds)}: ${
                    seg.margin >= 0 ? "+" : ""
                  }${seg.margin}`}
                >
                  {widthPct > 2.5 ? (seg.margin >= 0 ? `+${seg.margin}` : seg.margin) : ""}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <div className="flex items-center gap-2 mt-1">
        <div className="w-32 shrink-0" />
        <div className="relative flex-1 h-4 text-[10px] text-slate-500">
          {Array.from({ length: Math.floor(totalSeconds / 360) + 1 }, (_, i) => i * 360)
            .concat(totalSeconds)
            .map((t) => (
              <span key={t} className="absolute -translate-x-1/2" style={{ left: `${(t / totalSeconds) * 100}%` }}>
                {Math.round(t / 60)}
              </span>
            ))}
        </div>
      </div>
    </div>
  );
}

export default function RotationChart({ data, teamFilter = "both" }) {
  if (!data) return null;
  const totalSeconds = data.total_seconds;
  const periodBoundaries = [720, 1440, 2160, 2880];
  for (let i = 1; i <= data.ot_periods; i++) periodBoundaries.push(2880 + i * 300);

  const teamsToShow =
    teamFilter === "home" ? [data.home] : teamFilter === "away" ? [data.away] : [data.away, data.home];

  return (
    <div>
      {teamsToShow.map((team) => (
        <TeamRotation key={team.team_id} team={team} totalSeconds={totalSeconds} periodBoundaries={periodBoundaries} />
      ))}
      <div className="flex items-center gap-2 mt-3 text-[10px] text-slate-500">
        <span>Team losing the stint</span>
        <div
          className="h-2 w-32 rounded"
          style={{ background: `linear-gradient(to right, rgb(13,148,136), rgb(217,119,6), rgb(220,38,38))` }}
        />
        <span>Team winning the stint</span>
      </div>
    </div>
  );
}
