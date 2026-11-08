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

export const syncAllEntityAppearances = (modelGroup) => {
  for (const entity of getEntities(modelGroup)) {
    syncEntityAppearance(entity);
  }
  refreshBatchTransparency(modelGroup);
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
    const nextTransparent = needsTransparency;
    const nextDepthWrite = true;
    if (material.transparent !== nextTransparent || material.depthWrite !== nextDepthWrite) {
      material.transparent = nextTransparent;
      material.depthWrite = nextDepthWrite;
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

export const computeEntityMeshSurfaceArea = (entity) => sumMeshTriangleAreas(entity);

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
  const batches = group?.userData?.batches?.length
    ? group.userData.batches
    : [];

  if (batches.length) {
    for (const batch of batches) {
      batch.material?.dispose?.();
      batch.dispose?.();
    }
  } else {
    group.traverse((node) => {
      if (!node.isBatchedMesh) return;
      node.material?.dispose?.();
      node.dispose?.();
    });
  }

  group.clear();
  group.userData.entities = [];
  group.userData.batches = [];
  group.userData.fileGroups = [];
};
