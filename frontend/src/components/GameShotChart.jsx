import Plot from "react-plotly.js";

const LINE = { color: "#475569", width: 1.5 };
const THREE_PT_LINE = { color: "#facc15", width: 2.5 };

const COURT_SHAPES = [
  { type: "rect", x0: -25, x1: 25, y0: 0, y1: 47, line: LINE },
  { type: "line", x0: -3, x1: 3, y0: 4, y1: 4, line: { ...LINE, width: 2 } },
  { type: "circle", x0: -0.75, x1: 0.75, y0: 4.5, y1: 6, line: { color: "#f97316", width: 2 } },
  { type: "path", path: "M -4,5.25 A 4,4 0 0 0 4,5.25", line: LINE },
  { type: "rect", x0: -8, x1: 8, y0: 0, y1: 19, line: LINE },
  { type: "rect", x0: -6, x1: 6, y0: 0, y1: 19, line: LINE },
  { type: "circle", x0: -6, x1: 6, y0: 13, y1: 25, line: LINE },
  { type: "line", x0: -22, x1: -22, y0: 0, y1: 14, line: THREE_PT_LINE },
  { type: "line", x0: 22, x1: 22, y0: 0, y1: 14, line: THREE_PT_LINE },
  { type: "path", path: "M -22,14 A 23.75,23.75 0 0 0 22,14", line: THREE_PT_LINE },
  { type: "line", x0: -25, x1: 25, y0: 47, y1: 47, line: LINE },
];

// One team's shots plotted as made (filled) / missed (x), in a given color.
function teamTraces(shots, label, color) {
  const made = shots.filter((s) => s.SHOT_MADE);
  const missed = shots.filter((s) => !s.SHOT_MADE);
  return [
    {
      x: missed.map((s) => s.LOC_X),
      y: missed.map((s) => s.LOC_Y),
      mode: "markers",
      type: "scatter",
      name: `${label} miss (${missed.length})`,
      marker: { color, symbol: "x", size: 6, opacity: 0.55 },
      hovertemplate: "%{text}<extra></extra>",
      text: missed.map((s) => `${s.PLAYER_NAME} -- ${s.ACTION_TYPE} (${s.ZONE_NAME})`),
    },
    {
      x: made.map((s) => s.LOC_X),
      y: made.map((s) => s.LOC_Y),
      mode: "markers",
      type: "scatter",
      name: `${label} make (${made.length})`,
      marker: { color, symbol: "circle", size: 7, opacity: 0.9 },
      hovertemplate: "%{text}<extra></extra>",
      text: made.map((s) => `${s.PLAYER_NAME} -- ${s.ACTION_TYPE} (${s.ZONE_NAME})`),
    },
  ];
}

// filter: "both" | "home" | "away"
export default function GameShotChart({ homeShots = [], awayShots = [], homeLabel = "Home", awayLabel = "Away", filter = "both" }) {
  const traces = [
    ...(filter !== "away" ? teamTraces(homeShots, homeLabel, "#38bdf8") : []),
    ...(filter !== "home" ? teamTraces(awayShots, awayLabel, "#fb923c") : []),
  ];

  return (
    <Plot
      data={traces}
      layout={{
        shapes: COURT_SHAPES,
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
