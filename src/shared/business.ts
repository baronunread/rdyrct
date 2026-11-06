/** Who runs rdyrct.com, as Italian law asks a business site to say it: the
 * owner's name, the Partita IVA on the home page (art. 35 DPR 633/72) and the
 * address (art. 7 D.Lgs. 70/2003). Shown only on rdyrct.com's own pages,
 * which a self-hosted build never bundles. The newsletter footer prints the
 * same address from POSTAL_ADDRESS in wrangler.jsonc. */
export const BUSINESS = {
  name: "Andrea Bruno",
  vatNumber: "01457780326",
  address: "Viale Gabriele D'Annunzio 23, 34138 Trieste (TS), Italy",
} as const;
