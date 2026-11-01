/** Where to write. A mailbox people can reach, unlike the no-reply sender of
 * most mail. The app (ui/footer.tsx) and the Worker (email-layout.ts) both
 * re-export this one, so there is one address to change. */
export const SUPPORT_EMAIL = "support@mail.rdyrct.com";

/** What creating one organization too many answers, from the Worker's 402
 * and from the app's forms alike. */
export const ORG_LIMIT_MESSAGE =
  "You own as many organizations as your account allows. For more, ask us about Enterprise";
