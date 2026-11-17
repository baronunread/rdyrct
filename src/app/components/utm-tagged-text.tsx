import { UTM_KEYS } from "@/shared/utm";
import type { UtmFields } from "@/shared/utm";
import { cn } from "../ui/cn";

const PARAM_TONE = {
  utmSource: "text-mint",
  utmMedium: "text-sky",
  utmCampaign: "text-accent",
  utmTerm: "text-butter",
  utmContent: "text-pink",
} satisfies Record<keyof UtmFields, string>;

const tone = (param: string) => {
  const key = UTM_KEYS.find(([p]) => p === param)?.[1];
  return key ? PARAM_TONE[key] : "text-text";
};

export function TaggedText({ tagged }: { tagged: string }) {
  const { search, hash } = new URL(tagged);
  // Split on the text itself, not re-encoded params, so what shows is exactly `tagged`.
  const base = tagged.slice(0, tagged.length - search.length - hash.length);
  const pairs = search ? search.slice(1).split("&") : [];
  return (
    <>
      <span className="text-muted">{base}</span>
      {pairs.map((pair, i) => (
        <QueryPair key={pair.split("=")[0]} pair={pair} lead={i === 0 ? "?" : "&"} />
      ))}
      {hash && <span className="text-muted">{hash}</span>}
    </>
  );
}

function QueryPair({ pair, lead }: { pair: string; lead: string }) {
  // Split at the first "=" only: a value may hold another.
  const [name, value] = pair.split(/=(.*)/s);
  return (
    <span>
      <span className="text-placeholder">
        {lead}
        {name}
        {value === undefined ? "" : "="}
      </span>
      <span key={value} className={cn(tone(name), "motion-safe:animate-value-in")}>
        {value}
      </span>
    </span>
  );
}
