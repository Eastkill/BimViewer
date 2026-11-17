import { describe, expect, it } from "vitest";
import { extractEntityWorldPositions, getProblemRegion } from "../../src/entities.js";
import { buildModel } from "./helpers.js";

const round = (box) => ({
  min: box.min.toArray().map((value) => Number(value.toFixed(6))),
  max: box.max.toArray().map((value) => Number(value.toFixed(6)))
});

describe("getProblemRegion", () => {
  it("zwraca część wspólną brył otaczających pary przenikającej się", () => {
    const { entities } = buildModel([
      { min: [0, 0, 0], max: [4, 3, 0.3] },
      { min: [1, 1, -1], max: [1.2, 1.2, 2] }
    ]);
    expect(round(getProblemRegion(entities))).toEqual({ min: [1, 1, 0], max: [1.2, 1.2, 0.3] });
  });

  it("dla pary rozłącznej zwraca odstęp między bryłami", () => {
    const { entities } = buildModel([
      { min: [0, 0, 0], max: [1, 1, 1] },
      { min: [1.5, 0.25, 0], max: [2, 0.75, 1] }
    ]);
    expect(round(getProblemRegion(entities))).toEqual({ min: [1, 0.25, 0], max: [1.5, 0.75, 1] });
  });

  it("dla grupy innej niż para zwraca sumę brył otaczających", () => {
    const { entities } = buildModel([
      { min: [0, 0, 0], max: [1, 1, 1] },
      { min: [0, 0, 0], max: [1, 1, 1] },
      { min: [0.05, 0, 0], max: [1.05, 1, 1] }
    ]);
    expect(round(getProblemRegion(entities))).toEqual({ min: [0, 0, 0], max: [1.05, 1, 1] });
  });

  it("zwraca null, gdy nie ma elementów", () => {
    expect(getProblemRegion([])).toBeNull();
    expect(getProblemRegion([null, undefined])).toBeNull();
  });
});

describe("extractEntityWorldPositions", () => {
  it("zwraca trójkąty elementu w układzie sceny", () => {
    const { entities } = buildModel([
      { min: [0, 0, 0], max: [1, 1, 1] },
      { min: [10, 20, 30], max: [12, 21, 33] }
    ]);
    const positions = extractEntityWorldPositions(entities[1]);
    expect(positions.length).toBe(12 * 9);

    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) {
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], positions[i + axis]);
        max[axis] = Math.max(max[axis], positions[i + axis]);
      }
    }
    expect(min).toEqual([10, 20, 30]);
    expect(max).toEqual([12, 21, 33]);
  });

  it("zwraca null dla elementu bez geometrii", () => {
    expect(extractEntityWorldPositions(null)).toBeNull();
    expect(extractEntityWorldPositions({})).toBeNull();
  });
});
