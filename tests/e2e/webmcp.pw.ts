import { expect, test, type Page } from "@playwright/test";
import type { JsonValue } from "@/shared/types";
import { signUpAndVerify } from "./resend";

declare global {
  interface Window {
    webMcpTools: Array<{
      name: string;
      execute: (input: JsonValue, options: { signal: AbortSignal }) => Promise<string>;
    }>;
  }
}

/** Installs the browser API before the app runs, as a supporting browser does. */
async function supportWebMcp(page: Page) {
  await page.addInitScript(() => {
    const tools: Window["webMcpTools"] = [];
    Object.defineProperty(window, "webMcpTools", { value: tools });
    Object.defineProperty(document, "modelContext", {
      value: {
        registerTool(tool: (typeof tools)[number]) {
          tools.push(tool);
          return Promise.resolve();
        },
      },
    });
  });
}

async function toolNamed(page: Page, name: string) {
  await expect
    .poll(() =>
      page.evaluate((toolName) => window.webMcpTools.some((tool) => tool.name === toolName), name),
    )
    .toBe(true);
}

test("a browser agent can fill the visible QR generator", async ({ page }) => {
  await supportWebMcp(page);
  await page.goto("/qr-code-generator");
  await toolNamed(page, "generate_qr_code");

  const result = await page.evaluate(async () => {
    const tool = window.webMcpTools.find((candidate) => candidate.name === "generate_qr_code");
    return tool?.execute(
      { value: "https://example.com/agent-qr", dotStyle: "dots", dotColor: "#745ab8" },
      { signal: new AbortController().signal },
    );
  });

  expect(result).toMatch(/now shows that value/);
  await expect(page.getByLabel("Link or text")).toHaveValue("https://example.com/agent-qr");
  await expect(page.getByRole("button", { name: "Dot style" })).toContainText("dots");
  await expect(
    page.getByRole("img", { name: /QR code for https:\/\/example.com\/agent-qr/ }),
  ).toBeVisible();

  const invalid = await page.evaluate(async () => {
    const tool = window.webMcpTools.find((candidate) => candidate.name === "generate_qr_code");
    return tool?.execute({ value: "   " }, { signal: new AbortController().signal });
  });
  expect(invalid).toMatch(/not valid/);
  await expect(page.getByLabel("Link or text")).toHaveValue("https://example.com/agent-qr");
});

test("a signed-in browser agent can create and find a link", async ({ page }) => {
  await supportWebMcp(page);
  await signUpAndVerify(page, `webmcp-${Date.now()}@gmail.com`, "test-password-123");
  await page.goto("/dashboard");
  await toolNamed(page, "create_link");
  await toolNamed(page, "find_links");

  const destination = "https://example.com/browser-agent";
  const created = await page.evaluate(async (url) => {
    const tool = window.webMcpTools.find((candidate) => candidate.name === "create_link");
    return tool?.execute(
      { destination: url, title: "Agent link" },
      { signal: new AbortController().signal },
    );
  }, destination);

  expect(created).toMatch(/Created rdyrct.com\//);
  await expect(page).toHaveURL(/\/links$/);
  await expect(page.getByText(destination)).toBeVisible();

  const found = await page.evaluate(async () => {
    const tool = window.webMcpTools.find((candidate) => candidate.name === "find_links");
    return tool?.execute({ query: "browser-agent" }, { signal: new AbortController().signal });
  });
  expect(found).toContain(destination);
});
