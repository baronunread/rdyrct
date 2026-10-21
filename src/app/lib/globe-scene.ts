import createGlobe, { type COBEOptions, type Globe } from "cobe";

/**
 * Everything the landing hero's globe draws, with no React and no event
 * wiring: components/hero-globe.tsx owns when it draws.
 *
 * Two layers. cobe draws the sphere and its land in WebGL; a 2D canvas over
 * it draws the clicks, because cobe can only show an arc whole and these
 * draw in. Clicks hop between cities the way the mark is drawn: a small dot
 * leaves, an arc carries it, the accent dot lands on a flat shadow, and the
 * short link it followed appears beside it.
 *
 * The overlay projects points exactly as cobe does (its rotation by phi and
 * theta, the same axes), and cobe's scale and offset are set from the
 * overlay's centre and radius, so the two never drift apart.
 */
export type Vec = [number, number, number];

const RAD = Math.PI / 180;
/** A point on the unit sphere, on cobe's axes. */
export const vec = (lon: number, lat: number): Vec => [
  Math.cos(lat * RAD) * Math.cos(lon * RAD),
  Math.sin(lat * RAD),
  -Math.cos(lat * RAD) * Math.sin(lon * RAD),
];

const dot = (a: Vec, b: Vec) => Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
const angle = (a: Vec, b: Vec) => Math.acos(dot(a, b));

/** The point a fraction `t` of the way from `a` to `b` along the surface. */
function slerp(a: Vec, b: Vec, t: number): Vec {
  const d = angle(a, b);
  if (d < 1e-6) return a;
  const sa = Math.sin((1 - t) * d) / Math.sin(d);
  const sb = Math.sin(t * d) / Math.sin(d);
  return [a[0] * sa + b[0] * sb, a[1] * sa + b[1] * sb, a[2] * sa + b[2] * sb];
}

const CITIES: Vec[] = [
  [-74, 40.7], // New York
  [-0.1, 51.5], // London
  [13.4, 52.5], // Berlin
  [9.2, 45.5], // Milan
  [-46.6, -23.5], // São Paulo
  [-99.1, 19.4], // Mexico City
  [-122.4, 37.8], // San Francisco
  [-79.4, 43.7], // Toronto
  [3.4, 6.5], // Lagos
  [31.2, 30], // Cairo
  [55.3, 25.2], // Dubai
  [77.6, 12.97], // Bengaluru
  [103.8, 1.35], // Singapore
  [139.7, 35.7], // Tokyo
  [127, 37.6], // Seoul
  [151.2, -33.9], // Sydney
].map(([lon, lat]) => vec(lon, lat));

/** Examples, not traffic: the globe never claims to show real clicks. */
const LINKS = [
  "go.acme.dev/launch",
  "rdyr.cc/k3Tq9",
  "links.hearth.cafe/menu",
  "get.orbit.fm/ep42",
  "qr.northwind.shop/sale",
];

type Colors = {
  ink: string;
  muted: string;
  accent: string;
  border: string;
  surface: string;
  bg: string;
};

/** The theme tokens, read at runtime so the globe follows light and dark. */
function readColors(): Colors {
  const css = getComputedStyle(document.documentElement);
  const token = (name: string) => css.getPropertyValue(name).trim();
  return {
    ink: token("--text"),
    muted: token("--muted"),
    accent: token("--accent"),
    border: token("--border"),
    surface: token("--surface"),
    bg: token("--bg"),
  };
}

type Rgb = [number, number, number];

/** Any CSS colour as the 0 to 1 channels WebGL takes. The tokens are oklch,
 *  and painting one pixel is the only way to have the browser convert it. */
function rgb(color: string): Rgb {
  const pixel = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!pixel) return [0.5, 0.5, 0.5];
  pixel.fillStyle = color;
  pixel.fillRect(0, 0, 1, 1);
  const [r, g, b] = pixel.getImageData(0, 0, 1, 1).data;
  return [r / 255, g / 255, b / 255];
}

const luminance = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * cobe's colours for the current theme. It shades two ways: light mode
 * darkens land against the base colour, dark mode lights land up out of a
 * base it darkens. So light takes the surface as its base, and dark the
 * muted text, whose tenth is close to the page.
 */
function baseLook(
  colors: Colors,
): Pick<COBEOptions, "dark" | "baseColor" | "mapBrightness" | "glowColor"> {
  const dark = luminance(rgb(colors.bg)) < 0.5;
  return dark
    ? { dark: 1, baseColor: rgb(colors.muted), mapBrightness: 1.1, glowColor: rgb(colors.border) }
    : { dark: 0, baseColor: rgb(colors.surface), mapBrightness: 0.5, glowColor: rgb(colors.bg) };
}

/** cobe draws a sphere of radius 0.8 in a 2-unit-tall viewport. */
const COBE_RADIUS = 0.8;

export type Hop = {
  from: Vec;
  to: Vec;
  link: string;
  start: number;
  flight: number;
  lift: number;
  /** The visitor's own link, from the shortener in front of the globe. */
  own: boolean;
};

type Box = { left: number; top: number; width: number; height: number };

/** Pixels at the top of the globe that the shortener card sits over. */
const COVERED = 150;
/** Milliseconds a landed hop stays on screen, label included. A visitor's
 *  own link stays three times as long. */
const DWELL = 2600;
const FADE = 500;
/** Most hops in the air at once. */
export const MAX_HOPS = 4;

const overlaps = (a: Box, b: Box, gap: number) =>
  a.left < b.left + b.width + gap &&
  b.left < a.left + a.width + gap &&
  a.top < b.top + b.height + gap &&
  b.top < a.top + a.height + gap;

/**
 * Where a label goes: above right of its dot, then below right, above left,
 * below left. The first spot inside `bounds` and clear of `taken` wins; with
 * none free the dot lands unlabelled rather than in a pile.
 */
export function placeLabel(x: number, y: number, size: Box, bounds: Box, taken: Box[]): Box | null {
  const { width, height } = size;
  const spots = [
    [x + 10, y - height - 8],
    [x + 10, y + 12],
    [x - width - 10, y - height - 8],
    [x - width - 10, y + 12],
  ];
  for (const [left, top] of spots) {
    const box = { left, top, width, height };
    const inside =
      left >= bounds.left &&
      top >= bounds.top &&
      left + width <= bounds.left + bounds.width &&
      top + height <= bounds.top + bounds.height;
    if (inside && taken.every((other) => !overlaps(box, other, 6))) return box;
  }
  return null;
}

/**
 * Where a hop from `from` may land: a city in view, neither next door nor
 * across the globe, and never a pair already on screen either way round. A
 * hop from A to B with B to A drawn over it reads as one glitching arc, not
 * two clicks.
 */
export function destinations(from: Vec, inView: Vec[], hops: Pick<Hop, "from" | "to">[]) {
  const onScreen = (c: Vec) =>
    hops.some((hop) => (hop.from === from && hop.to === c) || (hop.from === c && hop.to === from));
  return inView.filter(
    (c) => c !== from && angle(c, from) < 1.3 && angle(c, from) > 0.25 && !onScreen(c),
  );
}

/** How far through its life a hop is, in the terms drawing needs. */
export function hopPhase(hop: Hop, now: number) {
  const after = now - hop.start - hop.flight;
  const dwell = hop.own ? DWELL * 3 : DWELL;
  return {
    head: Math.min(1, (now - hop.start) / hop.flight),
    // The trail shortens from the start once the dot has landed, so only the
    // landing stays on screen with its label.
    tail: after > 0 ? Math.min(1, after / 900) : 0,
    landed: after >= 0,
    labelAlpha: Math.min(1, Math.max(0, after) / 250),
    fade: after > dwell ? Math.max(0, 1 - (after - dwell) / FADE) : 1,
  };
}

export class GlobeScene {
  private readonly hops: Hop[] = [];
  private readonly labels: Box[] = [];
  private colors = readColors();
  private width = 0;
  private height = 0;
  private dpr = 1;
  private radius = 0;
  private cx = 0;
  private cy = 0;
  // cobe's angles. This phi faces 20°E, so Europe, Africa and both Americas
  // face the visitor; theta tilts the north toward them, so the northern
  // cities sit higher.
  private phi = -Math.PI / 2 - 0.35;
  private readonly theta = 0.32;
  private linkIndex = 0;
  private base: Globe | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ctx: CanvasRenderingContext2D,
    private readonly baseCanvas: HTMLCanvasElement,
  ) {}

  get hopCount() {
    return this.hops.length;
  }

  resize() {
    this.dpr = Math.min(2, devicePixelRatio || 1);
    this.width = this.canvas.clientWidth;
    this.height = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // On a phone the globe runs past both edges: at the column's width it is
    // a small disc mostly hidden behind the card.
    this.radius = this.width < 640 ? this.width * 0.66 : Math.min(this.width * 0.46, 470);
    this.cx = this.width / 2;
    this.cy = this.radius + 8;
    this.layoutBase();
  }

  /** cobe's sphere, sized and placed to sit exactly under the overlay's. */
  private layoutBase() {
    if (this.width === 0 || this.height === 0) return;
    const scale = this.radius / ((COBE_RADIUS * this.height) / 2);
    const offset: [number, number] = [
      ((this.cx - this.width / 2) * 2) / scale,
      ((this.cy - this.height / 2) * 2) / scale,
    ];
    const layout = {
      width: this.width,
      height: this.height,
      devicePixelRatio: this.dpr,
      scale,
      offset,
    };
    if (this.base) return this.base.update(layout);
    this.base = createGlobe(this.baseCanvas, {
      ...layout,
      ...baseLook(this.colors),
      phi: this.phi,
      theta: this.theta,
      mapSamples: 26000,
      diffuse: 1.2,
      markerColor: [0, 0, 0],
    });
  }

  refreshColors() {
    this.colors = readColors();
    this.base?.update(baseLook(this.colors));
  }

  /** Turn by a distance in pixels at the globe's surface, as a drag does. */
  turn(pixels: number) {
    this.phi += pixels / this.radius;
  }

  dispose() {
    this.base?.destroy();
    this.base = null;
  }

  clearHops() {
    this.hops.length = 0;
  }

  /** Make room for a hop that must be shown, dropping the oldest. */
  dropOldest() {
    if (this.hops.length >= MAX_HOPS) this.hops.shift();
  }

  /**
   * Launch a hop between two cities in view. `landed` starts it already on
   * the ground, for the still frame. `own` is the visitor's own short link.
   */
  addHop(now: number, landed = false, own?: string) {
    const front = this.citiesInView();
    if (front.length < 2) return;
    const from = front[Math.floor(Math.random() * front.length)];
    const options = destinations(from, front, this.hops);
    if (options.length === 0) return;
    const to = options[Math.floor(Math.random() * options.length)];
    const d = angle(from, to);
    const flight = 900 + d * 700;
    this.hops.push({
      from,
      to,
      link: own ?? LINKS[this.linkIndex++ % LINKS.length],
      start: landed ? now - flight - 400 : now,
      flight,
      lift: 0.08 + d * 0.2,
      own: own !== undefined,
    });
  }

  draw(now: number, spin = 0) {
    this.phi -= spin;
    this.base?.update({ phi: this.phi });
    const { ctx } = this;
    ctx.clearRect(0, 0, this.width, this.height);
    this.labels.length = 0;
    this.drawRim();
    // Newest first, so the visitor's own link gets first claim on label space.
    for (let i = this.hops.length - 1; i >= 0; i--) {
      if (!this.drawHop(this.hops[i], now)) this.hops.splice(i, 1);
    }
  }

  /** Screen x and y, and how far the point faces the visitor (1 dead
   *  ahead, below 0 behind). cobe's own rotation, so a point lands on the
   *  land it names. */
  private project(p: Vec, lift = 1): Vec {
    const cp = Math.cos(this.phi);
    const sp = Math.sin(this.phi);
    const ct = Math.cos(this.theta);
    const st = Math.sin(this.theta);
    const x = cp * p[0] + sp * p[2];
    const y = sp * st * p[0] + ct * p[1] - cp * st * p[2];
    const z = -sp * ct * p[0] + st * p[1] + cp * ct * p[2];
    return [this.cx + x * this.radius * lift, this.cy - y * this.radius * lift, z];
  }

  /** Facing the visitor, below the band the card covers, above the bottom. */
  private citiesInView() {
    return CITIES.filter((c) => {
      const [, y, z] = this.project(c);
      return z > 0.25 && y > COVERED && y < this.height - 24;
    });
  }

  /** A hairline round cobe's sphere, the edge every other surface here has. */
  private drawRim() {
    const { ctx, colors } = this;
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, this.radius, 0, Math.PI * 2);
    ctx.lineWidth = 1;
    ctx.strokeStyle = colors.border;
    ctx.stroke();
  }

  /** False once the hop has faded out and can be dropped. */
  private drawHop(hop: Hop, now: number) {
    const phase = hopPhase(hop, now);
    this.ctx.globalAlpha = phase.fade;
    this.drawTrail(hop, phase.tail, phase.head);
    // The dot that leaves stays until the trail has pulled away from it.
    if (phase.tail === 0) this.drawDot(hop.from, 4, this.colors.ink);
    if (phase.landed) this.drawLanding(hop, phase.fade * phase.labelAlpha);
    this.ctx.globalAlpha = 1;
    return phase.fade > 0;
  }

  private drawTrail(hop: Hop, tail: number, head: number) {
    const { ctx } = this;
    ctx.beginPath();
    let drawing = false;
    for (let j = 0; j <= 40; j++) {
      const u = tail + (head - tail) * (j / 40);
      const lift = 1 + Math.sin(Math.PI * u) * hop.lift;
      const [x, y, z] = this.project(slerp(hop.from, hop.to, u), lift);
      // Behind the globe: lift the pen rather than draw through it.
      if (z < -0.1) drawing = false;
      else if (drawing) ctx.lineTo(x, y);
      else {
        ctx.moveTo(x, y);
        drawing = true;
      }
    }
    ctx.lineCap = "round";
    ctx.lineWidth = 2.75;
    ctx.strokeStyle = this.colors.ink;
    ctx.stroke();
  }

  private drawDot(at: Vec, r: number, color: string) {
    const [x, y, z] = this.project(at);
    if (z <= 0) return;
    this.ctx.beginPath();
    this.ctx.arc(x, y, r, 0, Math.PI * 2);
    this.ctx.fillStyle = color;
    this.ctx.fill();
  }

  /** The mark's landing: the accent dot over a flat shadow, then the link. */
  private drawLanding(hop: Hop, labelAlpha: number) {
    const [x, y, z] = this.project(hop.to);
    if (z <= 0) return;
    const { ctx } = this;
    ctx.beginPath();
    ctx.ellipse(x, y + 9, 8, 2, 0, 0, Math.PI * 2);
    ctx.fillStyle = this.colors.border;
    ctx.fill();
    this.drawDot(hop.to, 6.5, this.colors.accent);
    this.drawLabel(hop.link, x, y, labelAlpha, hop.own);
  }

  private drawLabel(text: string, x: number, y: number, alpha: number, own: boolean) {
    const { ctx, colors } = this;
    ctx.font = "500 12px 'JetBrains Mono', ui-monospace, monospace";
    const size = { left: 0, top: 0, width: ctx.measureText(text).width + 14, height: 22 };
    const bounds = { left: 4, top: 4, width: this.width - 8, height: this.height - 8 };
    const box = placeLabel(x, y, size, bounds, this.labels);
    if (!box) return;
    this.labels.push(box);
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.roundRect(box.left, box.top, box.width, box.height, 6);
    ctx.fillStyle = colors.surface;
    ctx.fill();
    // The visitor's own link is outlined in the accent: it is the one that
    // is theirs.
    ctx.lineWidth = own ? 1.5 : 1;
    ctx.strokeStyle = own ? colors.accent : colors.border;
    ctx.stroke();
    ctx.fillStyle = colors.ink;
    ctx.textBaseline = "middle";
    ctx.fillText(text, box.left + 7, box.top + box.height / 2 + 0.5);
    ctx.globalAlpha = 1;
  }
}
