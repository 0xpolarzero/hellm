import { describe, expect, test } from "bun:test";
import { AUTH_REFACTOR_FRAMES, GATE_FRAME } from "../runs/authRefactorFrames";
import {
  clampFrame,
  framePct,
  frameLabel,
  frameMarkers,
  GATE_MARKER,
  NOTABLE_FRAME_MARKERS,
  runningAtFrame,
} from "./timeline";

/**
 * Pure domain tests for the timeline scrubber: the notable-frame maths, the gate
 * tick, the per-frame labels, and the running-task walk. No DOM, no gateway. The
 * running counts are checked against the real AUTH_REFACTOR_FRAMES tree the
 * inspector and canvas render, so the banner's "K tasks running" stays honest.
 */

const FRAME_COUNT = AUTH_REFACTOR_FRAMES.length; // 7
const LATEST = FRAME_COUNT - 1; // 6

describe("NOTABLE_FRAME_MARKERS", () => {
  test("the 7-frame run yields [0, 1, 3, 5, 6]", () => {
    expect(NOTABLE_FRAME_MARKERS(FRAME_COUNT)).toEqual([0, 1, 3, 5, 6]);
  });

  test("is sorted ascending and de-duped", () => {
    const marks = NOTABLE_FRAME_MARKERS(FRAME_COUNT);
    const sorted = [...marks].sort((a, b) => a - b);
    expect(marks).toEqual(sorted);
    expect(new Set(marks).size).toBe(marks.length);
  });

  test("always includes 0 and the latest frame", () => {
    const marks = NOTABLE_FRAME_MARKERS(FRAME_COUNT);
    expect(marks[0]).toBe(0);
    expect(marks[marks.length - 1]).toBe(LATEST);
  });

  test("a one-frame run collapses to a single marker", () => {
    expect(NOTABLE_FRAME_MARKERS(1)).toEqual([0]);
  });

  test("an empty run has no markers", () => {
    expect(NOTABLE_FRAME_MARKERS(0)).toEqual([]);
  });

  test("a two-frame run collapses the fractions onto the endpoints", () => {
    // latest = 1, so every fraction floors to 0 or 1; de-dup leaves [0, 1].
    expect(NOTABLE_FRAME_MARKERS(2)).toEqual([0, 1]);
  });
});

describe("frameMarkers (ticks)", () => {
  test("tags exactly one tick as the gate at GATE_FRAME", () => {
    const ticks = frameMarkers(FRAME_COUNT);
    const gates = ticks.filter((tick) => tick.kind === "gate");
    expect(gates).toHaveLength(1);
    expect(gates[0].frame).toBe(GATE_FRAME);
    expect(GATE_MARKER).toBe(GATE_FRAME);
  });

  test("merges the gate frame into the notable set (no duplicate frame)", () => {
    const ticks = frameMarkers(FRAME_COUNT);
    const byFrame = new Map(ticks.map((tick) => [tick.frame, tick]));
    expect(byFrame.size).toBe(ticks.length);
    // The notable set is 0,1,3,5,6; adding the gate at 4 makes six distinct ticks.
    expect(ticks.map((tick) => tick.frame)).toEqual([0, 1, 3, 4, 5, 6]);
  });

  test("ticks are sorted ascending so they share the dots' order", () => {
    const frames = frameMarkers(FRAME_COUNT).map((tick) => tick.frame);
    expect(frames).toEqual([...frames].sort((a, b) => a - b));
  });

  test("omits the gate tick when the gate is out of range", () => {
    // A 3-frame run (latest = 2) never reaches GATE_FRAME = 4.
    const ticks = frameMarkers(3);
    expect(ticks.every((tick) => tick.kind !== "gate")).toBe(true);
  });
});

describe("frameLabel", () => {
  test("maps each seeded frame to its step label", () => {
    expect(frameLabel(0)).toBe("planning");
    expect(frameLabel(4)).toBe("deploy gate (waiting)");
    expect(frameLabel(LATEST)).toBe("done");
  });

  test("has a label for every frame in the run", () => {
    for (let index = 0; index < FRAME_COUNT; index += 1) {
      expect(frameLabel(index).length).toBeGreaterThan(0);
    }
  });

  test("clamps out-of-range indices to the endpoints", () => {
    expect(frameLabel(-3)).toBe("planning");
    expect(frameLabel(99)).toBe("done");
  });
});

describe("runningAtFrame", () => {
  test("counts running nodes by walking the frame's snapshot tree", () => {
    // Frame 0: the root workflow node and the plan agent are both running,
    // edit-files + tests are queued → 2 (the walk includes container nodes).
    expect(runningAtFrame(0)).toBe(2);
    // Frame 4 (deploy gate): the root is waiting, every child is ok → 0 running.
    expect(runningAtFrame(4)).toBe(0);
    // Last frame is fully done.
    expect(runningAtFrame(LATEST)).toBe(0);
  });

  test("matches a manual walk of the tree for every frame", () => {
    const walk = (node: { status: string; children?: { status: string }[] }): number => {
      let count = node.status === "running" ? 1 : 0;
      for (const child of (node.children ?? []) as never[]) {
        count += walk(child);
      }
      return count;
    };
    for (let index = 0; index < FRAME_COUNT; index += 1) {
      expect(runningAtFrame(index)).toBe(walk(AUTH_REFACTOR_FRAMES[index]));
    }
  });

  test("an out-of-range frame reports zero", () => {
    expect(runningAtFrame(99)).toBe(0);
    expect(runningAtFrame(-1)).toBe(0);
  });
});

describe("clampFrame", () => {
  test("pins a target into [0, latest]", () => {
    expect(clampFrame(-5, LATEST)).toBe(0);
    expect(clampFrame(99, LATEST)).toBe(LATEST);
    expect(clampFrame(3, LATEST)).toBe(3);
  });
});

describe("framePct", () => {
  test("maps endpoints to 0% and 100% and the midpoint linearly", () => {
    expect(framePct(0, LATEST)).toBe(0);
    expect(framePct(LATEST, LATEST)).toBe(100);
    expect(framePct(3, LATEST)).toBeCloseTo(50, 5);
  });

  test("a single-frame run never divides by zero", () => {
    expect(framePct(0, 0)).toBe(0);
  });
});
