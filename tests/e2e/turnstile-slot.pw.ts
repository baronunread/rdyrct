import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * The always-pass key never shows a challenge, so this also pins that the slot takes no
 * space and the form does not move (#304).
 */

type GuardedForm = {
  name: string;
  open: (page: Page) => Promise<void>;
  container: (page: Page) => Locator;
  submit: (container: Locator) => Locator;
  /** Reset has none: it runs the widget only on submit, which replaces the form. */
  start?: (page: Page) => Promise<void>;
};

const FORMS: GuardedForm[] = [
  {
    name: "sign-up",
    open: (page) => page.goto("/signup").then(() => undefined),
    container: (page) => page.locator("form").filter({ has: page.getByLabel("Password") }),
    submit: (form) => form.getByRole("button", { name: "Sign up" }),
    start: (page) => page.getByLabel("Email").fill("slot-probe@example.com"),
  },
  {
    name: "password reset",
    open: async (page) => {
      await page.goto("/login");
      await page.getByRole("button", { name: "Forgot it?" }).click();
    },
    container: (page) =>
      page.locator("form").filter({ has: page.getByRole("button", { name: "Send reset link" }) }),
    submit: (form) => form.getByRole("button", { name: "Send reset link" }),
  },
  {
    name: "landing shortener",
    open: (page) => page.goto("/").then(() => undefined),
    container: (page) =>
      page.locator("form").filter({ has: page.getByLabel("Shorten a link, no account needed") }),
    submit: (form) => form.getByRole("button", { name: /Shorten it/ }),
    start: (page) =>
      page.getByLabel("Shorten a link, no account needed").fill("https://example.com/slot"),
  },
  {
    name: "UTM builder",
    open: (page) => page.goto("/utm-builder").then(() => undefined),
    container: (page) => page.locator("[data-utm-builder]"),
    submit: (card) => card.getByRole("button", { name: "Shorten it" }),
    start: (page) => page.getByLabel("Website URL").fill("https://example.com/slot"),
  },
  {
    name: "report form",
    open: (page) => page.goto("/report").then(() => undefined),
    container: (page) =>
      page.locator("form").filter({ has: page.getByRole("button", { name: "Send report" }) }),
    submit: (form) => form.getByRole("button", { name: "Send report" }),
    start: (page) => page.getByLabel("Short link").fill("https://rdyr.cc/abc1234"),
  },
];

for (const form of FORMS) {
  test(`the ${form.name} holds Turnstile's slot above its button, taking no space`, async ({
    page,
  }) => {
    await form.open(page);
    const container = form.container(page);
    const slot = container.locator("[data-turnstile-slot]");
    await expect(slot).toHaveCount(1);

    const precedesSubmit = await slot.evaluate(
      (el, label) => {
        let next = el.nextElementSibling;
        if (next?.getAttribute("role") === "status") next = next.nextElementSibling;
        return !!next && (next.textContent ?? "").includes(label);
      },
      (await form.submit(container).textContent())?.trim().slice(0, 9) ?? "",
    );
    expect(precedesSubmit).toBe(true);

    await expect(slot).toHaveJSProperty("offsetHeight", 0);
    if (!form.start) return;

    // The invisible widget solves and is removed in about a second, so a shift that lasts
    // only while it solves shows up as a second height.
    const heights = container.evaluate(
      (el) =>
        new Promise<number[]>((resolve) => {
          const seen = new Set<number>();
          const started = performance.now();
          let loadedAt = 0;
          const tick = () => {
            seen.add(Math.round(el.getBoundingClientRect().height));
            if (window.turnstile && !loadedAt) loadedAt = performance.now();
            const done = loadedAt && performance.now() - loadedAt > 3_000;
            if (done || performance.now() - started > 25_000) resolve([...seen]);
            else requestAnimationFrame(tick);
          };
          tick();
        }),
    );
    // Prerendered pages ignore typing until they hydrate, so retype until the script loads.
    const start = form.start;
    await expect(async () => {
      await start(page);
      await page.waitForFunction(() => !!window.turnstile, null, { timeout: 3_000 });
    }).toPass({ timeout: 20_000 });
    expect(await heights).toHaveLength(1);
    await expect(slot).toHaveJSProperty("offsetHeight", 0);
  });
}
