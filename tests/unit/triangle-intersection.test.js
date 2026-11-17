import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { pointInsideTriangleMesh, triangleTriangleIntersect } from "../../src/triangle-intersection.js";
import { boxTriangles } from "./helpers.js";

const v = (x, y, z) => new THREE.Vector3(x, y, z);
const intersects = (a, b) => triangleTriangleIntersect(...a.map((p) => v(...p)), ...b.map((p) => v(...p)));

// Reference triangle in the XY plane.
const BASE = [
  [0, 0, 0],
  [4, 0, 0],
  [0, 4, 0]
];

describe("triangleTriangleIntersect", () => {
  it("wykrywa trójkąt przebijający płaszczyznę drugiego", () => {
    expect(
      intersects(BASE, [
        [1, 1, -1],
        [1, 1, 1],
        [2, 1, 1]
      ])
    ).toBe(true);
  });

  it("jest symetryczny względem kolejności argumentów", () => {
    const other = [
      [1, 1, -1],
      [1, 1, 1],
      [2, 1, 1]
    ];
    expect(intersects(other, BASE)).toBe(intersects(BASE, other));
  });

  it("odrzuca trójkąty leżące po jednej stronie płaszczyzny", () => {
    expect(
      intersects(BASE, [
        [1, 1, 0.5],
        [2, 1, 0.5],
        [1, 2, 3]
      ])
    ).toBe(false);
  });

  it("odrzuca trójkąt przebijający płaszczyznę poza obrysem drugiego", () => {
    expect(
      intersects(BASE, [
        [10, 10, -1],
        [10, 10, 1],
        [11, 10, 1]
      ])
    ).toBe(false);
  });

  it("odrzuca trójkąty w płaszczyznach równoległych", () => {
    expect(
      intersects(BASE, [
        [0, 0, 1],
        [4, 0, 1],
        [0, 4, 1]
      ])
    ).toBe(false);
  });

  it("wykrywa nakładające się trójkąty współpłaszczyznowe", () => {
    expect(
      intersects(BASE, [
        [1, 1, 0],
        [5, 1, 0],
        [1, 5, 0]
      ])
    ).toBe(true);
  });

  it("wykrywa trójkąt współpłaszczyznowy zawarty w całości w drugim", () => {
    expect(
      intersects(BASE, [
        [0.5, 0.5, 0],
        [1, 0.5, 0],
        [0.5, 1, 0]
      ])
    ).toBe(true);
  });

  it("odrzuca rozłączne trójkąty współpłaszczyznowe", () => {
    expect(
      intersects(BASE, [
        [10, 10, 0],
        [12, 10, 0],
        [10, 12, 0]
      ])
    ).toBe(false);
  });

  it("odrzuca trójkąt zdegenerowany (zerowe pole)", () => {
    expect(
      intersects(BASE, [
        [1, 1, -1],
        [1, 1, 1],
        [1, 1, 0]
      ])
    ).toBe(false);
  });

  it("nie zależy od skali geometrii (milimetry i kilometry)", () => {
    for (const scale of [1e-3, 1, 1e3]) {
      const s = (tri) => tri.map((p) => p.map((c) => c * scale));
      expect(
        intersects(
          s(BASE),
          s([
            [1, 1, -1],
            [1, 1, 1],
            [2, 1, 1]
          ])
        )
      ).toBe(true);
      expect(
        intersects(
          s(BASE),
          s([
            [0, 0, 1],
            [4, 0, 1],
            [0, 4, 1]
          ])
        )
      ).toBe(false);
    }
  });

  it("nie modyfikuje wektorów wejściowych", () => {
    const a = BASE.map((p) => v(...p));
    const b = [v(1, 1, -1), v(1, 1, 1), v(2, 1, 1)];
    const snapshot = JSON.stringify([...a, ...b]);
    triangleTriangleIntersect(...a, ...b);
    expect(JSON.stringify([...a, ...b])).toBe(snapshot);
  });
});

describe("pointInsideTriangleMesh", () => {
  const cube = boxTriangles([0, 0, 0], [2, 2, 2]);

  it("punkt wewnątrz zamkniętej bryły", () => {
    expect(pointInsideTriangleMesh(1, 1, 1, cube.tris, cube.count)).toBe(true);
    expect(pointInsideTriangleMesh(0.1, 1.9, 0.3, cube.tris, cube.count)).toBe(true);
  });

  it("punkt na zewnątrz bryły, także na przedłużeniu półprostej testowej", () => {
    expect(pointInsideTriangleMesh(3, 1, 1, cube.tris, cube.count)).toBe(false);
    expect(pointInsideTriangleMesh(-1, 1, 1, cube.tris, cube.count)).toBe(false);
    expect(pointInsideTriangleMesh(1, 5, 1, cube.tris, cube.count)).toBe(false);
  });

  it("pusta siatka", () => {
    expect(pointInsideTriangleMesh(0, 0, 0, new Float32Array(0), 0)).toBe(false);
    expect(pointInsideTriangleMesh(0, 0, 0, null, 0)).toBe(false);
  });
});
