import { describe, expect, it } from "vitest";
import { detectLayerCollisions } from "../../src/collisions.js";
import { buildModel } from "./helpers.js";

const A = "Konstrukcja";
const B = "WodKan";
const column = (extra = {}) => ({ min: [0, 0, 0], max: [1, 3, 1], discipline: A, ...extra });
const run = (boxes, tolerance = 0, layers = [A, B]) =>
  detectLayerCollisions(buildModel(boxes).group, layers[0], layers[1], { tolerance });

describe("detectLayerCollisions — kolizje twarde", () => {
  it("wykrywa bryły przenikające się", () => {
    const result = run([column(), { min: [-1, 1, 0.4], max: [2, 1.2, 0.6], discipline: B }]);
    expect(result.collisionsCount).toBe(1);
    expect(result.samplePairs[0].kind).toBe("solid");
    expect(result.aabbCandidates).toBe(1);
    expect(result.meshRejected).toBe(0);
  });

  it("nie zgłasza brył rozłącznych", () => {
    const result = run([column(), { min: [5, 1, 0.4], max: [6, 1.2, 0.6], discipline: B }]);
    expect(result.collisionsCount).toBe(0);
    expect(result.aabbCandidates).toBe(0);
  });

  it("faza dokładna odrzuca parę, której przecinają się tylko bryły otaczające", () => {
    // Ukośna belka: jej AABB obejmuje narożnik, w którym stoi mały element, ale siatki się nie stykają.
    const result = run([
      { min: [-3, 0, -0.1], max: [3, 0.2, 0.1], rotationY: Math.PI / 4, discipline: A },
      { min: [1.5, 0, 1.7], max: [1.9, 0.2, 2.1], discipline: B }
    ]);
    expect(result.aabbCandidates).toBe(1);
    expect(result.meshRejected).toBe(1);
    expect(result.collisionsCount).toBe(0);
  });

  it("wykrywa element zawarty w całości w drugim (bez przecięcia powierzchni)", () => {
    const result = run([column(), { min: [0.4, 1, 0.4], max: [0.6, 1.2, 0.6], discipline: B }]);
    expect(result.collisionsCount).toBe(1);
    expect(result.samplePairs[0].kind).toBe("solid");
  });

  it("zawieranie działa niezależnie od kolejności warstw", () => {
    const boxes = [column(), { min: [0.4, 1, 0.4], max: [0.6, 1.2, 0.6], discipline: B }];
    expect(run(boxes, 0, [B, A]).collisionsCount).toBe(1);
  });

  it("zetknięcie ścianami przy tolerancji 0 jest zgłaszane jako kolizja", () => {
    const result = run([column(), { min: [1, 0, 0], max: [2, 3, 1], discipline: B }]);
    expect(result.collisionsCount).toBe(1);
  });
});

describe("detectLayerCollisions — tolerancja", () => {
  // Odstęp 0,10 m między bryłami.
  const gap = [column(), { min: [1.1, 0, 0], max: [2, 3, 1], discipline: B }];

  it("tolerancja dodatnia większa od odstępu daje kolizję miękką", () => {
    const result = run(gap, 0.2);
    expect(result.collisionsCount).toBe(1);
    expect(result.softClashCount).toBe(1);
    expect(result.samplePairs[0].kind).toBe("soft");
  });

  it("tolerancja dodatnia mniejsza od odstępu nie daje kolizji", () => {
    expect(run(gap, 0.05).collisionsCount).toBe(0);
  });

  it("próg kolizji miękkiej leży na wartości odstępu", () => {
    expect(run(gap, 0.09).collisionsCount).toBe(0);
    expect(run(gap, 0.11).collisionsCount).toBe(1);
  });

  // Przenikanie 0,03 m wzdłuż osi X.
  const shallow = [column(), { min: [0.97, 0, 0], max: [2, 3, 1], discipline: B }];

  it("tolerancja ujemna pomija przenikanie płytsze niż |t|", () => {
    expect(run(shallow, 0).collisionsCount).toBe(1);
    expect(run(shallow, -0.05).collisionsCount).toBe(0);
  });

  it("tolerancja ujemna zachowuje przenikanie głębsze niż |t|", () => {
    const deep = [column(), { min: [0.8, 0, 0], max: [2, 3, 1], discipline: B }];
    expect(run(deep, -0.05).collisionsCount).toBe(1);
  });

  it("tolerancja ujemna usuwa zetknięcie ścianami", () => {
    const touching = [column(), { min: [1, 0, 0], max: [2, 3, 1], discipline: B }];
    expect(run(touching, -0.01).collisionsCount).toBe(0);
  });

  it("nieprawidłowa tolerancja jest traktowana jak 0", () => {
    expect(run(shallow, Number.NaN).tolerance).toBe(0);
  });
});

describe("detectLayerCollisions — dobór par", () => {
  it("pomija elementy ukrytych warstw", () => {
    const result = run([column(), { min: [-1, 1, 0.4], max: [2, 1.2, 0.6], discipline: B, layerVisible: false }]);
    expect(result.testedB).toBe(0);
    expect(result.collisionsCount).toBe(0);
  });

  it("ta sama warstwa: każda para jest sprawdzana raz", () => {
    const result = run(
      [column(), { min: [0.5, 0, 0], max: [1.5, 3, 1], discipline: A }, { min: [9, 0, 0], max: [10, 3, 1], discipline: A }],
      0,
      [A, A]
    );
    expect(result.collisionsCount).toBe(1);
  });

  it("pomija instancje należące do tego samego elementu", () => {
    const result = run(
      [column({ expressID: 7 }), { min: [0.5, 0, 0], max: [1.5, 3, 1], discipline: A, expressID: 7 }],
      0,
      [A, A]
    );
    expect(result.collisionsCount).toBe(0);
  });

  it("zlicza wszystkie pary n × m", () => {
    const boxes = [];
    for (let i = 0; i < 4; i += 1) boxes.push({ min: [i * 5, 0, 0], max: [i * 5 + 1, 3, 1], discipline: A });
    for (let i = 0; i < 4; i += 1) boxes.push({ min: [i * 5 - 0.5, 1, 0.4], max: [i * 5 + 1.5, 1.2, 0.6], discipline: B });
    const result = run(boxes);
    expect(result.testedA).toBe(4);
    expect(result.testedB).toBe(4);
    expect(result.collisionsCount).toBe(4);
  });
});
