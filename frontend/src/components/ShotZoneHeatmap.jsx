import Plot from "react-plotly.js";

// Same court coordinate system as CourtShotChart: feet, origin at the
// baseline below the rim, rim center at (0, 5.25).
const LINE = { color: "#475569", width: 1.5 };

const COURT_SHAPES = [
  { type: "rect", x0: -25, x1: 25, y0: 0, y1: 47, line: LINE },
  { type: "line", x0: -3, x1: 3, y0: 4, y1: 4, line: { ...LINE, width: 2 } },
  { type: "circle", x0: -0.75, x1: 0.75, y0: 4.5, y1: 6, line: { color: "#f97316", width: 2 } },
  { type: "path", path: "M -4,5.25 A 4,4 0 0 0 4,5.25", line: LINE },
  { type: "rect", x0: -8, x1: 8, y0: 0, y1: 19, line: LINE },
  { type: "rect", x0: -6, x1: 6, y0: 0, y1: 19, line: LINE },
  { type: "circle", x0: -6, x1: 6, y0: 13, y1: 25, line: LINE },
  { type: "line", x0: -22, x1: -22, y0: 0, y1: 14, line: LINE },
  { type: "line", x0: 22, x1: 22, y0: 0, y1: 14, line: LINE },
  { type: "path", path: "M -22,14 A 23.75,23.75 0 0 0 22,14", line: LINE },
  { type: "line", x0: -25, x1: 25, y0: 47, y1: 47, line: LINE },
];

// Cold-to-hot scale for FG% -- blue (cold/inefficient) through to red (hot/efficient).
const FG_COLORSCALE = [
  [0, "#3b82f6"],
  [0.5, "#eab308"],
  [1, "#ef4444"],
];

function sizeFor(attempts, maxAttempts) {
  const minSize = 22;
  const maxSize = 70;
  if (!maxAttempts) return minSize;
  return minSize + (maxSize - minSize) * Math.sqrt(attempts / maxAttempts);
}

export default function ShotZoneHeatmap({ zones = [] }) {
  if (zones.length === 0) {
    return <p className="text-slate-400 text-sm">No shot data for this filter.</p>;
  }
  const maxAttempts = Math.max(...zones.map((z) => z.attempts));

  return (
    <Plot
      data={[
        {
          x: zones.map((z) => z.avg_loc_x),
          y: zones.map((z) => z.avg_loc_y),
          mode: "markers+text",
          type: "scatter",
          marker: {
            size: zones.map((z) => sizeFor(z.attempts, maxAttempts)),
            color: zones.map((z) => z.fg_pct),
            colorscale: FG_COLORSCALE,
            cmin: 0,
            cmax: 70,
            line: { color: "#0f172a", width: 1.5 },
            colorbar: {
              title: { text: "FG%", font: { color: "#e2e8f0" } },
              tickfont: { color: "#e2e8f0" },
              len: 0.6,
            },
          },
          text: zones.map((z) => `${z.fg_pct.toFixed(0)}%`),
          textfont: { color: "#0f172a", size: 10, family: "monospace" },
          hovertemplate: "%{customdata}<extra></extra>",
          customdata: zones.map(
            (z) => `${z.ZONE_NAME} ${z.BASIC_ZONE} (${z.ZONE_RANGE})<br>${z.makes}/${z.attempts} (${z.fg_pct}%)`
          ),
        },
      ]}
      layout={{
        shapes: COURT_SHAPES,
        xaxis: { range: [-25, 25], showgrid: false, zeroline: false, visible: false },
        yaxis: { range: [-2, 47], showgrid: false, zeroline: false, visible: false, scaleanchor: "x" },
        paper_bgcolor: "#0f172a",
        plot_bgcolor: "#0f172a",
        margin: { l: 10, r: 10, t: 10, b: 10 },
        showlegend: false,
        height: 520,
      }}
      config={{ displayModeBar: false, responsive: true }}
      style={{ width: "100%" }}
      useResizeHandler
    />
  );
}
