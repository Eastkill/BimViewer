import * as THREE from "three";
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyFileTransform,
  persistFileTransform,
  readTransformFromGroup,
  resetFileTransform,
  restoreStoredFileTransforms
} from "../../src/file-alignment.js";
import { buildFileCacheKey } from "../../src/ifc-cache.js";

const STORAGE_KEY = "bimviewer.fileTransforms.v1";

// Minimal in-memory localStorage for the Node test environment.
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key)
};

const entry = (name) => ({ name, group: new THREE.Group(), transform: null });
const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");

describe("file-alignment", () => {
  beforeEach(() => store.clear());

  it("stosuje przesunięcie i obrót (w stopniach) do grupy pliku", () => {
    const file = entry("a.ifc");
    applyFileTransform(file, { x: 1, y: 2, z: 3, rx: 0, ry: 90, rz: 0 });
    expect(file.group.position.toArray()).toEqual([1, 2, 3]);
    expect(file.group.rotation.y).toBeCloseTo(Math.PI / 2, 10);
    expect(readTransformFromGroup(file)).toEqual({ x: 1, y: 2, z: 3, rx: 0, ry: 90, rz: 0 });
  });

  it("zapisuje transformację pod nazwą pliku i odtwarza ją po ponownym wczytaniu", () => {
    applyFileTransform(entry("a.ifc"), { x: 5, ry: 45 });
    expect(stored()["a.ifc"]).toMatchObject({ x: 5, ry: 45 });

    const reloaded = [entry("a.ifc"), entry("b.ifc")];
    expect(restoreStoredFileTransforms(reloaded)).toBe(1);
    expect(reloaded[0].group.position.x).toBe(5);
    expect(reloaded[1].group.position.x).toBe(0);
  });

  it("reset usuwa zapisany wpis", () => {
    const file = entry("a.ifc");
    applyFileTransform(file, { x: 5 });
    resetFileTransform(file);
    expect(stored()).toEqual({});
    expect(file.group.position.x).toBe(0);
  });

  it("niepoprawne wartości są zamieniane na 0", () => {
    const file = entry("a.ifc");
    applyFileTransform(file, { x: "abc", y: undefined, z: Number.NaN });
    expect(file.group.position.toArray()).toEqual([0, 0, 0]);
  });

  it("uszkodzona zawartość localStorage nie powoduje błędu", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(restoreStoredFileTransforms([entry("a.ifc")])).toBe(0);
    expect(() => persistFileTransform("a.ifc", { x: 1 })).not.toThrow();
  });
});

describe("buildFileCacheKey", () => {
  const bytes = (size, fill = 1) => new Uint8Array(size).fill(fill);
  const file = (name) => ({ name });

  it("ten sam plik daje ten sam klucz", async () => {
    const a = await buildFileCacheKey(file("m.ifc"), bytes(1000));
    const b = await buildFileCacheKey(file("m.ifc"), bytes(1000));
    expect(a).toBe(b);
  });

  it("klucz zależy od nazwy, rozmiaru i zawartości", async () => {
    const base = await buildFileCacheKey(file("m.ifc"), bytes(1000));
    expect(await buildFileCacheKey(file("n.ifc"), bytes(1000))).not.toBe(base);
    expect(await buildFileCacheKey(file("m.ifc"), bytes(1001))).not.toBe(base);
    expect(await buildFileCacheKey(file("m.ifc"), bytes(1000, 2))).not.toBe(base);
  });

  it("zmiana na początku lub końcu dużego pliku zmienia klucz", async () => {
    const size = 400_000;
    const base = await buildFileCacheKey(file("m.ifc"), bytes(size));
    const head = bytes(size);
    head[10] = 9;
    const tail = bytes(size);
    tail[size - 10] = 9;
    expect(await buildFileCacheKey(file("m.ifc"), head)).not.toBe(base);
    expect(await buildFileCacheKey(file("m.ifc"), tail)).not.toBe(base);
  });

  it("znane ograniczenie: zmiana wyłącznie w środku dużego pliku nie zmienia klucza", async () => {
    const size = 400_000;
    const base = await buildFileCacheKey(file("m.ifc"), bytes(size));
    const middle = bytes(size);
    middle[200_000] = 9;
    expect(await buildFileCacheKey(file("m.ifc"), middle)).toBe(base);
  });
});
