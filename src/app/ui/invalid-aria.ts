/** The ARIA for a control marked outside a Field: invalid, and pointing at
 * the element that says why. Nothing when there is no reason. */
export type InvalidAria = { "aria-invalid"?: true; "aria-describedby"?: string };

export function invalidAria(reason: string | undefined | null, reasonId: string): InvalidAria {
  return reason ? { "aria-invalid": true, "aria-describedby": reasonId } : {};
}
