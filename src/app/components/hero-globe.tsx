import { useEffect, useRef } from "react";
import { GlobeScene, MAX_HOPS } from "../lib/globe-scene";
import { onHeroHop } from "../lib/hero-hop";

/**
 * The landing hero's globe (the drawing is lib/globe-scene.ts); this decides
 * when it draws.
 *
 * Decoration, not evidence. The cities and links are examples, which is why
 * nothing here counts clicks or claims to be live, and why the whole thing is
 * aria-hidden: the hero's heading and copy say what it shows. The one real
 * link is the visitor's own, when they shorten one in the card in front.
 *
 * Loaded lazily after hydration, so it is not in the prerendered HTML, costs
 * the first paint nothing, and the hero reserves its box so nothing moves when
 * it arrives.
 */
export default function HeroGlobe() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    return bindGlobe(canvas, new GlobeScene(canvas, ctx));
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 size-full cursor-grab touch-pan-y active:cursor-grabbing"
    />
  );
}

/** Wires the scene to the page: the frame loop, pausing, reduced motion,
 *  theme changes, dragging and the visitor's own links. Returns the cleanup. */
function bindGlobe(canvas: HTMLCanvasElement, scene: GlobeScene) {
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  const loop = frameLoop(scene, canvas);

  /** Reduced motion: one still frame, with two clicks already landed so the
   *  idea still reads. */
  const paintStill = () => {
    loop.stop();
    scene.clearHops();
    const now = performance.now();
    scene.addHop(now, true);
    scene.addHop(now, true);
    scene.draw(now);
  };
  const repaint = () => (still.matches ? paintStill() : loop.start());
  const redrawStill = () => {
    if (still.matches) scene.draw(performance.now());
  };

  scene.resize();
  repaint();

  const resized = new ResizeObserver(() => {
    scene.resize();
    if (still.matches) paintStill();
    else scene.draw(performance.now());
  });
  resized.observe(canvas);
  still.addEventListener("change", repaint);

  // The tokens change with the theme; read them again when it flips.
  const themed = new MutationObserver(() => {
    scene.refreshColors();
    redrawStill();
  });
  themed.observe(document.documentElement, { attributeFilter: ["data-theme"] });

  const stopDrag = bindDrag(canvas, scene, loop, redrawStill);
  const stopHops = onHeroHop((link) => {
    scene.dropOldest();
    scene.addHop(performance.now(), still.matches, link);
    redrawStill();
  });

  return () => {
    loop.dispose();
    resized.disconnect();
    themed.disconnect();
    still.removeEventListener("change", repaint);
    stopDrag();
    stopHops();
  };
}

type Loop = ReturnType<typeof frameLoop>;

/** On screen, in the foreground tab, and the visitor has not asked for less
 *  motion. */
function shouldRun(visible: boolean) {
  return visible && !document.hidden && !matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The animation, paused off screen and in a background tab: a globe nobody
 *  sees should not cost a frame. */
function frameLoop(scene: GlobeScene, canvas: HTMLCanvasElement) {
  let frame = 0;
  let nextHop = 0;
  let visible = true;
  let held = false;

  /** A new hop every second or so, while there is room for one. */
  const launch = (now: number) => {
    if (now < nextHop || scene.hopCount >= MAX_HOPS) return;
    scene.addHop(now);
    nextHop = now + 800 + Math.random() * 600;
  };
  const tick = (now: number) => {
    frame = 0;
    launch(now);
    scene.draw(now, held ? 0 : 0.0012);
    if (shouldRun(visible)) frame = requestAnimationFrame(tick);
  };
  const idle = () => frame === 0;
  const start = () => {
    if (idle() && shouldRun(visible)) frame = requestAnimationFrame(tick);
  };
  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
  };

  const onScreen = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    start();
  });
  onScreen.observe(canvas);
  document.addEventListener("visibilitychange", start);

  return {
    start,
    stop,
    /** While dragging, the visitor turns the globe, not the clock. */
    hold(on: boolean) {
      held = on;
    },
    dispose() {
      stop();
      onScreen.disconnect();
      document.removeEventListener("visibilitychange", start);
    },
  };
}

/** Drag to spin. Horizontal only, and touch-action keeps a vertical swipe
 *  scrolling the page on a phone. */
function bindDrag(canvas: HTMLCanvasElement, scene: GlobeScene, loop: Loop, redraw: () => void) {
  let lastX: number | null = null;
  const grab = (event: PointerEvent) => {
    lastX = event.clientX;
    loop.hold(true);
    canvas.setPointerCapture(event.pointerId);
  };
  const turn = (event: PointerEvent) => {
    if (lastX === null) return;
    scene.turn(event.clientX - lastX);
    lastX = event.clientX;
    redraw();
  };
  const drop = () => {
    lastX = null;
    loop.hold(false);
  };
  canvas.addEventListener("pointerdown", grab);
  canvas.addEventListener("pointermove", turn);
  canvas.addEventListener("pointerup", drop);
  canvas.addEventListener("pointercancel", drop);
  return () => {
    canvas.removeEventListener("pointerdown", grab);
    canvas.removeEventListener("pointermove", turn);
    canvas.removeEventListener("pointerup", drop);
    canvas.removeEventListener("pointercancel", drop);
  };
}
