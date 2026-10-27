import type { Page } from "@playwright/test";

/** Opens `path`, clicks its Export CSV button and returns the file it
 * downloads, as a user would get it. */
export async function exportCsvFrom(page: Page, path: string) {
  await page.goto(path);
  const button = page.getByRole("button", { name: "Export CSV" });
  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream()) chunks.push(Buffer.from(chunk));
  return { filename: download.suggestedFilename(), text: Buffer.concat(chunks).toString("utf8") };
}
