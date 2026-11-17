/**
 * Independent geometric oracle for the generated test models (dev-only).
 *
 * It does NOT use web-ifc, three.js or any application module: the STEP file is parsed
 * directly, every product built from IfcExtrudedAreaSolid + IfcRectangleProfileDef is turned
 * into an oriented box, and all box pairs are classified with the separating axis theorem.
 * The result is the reference ("ground truth") the application's collision detector, volume
 * and area calculations are compared against.
 *
 * Output: test-models/<model>.oracle.json
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const modelsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "test-models");
const TOUCH_EPS = 1e-6;

// --- STEP parsing ----------------------------------------------------------

const parseArgs = (text) => {
  let pos = 0;
  const parseValue = () => {
    const ch = text[pos];
    if (ch === "(") {
      pos += 1;
      const list = [];
      while (text[pos] !== ")") {
        list.push(parseValue());
        if (text[pos] === ",") pos += 1;
      }
      pos += 1;
      return list;
    }
    if (ch === "'") {
      let out = "";
      pos += 1;
      for (;;) {
        if (text[pos] === "'") {
          if (text[pos + 1] === "'") {
            out += "'";
            pos += 2;
            continue;
          }
          pos += 1;
          return out;
        }
        out += text[pos];
        pos += 1;
      }
    }
    let end = pos;
    let depth = 0;
    while (end < text.length) {
      const c = text[end];
      if (c === "(") depth += 1;
      else if (c === ")") {
        if (depth === 0) break;
        depth -= 1;
      } else if (c === "," && depth === 0) break;
      end += 1;
    }
    const token = text.slice(pos, end).trim();
    pos = end;
    if (token === "$" || token === "*") return null;
    if (token.startsWith("#")) return { ref: Number(token.slice(1)) };
    if (token.startsWith(".")) return token.slice(1, -1);
    const number = Number(token);
    return Number.isNaN(number) ? token : number;
  };

  const values = [];
  while (pos < text.length) {
    values.push(parseValue());
    if (text[pos] === ",") pos += 1;
  }
  return values;
};

const parseStep = (content) => {
  const entities = new Map();
  for (const line of content.split(/\r?\n/)) {
    const match = /^#(\d+)\s*=\s*([A-Z0-9_]+)\((.*)\);\s*$/.exec(line);
    if (!match) continue;
    entities.set(Number(match[1]), { id: Number(match[1]), type: match[2], args: parseArgs(match[3]) });
  }
  return entities;
};

// --- Minimal affine algebra (3×3 rotation + translation) -------------------

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalize = (v) => {
  const length = Math.hypot(...v);
  return v.map((x) => x / length);
};
const IDENTITY = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], o: [0, 0, 0] };
const applyPoint = (m, p) => [0, 1, 2].map((i) => m.x[i] * p[0] + m.y[i] * p[1] + m.z[i] * p[2] + m.o[i]);
const applyVector = (m, v) => [0, 1, 2].map((i) => m.x[i] * v[0] + m.y[i] * v[1] + m.z[i] * v[2]);
const compose = (parent, child) => ({
  x: applyVector(parent, child.x),
  y: applyVector(parent, child.y),
  z: applyVector(parent, child.z),
  o: applyPoint(parent, child.o)
});

const buildOracle = (content) => {
  const entities = parseStep(content);
  const get = (value) => (value?.ref != null ? entities.get(value.ref) : null);
  const coords = (value) => get(value)?.args[0] ?? null;

  const axis3d = (value) => {
    const entity = get(value);
    if (!entity) return IDENTITY;
    const o = coords(entity.args[0]) ?? [0, 0, 0];
    const z = normalize(coords(entity.args[1]) ?? [0, 0, 1]);
    const ref = coords(entity.args[2]) ?? [1, 0, 0];
    // RefDirection is projected onto the plane perpendicular to the axis.
    const x = normalize(ref.map((c, i) => c - dot(ref, z) * z[i]));
    return { x, y: cross(z, x), z, o: [o[0], o[1], o[2] ?? 0] };
  };

  const axis2d = (value) => {
    const entity = get(value);
    if (!entity) return IDENTITY;
    const o = coords(entity.args[0]) ?? [0, 0];
    const x2 = normalize([...(coords(entity.args[1]) ?? [1, 0]), 0]);
    return { x: x2, y: [-x2[1], x2[0], 0], z: [0, 0, 1], o: [o[0], o[1], 0] };
  };

  const placementCache = new Map();
  const localPlacement = (value) => {
    const entity = get(value);
    if (!entity) return IDENTITY;
    if (!placementCache.has(entity.id)) {
      placementCache.set(entity.id, compose(localPlacement(entity.args[0]), axis3d(entity.args[1])));
    }
    return placementCache.get(entity.id);
  };

  const products = [];
  for (const entity of entities.values()) {
    const placement = get(entity.args[5]);
    const shape = get(entity.args[6]);
    if (placement?.type !== "IFCLOCALPLACEMENT" || shape?.type !== "IFCPRODUCTDEFINITIONSHAPE") continue;

    const representation = get(shape.args[2][0]);
    const solid = get(representation?.args[3]?.[0]);
    const profile = get(solid?.args[0]);
    if (solid?.type !== "IFCEXTRUDEDAREASOLID" || profile?.type !== "IFCRECTANGLEPROFILEDEF") {
      throw new Error(`#${entity.id} ${entity.type}: unsupported geometry (oracle handles extruded rectangles only)`);
    }
    const direction = coords(solid.args[2]);
    if (direction[0] !== 0 || direction[1] !== 0 || direction[2] !== 1) {
      throw new Error(`#${entity.id}: extrusion direction other than +Z is not supported`);
    }

    const [xDim, yDim] = [profile.args[3], profile.args[4]];
    const depth = solid.args[3];
    const frame = compose(
      compose(localPlacement(entity.args[5]), axis3d(solid.args[1])),
      axis2d(profile.args[2])
    );
    const center = applyPoint(frame, [0, 0, depth / 2]);
    const axes = [frame.x, frame.y, frame.z];
    const half = [xDim / 2, yDim / 2, depth / 2];

    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let corner = 0; corner < 8; corner += 1) {
      const local = [corner & 1 ? 1 : -1, corner & 2 ? 1 : -1, corner & 4 ? 1 : -1];
      for (let i = 0; i < 3; i += 1) {
        const value = center[i] + axes.reduce((sum, axis, k) => sum + axis[i] * half[k] * local[k], 0);
        min[i] = Math.min(min[i], value);
        max[i] = Math.max(max[i], value);
      }
    }

    // Rectangular vertical faces: the two larger ones (the wall "sides") and the two ends.
    const sideLength = Math.max(xDim, yDim);
    products.push({
      expressID: entity.id,
      type: entity.type,
      globalId: entity.args[0],
      name: entity.args[2],
      center,
      axes,
      half,
      min,
      max,
      volume: xDim * yDim * depth,
      sideArea: sideLength * depth,
      footprintArea: xDim * yDim
    });
  }

  // Signed separation of two oriented boxes (SAT, 15 axes):
  // > 0 penetration depth, ≈ 0 touching, < 0 gap along the best separating axis.
  const penetration = (a, b) => {
    const delta = [0, 1, 2].map((i) => b.center[i] - a.center[i]);
    const candidates = [...a.axes, ...b.axes];
    for (const u of a.axes) {
      for (const v of b.axes) {
        const c = cross(u, v);
        if (Math.hypot(...c) > 1e-9) candidates.push(normalize(c));
      }
    }
    let best = Infinity;
    for (const axis of candidates) {
      const radius = (box) => box.axes.reduce((sum, u, k) => sum + Math.abs(dot(u, axis)) * box.half[k], 0);
      best = Math.min(best, radius(a) + radius(b) - Math.abs(dot(delta, axis)));
    }
    return best;
  };

  // Sweep along X over world AABBs, then the exact oriented-box test.
  const sorted = [...products].sort((p, q) => p.min[0] - q.min[0]);
  const pairs = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const first = sorted[i];
    for (let j = i + 1; j < sorted.length; j += 1) {
      const second = sorted[j];
      if (second.min[0] > first.max[0] + TOUCH_EPS) break;
      if (
        first.max[1] < second.min[1] - TOUCH_EPS ||
        second.max[1] < first.min[1] - TOUCH_EPS ||
        first.max[2] < second.min[2] - TOUCH_EPS ||
        second.max[2] < first.min[2] - TOUCH_EPS
      ) {
        continue;
      }
      const depth = penetration(first, second);
      if (depth < -TOUCH_EPS) continue;
      const [a, b] = first.expressID < second.expressID ? [first, second] : [second, first];
      pairs.push({
        a: a.expressID,
        b: b.expressID,
        names: [a.name, b.name],
        kind: depth > TOUCH_EPS ? "penetrating" : "touching",
        depth: Number(depth.toFixed(6))
      });
    }
  }

  const round = (value) => Number(value.toFixed(6));
  return {
    note: "Reference computed from the STEP text by scripts/build-oracle.mjs (no web-ifc / three.js).",
    productCount: products.length,
    penetratingPairs: pairs.filter((pair) => pair.kind === "penetrating").length,
    touchingPairs: pairs.filter((pair) => pair.kind === "touching").length,
    products: products.map((p) => ({
      expressID: p.expressID,
      type: p.type,
      name: p.name,
      globalId: p.globalId,
      min: p.min.map(round),
      max: p.max.map(round),
      volume: round(p.volume),
      sideArea: round(p.sideArea),
      footprintArea: round(p.footprintArea)
    })),
    pairs
  };
};

const requested = process.argv.slice(2);
const files = (requested.length ? requested : readdirSync(modelsDir).filter((name) => name.endsWith(".ifc"))).sort();
for (const name of files) {
  const t0 = performance.now();
  const oracle = buildOracle(readFileSync(join(modelsDir, name), "utf8"));
  const outName = name.replace(/\.ifc$/, ".oracle.json");
  writeFileSync(join(modelsDir, outName), JSON.stringify(oracle));
  console.log(
    `${outName}: ${oracle.productCount} products, ${oracle.penetratingPairs} penetrating + ${oracle.touchingPairs} touching pairs (${Math.round(performance.now() - t0)} ms)`
  );
}
