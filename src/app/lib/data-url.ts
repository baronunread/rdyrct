import * as v from "valibot";

export function dataUrlOf(reader: FileReader): string {
  const result = v.safeParse(v.string(), reader.result);
  return result.success ? result.output : "";
}
