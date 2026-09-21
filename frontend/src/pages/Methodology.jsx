// Static reference page -- no API calls. Consolidates every "is this
// official, derived, or estimated" caveat scattered across the backend's
// docstrings and API responses into one place a reader can actually find,
// instead of only ever surfacing in a JSON field or a code comment.

const BADGE_STYLES = {
  Official: "bg-emerald-900/50 text-emerald-300 border-emerald-700",
  Derived: "bg-sky-900/50 text-sky-300 border-sky-700",
  Estimated: "bg-amber-900/50 text-amber-300 border-amber-700",
};

function Badge({ kind }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded border font-medium ${BADGE_STYLES[kind]}`}>{kind}</span>
  );
}

function Entry({ title, badge, children }) {
  return (
    <div className="border-b border-slate-800 last:border-0 py-4">
      <div className="flex items-center gap-2 mb-1.5">
        <h4 className="font-medium text-sm">{title}</h4>
        <Badge kind={badge} />
      </div>
      <p className="text-sm text-slate-400 leading-relaxed">{children}</p>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="bg-slate-900 border border-slate-800 rounded-lg p-5">
      <h3 className="text-base font-semibold mb-1">{title}</h3>
      <div>{children}</div>
    </section>
  );
}

export default function Methodology() {
  return (
    <div className="p-6 space-y-4 max-w-4xl mx-auto">
      <div>
        <h2 className="text-xl font-semibold mb-1">Methodology</h2>
        <p className="text-sm text-slate-400">
          Three kinds of numbers live in this app: <strong className="text-emerald-300">Official</strong> figures
          pulled straight from the NBA stats API with no transformation, <strong className="text-sky-300">Derived</strong> figures
          built by reshaping official play-by-play or box-score data into something the NBA doesn't publish directly
          (using standard, published formulas), and <strong className="text-amber-300">Estimated</strong> figures
          that are this project's own approximation where no exact reproduction was possible from the data on hand.
          Every metric below is labeled honestly rather than presented as more authoritative than it is.
        </p>
      </div>

      <Section title="Team Performance">
        <Entry title="Four Factors -- All Games" badge="Official">
          Record, eFG%, TOV%, OREB%, and FTA rate for the full season read directly from the NBA stats API's own
          four-factors table, unchanged.
        </Entry>
        <Entry title="Four Factors -- Home/Away Split" badge="Estimated">
          The NBA doesn't publish a home/away split of four factors, so home/away numbers are computed live from
          box-score columns using the standard Dean Oliver formulas. eFG% and FTA rate reproduce the official
          all-games number almost exactly when recombined; TOV% and OREB% use the standard approximation formulas
          and can drift a couple of points from the NBA's own undocumented internal calculation.
        </Entry>
        <Entry title="Net Rating Trend" badge="Estimated">
          Game-by-game net rating uses an estimated possessions count (the standard FGA/FTA/OREB/TOV formula box-score
          sites use), since the warehouse has no play-level possession counter. Treat it as directionally
          trustworthy -- season averages have checked out closely against known public figures -- not exact to the
          decimal.
        </Entry>
        <Entry title="Estimated Win Shares" badge="Estimated">
          A from-scratch metric, not Basketball-Reference's published Win Shares and not the NBA stats API's own
          "DEF_WS" field (see below) -- both rely on methodology this project can't fully reproduce. Instead, each
          player's share of team wins is allocated by their share of a simple linear-weights production score
          (points, rebounds, assists, steals, blocks, minus empty possessions and turnovers), calibrated so the
          team's total always sums back to its actual win count.
        </Entry>
        <Entry title="NBA Stats API's 'DEF_WS' Field" badge="Official">
          A real field pulled verbatim from the NBA's own player-defense dashboard -- but it is <em>not</em> the same
          statistic as Basketball-Reference's "Defensive Win Shares," despite the name. Spot-check: Draymond Green's
          2022-23 value here is 0.127, versus roughly 2.5-3.0 on Basketball-Reference for that same season. It's
          shown as a genuine NBA.com-sourced signal, not a substitute for published Win Shares.
        </Entry>
        <Entry title="Playoffs vs. Regular Season Toggle" badge="Derived">
          Most team and roster views can switch between regular-season and playoff source tables. One exception:
          opponent zone shooting efficiency (Team Identity tab) always reflects that season's shots regardless of
          this toggle, since the underlying shot chart table has no season-type column to filter on.
        </Entry>
      </Section>

      <Section title="Clutch, Rest, and Timing">
        <Entry title="Clutch Definition" badge="Derived">
          Standard definition: period 4 or later, 5:00 or less remaining, score within 5 points at that moment.
          Player and team clutch box scores are derived event-by-event from play-by-play (crediting points, boards,
          assists, etc. the same way a full-game box score is built), restricted to events inside that window.
        </Entry>
        <Entry title="Clutch Shooting FG%" badge="Estimated">
          Because the shot chart table has no live score margin to join against, clutch FG% uses a looser,
          time-only definition (Q4/OT, &le;5:00 left, no margin condition) -- flagged separately from the
          margin-filtered counting stats above it.
        </Entry>
        <Entry title="Rest Days / Back-to-Back" badge="Derived">
          Straightforward: days since the team's previous game, computed from the game log's own dates. No
          approximation involved.
        </Entry>
      </Section>

      <Section title="Shot Profile & Style">
        <Entry title="Zone FG% vs. League Average" badge="Derived">
          Each of the seven shot zones' FG% is compared to the same season's league-wide FG% in that zone -- a
          direct calculation, not an approximation, though "zone" boundaries are this project's own simplification
          of the court into seven coach-facing regions rather an official NBA zone taxonomy.
        </Entry>
        <Entry title="Shot Creation Type" badge="Estimated">
          A six-bucket classification (catch & shoot, pullup, drive, post-up, cut, putback) built by pattern-matching
          each shot's text description (ACTION_TYPE). This is a proxy for genuine tracking-based play-type data,
          which the warehouse doesn't have -- treat it as directionally useful, not officially categorized.
        </Entry>
        <Entry title="Team Style / Shot Mix" badge="Official">
          Paint/mid-range/three-point scoring share, assisted vs. unassisted FGM, and similar shot-selection metrics
          come directly from the NBA stats API's team scoring dashboard.
        </Entry>
      </Section>

      <Section title="Player Similarity & Archetypes">
        <Entry title="Player Archetypes" badge="Estimated">
          An unsupervised KMeans clustering (scikit-learn) on z-score-normalized usage, efficiency, playmaking,
          rebounding, turnover, 3-point rate, paint-scoring share, and defensive-activity stats for a season. Cluster
          count and the auto-generated labels are this project's own heuristic -- not a reproduction of any
          published archetype taxonomy -- and results can shift with a different season or cluster count.
        </Entry>
        <Entry title="Similar Players" badge="Estimated">
          Nearest neighbors to a player in that same statistical feature space, ranked by Euclidean distance. Purely
          statistical -- "who put up similar numbers this season," not a scouting judgment about play style or fit.
        </Entry>
      </Section>

      <Section title="Derived Box Scores">
        <Entry title="Per-Game Player Box Scores" badge="Derived">
          No ready-made "who did what, in this specific game" table exists in the warehouse outside of a handful of
          season aggregates, so points/rebounds/assists/steals/blocks/turnovers/fouls per player per game are
          derived by crediting play-by-play events (a made shot, a rebound, a turnover, and so on) to the right
          player. Free throw attempts aren't tracked this way; the shot chart table already covers field goal
          attempts directly. Validated against official season-average totals for several high-minute players before
          being trusted for any downstream feature.
        </Entry>
        <Entry title="Teammate With/Without Impact" badge="Derived">
          "Missed" means a teammate never checked into a lineup stint for their team that game -- this covers
          injury, rest, and a healthy DNP alike, since the warehouse has no injury-designation data to tell them
          apart.
        </Entry>
      </Section>
    </div>
  );
}
