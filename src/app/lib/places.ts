const COUNTRY_NAMES = new Intl.DisplayNames("en", { type: "region" });

/** "Italy" from "IT", or the code itself when the runtime has no name. */
export function countryName(code: string): string {
  try {
    return COUNTRY_NAMES.of(code) ?? code;
  } catch {
    return code;
  }
}
