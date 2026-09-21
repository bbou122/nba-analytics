// Small shared loading indicator, used at the top of each page's primary
// data-fetching effect so a season/player switch never looks like nothing
// happened -- consistent look across the whole app instead of every page
// inventing its own spinner (or, more often before this, none at all).
export default function Loading({ label = "Loading..." }) {
  return (
    <div className="flex items-center gap-1.5 text-sm text-slate-400 py-6 justify-center">
      <span className="w-2 h-2 rounded-full bg-sky-500 animate-pulse" />
      <span className="w-2 h-2 rounded-full bg-sky-500 animate-pulse [animation-delay:150ms]" />
      <span className="w-2 h-2 rounded-full bg-sky-500 animate-pulse [animation-delay:300ms]" />
      <span className="ml-2">{label}</span>
    </div>
  );
}
