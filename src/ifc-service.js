import * as THREE from "three";
import { IFC_TYPE_IDS } from "./constants.js";
import { ALL_DISCIPLINES, buildElementSystemHints, resolveDiscipline } from "./disciplines.js";
import {
  buildFileCacheKey,
  getCachedProcessedFile,
  hydrateGeometryCache,
  IFC_CACHE_SCHEMA_VERSION,
  rebuildPlacementsFromCache,
  serializeGeometries,
  serializePlacements,
  setCachedProcessedFile
} from "./ifc-cache.js";
import { buildMaterialTakeoffReport } from "./material-takeoff.js";
import { formatMaterialsLabel } from "./materials.js";

export const createIfcService = () => {
  let ifcApi = null;
  let initialized = false;
  let openModelIds = [];

  const init = async () => {
    if (initialized) return;
    const { IfcAPI } = await import("web-ifc");
    ifcApi = new IfcAPI();

    const localWasmPath = `${import.meta.env.BASE_URL}wasm/`;
    try {
      await ifcApi.SetWasmPath(localWasmPath, true);
      await ifcApi.Init();
    } catch (localError) {
      await ifcApi.SetWasmPath("https://unpkg.com/web-ifc@0.0.77/", true);
      try {
        await ifcApi.Init();
      } catch (cdnError) {
        throw new Error(
          `Nie udalo sie zainicjalizowac web-ifc WASM. Lokalnie: ${localError?.message ?? localError}. CDN: ${cdnError?.message ?? cdnError}`
        );
      }
    }

    initialized = true;
  };

  const closeAllModels = () => {
    if (!ifcApi) return;
    for (const modelId of openModelIds) {
      try {
        ifcApi.CloseModel(modelId);
      } catch {
        // ignore close errors on already disposed models
      }
    }
    openModelIds = [];
  };

  // Backwards-compatible alias used by main.js
  const closeCurrentModel = () => closeAllModels();

  const extractBufferGeometry = (modelId, geometryId, geometryCache) => {
    const cacheKey = `${modelId}:${geometryId}`;
    if (geometryCache.has(cacheKey)) {
      return geometryCache.get(cacheKey);
    }

    const ifcGeometry = ifcApi.GetGeometry(modelId, geometryId);
    if (!ifcGeometry) {
      geometryCache.set(cacheKey, null);
      return null;
    }

    const vertexData = Float32Array.from(
      ifcApi.GetVertexArray(ifcGeometry.GetVertexData(), ifcGeometry.GetVertexDataSize())
    );
    const indexData = Uint32Array.from(
      ifcApi.GetIndexArray(ifcGeometry.GetIndexData(), ifcGeometry.GetIndexDataSize())
    );
    ifcGeometry.delete();

    if (!vertexData.length || !indexData.length) {
      geometryCache.set(cacheKey, null);
      return null;
    }

    const positionArray = new Float32Array((vertexData.length / 6) * 3);
    const normalArray = new Float32Array((vertexData.length / 6) * 3);
    let write = 0;
    for (let i = 0; i < vertexData.length; i += 6) {
      positionArray[write] = vertexData[i];
      positionArray[write + 1] = vertexData[i + 1];
      positionArray[write + 2] = vertexData[i + 2];
      normalArray[write] = vertexData[i + 3];
      normalArray[write + 1] = vertexData[i + 4];
      normalArray[write + 2] = vertexData[i + 5];
      write += 3;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positionArray, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normalArray, 3));
    geometry.setIndex(new THREE.BufferAttribute(indexData, 1));
    geometry.computeBoundingBox();
    geometryCache.set(cacheKey, geometry);
    return geometry;
  };

  const buildDuplicateReport = (geometryCounts, elementCounts) => {
    const duplicateGeometry = [...geometryCounts.entries()].filter(([, count]) => count > 1);
    const duplicateElements = [...elementCounts.entries()].filter(([, count]) => count > 1);
    const geometryInstances = duplicateGeometry.reduce((sum, [, count]) => sum + count, 0);
    const elementInstances = duplicateElements.reduce((sum, [, count]) => sum + count, 0);

    return {
      duplicateGeometryCount: duplicateGeometry.length,
      duplicateGeometryInstances: geometryInstances,
      duplicateElementsCount: duplicateElements.length,
      duplicateElementsInstances: elementInstances
    };
  };

  const guessHintFromFileName = (fileName) => String(fileName || "").toLowerCase();

  const createBatchMaterial = (transparent) =>
    new THREE.MeshLambertMaterial({
      color: 0xffffff,
      emissive: 0x000000,
      emissiveIntensity: 1,
      transparent,
      opacity: 1,
      depthWrite: !transparent,
      side: THREE.DoubleSide
    });

  const buildBatchedMeshes = (placements, geometryCache) => {
    const opaquePlacements = [];
    const transparentPlacements = [];

    for (const placement of placements) {
      if (placement.opacity < 0.999) transparentPlacements.push(placement);
      else opaquePlacements.push(placement);
    }

    const batches = [];
    const entities = [];

    const buildOneBatch = (batchPlacements, transparent) => {
      if (batchPlacements.length === 0) return;

      const uniqueGeometries = new Map();
      let maxVertexCount = 0;
      let maxIndexCount = 0;

      for (const placement of batchPlacements) {
        if (uniqueGeometries.has(placement.geometryKey)) continue;
        const geometry = geometryCache.get(placement.geometryKey);
        if (!geometry) continue;
        uniqueGeometries.set(placement.geometryKey, geometry);
        maxVertexCount += geometry.getAttribute("position").count;
        maxIndexCount += geometry.getIndex()?.count ?? geometry.getAttribute("position").count;
      }

      if (uniqueGeometries.size === 0) return;

      const batch = new THREE.BatchedMesh(
        batchPlacements.length,
        Math.max(1, maxVertexCount),
        Math.max(1, maxIndexCount),
        createBatchMaterial(transparent)
      );
      batch.perObjectFrustumCulled = true;
      batch.frustumCulled = true;
      batch.userData.entityByInstanceId = new Map();
      batch.userData.transparent = transparent;

      const geometryIdByKey = new Map();
      for (const [geometryKey, geometry] of uniqueGeometries) {
        geometryIdByKey.set(geometryKey, batch.addGeometry(geometry));
      }

      const matrix = new THREE.Matrix4();
      const color4 = new THREE.Vector4();

      for (const placement of batchPlacements) {
        const geometryId = geometryIdByKey.get(placement.geometryKey);
        if (geometryId == null) continue;

        const instanceId = batch.addInstance(geometryId);
        matrix.fromArray(placement.flatTransformation);
        batch.setMatrixAt(instanceId, matrix);
        color4.set(placement.color.r, placement.color.g, placement.color.b, placement.opacity);
        batch.setColorAt(instanceId, color4);

        const entity = {
          batch,
          instanceId,
          expressID: placement.expressID,
          geometryExpressID: placement.geometryExpressID,
          typeId: placement.typeId,
          typeName: placement.typeName,
          objectType: placement.objectType,
          name: placement.name,
          discipline: placement.discipline,
          sourceFile: placement.sourceFile,
          modelId: placement.modelId,
          baseColor: { ...placement.color },
          baseOpacity: placement.opacity,
          layerId: null,
          layerName: null,
          layerVisible: true,
          layerOpacity: 1,
          isolationVisible: true,
          isolationOpacity: 1,
          isolationDim: 1,
          highlightColor: null
        };

        batch.userData.entityByInstanceId.set(instanceId, entity);
        entities.push(entity);
      }

      batch.computeBoundingBox();
      batch.computeBoundingSphere();
      batches.push(batch);
    };

    buildOneBatch(opaquePlacements, false);
    buildOneBatch(transparentPlacements, true);
    return { batches, entities };
  };

  const openIfcModel = (data, fileName) => {
    const modelId = ifcApi.OpenModel(data, { COORDINATE_TO_ORIGIN: true });
    if (modelId < 0) {
      throw new Error(`OpenModel blad dla pliku: ${fileName}`);
    }
    openModelIds.push(modelId);
    return modelId;
  };

  const readProjectName = (modelId) => {
    let projectName = "Nie znaleziono IfcProject";
    const projectLines = ifcApi.GetLineIDsWithType(modelId, IFC_TYPE_IDS.IFCPROJECT);
    if (projectLines.size() > 0) {
      const projectData = ifcApi.GetLine(modelId, projectLines.get(0));
      projectName = projectData?.Name?.value ?? projectName;
    }
    return projectName;
  };

  const parseFilePlacements = (file, modelId, aggregates, allPlacements, geometryCache) => {
    const systemHints = buildElementSystemHints(ifcApi, modelId);
    const fileHint = guessHintFromFileName(file.name);
    let meshesFromFile = 0;

    ifcApi.StreamAllMeshes(modelId, (mesh) => {
      const elementId = mesh.expressID;
      const elementKey = `${file.name}:${elementId}`;
      aggregates.elementCounts.set(elementKey, (aggregates.elementCounts.get(elementKey) ?? 0) + 1);

      const elementTypeId = ifcApi.GetLineType(modelId, elementId);
      const elementTypeName = ifcApi.GetNameFromTypeCode(elementTypeId) || "UNKNOWN";

      let elementLine = null;
      try {
        elementLine = ifcApi.GetLine(modelId, elementId, true);
      } catch {
        elementLine = null;
      }

      const discipline = resolveDiscipline({
        typeId: elementTypeId,
        line: elementLine,
        systemHint: [systemHints.get(elementId) ?? "", fileHint].filter(Boolean).join(" ")
      });

      for (let i = 0; i < mesh.geometries.size(); i += 1) {
        const placedGeometry = mesh.geometries.get(i);
        const geometryId = placedGeometry.geometryExpressID;
        const geometryKey = `${modelId}:${geometryId}`;
        aggregates.geometryCounts.set(geometryKey, (aggregates.geometryCounts.get(geometryKey) ?? 0) + 1);

        const geometry = extractBufferGeometry(modelId, geometryId, geometryCache);
        if (!geometry) continue;

        const r = placedGeometry.color?.x ?? 0.75;
        const g = placedGeometry.color?.y ?? 0.75;
        const b = placedGeometry.color?.z ?? 0.75;
        const a = placedGeometry.color?.w ?? 1;

        allPlacements.push({
          geometryKey,
          flatTransformation: placedGeometry.flatTransformation,
          color: { r, g, b },
          opacity: a,
          expressID: elementId,
          geometryExpressID: geometryId,
          typeId: elementTypeId,
          typeName: elementTypeName,
          objectType: elementLine?.ObjectType?.value ?? elementLine?.ObjectType ?? null,
          name: elementLine?.Name?.value ?? elementLine?.Name ?? null,
          discipline,
          sourceFile: file.name,
          modelId
        });

        aggregates.disciplineCounts[discipline] += 1;
        meshesFromFile += 1;
      }
    });

    return meshesFromFile;
  };

  const applyCachedPlacementsToAggregates = (placements, fileName, aggregates) => {
    for (const placement of placements) {
      const elementKey = `${fileName}:${placement.expressID}`;
      aggregates.elementCounts.set(elementKey, (aggregates.elementCounts.get(elementKey) ?? 0) + 1);
      aggregates.geometryCounts.set(
        placement.geometryKey,
        (aggregates.geometryCounts.get(placement.geometryKey) ?? 0) + 1
      );
      aggregates.disciplineCounts[placement.discipline] =
        (aggregates.disciplineCounts[placement.discipline] ?? 0) + 1;
    }
  };

  const loadSingleFilePlacements = async (file, aggregates, allPlacements, geometryCache) => {
    const buffer = await file.arrayBuffer();
    const data = new Uint8Array(buffer);
    const cacheKey = await buildFileCacheKey(file, data);
    const cached = await getCachedProcessedFile(cacheKey);

    if (
      cached?.schemaVersion === IFC_CACHE_SCHEMA_VERSION &&
      cached?.placements?.length &&
      cached?.geometries
    ) {
      const modelId = openIfcModel(data, file.name);
      hydrateGeometryCache(cached.geometries, modelId, geometryCache);
      const placements = rebuildPlacementsFromCache(cached.placements, file.name, modelId);
      allPlacements.push(...placements);
      applyCachedPlacementsToAggregates(placements, file.name, aggregates);

      return {
        fileName: file.name,
        projectName: cached.projectName || readProjectName(modelId),
        meshCount: placements.length,
        modelId,
        cache: "hit",
        cacheKey
      };
    }

    const modelId = openIfcModel(data, file.name);
    const projectName = readProjectName(modelId);
    const meshCount = parseFilePlacements(file, modelId, aggregates, allPlacements, geometryCache);

    // Fire-and-forget persist; load should not wait on IndexedDB write.
    void setCachedProcessedFile({
      key: cacheKey,
      fileName: file.name,
      projectName,
      placements: serializePlacements(allPlacements),
      geometries: serializeGeometries(geometryCache, allPlacements)
    });

    return {
      fileName: file.name,
      projectName,
      meshCount,
      modelId,
      cache: "miss",
      cacheKey
    };
  };

  const loadFilesIntoGroup = async (files, targetGroup) => {
    if (!initialized || !ifcApi) {
      throw new Error("web-ifc nie zostalo zainicjalizowane. Sprobuj odswiezyc strone.");
    }

    const fileList = Array.from(files || []).filter(Boolean);
    if (fileList.length === 0) {
      throw new Error("Nie wybrano zadnych plikow IFC.");
    }

    closeAllModels();

    const aggregates = {
      geometryCounts: new Map(),
      elementCounts: new Map(),
      disciplineCounts: Object.fromEntries(ALL_DISCIPLINES.map((discipline) => [discipline, 0]))
    };

    const geometryCache = new Map();
    const allEntities = [];
    const allBatches = [];
    const fileGroups = [];
    const fileReports = [];

    for (const file of fileList) {
      const filePlacements = [];
      const report = await loadSingleFilePlacements(file, aggregates, filePlacements, geometryCache);
      fileReports.push(report);

      if (filePlacements.length === 0) continue;

      const { batches, entities } = buildBatchedMeshes(filePlacements, geometryCache);
      const fileGroup = new THREE.Group();
      fileGroup.name = file.name;
      fileGroup.userData.sourceFile = file.name;
      fileGroup.userData.isFileGroup = true;

      for (const batch of batches) {
        batch.userData.sourceFile = file.name;
        fileGroup.add(batch);
        allBatches.push(batch);
      }

      allEntities.push(...entities);
      targetGroup.add(fileGroup);
      fileGroups.push({
        name: file.name,
        group: fileGroup,
        transform: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 },
        meshCount: entities.length
      });
    }

    for (const cached of geometryCache.values()) {
      cached?.dispose?.();
    }

    if (allEntities.length === 0) {
      throw new Error("Pliki IFC zostaly otwarte, ale nie zawieraja geometrii 3D do wyrenderowania.");
    }

    targetGroup.userData.entities = allEntities;
    targetGroup.userData.batches = allBatches;
    targetGroup.userData.fileGroups = fileGroups;
    targetGroup.updateMatrixWorld(true);

    const duplicateReport = buildDuplicateReport(aggregates.geometryCounts, aggregates.elementCounts);
    const cacheHits = fileReports.filter((report) => report.cache === "hit").length;
    const cacheMisses = fileReports.filter((report) => report.cache === "miss").length;
    const summary = [
      `Wczytane pliki: ${fileReports.length}`,
      ...fileReports.map(
        (report, index) =>
          `${index + 1}. ${report.fileName} | projekt: ${report.projectName} | meshy: ${report.meshCount} | cache: ${report.cache}`
      ),
      `Cache geometrii: ${cacheHits} hit / ${cacheMisses} miss`,
      `Elementy 3D (suma): ${allEntities.length}`,
      `Draw calle (BatchedMesh): ${allBatches.length}`,
      `Grupy plikow (do wyrównania): ${fileGroups.length}`,
      `Unikalne geometrie: ${aggregates.geometryCounts.size}`,
      `Duplikaty geometrii (ID): ${duplicateReport.duplicateGeometryCount}`,
      `Instancje geometrii (powtorzenia): ${duplicateReport.duplicateGeometryInstances}`,
      `Duplikaty elementow (ExpressID/plik): ${duplicateReport.duplicateElementsCount}`,
      ...Object.entries(aggregates.disciplineCounts).map(([name, count]) => `${name}: ${count}`)
    ].join("\n");

    return {
      summary,
      disciplineCounts: aggregates.disciplineCounts,
      fileReports,
      fileGroups,
      cacheStats: { hits: cacheHits, misses: cacheMisses }
    };
  };

  // Single-file helper kept for compatibility.
  const loadIntoGroup = async (file, targetGroup) => loadFilesIntoGroup([file], targetGroup);

  const getElementMaterialNodes = async (modelId, expressID) => {
    if (!initialized || !ifcApi || modelId == null || expressID == null) return [];
    try {
      const fromElement = await ifcApi.properties.getMaterialsProperties(modelId, expressID, true, false);
      const fromType = await ifcApi.properties.getMaterialsProperties(modelId, expressID, true, true);
      return [...(fromElement || []), ...(fromType || [])];
    } catch {
      return [];
    }
  };

  const getElementMaterialsLabel = async (modelId, expressID) => {
    const nodes = await getElementMaterialNodes(modelId, expressID);
    return formatMaterialsLabel(nodes);
  };

  const getElementQuantityPsets = async (modelId, expressID) => {
    if (!initialized || !ifcApi || modelId == null || expressID == null) return [];
    try {
      const fromElement = await ifcApi.properties.getPropertySets(modelId, expressID, true, false);
      let fromType = [];
      try {
        fromType = await ifcApi.properties.getPropertySets(modelId, expressID, true, true);
      } catch {
        fromType = [];
      }
      return [...(fromElement || []), ...(fromType || [])];
    } catch {
      return [];
    }
  };

  const buildProjectMaterialTakeoff = async (entities) => {
    if (!initialized || !ifcApi) {
      throw new Error("web-ifc nie zostalo zainicjalizowane.");
    }
    return buildMaterialTakeoffReport({
      entities,
      getMaterialsNodes: getElementMaterialNodes,
      getQuantityPsets: getElementQuantityPsets
    });
  };

  return {
    init,
    closeCurrentModel,
    closeAllModels,
    loadIntoGroup,
    loadFilesIntoGroup,
    getElementMaterialsLabel,
    buildProjectMaterialTakeoff
  };
};
