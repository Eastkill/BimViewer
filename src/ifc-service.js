import * as THREE from "three";
import { IFC_TYPE_IDS } from "./constants.js";
import { ALL_DISCIPLINES, buildElementSystemHints, resolveDiscipline } from "./disciplines.js";

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
    geometryCache.set(cacheKey, geometry);
    return geometry;
  };

  const createMeshFromIfcGeometry = (modelId, flatTransformation, geometryId, color, geometryCache) => {
    const geometry = extractBufferGeometry(modelId, geometryId, geometryCache);
    if (!geometry) return null;

    const r = color?.x ?? 0.75;
    const g = color?.y ?? 0.75;
    const b = color?.z ?? 0.75;
    const a = color?.w ?? 1;

    const material = new THREE.MeshLambertMaterial({
      color: new THREE.Color(r, g, b),
      emissive: new THREE.Color(0x000000),
      emissiveIntensity: 1,
      transparent: a < 0.999,
      opacity: a,
      side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(geometry.clone(), material);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.fromArray(flatTransformation);
    mesh.updateMatrixWorld(true);
    return mesh;
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

  const guessHintFromFileName = (fileName) => {
    const name = String(fileName || "").toLowerCase();
    return name;
  };

  const loadSingleFileIntoGroup = async (file, targetGroup, aggregates) => {
    const buffer = await file.arrayBuffer();
    const data = new Uint8Array(buffer);
    const modelId = ifcApi.OpenModel(data, { COORDINATE_TO_ORIGIN: true });
    if (modelId < 0) {
      throw new Error(`OpenModel blad dla pliku: ${file.name}`);
    }

    openModelIds.push(modelId);
    const geometryCache = new Map();
    const systemHints = buildElementSystemHints(ifcApi, modelId);
    const fileHint = guessHintFromFileName(file.name);
    let meshesFromFile = 0;
    let projectName = "Nie znaleziono IfcProject";

    const projectLines = ifcApi.GetLineIDsWithType(modelId, IFC_TYPE_IDS.IFCPROJECT);
    if (projectLines.size() > 0) {
      const projectData = ifcApi.GetLine(modelId, projectLines.get(0));
      projectName = projectData?.Name?.value ?? projectName;
    }

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

        const modelMesh = createMeshFromIfcGeometry(
          modelId,
          placedGeometry.flatTransformation,
          geometryId,
          placedGeometry.color,
          geometryCache
        );

        if (!modelMesh) continue;
        modelMesh.userData.expressID = elementId;
        modelMesh.userData.geometryExpressID = geometryId;
        modelMesh.userData.typeId = elementTypeId;
        modelMesh.userData.typeName = elementTypeName;
        modelMesh.userData.objectType = elementLine?.ObjectType?.value ?? elementLine?.ObjectType ?? null;
        modelMesh.userData.name = elementLine?.Name?.value ?? elementLine?.Name ?? null;
        modelMesh.userData.discipline = discipline;
        modelMesh.userData.sourceFile = file.name;
        modelMesh.userData.modelId = modelId;
        aggregates.disciplineCounts[discipline] += 1;
        meshesFromFile += 1;
        targetGroup.add(modelMesh);
      }
    });

    for (const cached of geometryCache.values()) {
      cached?.dispose?.();
    }

    return {
      fileName: file.name,
      projectName,
      meshCount: meshesFromFile,
      modelId
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

    const fileReports = [];
    for (const file of fileList) {
      const report = await loadSingleFileIntoGroup(file, targetGroup, aggregates);
      fileReports.push(report);
    }

    targetGroup.updateMatrixWorld(true);

    if (targetGroup.children.length === 0) {
      throw new Error("Pliki IFC zostaly otwarte, ale nie zawieraja geometrii 3D do wyrenderowania.");
    }

    const duplicateReport = buildDuplicateReport(aggregates.geometryCounts, aggregates.elementCounts);
    const summary = [
      `Wczytane pliki: ${fileReports.length}`,
      ...fileReports.map(
        (report, index) =>
          `${index + 1}. ${report.fileName} | projekt: ${report.projectName} | meshy: ${report.meshCount}`
      ),
      `Meshy 3D (suma): ${targetGroup.children.length}`,
      `Duplikaty geometrii (ID): ${duplicateReport.duplicateGeometryCount}`,
      `Instancje geometrii (powtorzenia): ${duplicateReport.duplicateGeometryInstances}`,
      `Duplikaty elementow (ExpressID/plik): ${duplicateReport.duplicateElementsCount}`,
      ...Object.entries(aggregates.disciplineCounts).map(([name, count]) => `${name}: ${count}`)
    ].join("\n");

    return {
      summary,
      disciplineCounts: aggregates.disciplineCounts,
      fileReports
    };
  };

  // Single-file helper kept for compatibility.
  const loadIntoGroup = async (file, targetGroup) => loadFilesIntoGroup([file], targetGroup);

  return {
    init,
    closeCurrentModel,
    closeAllModels,
    loadIntoGroup,
    loadFilesIntoGroup
  };
};
