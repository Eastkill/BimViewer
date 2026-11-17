import * as THREE from "three";

/**
 * Builds a model group the same way ifc-service does (one BatchedMesh + entity list),
 * but from plain axis-aligned boxes, so geometric results are analytically known.
 *
 * box: { min: [x,y,z], max: [x,y,z], rotationY?: radians (about the box centre), ...entity fields }
 */
export const buildModel = (boxes) => {
  const batch = new THREE.BatchedMesh(
    boxes.length,
    boxes.length * 24,
    boxes.length * 36,
    new THREE.MeshBasicMaterial()
  );
  batch.userData.entityByInstanceId = new Map();

  const entities = boxes.map((box, index) => {
    const size = new THREE.Vector3().subVectors(
      new THREE.Vector3(...box.max),
      new THREE.Vector3(...box.min)
    );
    const center = new THREE.Vector3(...box.min).add(new THREE.Vector3(...box.max)).multiplyScalar(0.5);
    const geometryId = batch.addGeometry(new THREE.BoxGeometry(size.x, size.y, size.z));
    const instanceId = batch.addInstance(geometryId);
    batch.setMatrixAt(
      instanceId,
      new THREE.Matrix4().compose(
        center,
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), box.rotationY ?? 0),
        new THREE.Vector3(1, 1, 1)
      )
    );

    const entity = {
      batch,
      instanceId,
      modelId: box.modelId ?? 0,
      expressID: box.expressID ?? index + 1,
      globalId: box.globalId ?? `gid-${index + 1}`,
      typeName: box.typeName ?? "IFCBUILDINGELEMENTPROXY",
      typeId: box.typeId ?? 0,
      name: box.name ?? `element-${index + 1}`,
      discipline: box.discipline ?? "Inne",
      layerName: box.layerName ?? box.discipline ?? "Inne",
      layerVisible: box.layerVisible ?? true,
      sourceFile: box.sourceFile ?? "test.ifc"
    };
    batch.userData.entityByInstanceId.set(instanceId, entity);
    return entity;
  });

  const group = new THREE.Group();
  group.add(batch);
  group.userData.entities = entities;
  group.userData.batches = [batch];
  group.updateMatrixWorld(true);
  return { group, entities };
};

/** Flat triangle list (9 floats per triangle) of an axis-aligned box. */
export const boxTriangles = (min, max) => {
  const size = new THREE.Vector3().subVectors(new THREE.Vector3(...max), new THREE.Vector3(...min));
  const center = new THREE.Vector3(...min).add(new THREE.Vector3(...max)).multiplyScalar(0.5);
  const geometry = new THREE.BoxGeometry(size.x, size.y, size.z).toNonIndexed();
  geometry.translate(center.x, center.y, center.z);
  const tris = Float32Array.from(geometry.getAttribute("position").array);
  return { tris, count: tris.length / 9 };
};
