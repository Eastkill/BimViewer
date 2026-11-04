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

export const refreshBatchTransparency = (modelGroup) => {
  const batches = modelGroup?.userData?.batches ?? [];
  for (const batch of batches) {
    if (batch.userData.transparent) continue;
    const entityMap = batch.userData.entityByInstanceId;
    let needsTransparency = false;
    if (entityMap) {
      for (const entity of entityMap.values()) {
        const opacity =
          (entity.baseOpacity ?? 1) * (entity.layerOpacity ?? 1) * (entity.isolationOpacity ?? 1);
        if (opacity < 0.999 && entity.layerVisible !== false && entity.isolationVisible !== false) {
          needsTransparency = true;
          break;
        }
      }
    }
    const material = batch.material;
    if (!material) continue;
    if (material.transparent !== needsTransparency) {
      material.transparent = needsTransparency;
      material.depthWrite = !needsTransparency;
      material.needsUpdate = true;
    }
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
