const COUNTRY_NAMES = new Intl.DisplayNames("en", { type: "region" });

export function countryName(code: string): string {
  try {
    return COUNTRY_NAMES.of(code) ?? code;
  } catch {
    return code;
  }
}
