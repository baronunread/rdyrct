/**
 * The landing page's two WebGPU effects, written with TypeGPU: a slow wash
 * of the brand colours behind the hero, and a light along the edge of the
 * product screenshot. Decoration only. Nothing here is loaded unless the
 * browser has WebGPU (components/hero-backdrop.tsx decides), and a browser
 * without it simply shows the page without them.
 *
 * The shaders are raw WGSL inside TypeGPU's typed shells, so no build plugin
 * is needed. One GPU device serves both, and each loop pauses while its
 * canvas is off screen or the tab is hidden.
 */
import tgpu, { common, d, type TgpuRoot } from "typegpu";
import { currentTheme } from "./theme";

let rootPromise: Promise<TgpuRoot> | null = null;
function gpuRoot(): Promise<TgpuRoot> {
  rootPromise ??= tgpu.init();
  return rootPromise;
}

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const dark = () => (currentTheme() === "dark" ? 1 : 0);

/** Keeps the drawing buffer at the canvas's size, at most 2x density. */
function fit(canvas: HTMLCanvasElement): number {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return dpr;
}

/** Runs `draw` once a frame while `canvas` is on screen and the tab is
 *  visible, or once if the visitor asked for less motion. Returns stop. */
function loop(canvas: HTMLCanvasElement, draw: (now: number) => void): () => void {
  let visible = true;
  let frame = 0;
  let stopped = false;
  const watcher = new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? true;
  });
  watcher.observe(canvas);
  const tick = (now: number) => {
    if (stopped) return;
    if (visible && !document.hidden) draw(now);
    frame = requestAnimationFrame(tick);
  };
  if (reducedMotion()) requestAnimationFrame(draw);
  else frame = requestAnimationFrame(tick);
  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
    watcher.disconnect();
  };
}

const hash = tgpu.fn([d.vec2f], d.f32)`(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}`;
const vnoise = tgpu.fn([d.vec2f], d.f32)`(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p);
  let w = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2f(1.0, 0.0)), w.x), mix(hash(i + vec2f(0.0, 1.0)), hash(i + vec2f(1.0, 1.0)), w.x), w.y);
}`.$uses({ hash });
const fbm = tgpu.fn([d.vec2f], d.f32)`(p0: vec2f) -> f32 {
  var p = p0; var a = 0.5; var s = 0.0;
  for (var i = 0; i < 5; i++) { s = s + a * vnoise(p); p = p * 2.03 + vec2f(1.7, 9.2); a = a * 0.5; }
  return s;
}`.$uses({ vnoise });

const BackdropParams = d.struct({
  res: d.vec2f,
  title: d.vec2f,
  time: d.f32,
  dark: d.f32,
  dpr: d.f32,
});

/**
 * The hero's background: three soft blobs of lavender, pink and violet,
 * pushed around by noise so slowly that it reads as still at a glance. It
 * thins out behind the headline, at both sides and towards the bottom.
 */
export async function startHeroBackdrop(
  canvas: HTMLCanvasElement,
  title: HTMLElement,
): Promise<() => void> {
  const root = await gpuRoot();
  const context = root.configureContext({ canvas, alphaMode: "premultiplied" });
  const u = root.createUniform(BackdropParams);
  const fragment = tgpu.fragmentFn({
    in: { uv: d.vec2f, pos: d.builtin.position },
    out: d.vec4f,
  })`{
    let px = pos.xy / u.dpr;
    let res = u.res / u.dpr;
    let uvn = px / res;
    let t = u.time;
    let dk = u.dark > 0.5;
    let lav = select(vec3f(0.455, 0.353, 0.722), vec3f(0.804, 0.725, 0.961), dk);
    let pink = select(vec3f(0.76, 0.38, 0.5), vec3f(0.96, 0.72, 0.78), dk);
    let deep = select(vec3f(0.36, 0.28, 0.62), vec3f(0.55, 0.45, 0.9), dk);
    let q = uvn * vec2f(1.6, 1.0);
    let w = vec2f(fbm(q * 1.4 + vec2f(t * 0.03, 0.0)), fbm(q * 1.4 + vec2f(5.2, t * 0.025)));
    let r = q + w * 0.9;
    let b1 = smoothstep(0.75, 0.0, length(r - vec2f(0.35 + 0.08 * sin(t * 0.11), 0.35)));
    let b2 = smoothstep(0.7, 0.0, length(r - vec2f(1.35, 0.45 + 0.08 * cos(t * 0.09))));
    let b3 = smoothstep(0.6, 0.0, length(r - vec2f(0.95 + 0.1 * sin(t * 0.07), 1.0)));
    let sum = b1 + b2 * 0.8 + b3 * 0.7;
    let col = (lav * b1 + pink * b2 * 0.8 + deep * b3 * 0.7) / max(sum, 0.001);
    let tc = (px - u.title) / vec2f(420.0, 170.0);
    let clearTitle = smoothstep(0.55, 1.25, length(tc));
    let fade = smoothstep(1.0, 0.65, uvn.y) * smoothstep(0.0, 0.08, uvn.x) * smoothstep(1.0, 0.92, uvn.x);
    let a = clamp(sum, 0.0, 1.0) * select(0.2, 0.18, dk) * fade * mix(0.3, 1.0, clearTitle);
    return vec4f(col * a, a);
  }`.$uses({ u, fbm });
  const pipeline = root.createRenderPipeline({ vertex: common.fullScreenTriangle, fragment });

  const start = performance.now();
  return loop(canvas, (now) => {
    const dpr = fit(canvas);
    const box = canvas.getBoundingClientRect();
    const head = title.getBoundingClientRect();
    u.write({
      res: d.vec2f(canvas.width, canvas.height),
      title: d.vec2f(head.left + head.width / 2 - box.left, head.top + head.height / 2 - box.top),
      // A still frame for reduced motion, picked for a balanced spread.
      time: reducedMotion() ? 6 : (now - start) / 1000,
      dark: dark(),
      dpr,
    });
    pipeline
      .withColorAttachment({
        view: context,
        clearValue: [0, 0, 0, 0],
        loadOp: "clear",
        storeOp: "store",
      })
      .draw(3);
  });
}

const EdgeParams = d.struct({
  res: d.vec2f,
  cursor: d.vec2f,
  rest: d.vec2f,
  hover: d.f32,
  inset: d.f32,
  radius: d.f32,
  power: d.f32,
  dark: d.f32,
  dpr: d.f32,
});

/**
 * A light along the edge of the screenshot frame. At rest it sits on the top
 * edge and moves along it as the frame scrolls into view; under the pointer
 * a second light follows the cursor. The two cross-fade rather than one
 * light travelling between them, which would cross the frame's middle
 * where it shows nothing and seem to jump.
 *
 * `canvas` overhangs the frame by `inset` px on every side, so the halo
 * outside the edge has somewhere to draw.
 */
export async function startEdgeLight(
  canvas: HTMLCanvasElement,
  frame: HTMLElement,
  inset: number,
  radius: number,
): Promise<() => void> {
  const root = await gpuRoot();
  const context = root.configureContext({ canvas, alphaMode: "premultiplied" });
  const u = root.createUniform(EdgeParams);
  const fragment = tgpu.fragmentFn({
    in: { uv: d.vec2f, pos: d.builtin.position },
    out: d.vec4f,
  })`{
    let px = pos.xy / u.dpr;
    let size = u.res / u.dpr;
    let hb = size * 0.5 - vec2f(u.inset);
    let q = abs(px - size * 0.5) - hb + vec2f(u.radius);
    let dist = length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - u.radius;
    let toCursor = px - u.cursor;
    let toRest = px - u.rest;
    let near = exp(-dot(toCursor, toCursor) / 135200.0) * u.hover + exp(-dot(toRest, toRest) / 135200.0) * (1.0 - u.hover);
    let line = smoothstep(1.6, 0.0, abs(dist)) * near;
    let halo = smoothstep(36.0, 0.0, max(dist, 0.0)) * step(0.0, dist) * near * 0.35;
    let sheen = smoothstep(-120.0, 0.0, dist) * step(dist, 0.0) * near * 0.1;
    let col = select(vec3f(0.455, 0.353, 0.722), vec3f(0.86, 0.79, 1.0), u.dark > 0.5);
    let a = clamp((line + halo + sheen) * u.power, 0.0, 1.0);
    return vec4f(col * a, a);
  }`.$uses({ u });
  const pipeline = root.createRenderPipeline({ vertex: common.fullScreenTriangle, fragment });

  const cursor = cursorLight();
  const stop = loop(canvas, () => {
    const dpr = fit(canvas);
    const box = canvas.getBoundingClientRect();
    const edge = frame.getBoundingClientRect();
    const shown = Math.min(
      1,
      Math.max(0, (window.innerHeight - edge.top) / (window.innerHeight * 0.9)),
    );
    const light = cursor.update(edge, box);
    u.write({
      res: d.vec2f(canvas.width, canvas.height),
      cursor: d.vec2f(light.x, light.y),
      rest: d.vec2f(inset + shown * (box.width - inset * 2), inset),
      hover: light.hover,
      inset,
      radius,
      power: (0.35 + 0.65 * shown) * (dark() ? 1 : 1.3),
      dark: dark(),
      dpr,
    });
    pipeline
      .withColorAttachment({
        view: context,
        clearValue: [0, 0, 0, 0],
        loadOp: "clear",
        storeOp: "store",
      })
      .draw(3);
  });
  return () => {
    stop();
    cursor.dispose();
  };
}

const within = (p: { x: number; y: number }, r: DOMRect) =>
  p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom;

/**
 * Where the edge light under the pointer is, in the canvas's pixels, and how
 * strongly it shows. It eases towards the cursor while the cursor is over
 * the frame, and fades out where it was once the cursor leaves.
 */
function cursorLight() {
  const pointer = { x: -1e4, y: -1e4 };
  const onMove = (event: PointerEvent) => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
  };
  window.addEventListener("pointermove", onMove, { passive: true });
  const light = { x: 0, y: 0, hover: 0, placed: false };
  return {
    update(edge: DOMRect, box: DOMRect) {
      const inside = within(pointer, edge);
      if (inside) {
        const x = pointer.x - box.left;
        const y = pointer.y - box.top;
        if (!light.placed) Object.assign(light, { x, y, placed: true });
        light.x += (x - light.x) * 0.18;
        light.y += (y - light.y) * 0.18;
      }
      light.hover += ((inside ? 1 : 0) - light.hover) * (inside ? 0.1 : 0.05);
      if (!inside && light.hover < 0.01) light.placed = false;
      return light;
    },
    dispose() {
      window.removeEventListener("pointermove", onMove);
    },
  };
}
