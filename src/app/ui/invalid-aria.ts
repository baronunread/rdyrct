export type InvalidAria = { "aria-invalid"?: true; "aria-describedby"?: string };

export function invalidAria(reason: string | undefined | null, reasonId: string): InvalidAria {
  return reason ? { "aria-invalid": true, "aria-describedby": reasonId } : {};
}
