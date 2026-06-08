import { parseDiffLines } from "./landings";

/** Render a unified diff as signed lines. Blank diff shows an empty state. */
export function LandingDiff({ diff }: { diff: string }) {
  if (diff.trim() === "") {
    return <div className="rev-empty">No diff</div>;
  }
  return (
    <div className="diff">
      {parseDiffLines(diff).map((line, index) => (
        <div
          className={`diff-line ${line.sign === "+" ? "add" : line.sign === "-" ? "del" : ""}`}
          key={index}
        >
          <span className="diff-sign">{line.sign}</span>
          <span className="diff-text">{line.text}</span>
        </div>
      ))}
    </div>
  );
}
