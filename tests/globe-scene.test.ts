import { describe, expect, test } from "bun:test";
import { hopPhase, placeLabel, type Hop } from "../src/app/lib/globe-scene";

const bounds = { left: 0, top: 0, width: 400, height: 300 };
const size = { left: 0, top: 0, width: 100, height: 22 };

describe("placeLabel", () => {
  test("puts a label above and to the right of its dot when there is room", () => {
    expect(placeLabel(100, 100, size, bounds, [])).toEqual({
      left: 110,
      top: 70,
      width: 100,
      height: 22,
    });
  });

  test("moves below the dot when another label is in the way", () => {
    const taken = [{ left: 110, top: 70, width: 100, height: 22 }];
    expect(placeLabel(100, 100, size, bounds, taken)?.top).toBe(112);
  });

  test("flips left at the right edge and below at the top edge", () => {
    expect(placeLabel(380, 10, size, bounds, [])).toEqual({
      left: 270,
      top: 22,
      width: 100,
      height: 22,
    });
  });

  test("gives up rather than pile labels on top of each other", () => {
    const everywhere = [{ left: 0, top: 0, width: 400, height: 300 }];
    expect(placeLabel(200, 150, size, bounds, everywhere)).toBeNull();
  });
});

describe("hopPhase", () => {
  const hop: Hop = {
    from: [0, 0, 1],
    to: [1, 0, 0],
    link: "rdyr.cc/k3Tq9",
    start: 0,
    flight: 1000,
    lift: 0.1,
    own: false,
  };

  test("flies, lands, then fades", () => {
    expect(hopPhase(hop, 500)).toMatchObject({ head: 0.5, tail: 0, landed: false, fade: 1 });
    expect(hopPhase(hop, 1000)).toMatchObject({ head: 1, landed: true, fade: 1 });
    expect(hopPhase(hop, 1000 + 2600 + 250).fade).toBe(0.5);
    expect(hopPhase(hop, 1000 + 2600 + 500).fade).toBe(0);
  });

  test("keeps the visitor's own link up three times as long", () => {
    const own = { ...hop, own: true };
    expect(hopPhase(own, 1000 + 2600 + 500).fade).toBe(1);
    expect(hopPhase(own, 1000 + 7800 + 500).fade).toBe(0);
  });
});
