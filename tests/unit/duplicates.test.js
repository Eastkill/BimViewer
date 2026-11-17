import { describe, expect, it } from "vitest";
import { detectDuplicates } from "../../src/duplicates.js";
import { buildModel } from "./helpers.js";

const pipe = (x, extra = {}) => ({
  min: [x, 0, 0],
  max: [x + 2, 0.1, 0.1],
  typeName: "IFCPIPESEGMENT",
  ...extra
});
const run = (boxes, options) => detectDuplicates(buildModel(boxes).group, options);

describe("detectDuplicates — GlobalId", () => {
  it("grupuje elementy o tym samym GlobalId, także odległe i z różnych plików", () => {
    const result = run([
      pipe(0, { globalId: "DUP", modelId: 0 }),
      pipe(50, { globalId: "DUP", modelId: 1 }),
      pipe(100, { globalId: "UNIQUE" })
    ]);
    expect(result.globalIdDuplicateGroups).toBe(1);
    expect(result.groups[0].kind).toBe("globalId");
    expect(result.groups[0].items).toHaveLength(2);
    expect(result.geometricDuplicateGroups).toBe(0);
  });

  it("ignoruje elementy bez GlobalId", () => {
    const result = run([pipe(0, { globalId: null }), pipe(50, { globalId: null })]);
    expect(result.globalIdDuplicateGroups).toBe(0);
  });
});

describe("detectDuplicates — geometria", () => {
  it("wykrywa element tego samego typu w niemal tym samym miejscu", () => {
    const result = run([pipe(0), pipe(0.05)]);
    expect(result.geometricDuplicateGroups).toBe(1);
    expect(result.groups[0].items).toHaveLength(2);
  });

  it("nie zgłasza jednakowych odcinków ułożonych jeden za drugim", () => {
    expect(run([pipe(0), pipe(2), pipe(4)]).geometricDuplicateGroups).toBe(0);
  });

  it("nie łączy elementów różnych typów", () => {
    const result = run([pipe(0), pipe(0, { typeName: "IFCDUCTSEGMENT" })]);
    expect(result.geometricDuplicateGroups).toBe(0);
  });

  it("nie łączy elementów o różnych wymiarach", () => {
    const result = run([pipe(0), { min: [0, 0, 0], max: [2.2, 0.1, 0.1], typeName: "IFCPIPESEGMENT" }]);
    expect(result.geometricDuplicateGroups).toBe(0);
  });

  it("respektuje tolerancję położenia", () => {
    const boxes = [pipe(0), pipe(0.3)];
    expect(run(boxes, { positionTolerance: 0.1 }).geometricDuplicateGroups).toBe(0);
    expect(run(boxes, { positionTolerance: 0.5 }).geometricDuplicateGroups).toBe(1);
  });

  it("respektuje tolerancję rozmiaru", () => {
    const boxes = [pipe(0), { min: [0, 0, 0], max: [2.04, 0.1, 0.1], typeName: "IFCPIPESEGMENT" }];
    expect(run(boxes, { sizeTolerance: 0.01 }).geometricDuplicateGroups).toBe(0);
    expect(run(boxes, { sizeTolerance: 0.05 }).geometricDuplicateGroups).toBe(1);
  });

  it("trzy pokrywające się elementy tworzą jedną grupę", () => {
    const result = run([pipe(0), pipe(0.01), pipe(0.02)]);
    expect(result.geometricDuplicateGroups).toBe(1);
    expect(result.groups[0].items).toHaveLength(3);
  });

  it("element złożony z kilku geometrii jest porównywany jako całość", () => {
    // Element 1 = dwie instancje stykające się końcami; element 2 = jedna bryła o tym samym gabarycie.
    const result = run([
      { min: [0, 0, 0], max: [1, 0.1, 0.1], typeName: "IFCPIPESEGMENT", expressID: 1 },
      { min: [1, 0, 0], max: [2, 0.1, 0.1], typeName: "IFCPIPESEGMENT", expressID: 1 },
      pipe(0, { expressID: 2 })
    ]);
    expect(result.elementCount).toBe(2);
    expect(result.geometricDuplicateGroups).toBe(1);
  });

  it("model bez duplikatów daje pusty wynik", () => {
    const result = run([pipe(0), pipe(10), pipe(20)]);
    expect(result.totalGroups).toBe(0);
    expect(result.groups).toEqual([]);
  });
});
