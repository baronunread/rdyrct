import { expect, test } from "bun:test";
import { devHostVars, label } from "../scripts/dev-hosts";

test("a branch becomes one DNS label", () => {
  expect(label("ui-evolved")).toBe("ui-evolved");
  expect(label("feat/Links_Bulk")).toBe("feat-links-bulk");
  expect(label("--x--")).toBe("x");
  expect(label("a".repeat(80))).toHaveLength(40);
});

test("the Worker's addresses all follow the app's host", () => {
  expect(
    devHostVars({
      name: "rdyrct-x",
      app: "https://rdyrct-x.local",
      mail: "https://rdyrct-x-mail.local",
      google: "https://rdyrct-x-google.local",
    }),
  ).toEqual({
    APP_URL: "https://rdyrct-x.local",
    APP_HOST: "rdyrct-x.local",
    SHARED_LINK_HOST: "rdyrct-x.local",
    RESEND_BASE_URL: "https://rdyrct-x-mail.local",
    GOOGLE_EMULATOR_URL: "https://rdyrct-x-google.local",
  });
});
