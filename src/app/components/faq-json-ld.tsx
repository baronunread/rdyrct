import type { ReactNode } from "react";

/**
 * FAQPage structured data, from the same questions the page renders.
 *
 * Shared by the landing page and the QR generator so the answers a search
 * result shows are the answers on the page, and so the escaping is written
 * once: a "</script>" inside any value would close the tag early, so every
 * "<" goes out as <.
 */
export interface Faq {
  q: string;
  /** Plain-text answer: what a search result shows, and what renders when
   *  `aNode` is absent. */
  a: string;
  /** Rendered answer, for the rare one that needs an inline link `a` alone
   *  can't carry. Schema still reads `a`, since a link's destination means
   *  nothing to a search snippet. */
  aNode?: ReactNode;
}

export function FaqJsonLd({ faqs }: { faqs: readonly Faq[] }) {
  const json = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  }).replace(/</g, "\\u003c");
  // eslint-disable-next-line react-doctor/dangerous-html-sink -- our own
  // strings, escaped above; a script tag has no other way to carry JSON.
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
