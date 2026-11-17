import * as THREE from "three";
import { getEntities, getEntityWorldBox } from "./entities.js";
import { pointInsideTriangleMesh, triangleTriangleIntersect } from "./triangle-intersection.js";

const _matrix = new THREE.Matrix4();
const _world = new THREE.Matrix4();
const _va = new THREE.Vector3();
const _vb = new THREE.Vector3();
const _vc = new THREE.Vector3();
const _V0 = new THREE.Vector3();
const _V1 = new THREE.Vector3();
const _V2 = new THREE.Vector3();

const getEntitiesForLayer = (group, layerName) =>
  getEntities(group).filter(
    (entity) =>
      entity.layerVisible !== false &&
      (entity.layerName === layerName || entity.discipline === layerName)
  );

/**
 * Positive tolerance = required clearance (soft clash): expand AABBs by tol/2 each.
 * Negative tolerance = allowed penetration: collide only when overlap on every axis exceeds |t|.
 * Zero = standard intersectsBox (touching counts).
 */
const boxesCollide = (boxA, boxB, tolerance) => {
  if (tolerance > 0) {
    return boxA.intersectsBox(boxB);
  }

  if (tolerance < 0) {
    const allowed = -tolerance;
    const overlapX = Math.min(boxA.max.x, boxB.max.x) - Math.max(boxA.min.x, boxB.min.x);
    const overlapY = Math.min(boxA.max.y, boxB.max.y) - Math.max(boxA.min.y, boxB.min.y);
    const overlapZ = Math.min(boxA.max.z, boxB.max.z) - Math.max(boxA.min.z, boxB.min.z);
    return overlapX > allowed && overlapY > allowed && overlapZ > allowed;
  }

  return boxA.intersectsBox(boxB);
};

/**
 * World-space triangles for one BatchedMesh instance.
 * `tris`: ax,ay,az, bx,by,bz, cx,cy,cz per triangle
 * `aabbs`: minx,miny,minz, maxx,maxy,maxz per triangle
 */
const extractEntityTriangles = (entity) => {
  const { batch, instanceId } = entity || {};
  if (!batch || instanceId == null) return null;

  const geometryId = batch.getGeometryIdAt(instanceId);
  const range = batch.getGeometryRangeAt?.(geometryId);
  if (!range) return null;

  const geometry = batch.geometry;
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  if (!position) return null;

  batch.getMatrixAt(instanceId, _matrix);
  _world.copy(batch.matrixWorld).multiply(_matrix);

  const triCount = Math.floor(range.count / 3);
  if (triCount <= 0) return null;

  const tris = new Float32Array(triCount * 9);
  const aabbs = new Float32Array(triCount * 6);
  // Union of all triangle AABBs (same float32 values the per-triangle tests use).
  const bounds = new Float32Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);

  const writeVertex = (vertexIndex, offset) => {
    _va.fromBufferAttribute(position, vertexIndex).applyMatrix4(_world);
    tris[offset] = _va.x;
    tris[offset + 1] = _va.y;
    tris[offset + 2] = _va.z;
  };

  const start = range.start;
  for (let i = 0; i < triCount; i += 1) {
    const base = start + i * 3;
    const o = i * 9;
    const ao = i * 6;

    if (index) {
      writeVertex(index.getX(base), o);
      writeVertex(index.getX(base + 1), o + 3);
      writeVertex(index.getX(base + 2), o + 6);
    } else {
      writeVertex(base, o);
      writeVertex(base + 1, o + 3);
      writeVertex(base + 2, o + 6);
    }

    const ax = tris[o];
    const ay = tris[o + 1];
    const az = tris[o + 2];
    const bx = tris[o + 3];
    const by = tris[o + 4];
    const bz = tris[o + 5];
    const cx = tris[o + 6];
    const cy = tris[o + 7];
    const cz = tris[o + 8];

    aabbs[ao] = Math.min(ax, bx, cx);
    aabbs[ao + 1] = Math.min(ay, by, cy);
    aabbs[ao + 2] = Math.min(az, bz, cz);
    aabbs[ao + 3] = Math.max(ax, bx, cx);
    aabbs[ao + 4] = Math.max(ay, by, cy);
    aabbs[ao + 5] = Math.max(az, bz, cz);

    if (aabbs[ao] < bounds[0]) bounds[0] = aabbs[ao];
    if (aabbs[ao + 1] < bounds[1]) bounds[1] = aabbs[ao + 1];
    if (aabbs[ao + 2] < bounds[2]) bounds[2] = aabbs[ao + 2];
    if (aabbs[ao + 3] > bounds[3]) bounds[3] = aabbs[ao + 3];
    if (aabbs[ao + 4] > bounds[4]) bounds[4] = aabbs[ao + 4];
    if (aabbs[ao + 5] > bounds[5]) bounds[5] = aabbs[ao + 5];
  }

  return { tris, aabbs, bounds, count: triCount };
};

const triAabbOverlap = (aabbs, index, otherMinX, otherMinY, otherMinZ, otherMaxX, otherMaxY, otherMaxZ) => {
  const o = index * 6;
  return !(
    aabbs[o + 3] < otherMinX ||
    aabbs[o] > otherMaxX ||
    aabbs[o + 4] < otherMinY ||
    aabbs[o + 1] > otherMaxY ||
    aabbs[o + 5] < otherMinZ ||
    aabbs[o + 2] > otherMaxZ
  );
};

const loadTriVectors = (tris, index, v0, v1, v2) => {
  const o = index * 9;
  v0.set(tris[o], tris[o + 1], tris[o + 2]);
  v1.set(tris[o + 3], tris[o + 4], tris[o + 5]);
  v2.set(tris[o + 6], tris[o + 7], tris[o + 8]);
};

/**
 * Indices of the triangles of `data` whose AABB overlaps the bounds of the other mesh.
 * Only those can take part in a triangle–triangle intersection, so the pair loop below
 * shrinks from ta·tb to ta'·tb' (e.g. a pipe crossing a large slab touches a few triangles).
 */
const trianglesNearBounds = (data, otherBounds) => {
  const indices = [];
  for (let i = 0; i < data.count; i += 1) {
    if (
      triAabbOverlap(
        data.aabbs,
        i,
        otherBounds[0],
        otherBounds[1],
        otherBounds[2],
        otherBounds[3],
        otherBounds[4],
        otherBounds[5]
      )
    ) {
      indices.push(i);
    }
  }
  return indices;
};

/**
 * Precise mesh–mesh test:
 * 1) keep only triangles lying in the other mesh's bounds, then per-triangle AABB cull
 *    + triangle–triangle
 * 2) if surfaces miss: containment (vertex of A inside B / vice versa via odd ray hits)
 *    — catches e.g. a short pipe fully inside a column.
 *
 * Broadphase is O(n·m) element pairs; narrowphase is O(ta'·tb') triangles per pair,
 * where ta'/tb' are the triangles inside the overlap region.
 */
const meshesIntersect = (meshA, meshB, triangleCache) => {
  let dataA = triangleCache.get(meshA);
  if (dataA === undefined) {
    dataA = extractEntityTriangles(meshA);
    triangleCache.set(meshA, dataA);
  }
  let dataB = triangleCache.get(meshB);
  if (dataB === undefined) {
    dataB = extractEntityTriangles(meshB);
    triangleCache.set(meshB, dataB);
  }
  if (!dataA || !dataB) return false;

  const nearA = trianglesNearBounds(dataA, dataB.bounds);
  const nearB = nearA.length ? trianglesNearBounds(dataB, dataA.bounds) : [];

  let outer = dataA;
  let outerIndices = nearA;
  let inner = dataB;
  let innerIndices = nearB;
  if (nearA.length > nearB.length) {
    outer = dataB;
    outerIndices = nearB;
    inner = dataA;
    innerIndices = nearA;
  }

  for (let oi = 0; oi < outerIndices.length; oi += 1) {
    const i = outerIndices[oi];
    const oo = i * 6;
    const ominx = outer.aabbs[oo];
    const ominy = outer.aabbs[oo + 1];
    const ominz = outer.aabbs[oo + 2];
    const omaxx = outer.aabbs[oo + 3];
    const omaxy = outer.aabbs[oo + 4];
    const omaxz = outer.aabbs[oo + 5];

    loadTriVectors(outer.tris, i, _V0, _V1, _V2);

    for (let ii = 0; ii < innerIndices.length; ii += 1) {
      const j = innerIndices[ii];
      if (!triAabbOverlap(inner.aabbs, j, ominx, ominy, ominz, omaxx, omaxy, omaxz)) continue;
      loadTriVectors(inner.tris, j, _va, _vb, _vc);
      if (triangleTriangleIntersect(_V0, _V1, _V2, _va, _vb, _vc)) return true;
    }
  }

  // Surfaces do not cross — check full containment
  if (pointInsideTriangleMesh(dataA.tris[0], dataA.tris[1], dataA.tris[2], dataB.tris, dataB.count)) {
    return true;
  }
  if (pointInsideTriangleMesh(dataB.tris[0], dataB.tris[1], dataB.tris[2], dataA.tris, dataA.count)) {
    return true;
  }

  return false;
};

const sameProduct = (a, b) =>
  a?.modelId === b?.modelId && a?.expressID != null && a.expressID === b.expressID;

const makePair = (id, kind, left, right) => ({
  id,
  kind,
  leftMesh: left.entity,
  rightMesh: right.entity,
  leftExpressId: left.entity.expressID ?? "brak",
  rightExpressId: right.entity.expressID ?? "brak",
  leftDiscipline: left.entity.layerName ?? left.entity.discipline ?? "brak",
  rightDiscipline: right.entity.layerName ?? right.entity.discipline ?? "brak"
});

/**
 * Two-phase collision detection (no result limit):
 * 1) AABB broadphase (with tolerance)
 * 2) Triangle–triangle narrowphase (filters e.g. railing through slab opening)
 *
 * Soft clash (tol > 0): pairs that only meet after AABB expansion count without mesh test.
 */
export const detectLayerCollisions = (group, layerA, layerB, { tolerance = 0 } = {}) => {
  const t0 = performance.now();
  group.updateMatrixWorld(true);
  const entitiesA = getEntitiesForLayer(group, layerA);
  const entitiesB = getEntitiesForLayer(group, layerB);
  const tol = Number.isFinite(tolerance) ? tolerance : 0;

  const sameLayer = layerA === layerB;
  const halfExpand = tol > 0 ? tol * 0.5 : 0;

  const prepare = (entity) => {
    const box = getEntityWorldBox(entity);
    const boxBroad = halfExpand > 0 ? box.clone().expandByScalar(halfExpand) : box;
    return { entity, box, boxBroad };
  };

  const boxesA = entitiesA.map(prepare);
  const boxesB = sameLayer ? boxesA : entitiesB.map(prepare);

  const triangleCache = new Map();
  const samplePairs = [];
  let aabbCandidates = 0;
  let softClashCount = 0;
  let meshRejected = 0;

  for (let i = 0; i < boxesA.length; i += 1) {
    const startJ = sameLayer ? i + 1 : 0;
    for (let j = startJ; j < boxesB.length; j += 1) {
      const left = boxesA[i];
      const right = boxesB[j];
      if (sameProduct(left.entity, right.entity)) continue;

      // Phase 1 — AABB (boxBroad already expanded when tol > 0)
      if (!boxesCollide(left.boxBroad, right.boxBroad, tol <= 0 ? tol : 0)) continue;

      aabbCandidates += 1;

      // Soft clash: only expanded boxes overlap
      if (tol > 0 && !left.box.intersectsBox(right.box)) {
        softClashCount += 1;
        samplePairs.push(makePair(samplePairs.length, "soft", left, right));
        continue;
      }

      // Phase 2 — triangle–triangle
      if (!meshesIntersect(left.entity, right.entity, triangleCache)) {
        meshRejected += 1;
        continue;
      }

      samplePairs.push(makePair(samplePairs.length, "solid", left, right));
    }
  }

  return {
    layerA,
    layerB,
    tolerance: tol,
    collisionsCount: samplePairs.length,
    aabbCandidates,
    meshRejected,
    softClashCount,
    samplePairs,
    testedA: entitiesA.length,
    testedB: entitiesB.length,
    elapsedMs: Math.round(performance.now() - t0)
  };
};
