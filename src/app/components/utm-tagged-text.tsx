import { UTM_KEYS } from "@/shared/utm";
import type { UtmFields } from "@/shared/utm";
import { cn } from "../ui/cn";

/** Each parameter's colour, in the fields' order, shared by the tagged link
 *  so a value there reads as the field it came from. */
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

/** A tagged link, each value in its field's colour. */
export function TaggedText({ tagged }: { tagged: string }) {
  const { search, hash } = new URL(tagged);
  // Split on the text itself rather than re-encoding the parameters, so
  // what shows is exactly `tagged`, character for character: the address,
  // the query (none for a link with no tags yet), then any #fragment, which
  // URLs put after the query.
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

/** One `name=value` of the query: the name quiet, the value in its field's
 *  colour, keyed on the value so a changed one fades in. */
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
