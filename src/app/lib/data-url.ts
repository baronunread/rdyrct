import * as v from "valibot";

/** What a FileReader holds after `readAsDataURL` finishes: a string. The
 * type also allows an ArrayBuffer or null, which that call never leaves. */
export function dataUrlOf(reader: FileReader): string {
  const result = v.safeParse(v.string(), reader.result);
  return result.success ? result.output : "";
}
