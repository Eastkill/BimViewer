import * as THREE from "three";

const IFC_MATERIAL = 1838606355;
const IFC_MATERIAL_LAYER = 248100487;
const IFC_MATERIAL_LAYER_SET = 3303938423;
const IFC_MATERIAL_LAYER_SET_USAGE = 1303795690;
const IFC_MATERIAL_LIST = 2199411900;
const IFC_MATERIAL_CONSTITUENT = 3708119000;
const IFC_MATERIAL_CONSTITUENT_SET = 2852063980;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _cross = new THREE.Vector3();
const _matrix = new THREE.Matrix4();
const _world = new THREE.Matrix4();

const readValue = (value) => {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  if (typeof value?.value === "number" && Number.isFinite(value.value)) return value.value;
  if (typeof value?.value === "string" && value.value.trim() !== "" && !Number.isNaN(Number(value.value))) {
    return Number(value.value);
  }
  return null;
};

const readLabel = (value) => {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number") return String(value).trim() || null;
  if (typeof value?.value === "string" || typeof value?.value === "number") {
    return String(value.value).trim() || null;
  }
  return null;
};

const typeOf = (node) => Number(node?.type) || 0;
const typeNameOf = (node) => String(node?.constructor?.name || "");

const UNKNOWN_MATERIAL = "Brak / nieprzypisany";

/**
 * Extract material parts with optional thickness from IFC material definitions.
 * @returns {{ name: string, thickness: number|null }[]}
 */
export const extractMaterialParts = (nodes, parts = [], seen = new Set()) => {
  for (const node of nodes || []) {
    if (!node || typeof node !== "object") continue;
    const id = node.expressID;
    if (id != null) {
      if (seen.has(id)) continue;
      seen.add(id);
    }

    const type = typeOf(node);
    const typeName = typeNameOf(node);

    if (type === IFC_MATERIAL_LAYER_SET_USAGE || typeName === "IfcMaterialLayerSetUsage") {
      extractMaterialParts([node.ForLayerSet], parts, seen);
      continue;
    }

    if (type === IFC_MATERIAL_LAYER_SET || typeName === "IfcMaterialLayerSet") {
      extractMaterialParts(node.MaterialLayers || [], parts, seen);
      continue;
    }

    if (type === IFC_MATERIAL_LAYER || typeName === "IfcMaterialLayer") {
      const name = readLabel(node.Material?.Name) || readLabel(node.Name) || UNKNOWN_MATERIAL;
      parts.push({ name, thickness: readValue(node.LayerThickness) });
      continue;
    }

    if (type === IFC_MATERIAL_LIST || typeName === "IfcMaterialList") {
      extractMaterialParts(node.Materials || [], parts, seen);
      continue;
    }

    if (type === IFC_MATERIAL_CONSTITUENT_SET || typeName === "IfcMaterialConstituentSet") {
      extractMaterialParts(node.MaterialConstituents || [], parts, seen);
      continue;
    }

    if (type === IFC_MATERIAL_CONSTITUENT || typeName === "IfcMaterialConstituent") {
      const name = readLabel(node.Material?.Name) || readLabel(node.Name) || UNKNOWN_MATERIAL;
      parts.push({ name, thickness: null });
      continue;
    }

    if (type === IFC_MATERIAL || typeName === "IfcMaterial") {
      parts.push({
        name: readLabel(node.Name) || readLabel(node.Category) || UNKNOWN_MATERIAL,
        thickness: null
      });
      continue;
    }

    // Fallback: recurse common nested fields
    extractMaterialParts(
      [
        ...(Array.isArray(node.Materials) ? node.Materials : []),
        ...(Array.isArray(node.MaterialLayers) ? node.MaterialLayers : []),
        ...(Array.isArray(node.MaterialConstituents) ? node.MaterialConstituents : []),
        node.ForLayerSet,
        node.Material
      ].filter(Boolean),
      parts,
      seen
    );
  }

  return parts;
};

const PROPERTY_VOLUME_NAMES = [
  "netvolume",
  "grossvolume",
  "volume",
  "nominalvolume",
  "outervolume"
];

const PROPERTY_AREA_NAMES = [
  "netsidearea",
  "grosssidearea",
  "netarea",
  "grossarea",
  "area",
  "nominalarea",
  "netfloorarea",
  "grossfloorarea"
];

const normalizePropName = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");

export const extractQuantitiesFromPsets = (psets = []) => {
  let volume = null;
  let volumeName = null;
  let area = null;
  let areaName = null;

  for (const pset of psets) {
    const props = pset?.HasProperties || pset?.Quantities || pset?.Properties || [];
    if (!Array.isArray(props)) continue;

    for (const prop of props) {
      const name = normalizePropName(readLabel(prop?.Name));
      const numeric =
        readValue(prop?.NominalValue) ??
        readValue(prop?.LengthValue) ??
        readValue(prop?.AreaValue) ??
        readValue(prop?.VolumeValue) ??
        readValue(prop?.value);

      if (numeric == null || !(numeric > 0)) continue;

      if (volume == null && PROPERTY_VOLUME_NAMES.some((key) => name.includes(key) || name === key)) {
        volume = numeric;
        volumeName = readLabel(prop?.Name) || name;
      }
      if (area == null && PROPERTY_AREA_NAMES.some((key) => name.includes(key) || name === key)) {
        area = numeric;
        areaName = readLabel(prop?.Name) || name;
      }
    }
  }

  return { volume, volumeName, area, areaName };
};

/**
 * Signed mesh volume in world units (typically meters^3 after IFC origin mapping).
 */
export const computeEntityMeshVolume = (entity) => {
  const { batch, instanceId } = entity || {};
  if (!batch || instanceId == null) return 0;

  const geometryId = batch.getGeometryIdAt(instanceId);
  const range = batch.getGeometryRangeAt(geometryId);
  if (!range) return 0;

  const geometry = batch.geometry;
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  if (!position) return 0;

  batch.getMatrixAt(instanceId, _matrix);
  _world.copy(batch.matrixWorld).multiply(_matrix);

  let volume = 0;
  const start = range.start;
  const count = range.count;

  const readVertex = (vertexIndex, target) => {
    target.fromBufferAttribute(position, vertexIndex).applyMatrix4(_world);
  };

  if (index) {
    for (let i = start; i < start + count; i += 3) {
      readVertex(index.getX(i), _a);
      readVertex(index.getX(i + 1), _b);
      readVertex(index.getX(i + 2), _c);
      volume += _a.dot(_cross.crossVectors(_b, _c)) / 6;
    }
  } else {
    for (let i = start; i < start + count; i += 3) {
      readVertex(i, _a);
      readVertex(i + 1, _b);
      readVertex(i + 2, _c);
      volume += _a.dot(_cross.crossVectors(_b, _c)) / 6;
    }
  }

  return Math.abs(volume);
};

const addVolume = (totals, name, volumeM3, meta) => {
  if (!(volumeM3 > 0)) return;
  const key = name || UNKNOWN_MATERIAL;
  const row = totals.get(key) || {
    material: key,
    volumeM3: 0,
    elementCount: 0,
    sources: new Set(),
    notes: new Set()
  };
  row.volumeM3 += volumeM3;
  row.elementCount += 1;
  if (meta?.source) row.sources.add(meta.source);
  if (meta?.note) row.notes.add(meta.note);
  totals.set(key, row);
};

/**
 * Allocate element volume/area across material parts.
 */
export const allocateElementMaterials = ({ parts, volume, area }) => {
  const allocations = [];
  const cleanParts = (parts || []).filter((part) => part?.name);
  if (!cleanParts.length) {
    if (volume > 0) allocations.push({ name: UNKNOWN_MATERIAL, volume, source: "geometria", note: "brak materiału w IFC" });
    return allocations;
  }

  const layered = cleanParts.filter((part) => part.thickness != null && part.thickness > 0);
  if (layered.length && area != null && area > 0) {
    for (const part of layered) {
      allocations.push({
        name: part.name,
        volume: area * part.thickness,
        source: "warstwa × powierzchnia IFC/estymacja",
        note: `grubość ${part.thickness}`
      });
    }
    // Parts without thickness get remaining mesh volume share if any leftover single materials
    const plain = cleanParts.filter((part) => !(part.thickness != null && part.thickness > 0));
    if (plain.length && volume > 0) {
      const share = volume / plain.length;
      for (const part of plain) {
        allocations.push({
          name: part.name,
          volume: share,
          source: "objętość / liczba materiałów",
          note: "bez grubości warstwy"
        });
      }
    }
    return allocations;
  }

  if (layered.length && volume > 0) {
    const totalThickness = layered.reduce((sum, part) => sum + part.thickness, 0);
    if (totalThickness > 0) {
      for (const part of layered) {
        allocations.push({
          name: part.name,
          volume: volume * (part.thickness / totalThickness),
          source: "objętość × udział grubości",
          note: `grubość ${part.thickness}`
        });
      }
      return allocations;
    }
  }

  // No usable thicknesses — split volume equally
  if (volume > 0) {
    const share = volume / cleanParts.length;
    for (const part of cleanParts) {
      allocations.push({
        name: part.name,
        volume: share,
        source: cleanParts.length > 1 ? "objętość / liczba materiałów" : "objętość elementu",
        note: part.thickness != null ? `grubość ${part.thickness}` : "bez grubości"
      });
    }
  }

  return allocations;
};

export const buildMaterialTakeoffReport = async ({ entities, getMaterialsNodes, getQuantityPsets }) => {
  const byElement = new Map();

  for (const entity of entities || []) {
    if (entity?.modelId == null || entity?.expressID == null) continue;
    const key = `${entity.modelId}:${entity.expressID}`;
    const group = byElement.get(key) || {
      modelId: entity.modelId,
      expressID: entity.expressID,
      sourceFile: entity.sourceFile,
      typeName: entity.typeName,
      name: entity.name,
      meshVolume: 0
    };
    group.meshVolume += computeEntityMeshVolume(entity);
    byElement.set(key, group);
  }

  const totals = new Map();
  let elementsWithMaterials = 0;
  let elementsFromQto = 0;
  let elementsFromGeometry = 0;

  for (const element of byElement.values()) {
    const [materialNodes, psets] = await Promise.all([
      getMaterialsNodes(element.modelId, element.expressID),
      getQuantityPsets(element.modelId, element.expressID)
    ]);

    const parts = extractMaterialParts(materialNodes);
    const quantities = extractQuantitiesFromPsets(psets);

    let volume = quantities.volume;
    let area = quantities.area;
    let volumeSource = quantities.volume != null ? `IFC (${quantities.volumeName})` : null;

    if (!(volume > 0) && element.meshVolume > 0) {
      volume = element.meshVolume;
      volumeSource = "geometria 3D";
      elementsFromGeometry += 1;
    } else if (volume > 0) {
      elementsFromQto += 1;
    }

    // Approximate side area from volume / total thickness when missing
    if (!(area > 0) && parts.some((part) => part.thickness > 0) && volume > 0) {
      const totalThickness = parts.reduce((sum, part) => sum + (part.thickness > 0 ? part.thickness : 0), 0);
      if (totalThickness > 0) {
        area = volume / totalThickness;
      }
    }

    if (parts.length) elementsWithMaterials += 1;

    const allocations = allocateElementMaterials({ parts, volume: volume || 0, area });
    for (const item of allocations) {
      addVolume(totals, item.name, item.volume, {
        source: item.source || volumeSource || "estymacja",
        note: item.note
      });
    }
  }

  const rows = [...totals.values()]
    .map((row) => ({
      material: row.material,
      volumeM3: row.volumeM3,
      elementCount: row.elementCount,
      sources: [...row.sources],
      notes: [...row.notes]
    }))
    .sort((a, b) => b.volumeM3 - a.volumeM3);

  const totalVolume = rows.reduce((sum, row) => sum + row.volumeM3, 0);

  return {
    rows,
    totalVolumeM3: totalVolume,
    elementCount: byElement.size,
    elementsWithMaterials,
    elementsFromQto,
    elementsFromGeometry,
    generatedAt: new Date().toISOString()
  };
};

export const formatVolume = (value) => {
  if (!(value > 0)) return "0";
  if (value >= 100) return value.toFixed(1);
  if (value >= 1) return value.toFixed(2);
  if (value >= 0.01) return value.toFixed(3);
  return value.toExponential(2);
};
