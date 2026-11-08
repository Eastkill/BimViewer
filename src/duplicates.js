import * as THREE from "three";
import { getEntities, getEntityWorldBox } from "./entities.js";

const _sizeA = new THREE.Vector3();
const _sizeB = new THREE.Vector3();
const _centerA = new THREE.Vector3();
const _centerB = new THREE.Vector3();

/**
 * Collapse multi-geometry IFC products into one world AABB per (modelId, expressID).
 */
export const buildElementBoxes = (modelGroup) => {
  modelGroup.updateMatrixWorld(true);
  const byKey = new Map();

  for (const entity of getEntities(modelGroup)) {
    if (entity?.modelId == null || entity?.expressID == null) continue;
    const key = `${entity.modelId}:${entity.expressID}`;
    const box = getEntityWorldBox(entity);
    if (box.isEmpty()) continue;

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        key,
        entity,
        box: box.clone(),
        entities: [entity]
      });
    } else {
      existing.box.union(box);
      existing.entities.push(entity);
    }
  }

  return [...byKey.values()];
};

/**
 * Same type + nearly identical size + nearly co-located centers.
 * Deliberately does NOT use expanded-AABB intersection — that flags abutting
 * identical segments (pipes/walls end-to-end) as duplicates.
 */
const boxesAreGeometricDuplicates = (boxA, boxB, { positionTolerance, sizeTolerance }) => {
  boxA.getSize(_sizeA);
  boxB.getSize(_sizeB);
  boxA.getCenter(_centerA);
  boxB.getCenter(_centerB);

  const sizeOk =
    Math.abs(_sizeA.x - _sizeB.x) <= sizeTolerance &&
    Math.abs(_sizeA.y - _sizeB.y) <= sizeTolerance &&
    Math.abs(_sizeA.z - _sizeB.z) <= sizeTolerance;

  if (!sizeOk) return false;

  return _centerA.distanceTo(_centerB) <= positionTolerance;
};

/**
 * Detect duplicated GlobalId values and near-identical geometry of the same IFC type.
 */
export const detectDuplicates = (
  modelGroup,
  { positionTolerance = 0.1, sizeTolerance = 0.05, maxSamples = 50 } = {}
) => {
  const elements = buildElementBoxes(modelGroup);
  const posTol = Number.isFinite(positionTolerance) ? Math.max(0, positionTolerance) : 0.1;
  const sizeTol = Number.isFinite(sizeTolerance) ? Math.max(0, sizeTolerance) : 0.05;

  // --- GlobalId duplicates ---
  const byGlobalId = new Map();
  for (const item of elements) {
    const globalId = item.entity.globalId;
    if (!globalId || globalId === "brak") continue;
    const list = byGlobalId.get(globalId) || [];
    list.push(item);
    byGlobalId.set(globalId, list);
  }

  const globalIdGroups = [];
  for (const [globalId, items] of byGlobalId) {
    if (items.length < 2) continue;
    globalIdGroups.push({
      id: `gid-${globalIdGroups.length}`,
      kind: "globalId",
      label: `GlobalId ${globalId}`,
      globalId,
      typeName: items[0].entity.typeName ?? "?",
      items,
      entities: items.flatMap((item) => item.entities)
    });
  }

  // --- Geometric duplicates (same type + similar AABB + near centers) ---
  const byType = new Map();
  for (const item of elements) {
    const typeName = item.entity.typeName || "UNKNOWN";
    const list = byType.get(typeName) || [];
    list.push(item);
    byType.set(typeName, list);
  }

  const geometricGroups = [];
  const assigned = new Set();

  for (const [typeName, items] of byType) {
    for (let i = 0; i < items.length; i += 1) {
      if (assigned.has(items[i].key)) continue;
      const cluster = [items[i]];

      for (let j = i + 1; j < items.length; j += 1) {
        if (assigned.has(items[j].key)) continue;
        if (
          boxesAreGeometricDuplicates(items[i].box, items[j].box, {
            positionTolerance: posTol,
            sizeTolerance: sizeTol
          })
        ) {
          cluster.push(items[j]);
        }
      }

      if (cluster.length < 2) continue;
      for (const item of cluster) assigned.add(item.key);

      geometricGroups.push({
        id: `geo-${geometricGroups.length}`,
        kind: "geometry",
        label: `${typeName} × ${cluster.length}`,
        typeName,
        items: cluster,
        entities: cluster.flatMap((item) => item.entities)
      });
    }
  }

  const sampleGroups = [...globalIdGroups, ...geometricGroups].slice(0, maxSamples);

  return {
    positionTolerance: posTol,
    sizeTolerance: sizeTol,
    elementCount: elements.length,
    globalIdDuplicateGroups: globalIdGroups.length,
    geometricDuplicateGroups: geometricGroups.length,
    groups: sampleGroups,
    totalGroups: globalIdGroups.length + geometricGroups.length
  };
};
