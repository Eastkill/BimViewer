import { getEntities, getEntityWorldBox } from "./entities.js";

const getEntitiesForLayer = (group, layerName) =>
  getEntities(group).filter(
    (entity) =>
      entity.layerVisible !== false &&
      (entity.layerName === layerName || entity.discipline === layerName)
  );

export const detectLayerCollisions = (group, layerA, layerB, maxSamples = 30) => {
  group.updateMatrixWorld(true);
  const entitiesA = getEntitiesForLayer(group, layerA);
  const entitiesB = getEntitiesForLayer(group, layerB);

  const sameLayer = layerA === layerB;
  const boxesA = entitiesA.map((entity) => ({ entity, box: getEntityWorldBox(entity) }));
  const boxesB = sameLayer ? boxesA : entitiesB.map((entity) => ({ entity, box: getEntityWorldBox(entity) }));

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
          leftMesh: left.entity,
          rightMesh: right.entity,
          leftExpressId: left.entity.expressID ?? "brak",
          rightExpressId: right.entity.expressID ?? "brak",
          leftDiscipline: left.entity.layerName ?? left.entity.discipline ?? "brak",
          rightDiscipline: right.entity.layerName ?? right.entity.discipline ?? "brak"
        });
      }
    }
  }

  return {
    layerA,
    layerB,
    collisionsCount,
    samplePairs,
    testedA: entitiesA.length,
    testedB: entitiesB.length
  };
};
