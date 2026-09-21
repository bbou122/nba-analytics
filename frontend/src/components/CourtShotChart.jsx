import Plot from "react-plotly.js";

// Coordinate system matches fact_shot_chart's LOC_X/LOC_Y: feet, origin at
// the baseline directly below the rim, rim center at (0, 5.25). Court is
// 50ft wide (x: -25..25) and drawn out to half court (y: 0..47).
const LINE = { color: "#475569", width: 1.5 };
const THREE_PT_LINE = { color: "#facc15", width: 2.5 }; // distinct from the rest of the court markings

const COURT_SHAPES = [
  { type: "rect", x0: -25, x1: 25, y0: 0, y1: 47, line: LINE },
  { type: "line", x0: -3, x1: 3, y0: 4, y1: 4, line: { ...LINE, width: 2 } }, // backboard
  { type: "circle", x0: -0.75, x1: 0.75, y0: 4.5, y1: 6, line: { color: "#f97316", width: 2 } }, // rim
  { type: "path", path: "M -4,5.25 A 4,4 0 0 0 4,5.25", line: LINE }, // restricted area
  { type: "rect", x0: -8, x1: 8, y0: 0, y1: 19, line: LINE }, // outer key
  { type: "rect", x0: -6, x1: 6, y0: 0, y1: 19, line: LINE }, // inner key
  { type: "circle", x0: -6, x1: 6, y0: 13, y1: 25, line: LINE }, // free throw circle
  { type: "line", x0: -22, x1: -22, y0: 0, y1: 14, line: THREE_PT_LINE }, // corner 3 left
  { type: "line", x0: 22, x1: 22, y0: 0, y1: 14, line: THREE_PT_LINE }, // corner 3 right
  { type: "path", path: "M -22,14 A 23.75,23.75 0 0 0 22,14", line: THREE_PT_LINE }, // 3pt arc
  { type: "line", x0: -25, x1: 25, y0: 47, y1: 47, line: LINE }, // half court
];

// Fixed anchor point for each of the 7 coach-facing zones (see
// GET /shots/zones/seven), positioned to sit inside that region of the
// court diagram regardless of how sparse the actual shot data is there.
const SEVEN_ZONE_ANCHORS = {
  Paint: { x: 0, y: 8 },
  "Mid-Range Left": { x: -14, y: 13 },
  "Mid-Range Center": { x: 0, y: 19 },
  "Mid-Range Right": { x: 14, y: 13 },
  "Three Left": { x: -21, y: 19 },
  "Three Center": { x: 0, y: 33 },
  "Three Right": { x: 21, y: 19 },
};

function sevenZoneAnnotations(sevenZones) {
  if (!sevenZones || sevenZones.length === 0) return [];
  return sevenZones
    .filter((z) => SEVEN_ZONE_ANCHORS[z.zone])
    .map((z) => {
      const { x, y } = SEVEN_ZONE_ANCHORS[z.zone];
      const hasLeague = z.league_fg_pct != null && z.diff_vs_league != null;
      const diffText = hasLeague ? `${z.diff_vs_league >= 0 ? "+" : ""}${z.diff_vs_league.toFixed(1)} vs lg` : "";
      return {
        x,
        y,
        text: hasLeague ? `${z.fg_pct.toFixed(1)}%<br>${diffText}` : `${z.fg_pct.toFixed(1)}%`,
        showarrow: false,
        font: { color: "#0f172a", size: 12, family: "Arial, sans-serif", weight: 700 },
        bgcolor: hasLeague
          ? z.diff_vs_league >= 0
            ? "rgba(187, 247, 208, 0.92)"
            : "rgba(254, 202, 202, 0.92)"
          : "rgba(226, 232, 240, 0.92)",
        bordercolor: "#94a3b8",
        borderwidth: 1,
        borderpad: 3,
      };
    });
}

export default function CourtShotChart({ shots = [], sevenZones = [] }) {
  const made = shots.filter((s) => s.SHOT_MADE);
  const missed = shots.filter((s) => !s.SHOT_MADE);

  return (
    <Plot
      data={[
        {
          x: missed.map((s) => s.LOC_X),
          y: missed.map((s) => s.LOC_Y),
          mode: "markers",
          type: "scatter",
          name: `Missed (${missed.length})`,
          marker: { color: "#ef4444", symbol: "x", size: 6, opacity: 0.7 },
          hovertemplate: "%{text}<extra></extra>",
          text: missed.map((s) => `${s.ACTION_TYPE} - ${s.ZONE_NAME}`),
        },
        {
          x: made.map((s) => s.LOC_X),
          y: made.map((s) => s.LOC_Y),
          mode: "markers",
          type: "scatter",
          name: `Made (${made.length})`,
          marker: { color: "#22c55e", symbol: "circle", size: 6, opacity: 0.85 },
          hovertemplate: "%{text}<extra></extra>",
          text: made.map((s) => `${s.ACTION_TYPE} - ${s.ZONE_NAME}`),
        },
      ]}
      layout={{
        shapes: COURT_SHAPES,
        annotations: sevenZoneAnnotations(sevenZones),
        xaxis: { range: [-25, 25], showgrid: false, zeroline: false, visible: false },
        yaxis: { range: [-2, 47], showgrid: false, zeroline: false, visible: false, scaleanchor: "x" },
        paper_bgcolor: "#0f172a",
        plot_bgcolor: "#0f172a",
        margin: { l: 10, r: 10, t: 10, b: 10 },
        showlegend: true,
        legend: { font: { color: "#e2e8f0" }, orientation: "h", y: 1.05 },
        height: 560,
      }}
      config={{ displayModeBar: false, responsive: true }}
      style={{ width: "100%" }}
      useResizeHandler
    />
  );
}
