import type { Page } from "@playwright/test";

/** Opens `path`, clicks its export button and returns the file it
 * downloads, as a user would get it. /analytics names it "Export CSV"; the
 * links page's header calls it "Export". */
export async function exportCsvFrom(page: Page, path: string, buttonName = "Export CSV") {
  await page.goto(path);
  const button = page.getByRole("button", { name: buttonName, exact: true });
  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream()) chunks.push(Buffer.from(chunk));
  return { filename: download.suggestedFilename(), text: Buffer.concat(chunks).toString("utf8") };
}
