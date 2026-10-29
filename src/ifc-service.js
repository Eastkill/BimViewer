import * as THREE from "three";
import { IFC_TYPE_IDS } from "./constants.js";
import { ALL_DISCIPLINES, getDisciplineForType } from "./disciplines.js";

export const createIfcService = () => {
  let ifcApi = null;
  let initialized = false;
  let currentModelId = null;

  const init = async () => {
    if (initialized) return;
    const { IfcAPI } = await import("web-ifc");
    ifcApi = new IfcAPI();

    // Prefer local WASM served by Vite from /public/wasm
    const localWasmPath = `${import.meta.env.BASE_URL}wasm/`;
    try {
      await ifcApi.SetWasmPath(localWasmPath, true);
      await ifcApi.Init();
    } catch (localError) {
      // Fallback to CDN if local wasm is missing
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

  const closeCurrentModel = () => {
    if (currentModelId === null || !ifcApi) return;
    ifcApi.CloseModel(currentModelId);
    currentModelId = null;
  };

  const extractBufferGeometry = (modelId, geometryId, geometryCache) => {
    if (geometryCache.has(geometryId)) {
      return geometryCache.get(geometryId);
    }

    const ifcGeometry = ifcApi.GetGeometry(modelId, geometryId);
    if (!ifcGeometry) {
      geometryCache.set(geometryId, null);
      return null;
    }

    // Copy out of WASM memory before delete — shared geometryExpressID is reused across placements.
    const vertexData = Float32Array.from(
      ifcApi.GetVertexArray(ifcGeometry.GetVertexData(), ifcGeometry.GetVertexDataSize())
    );
    const indexData = Uint32Array.from(
      ifcApi.GetIndexArray(ifcGeometry.GetIndexData(), ifcGeometry.GetIndexDataSize())
    );
    ifcGeometry.delete();

    if (!vertexData.length || !indexData.length) {
      geometryCache.set(geometryId, null);
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
    geometryCache.set(geometryId, geometry);
    return geometry;
  };

  const createMeshFromIfcGeometry = (modelId, flatTransformation, geometryId, color, geometryCache) => {
    const geometry = extractBufferGeometry(modelId, geometryId, geometryCache);
    if (!geometry) return null;

    const r = color?.x ?? 0.75;
    const g = color?.y ?? 0.75;
    const b = color?.z ?? 0.75;
    const a = color?.w ?? 1;

    // MeshLambertMaterial is reliably visible in WebGPURenderer with classic materials.
    const material = new THREE.MeshLambertMaterial({
      color: new THREE.Color(r, g, b),
      emissive: new THREE.Color(0x000000),
      emissiveIntensity: 1,
      transparent: a < 0.999,
      opacity: a,
      side: THREE.DoubleSide
    });

    // Clone so disposing one mesh does not destroy shared BufferGeometry used by other instances.
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

  const readIfcSummary = (modelId, meshCount, duplicateReport, fileName, disciplineCounts) => {
    const projectLines = ifcApi.GetLineIDsWithType(modelId, IFC_TYPE_IDS.IFCPROJECT);
    const wallLines = ifcApi.GetLineIDsWithType(modelId, IFC_TYPE_IDS.IFCWALL);
    const slabLines = ifcApi.GetLineIDsWithType(modelId, IFC_TYPE_IDS.IFCSLAB);
    const doorLines = ifcApi.GetLineIDsWithType(modelId, IFC_TYPE_IDS.IFCDOOR);

    let projectName = "Nie znaleziono IfcProject";
    if (projectLines.size() > 0) {
      const firstProjectId = projectLines.get(0);
      const projectData = ifcApi.GetLine(modelId, firstProjectId);
      projectName = projectData?.Name?.value ?? projectName;
    }

    return [
      `Plik: ${fileName}`,
      `Nazwa projektu: ${projectName}`,
      `IfcProject: ${projectLines.size()}`,
      `IfcWall: ${wallLines.size()}`,
      `IfcSlab: ${slabLines.size()}`,
      `IfcDoor: ${doorLines.size()}`,
      `Meshy 3D: ${meshCount}`,
      `Duplikaty geometrii (ID): ${duplicateReport.duplicateGeometryCount}`,
      `Instancje geometrii (powtorzenia): ${duplicateReport.duplicateGeometryInstances}`,
      `Duplikaty elementow (ExpressID): ${duplicateReport.duplicateElementsCount}`,
      ...Object.entries(disciplineCounts).map(([name, count]) => `${name}: ${count}`)
    ].join("\n");
  };

  const loadIntoGroup = async (file, targetGroup) => {
    if (!initialized || !ifcApi) {
      throw new Error("web-ifc nie zostalo zainicjalizowane. Sprobuj odswiezyc strone.");
    }

    const buffer = await file.arrayBuffer();
    const data = new Uint8Array(buffer);

    closeCurrentModel();

    const modelId = ifcApi.OpenModel(data, { COORDINATE_TO_ORIGIN: true });
    if (modelId < 0) {
      throw new Error("OpenModel zwrocil blad - plik IFC jest niepoprawny lub nieobslugiwany.");
    }

    currentModelId = modelId;
    const geometryCounts = new Map();
    const elementCounts = new Map();
    const geometryCache = new Map();
    const disciplineCounts = Object.fromEntries(ALL_DISCIPLINES.map((discipline) => [discipline, 0]));

    ifcApi.StreamAllMeshes(modelId, (mesh) => {
      const elementId = mesh.expressID;
      elementCounts.set(elementId, (elementCounts.get(elementId) ?? 0) + 1);
      const elementTypeId = ifcApi.GetLineType(modelId, elementId);
      const discipline = getDisciplineForType(elementTypeId);

      for (let i = 0; i < mesh.geometries.size(); i += 1) {
        const placedGeometry = mesh.geometries.get(i);
        const geometryId = placedGeometry.geometryExpressID;
        geometryCounts.set(geometryId, (geometryCounts.get(geometryId) ?? 0) + 1);

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
        modelMesh.userData.discipline = discipline;
        disciplineCounts[discipline] += 1;
        targetGroup.add(modelMesh);
      }
    });

    // Cached templates are no longer needed after meshes cloned their own geometry.
    for (const cached of geometryCache.values()) {
      cached?.dispose?.();
    }
    geometryCache.clear();

    targetGroup.updateMatrixWorld(true);

    if (targetGroup.children.length === 0) {
      throw new Error("Model IFC zostal otwarty, ale nie zawiera geometrii 3D do wyrenderowania.");
    }

    const duplicateReport = buildDuplicateReport(geometryCounts, elementCounts);
    return {
      summary: readIfcSummary(modelId, targetGroup.children.length, duplicateReport, file.name, disciplineCounts),
      disciplineCounts
    };
  };

  return {
    init,
    closeCurrentModel,
    loadIntoGroup
  };
};
