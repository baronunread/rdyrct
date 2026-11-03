import { ChevronDown } from "@/app/ui/icons";
import { FaqJsonLd, type Faq } from "./faq-json-ld";

/**
 * Questions as a list of disclosures, each opening smoothly (styles.css,
 * `details`), with the same questions as FAQPage data so a search result
 * shows the answers the page shows.
 *
 * w-full matters: a parent that centres its children would otherwise size
 * this column to its content, and every answer that opens would be wider
 * than the question it hangs under.
 */
export function FaqList({ faqs, title }: { faqs: readonly Faq[]; title?: string }) {
  return (
    <div className="flex w-full max-w-3xl flex-col gap-3">
      {title && <h2 className="text-sm font-bold">{title}</h2>}
      {faqs.map(({ q, a, aNode }) => (
        <details
          key={q}
          className="group rounded-lg border border-border bg-surface px-4 open:border-accent/40"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-4 text-sm font-bold [&::-webkit-details-marker]:hidden">
            {q}
            <ChevronDown
              size={16}
              className="shrink-0 text-muted transition-transform group-open:rotate-180"
            />
          </summary>
          <p className="pb-4 text-sm text-muted">{aNode ?? a}</p>
        </details>
      ))}
      <FaqJsonLd faqs={faqs} />
    </div>
  );
}
