/**
 * Merges the modules of a generated QR into one shape, so the code has no
 * interior edges to show.
 *
 * qr-code-styling does not fill the dots. It collects all 450-odd module
 * shapes into one `<clipPath>` and paints a single solid `<rect>` through it.
 * A renderer works that clip out one child at a time and combines the
 * coverage, so along every edge two neighbouring modules share, neither
 * reaches full opacity: a pale grid appears inside what should be one solid
 * block. It never showed in the PNG, which goes out through a canvas at the
 * code's own size where the seam falls below a pixel, and it showed in the
 * SVG the moment anyone scaled it, which is the only reason to download one.
 *
 * Painting the shapes individually does not fix it, and neither does a
 * hairline stroke to cover the gap: two abutting shapes antialias against each
 * other whatever they are drawn with, and a stroke wide enough to hide that at
 * one zoom is invisible at the next. The seam only goes away when there is one
 * shape. So every module becomes a subpath of a single `<path>`, which the
 * renderer fills in one pass: the shared edges are interior to the region and
 * never rasterized at all.
 *
 * The vocabulary the library emits is small and closed. Anything outside it
 * leaves that layer as it was rather than guessing at it.
 */
const SVG_NS = "http://www.w3.org/2000/svg";

type Point = [number, number];
/** Turns a vector. Absolute points go through `around` instead. */
type Turn = (x: number, y: number) => Point;
/** Where a shape sits: how its vectors turn, and where its points land. */
interface Place {
  spin: Turn;
  around: Turn;
}

/** Every transform in the output is a quarter turn about a shape's own centre,
 * which keeps this to four cases and no trigonometry. */
const TURNS: Partial<Record<number, Turn>> = {
  0: (x, y) => [x, y],
  90: (x, y) => [-y, x],
  180: (x, y) => [-x, -y],
  270: (x, y) => [y, -x],
};

const ROTATE = /rotate\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/;

function placement(el: Element): Place | null {
  const found = ROTATE.exec(el.getAttribute("transform") ?? "");
  const [angle, cx, cy] = found ? found.slice(1).map(Number) : [0, 0, 0];
  const spin = TURNS[((angle % 360) + 360) % 360];
  if (!spin) return null;
  return {
    spin,
    around: (x, y) => {
      const [dx, dy] = spin(x - cx, y - cy);
      return [cx + dx, cy + dy];
    },
  };
}

function num(el: Element, name: string): number {
  return Number(el.getAttribute(name) ?? 0);
}

function rectSubpath(el: Element, { around }: Place): string {
  const x = num(el, "x");
  const y = num(el, "y");
  const right = x + num(el, "width");
  const bottom = y + num(el, "height");
  const corners: Point[] = [
    [x, y],
    [right, y],
    [right, bottom],
    [x, bottom],
  ];
  return `M${corners.map((corner) => around(...corner).join(" ")).join("L")}Z`;
}

function circleSubpath(el: Element, { around }: Place): string {
  const r = num(el, "r");
  const [cx, cy] = around(num(el, "cx"), num(el, "cy"));
  return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${r * -2} 0Z`;
}

/**
 * The four commands the library writes, each rewritten where the shape ends up.
 *
 * A turned horizontal is no longer horizontal, so `h` and `v` both become `l`.
 * A quarter turn leaves a circular arc's radii and sweep alone and only moves
 * where it ends.
 */
const COMMANDS: Partial<Record<string, (n: number[], place: Place) => string>> = {
  M: (n, { around }) => `M${around(n[0], n[1]).join(" ")}`,
  h: (n, { spin }) => `l${spin(n[0], 0).join(" ")}`,
  v: (n, { spin }) => `l${spin(0, n[0]).join(" ")}`,
  a: (n, { spin }) => `a${n[0]} ${n[1]} 0 ${n[3]} ${n[4]} ${spin(n[5], n[6]).join(" ")}`,
  z: () => "Z",
  Z: () => "Z",
};

/** One command and its numbers: "M 274 50", "v 28", "a 14 14, 0, 0, 0, -14 -14". */
const SEGMENT = /[A-Za-z][^A-Za-z]*/g;

function segments(el: Element): string[] {
  return (el.getAttribute("d") ?? "").match(SEGMENT) ?? [];
}

function numbers(segment: string): number[] {
  return (segment.slice(1).match(/-?[\d.]+/g) ?? []).map(Number);
}

function pathSubpath(el: Element, place: Place): string | null {
  const written = segments(el).map((segment) => COMMANDS[segment[0]]?.(numbers(segment), place));
  return written.includes(undefined) ? null : `${written.join("")}Z`;
}

const SHAPES: Partial<Record<string, (el: Element, place: Place) => string | null>> = {
  rect: rectSubpath,
  circle: circleSubpath,
  path: pathSubpath,
};

function subpath(el: Element): string | null {
  const place = placement(el);
  const build = SHAPES[el.tagName];
  return place && build ? build(el, place) : null;
}

function clipId(painted: Element): string {
  return /url\(['"]?#([^'")]+)/.exec(painted.getAttribute("clip-path") ?? "")?.[1] ?? "";
}

/**
 * The clip a painted element points at, when that clip holds enough shapes to
 * seam. One shape is one fill and has no interior edges, which is the
 * background and the corner squares: those are left alone.
 */
function crowdedClip(svg: SVGElement, painted: Element): Element | null {
  const clip = svg.querySelector(`clipPath[id="${clipId(painted)}"]`);
  return clip && clip.children.length > 1 ? clip : null;
}

/** All of a layer's modules as one path, or nothing if any shape is not one
 * this understands: half a code merged and half of it clipped would be worse
 * than the seams. */
function mergedPath(svg: SVGElement, painted: Element, clip: Element): SVGPathElement | null {
  const parts = [...clip.children].map(subpath);
  if (parts.includes(null)) return null;

  const merged = svg.ownerDocument.createElementNS(SVG_NS, "path");
  merged.setAttribute("d", parts.join(""));
  merged.setAttribute("fill", painted.getAttribute("fill") ?? "");
  return merged;
}

export function fillSeams(svg: SVGElement): void {
  for (const painted of svg.querySelectorAll("[clip-path]")) {
    const clip = crowdedClip(svg, painted);
    if (!clip) continue;

    const merged = mergedPath(svg, painted, clip);
    if (!merged) continue;

    painted.replaceWith(merged);
    clip.remove();
  }
}
