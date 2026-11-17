import * as THREE from "three";

const _matrix = new THREE.Matrix4();
const _worldMatrix = new THREE.Matrix4();
const _box = new THREE.Box3();
const _color4 = new THREE.Vector4();

export const getEntities = (modelGroup) => modelGroup?.userData?.entities ?? [];

export const getEntityFromPick = (intersection) => {
  if (!intersection?.object) return null;
  const batch = intersection.object;
  if (!batch.isBatchedMesh) return null;
  const batchId = intersection.batchId;
  if (batchId == null) return null;
  return batch.userData.entityByInstanceId?.get(batchId) ?? null;
};

export const syncEntityAppearance = (entity) => {
  const { batch, instanceId } = entity;
  if (!batch || instanceId == null) return;

  const visible = entity.layerVisible !== false && entity.isolationVisible !== false;
  batch.setVisibleAt(instanceId, visible);

  const opacity = Math.max(
    0,
    Math.min(1, (entity.baseOpacity ?? 1) * (entity.layerOpacity ?? 1) * (entity.isolationOpacity ?? 1))
  );

  if (entity.highlightColor != null) {
    const highlight = entity.highlightColor;
    _color4.set(highlight.r, highlight.g, highlight.b, opacity);
  } else {
    const dim = entity.isolationDim ?? 1;
    _color4.set(
      entity.baseColor.r * dim,
      entity.baseColor.g * dim,
      entity.baseColor.b * dim,
      opacity
    );
  }

  batch.setColorAt(instanceId, _color4);
};

const entityEffectiveOpacity = (entity) =>
  (entity.baseOpacity ?? 1) * (entity.layerOpacity ?? 1) * (entity.isolationOpacity ?? 1);

/**
 * Opaque instances first (front→back), then transparent (back→front).
 * Prevents solid geometry in a mixed BatchedMesh from disappearing when
 * another layer's opacity flips the shared material to transparent.
 */
const createMixedOpacitySort = (batch) => (list) => {
  const entityMap = batch.userData.entityByInstanceId;
  const isTransparentInstance = (item) => {
    const entity = entityMap?.get(item.index);
    if (!entity) return false;
    if (entity.layerVisible === false || entity.isolationVisible === false) return false;
    return entityEffectiveOpacity(entity) < 0.999;
  };

  list.sort((a, b) => {
    const aT = isTransparentInstance(a);
    const bT = isTransparentInstance(b);
    if (aT !== bT) return aT ? 1 : -1;
    return aT ? b.z - a.z : a.z - b.z;
  });
};

export const refreshBatchTransparency = (modelGroup) => {
  const batches = modelGroup?.userData?.batches ?? [];
  for (const batch of batches) {
    // Originally translucent IFC materials keep classic transparent behaviour.
    if (batch.userData.transparent) continue;

    const entityMap = batch.userData.entityByInstanceId;
    let needsTransparency = false;
    let hasOpaque = false;
    if (entityMap) {
      for (const entity of entityMap.values()) {
        if (entity.layerVisible === false || entity.isolationVisible === false) continue;
        if (entityEffectiveOpacity(entity) < 0.999) needsTransparency = true;
        else hasOpaque = true;
      }
    }

    const material = batch.material;
    if (!material) continue;

    // Mixed opaque+transparent in one BatchedMesh: keep depthWrite so solids still
    // occlude. depthWrite:false on the whole batch was making other layers vanish.
    if (material.transparent !== needsTransparency || material.depthWrite !== true) {
      material.transparent = needsTransparency;
      material.depthWrite = true;
      material.needsUpdate = true;
    }

    batch.customSort = needsTransparency && hasOpaque ? createMixedOpacitySort(batch) : null;
  }
};

export const getEntityWorldBox = (entity, target = new THREE.Box3()) => {
  const { batch, instanceId } = entity;
  const geometryId = batch.getGeometryIdAt(instanceId);
  batch.getBoundingBoxAt(geometryId, _box);
  batch.getMatrixAt(instanceId, _matrix);
  _worldMatrix.copy(batch.matrixWorld).multiply(_matrix);
  return target.copy(_box).applyMatrix4(_worldMatrix);
};

/**
 * Box marking where a reported problem is located.
 * Two entities (a collision pair): the overlap of their boxes; when the boxes do not
 * overlap on some axis (soft clash), the gap between them on that axis.
 * Any other count (a duplicate group): the union of the boxes.
 * Returns null when no entity has a usable box.
 */
export const getProblemRegion = (entities = []) => {
  const boxes = [];
  for (const entity of entities) {
    if (!entity?.batch) continue;
    const box = getEntityWorldBox(entity);
    if (!box.isEmpty()) boxes.push(box);
  }
  if (!boxes.length) return null;

  if (boxes.length === 2) {
    const [a, b] = boxes;
    const region = new THREE.Box3();
    for (const axis of ["x", "y", "z"]) {
      const low = Math.max(a.min[axis], b.min[axis]);
      const high = Math.min(a.max[axis], b.max[axis]);
      region.min[axis] = Math.min(low, high);
      region.max[axis] = Math.max(low, high);
    }
    return region;
  }

  const region = boxes[0].clone();
  for (let i = 1; i < boxes.length; i += 1) region.union(boxes[i]);
  return region;
};

/**
 * World-space triangle soup of one entity (9 floats per triangle), used to draw it
 * as an overlay on top of the model. Returns null for entities without geometry.
 */
export const extractEntityWorldPositions = (entity) => {
  const { batch, instanceId } = entity || {};
  if (!batch || instanceId == null) return null;

  const range = batch.getGeometryRangeAt?.(batch.getGeometryIdAt(instanceId));
  const position = batch.geometry.getAttribute("position");
  if (!range || !position) return null;

  const index = batch.geometry.getIndex();
  const count = Math.floor(range.count / 3) * 3;
  if (count <= 0) return null;

  batch.getMatrixAt(instanceId, _matrix);
  _worldMatrix.copy(batch.matrixWorld).multiply(_matrix);

  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const vertexIndex = index ? index.getX(range.start + i) : range.start + i;
    _vertex.fromBufferAttribute(position, vertexIndex).applyMatrix4(_worldMatrix);
    positions[i * 3] = _vertex.x;
    positions[i * 3 + 1] = _vertex.y;
    positions[i * 3 + 2] = _vertex.z;
  }
  return positions;
};

const _vertex = new THREE.Vector3();
const _surfA = new THREE.Vector3();
const _surfB = new THREE.Vector3();
const _surfC = new THREE.Vector3();
const _surfAb = new THREE.Vector3();
const _surfAc = new THREE.Vector3();
const _surfN = new THREE.Vector3();

/**
 * Sum triangle areas, optionally skipping faces whose normal is nearly parallel
 * to a world "up" axis (top/bottom of a wall).
 * After Y-up conversion, vertical axis is Y → skipUpAxis: 1.
 */
const sumMeshTriangleAreas = (entity, { skipUpAxis = null, upDotThreshold = 0.9 } = {}) => {
  const { batch, instanceId } = entity || {};
  if (!batch || instanceId == null) return 0;

  const geometryId = batch.getGeometryIdAt(instanceId);
  const range = batch.getGeometryRangeAt?.(geometryId);
  if (!range) return 0;

  const geometry = batch.geometry;
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  if (!position) return 0;

  batch.getMatrixAt(instanceId, _matrix);
  _worldMatrix.copy(batch.matrixWorld).multiply(_matrix);

  let area = 0;
  const start = range.start;
  const count = range.count;

  const readVertex = (vertexIndex, target) => {
    target.fromBufferAttribute(position, vertexIndex).applyMatrix4(_worldMatrix);
  };

  const addTriangle = () => {
    _surfAb.subVectors(_surfB, _surfA);
    _surfAc.subVectors(_surfC, _surfA);
    _surfN.crossVectors(_surfAb, _surfAc);
    const twiceArea = _surfN.length();
    if (!(twiceArea > 0)) return;

    if (skipUpAxis != null) {
      const upComponent =
        skipUpAxis === 1 ? Math.abs(_surfN.y) : skipUpAxis === 2 ? Math.abs(_surfN.z) : Math.abs(_surfN.x);
      if (upComponent / twiceArea > upDotThreshold) return;
    }

    area += twiceArea * 0.5;
  };

  if (index) {
    for (let i = start; i < start + count; i += 3) {
      readVertex(index.getX(i), _surfA);
      readVertex(index.getX(i + 1), _surfB);
      readVertex(index.getX(i + 2), _surfC);
      addTriangle();
    }
  } else {
    for (let i = start; i < start + count; i += 3) {
      readVertex(i, _surfA);
      readVertex(i + 1, _surfB);
      readVertex(i + 2, _surfC);
      addTriangle();
    }
  }

  return area;
};

/**
 * One-sided wall area: drop faces nearly perpendicular to world Y (top/bottom after
 * Y-up conversion), then /2 for both faces. Do not max with a Z-up variant — that
 * overestimates walls running along Z (e.g. Sciana_W 0.3×3.2×12 → 42 instead of 39.4).
 */
export const computeEntityOneSidedSurfaceArea = (entity) => {
  const area = sumMeshTriangleAreas(entity, { skipUpAxis: 1 });
  return area > 0 ? area * 0.5 : 0;
};

export const disposeBatchedModelGroup = (group) => {
  if (!group) return;

  group.traverse((node) => {
    if (!node.isBatchedMesh) return;
    node.material?.dispose?.();
    node.dispose?.();
  });

  group.clear();
  group.userData.entities = [];
  group.userData.batches = [];
  group.userData.fileGroups = [];
};
