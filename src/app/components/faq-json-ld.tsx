import type { ReactNode } from "react";

// "<" is escaped as < so a "</script>" inside a value cannot close the tag.
export interface Faq {
  q: string;
  a: string;
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
