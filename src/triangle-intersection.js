import * as THREE from "three";

const _E1 = new THREE.Vector3();
const _E2 = new THREE.Vector3();
const _N1 = new THREE.Vector3();
const _N2 = new THREE.Vector3();
const _D = new THREE.Vector3();
const _TMP = new THREE.Vector3();
const _VP = new THREE.Vector3();
const _RAY_ORIGIN = new THREE.Vector3();
const _RAY_DIR = new THREE.Vector3(1, 1e-4, 1e-5).normalize();
const _T0 = new THREE.Vector3();
const _T1 = new THREE.Vector3();
const _T2 = new THREE.Vector3();

const orient2D = (ax, ay, bx, by, cx, cy) => (ax - cx) * (by - cy) - (ay - cy) * (bx - cx);

const pointInTri2D = (px, py, ax, ay, bx, by, cx, cy) => {
  const s1 = orient2D(px, py, ax, ay, bx, by);
  const s2 = orient2D(px, py, bx, by, cx, cy);
  const s3 = orient2D(px, py, cx, cy, ax, ay);
  const hasNeg = s1 < 0 || s2 < 0 || s3 < 0;
  const hasPos = s1 > 0 || s2 > 0 || s3 > 0;
  return !(hasNeg && hasPos);
};

const segmentsIntersect2D = (a0x, a0y, a1x, a1y, b0x, b0y, b1x, b1y) => {
  const d1 = orient2D(b0x, b0y, b1x, b1y, a0x, a0y);
  const d2 = orient2D(b0x, b0y, b1x, b1y, a1x, a1y);
  const d3 = orient2D(a0x, a0y, a1x, a1y, b0x, b0y);
  const d4 = orient2D(a0x, a0y, a1x, a1y, b1x, b1y);
  if (((d1 > 0 && d2 > 0) || (d1 < 0 && d2 < 0)) && ((d3 > 0 && d4 > 0) || (d3 < 0 && d4 < 0))) {
    return false;
  }
  if (d1 === 0 && d2 === 0 && d3 === 0 && d4 === 0) {
    const minAx = Math.min(a0x, a1x);
    const maxAx = Math.max(a0x, a1x);
    const minBx = Math.min(b0x, b1x);
    const maxBx = Math.max(b0x, b1x);
    const minAy = Math.min(a0y, a1y);
    const maxAy = Math.max(a0y, a1y);
    const minBy = Math.min(b0y, b1y);
    const maxBy = Math.max(b0y, b1y);
    return maxAx >= minBx && maxBx >= minAx && maxAy >= minBy && maxBy >= minAy;
  }
  return d1 * d2 <= 0 && d3 * d4 <= 0;
};

const coplanarTrianglesIntersect = (a0, a1, a2, b0, b1, b2, normal) => {
  const nx = Math.abs(normal.x);
  const ny = Math.abs(normal.y);
  const nz = Math.abs(normal.z);
  let i0 = 0;
  let i1 = 1;
  if (nx > ny && nx > nz) {
    i0 = 1;
    i1 = 2;
  } else if (ny > nz) {
    i0 = 0;
    i1 = 2;
  }

  const a0u = a0.getComponent(i0);
  const a0v = a0.getComponent(i1);
  const a1u = a1.getComponent(i0);
  const a1v = a1.getComponent(i1);
  const a2u = a2.getComponent(i0);
  const a2v = a2.getComponent(i1);
  const b0u = b0.getComponent(i0);
  const b0v = b0.getComponent(i1);
  const b1u = b1.getComponent(i0);
  const b1v = b1.getComponent(i1);
  const b2u = b2.getComponent(i0);
  const b2v = b2.getComponent(i1);

  const edgesA = [
    [a0u, a0v, a1u, a1v],
    [a1u, a1v, a2u, a2v],
    [a2u, a2v, a0u, a0v]
  ];
  const edgesB = [
    [b0u, b0v, b1u, b1v],
    [b1u, b1v, b2u, b2v],
    [b2u, b2v, b0u, b0v]
  ];

  for (const ea of edgesA) {
    for (const eb of edgesB) {
      if (segmentsIntersect2D(ea[0], ea[1], ea[2], ea[3], eb[0], eb[1], eb[2], eb[3])) return true;
    }
  }

  if (pointInTri2D(a0u, a0v, b0u, b0v, b1u, b1v, b2u, b2v)) return true;
  if (pointInTri2D(b0u, b0v, a0u, a0v, a1u, a1v, a2u, a2v)) return true;
  return false;
};

/** Edge p→q against triangle (a,b,c) with plane n·x + d = 0 (n unit). */
const edgeIntersectsTriangle = (p, q, a, b, c, n, d) => {
  const distP = n.dot(p) + d;
  const distQ = n.dot(q) + d;
  if (distP * distQ > 0) return false;
  if (distP === 0 && distQ === 0) return false;

  const denomEdge = distP - distQ;
  if (Math.abs(denomEdge) < 1e-20) return false;
  const t = distP / denomEdge;
  if (t < 0 || t > 1) return false;

  _TMP.copy(q).sub(p).multiplyScalar(t).add(p);

  _E1.subVectors(b, a);
  _E2.subVectors(c, a);
  _VP.subVectors(_TMP, a);
  const dot00 = _E1.dot(_E1);
  const dot01 = _E1.dot(_E2);
  const dot02 = _E1.dot(_VP);
  const dot11 = _E2.dot(_E2);
  const dot12 = _E2.dot(_VP);
  const denom = dot00 * dot11 - dot01 * dot01;
  if (Math.abs(denom) < 1e-20) return false;
  const u = (dot11 * dot02 - dot01 * dot12) / denom;
  const v = (dot00 * dot12 - dot01 * dot02) / denom;
  return u >= -1e-8 && v >= -1e-8 && u + v <= 1 + 1e-8;
};

/**
 * Triangle–triangle intersection (Möller-style).
 * Normals are normalized so coplanar / separation epsilons are scale-independent.
 * Vectors are not modified.
 */
export const triangleTriangleIntersect = (a0, a1, a2, b0, b1, b2) => {
  _E1.subVectors(a1, a0);
  _E2.subVectors(a2, a0);
  _N1.crossVectors(_E1, _E2);
  if (_N1.lengthSq() < 1e-24) return false;
  _N1.normalize();
  const d1 = -_N1.dot(a0);

  const eps = 1e-8;
  const db0 = _N1.dot(b0) + d1;
  const db1 = _N1.dot(b1) + d1;
  const db2 = _N1.dot(b2) + d1;
  if ((db0 > eps && db1 > eps && db2 > eps) || (db0 < -eps && db1 < -eps && db2 < -eps)) {
    return false;
  }

  _E1.subVectors(b1, b0);
  _E2.subVectors(b2, b0);
  _N2.crossVectors(_E1, _E2);
  if (_N2.lengthSq() < 1e-24) return false;
  _N2.normalize();
  const d2 = -_N2.dot(b0);

  const da0 = _N2.dot(a0) + d2;
  const da1 = _N2.dot(a1) + d2;
  const da2 = _N2.dot(a2) + d2;
  if ((da0 > eps && da1 > eps && da2 > eps) || (da0 < -eps && da1 < -eps && da2 < -eps)) {
    return false;
  }

  _D.crossVectors(_N1, _N2);
  if (_D.lengthSq() < 1e-16) {
    return coplanarTrianglesIntersect(a0, a1, a2, b0, b1, b2, _N1);
  }

  if (edgeIntersectsTriangle(a0, a1, b0, b1, b2, _N2, d2)) return true;
  if (edgeIntersectsTriangle(a1, a2, b0, b1, b2, _N2, d2)) return true;
  if (edgeIntersectsTriangle(a2, a0, b0, b1, b2, _N2, d2)) return true;
  if (edgeIntersectsTriangle(b0, b1, a0, a1, a2, _N1, d1)) return true;
  if (edgeIntersectsTriangle(b1, b2, a0, a1, a2, _N1, d1)) return true;
  if (edgeIntersectsTriangle(b2, b0, a0, a1, a2, _N1, d1)) return true;

  return false;
};

/** Möller–Trumbore: ray origin+t*dir hits triangle? t > 0 only. */
const rayHitsTriangle = (origin, dir, v0, v1, v2) => {
  _E1.subVectors(v1, v0);
  _E2.subVectors(v2, v0);
  _D.crossVectors(dir, _E2);
  const det = _E1.dot(_D);
  if (Math.abs(det) < 1e-12) return false;
  const invDet = 1 / det;
  _VP.subVectors(origin, v0);
  const u = _VP.dot(_D) * invDet;
  if (u < 0 || u > 1) return false;
  _TMP.crossVectors(_VP, _E1);
  const v = dir.dot(_TMP) * invDet;
  if (v < 0 || u + v > 1) return false;
  const t = _E2.dot(_TMP) * invDet;
  return t > 1e-8;
};

/**
 * Point-in-mesh via odd/even ray–triangle hits (closed manifold assumed).
 * `tris`: flat ax,ay,az,bx,by,bz,cx,cy,cz × count
 */
export const pointInsideTriangleMesh = (x, y, z, tris, count) => {
  if (!tris || count <= 0) return false;
  _RAY_ORIGIN.set(x, y, z);
  let hits = 0;
  for (let i = 0; i < count; i += 1) {
    const o = i * 9;
    _T0.set(tris[o], tris[o + 1], tris[o + 2]);
    _T1.set(tris[o + 3], tris[o + 4], tris[o + 5]);
    _T2.set(tris[o + 6], tris[o + 7], tris[o + 8]);
    if (rayHitsTriangle(_RAY_ORIGIN, _RAY_DIR, _T0, _T1, _T2)) hits += 1;
  }
  return hits % 2 === 1;
};
