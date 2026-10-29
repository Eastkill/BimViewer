import * as THREE from "three";

const getMeshesForLayer = (group, layerName) =>
  group.children.filter((node) => node.isMesh && node.userData.discipline === layerName && node.visible);

const getWorldBox = (mesh) => {
  if (!mesh.geometry.boundingBox) {
    mesh.geometry.computeBoundingBox();
  }
  const worldBox = new THREE.Box3();
  worldBox.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
  return worldBox;
};

export const detectLayerCollisions = (group, layerA, layerB, maxSamples = 30) => {
  group.updateMatrixWorld(true);
  const meshesA = getMeshesForLayer(group, layerA);
  const meshesB = getMeshesForLayer(group, layerB);

  const sameLayer = layerA === layerB;
  const boxesA = meshesA.map((mesh) => ({ mesh, box: getWorldBox(mesh) }));
  const boxesB = sameLayer ? boxesA : meshesB.map((mesh) => ({ mesh, box: getWorldBox(mesh) }));

  let collisionsCount = 0;
  const samplePairs = [];

  for (let i = 0; i < boxesA.length; i += 1) {
    const startJ = sameLayer ? i + 1 : 0;
    for (let j = startJ; j < boxesB.length; j += 1) {
      const left = boxesA[i];
      const right = boxesB[j];
      if (!left.box.intersectsBox(right.box)) continue;
      collisionsCount += 1;
      if (samplePairs.length < maxSamples) {
        samplePairs.push({
          id: samplePairs.length,
          leftMesh: left.mesh,
          rightMesh: right.mesh,
          leftExpressId: left.mesh.userData.expressID ?? "brak",
          rightExpressId: right.mesh.userData.expressID ?? "brak",
          leftDiscipline: left.mesh.userData.discipline ?? "brak",
          rightDiscipline: right.mesh.userData.discipline ?? "brak"
        });
      }
    }
  }

  return {
    layerA,
    layerB,
    collisionsCount,
    samplePairs,
    testedA: meshesA.length,
    testedB: meshesB.length
  };
};
