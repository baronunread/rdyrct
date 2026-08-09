// WCAG 2.2 + APCA-W3 contrast for rdyrct's tokens.
const hex = (h: string) => {
  const n = parseInt(h.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as [number, number, number];
};

const srgb = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

const lum = (rgb: number[]) =>
  0.2126 * srgb(rgb[0]) + 0.7152 * srgb(rgb[1]) + 0.0722 * srgb(rgb[2]);

const wcag = (fg: string, bg: string) => {
  const a = lum(hex(fg)),
    b = lum(hex(bg));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

/** Composite a foreground over an opaque background at the given alpha. */
const over = (fg: string, bg: string, alpha: number) => {
  const f = hex(fg),
    b = hex(bg);
  const m = f.map((c, i) => Math.round(c * alpha + b[i] * (1 - alpha)));
  return "#" + m.map((c) => c.toString(16).padStart(2, "0")).join("");
};

// APCA-W3 0.1.9
const apcaY = (rgb: number[]) =>
  0.2126729 * (rgb[0] / 255) ** 2.4 +
  0.7151522 * (rgb[1] / 255) ** 2.4 +
  0.072175 * (rgb[2] / 255) ** 2.4;

function apca(fgHex: string, bgHex: string) {
  const clamp = (y: number) => (y > 0.022 ? y : y + (0.022 - y) ** 1.414);
  let Ytxt = clamp(apcaY(hex(fgHex)));
  let Ybg = clamp(apcaY(hex(bgHex)));
  let out: number;
  if (Ybg > Ytxt) out = (Ybg ** 0.56 - Ytxt ** 0.57) * 1.14;
  else out = (Ybg ** 0.65 - Ytxt ** 0.62) * 1.14;
  if (Math.abs(out) < 0.1) return 0;
  out = out > 0 ? out - 0.027 : out + 0.027;
  return out * 100;
}

const themes = {
  light: {
    bg: "#f7f4ef",
    surface: "#ffffff",
    "surface-2": "#efeae2",
    border: "#ddd5c8",
    text: "#2a2733",
    muted: "#544f61",
    accent: "#745ab8",
    "accent-2": "#35875e",
    danger: "#c2607f",
    butter: "#a8842c",
    sky: "#4f7fae",
  },
  dark: {
    bg: "#17151f",
    surface: "#1f1c2b",
    "surface-2": "#262336",
    border: "#34304a",
    text: "#eae7f2",
    muted: "#c6c2d3",
    accent: "#cdb9f5",
    "accent-2": "#b9e6c9",
    danger: "#f5b8c8",
    butter: "#f2e3b3",
    sky: "#b9d9f0",
  },
} as const;

const grounds = ["bg", "surface", "surface-2"] as const;
const fgs = ["text", "muted", "accent", "accent-2", "danger", "butter", "sky"] as const;
const alphas = [1, 0.8, 0.7, 0.6, 0.5, 0.4];

type Row = {
  theme: string;
  fg: string;
  alpha: number;
  ground: string;
  wcag: number;
  apca: number;
};
const rows: Row[] = [];

for (const [name, t] of Object.entries(themes)) {
  for (const f of fgs) {
    for (const a of alphas) {
      for (const g of grounds) {
        const eff = a === 1 ? t[f] : over(t[f], t[g], a);
        rows.push({
          theme: name,
          fg: `${f}${a === 1 ? "" : `/${a * 100}`}`,
          alpha: a,
          ground: g,
          wcag: +wcag(eff, t[g]).toFixed(2),
          apca: +Math.abs(apca(eff, t[g])).toFixed(0),
        });
      }
    }
  }
}

// Only report what is actually used in the codebase or is body text.
const used = new Set([20, 40, 50, 60, 70, 80, 85, 100]);
const fails = rows.filter((r) => used.has(r.alpha * 100) && r.wcag < 4.5);

console.log("=== BODY-TEXT FAILURES (WCAG < 4.5, APCA < 75) ===");
for (const r of fails.sort((a, b) => a.wcag - b.wcag)) {
  const verdict = r.wcag < 3 ? "FAIL-HARD" : "fail-AA";
  console.log(
    `${verdict.padEnd(10)} ${r.theme.padEnd(5)} text-${r.fg.padEnd(12)} on ${r.ground.padEnd(9)} wcag ${String(r.wcag).padStart(5)}  apca ${String(r.apca).padStart(3)}`,
  );
}

console.log("\n=== FULL-OPACITY TOKENS (the baseline everything rests on) ===");
for (const r of rows.filter((r) => r.alpha === 1)) {
  const ok = r.wcag >= 4.5 ? "ok  " : r.wcag >= 3 ? "warn" : "FAIL";
  console.log(
    `${ok} ${r.theme.padEnd(5)} ${r.fg.padEnd(9)} on ${r.ground.padEnd(9)} wcag ${String(r.wcag).padStart(5)}  apca ${String(r.apca).padStart(3)}`,
  );
}
