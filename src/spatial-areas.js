import * as THREE from "three";
import {
  computeEntityOneSidedSurfaceArea,
  getEntityWorldBox
} from "./entities.js";
import { extractQuantitiesFromPsets } from "./material-takeoff.js";

const IFCBUILDINGSTOREY = 3124254112;
const IFCRELCONTAINEDINSPATIALSTRUCTURE = 3242617779;
const IFCRELAGGREGATES = 160246688;
const IFCSPACE = 3856911033;
const IFCSLAB = 1529196076;
const IFCSLABSTANDARDCASE = 3027962421;
const IFCWALL = 2391406946;
const IFCWALLSTANDARDCASE = 3512223829;
const IFCUNITASSIGNMENT = 180925521;
const IFCSIUNIT = 448429030;

const _size = new THREE.Vector3();

const EXCLUDED_SLAB_TYPES = new Set(["ROOF", "BASESLAB", "LANDING", "APPROACH_SLAB"]);

const readLabel = (value) => {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number") return String(value).trim() || null;
  if (typeof value?.value === "string" || typeof value?.value === "number") {
    return String(value.value).trim() || null;
  }
  return null;
};

const readNumber = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value?.value === "number" && Number.isFinite(value.value)) return value.value;
  return null;
};

const readEnum = (value) => {
  const raw = readLabel(value);
  if (!raw) return null;
  return raw.replace(/^\./, "").replace(/\.$/, "").toUpperCase();
};

const isWallType = (typeName, typeId) =>
  typeId === IFCWALL ||
  typeId === IFCWALLSTANDARDCASE ||
  typeName === "IFCWALL" ||
  typeName === "IFCWALLSTANDARDCASE";

const isSlabType = (typeName, typeId) =>
  typeId === IFCSLAB ||
  typeId === IFCSLABSTANDARDCASE ||
  typeName === "IFCSLAB" ||
  typeName === "IFCSLABSTANDARDCASE";

const storeyMergeKey = (name, elevation) => {
  const elev = Number.isFinite(elevation) ? elevation.toFixed(3) : "na";
  const normalized = String(name || "Bez kondygnacji")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return `${normalized}|${elev}`;
};

const readAreaUnitNote = (ifcApi, modelId) => {
  try {
    const assignmentIds = ifcApi.GetLineIDsWithType(modelId, IFCUNITASSIGNMENT);
    if (!assignmentIds.size()) return null;
    const assignment = ifcApi.GetLine(modelId, assignmentIds.get(0), true);
    const units = assignment?.Units;
    if (!Array.isArray(units)) return null;
    for (const unit of units) {
      const unitType = readEnum(unit?.UnitType) || readEnum(unit?.value?.UnitType);
      const name = readEnum(unit?.Name) || readEnum(unit?.value?.Name);
      const prefix = readEnum(unit?.Prefix) || readEnum(unit?.value?.Prefix);
      if (unitType === "AREAUNIT" || name === "SQUARE_METRE" || name === "SQUARE_METER") {
        if (prefix && prefix !== "NULL") {
          return `AREAUNIT: ${prefix} SQUARE_METRE — geometria web-ifc jest w metrach; Qto może wymagać przeliczenia.`;
        }
        if (name === "SQUARE_METRE" || name === "SQUARE_METER" || unitType === "AREAUNIT") {
          return "AREAUNIT: SQUARE_METRE (zgodne z geometrią w metrach).";
        }
      }
      // Fully resolved IfcSIUnit
      if (unit?.constructor?.name === "IfcSIUnit" || unit?.type === IFCSIUNIT) {
        const ut = readEnum(unit.UnitType);
        if (ut === "AREAUNIT") {
          const n = readEnum(unit.Name) || "SQUARE_METRE";
          const p = readEnum(unit.Prefix);
          return p && p !== "NULL"
            ? `AREAUNIT: ${p} ${n} — geometria web-ifc jest w metrach.`
            : `AREAUNIT: ${n}.`;
        }
      }
    }
  } catch {
    // ignore
  }
  return "Jednostki Qto: zakładane m² (jak geometria web-ifc); przy innym AREAUNIT wartości mogą się nie zgadzać.";
};

/**
 * Map element/space expressID -> storey via ContainedInSpatialStructure + RelAggregates.
 * Also resolves element → IfcSpace → storey when the element is contained in a space.
 */
export const buildStoreyMembership = (ifcApi, modelId) => {
  const storeysById = new Map();
  const spacesById = new Set();
  const membership = new Map();
  const spaceToStorey = new Map();
  const pendingSpaceContents = [];

  const storeyIds = ifcApi.GetLineIDsWithType(modelId, IFCBUILDINGSTOREY);
  for (let i = 0; i < storeyIds.size(); i += 1) {
    const storeyId = storeyIds.get(i);
    let line = null;
    try {
      line = ifcApi.GetLine(modelId, storeyId, true);
    } catch {
      continue;
    }
    storeysById.set(storeyId, {
      expressID: storeyId,
      name: readLabel(line?.Name) || `Storey ${storeyId}`,
      elevation: readNumber(line?.Elevation) ?? 0
    });
  }

  const spaceIds = ifcApi.GetLineIDsWithType(modelId, IFCSPACE);
  for (let i = 0; i < spaceIds.size(); i += 1) {
    spacesById.add(spaceIds.get(i));
  }

  const assignToStorey = (storey, expressId) => {
    if (!storey || typeof expressId !== "number") return;
    membership.set(expressId, storey);
  };

  // Aggregates: storey → spaces (and other children)
  const aggregateIds = ifcApi.GetLineIDsWithType(modelId, IFCRELAGGREGATES);
  for (let i = 0; i < aggregateIds.size(); i += 1) {
    let rel = null;
    try {
      rel = ifcApi.GetLine(modelId, aggregateIds.get(i), true);
    } catch {
      continue;
    }
    const relating = rel?.RelatingObject;
    const relatingId = relating?.value ?? relating?.expressID ?? relating;
    if (typeof relatingId !== "number") continue;
    const storey = storeysById.get(relatingId);
    if (!storey || !Array.isArray(rel?.RelatedObjects)) continue;
    for (const item of rel.RelatedObjects) {
      const expressId = item?.value ?? item?.expressID ?? item;
      if (typeof expressId !== "number") continue;
      assignToStorey(storey, expressId);
      if (spacesById.has(expressId)) spaceToStorey.set(expressId, storey);
    }
  }

  const containedIds = ifcApi.GetLineIDsWithType(modelId, IFCRELCONTAINEDINSPATIALSTRUCTURE);
  for (let i = 0; i < containedIds.size(); i += 1) {
    let rel = null;
    try {
      rel = ifcApi.GetLine(modelId, containedIds.get(i), true);
    } catch {
      continue;
    }
    const relating = rel?.RelatingStructure;
    const relatingId = relating?.value ?? relating?.expressID ?? relating;
    if (typeof relatingId !== "number" || !Array.isArray(rel?.RelatedElements)) continue;

    if (storeysById.has(relatingId)) {
      const storey = storeysById.get(relatingId);
      for (const item of rel.RelatedElements) {
        const expressId = item?.value ?? item?.expressID ?? item;
        assignToStorey(storey, expressId);
      }
      continue;
    }

    // Contained in a space → resolve via space → storey
    if (spacesById.has(relatingId)) {
      pendingSpaceContents.push({ spaceId: relatingId, related: rel.RelatedElements });
    }
  }

  for (const { spaceId, related } of pendingSpaceContents) {
    const storey = spaceToStorey.get(spaceId) ?? membership.get(spaceId);
    if (!storey) continue;
    for (const item of related) {
      const expressId = item?.value ?? item?.expressID ?? item;
      if (typeof expressId !== "number") continue;
      if (!membership.has(expressId)) assignToStorey(storey, expressId);
    }
  }

  return {
    storeys: [...storeysById.values()].sort((a, b) => a.elevation - b.elevation),
    membership
  };
};

const footprintAreaFromBox = (box) => {
  if (!box || box.isEmpty()) return 0;
  box.getSize(_size);
  const xy = Math.abs(_size.x * _size.y);
  const xz = Math.abs(_size.x * _size.z);
  const yz = Math.abs(_size.y * _size.z);
  return Math.max(xy, xz, yz);
};

const extractNamedAreas = (psets) => {
  let netSide = null;
  let grossSide = null;
  let netFloor = null;
  let grossFloor = null;
  let netArea = null;
  let grossArea = null;

  for (const pset of psets || []) {
    const props = pset?.HasProperties || pset?.Quantities || pset?.Properties || [];
    if (!Array.isArray(props)) continue;
    for (const prop of props) {
      const name = String(prop?.Name?.value || prop?.Name || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
      const numeric =
        readNumber(prop?.NominalValue) ??
        readNumber(prop?.AreaValue) ??
        readNumber(prop?.value);
      if (!(numeric > 0)) continue;
      if (name.includes("netsidearea")) netSide = numeric;
      if (name.includes("grosssidearea")) grossSide = numeric;
      if (name.includes("netfloorarea")) netFloor = numeric;
      if (name.includes("grossfloorarea")) grossFloor = numeric;
      if (name === "netarea") netArea = numeric;
      if (name === "grossarea") grossArea = numeric;
    }
  }

  return { netSide, grossSide, netFloor, grossFloor, netArea, grossArea };
};

const resolveStoreyForElement = (storeyByModelElement, modelId, expressId) =>
  storeyByModelElement.get(`${modelId}:${expressId}`) ?? null;

/**
 * Build floor + wall area report grouped by storey (merged across files by name+elevation).
 */
export const buildSpatialAreaReport = async ({
  ifcApi,
  openModelIds = [],
  entities = [],
  getQuantityPsets
}) => {
  const storeyByModelElement = new Map();
  const allStoreys = [];
  const seenStoreyKeys = new Set();
  let areaUnitNote = null;

  for (const modelId of openModelIds) {
    if (!areaUnitNote) areaUnitNote = readAreaUnitNote(ifcApi, modelId);

    const { storeys, membership } = buildStoreyMembership(ifcApi, modelId);
    const keyByStoreyId = new Map();
    for (const storey of storeys) {
      const key = storeyMergeKey(storey.name, storey.elevation);
      keyByStoreyId.set(storey.expressID, key);
      if (!seenStoreyKeys.has(key)) {
        seenStoreyKeys.add(key);
        allStoreys.push({ ...storey, modelId, key });
      }
    }
    for (const [expressId, storey] of membership) {
      const key = keyByStoreyId.get(storey.expressID) ?? storeyMergeKey(storey.name, storey.elevation);
      storeyByModelElement.set(`${modelId}:${expressId}`, {
        ...storey,
        modelId,
        key
      });
    }
  }

  for (const entity of entities) {
    const storey = storeyByModelElement.get(`${entity.modelId}:${entity.expressID}`);
    entity.storeyName = storey?.name ?? "Bez kondygnacji";
    entity.storeyElevation = storey?.elevation ?? null;
    entity.storeyKey = storey?.key ?? "none";
  }

  // Only walls/slabs need geometry fallbacks — skip mesh/AABB work for pipes, doors, etc.
  const byElement = new Map();
  for (const entity of entities) {
    const relevant =
      isWallType(entity.typeName, entity.typeId) || isSlabType(entity.typeName, entity.typeId);
    if (!relevant) continue;

    const key = `${entity.modelId}:${entity.expressID}`;
    const group = byElement.get(key) || {
      modelId: entity.modelId,
      expressID: entity.expressID,
      typeName: entity.typeName,
      typeId: entity.typeId,
      name: entity.name,
      sourceFile: entity.sourceFile,
      storeyName: entity.storeyName,
      storeyKey: entity.storeyKey,
      predefinedType: null,
      box: null,
      meshOneSidedArea: 0,
      entities: []
    };

    if (isWallType(entity.typeName, entity.typeId)) {
      group.meshOneSidedArea += computeEntityOneSidedSurfaceArea(entity);
    } else if (isSlabType(entity.typeName, entity.typeId)) {
      const box = getEntityWorldBox(entity);
      if (!box.isEmpty()) {
        group.box = group.box ? group.box.union(box) : box.clone();
      }
    }

    group.entities.push(entity);
    byElement.set(key, group);
  }

  for (const element of byElement.values()) {
    if (!isSlabType(element.typeName, element.typeId)) continue;
    try {
      const line = ifcApi.GetLine(element.modelId, element.expressID, false);
      element.predefinedType = readEnum(line?.PredefinedType);
    } catch {
      element.predefinedType = null;
    }
  }

  const floors = new Map();
  const ensureFloor = (storeyKey, storeyName, elevation) => {
    if (!floors.has(storeyKey)) {
      floors.set(storeyKey, {
        storeyKey,
        storeyName,
        elevation: elevation ?? 0,
        spaceNetArea: 0,
        spaceGrossArea: 0,
        slabArea: 0,
        wallNetArea: 0,
        wallGrossArea: 0,
        spaceCount: 0,
        slabCount: 0,
        wallCount: 0,
        excludedSlabCount: 0
      });
    }
    return floors.get(storeyKey);
  };

  for (const storey of allStoreys) {
    ensureFloor(storey.key, storey.name, storey.elevation);
  }
  ensureFloor("none", "Bez kondygnacji", null);

  // --- Spaces: IFC lines (StreamAllMeshes skips IfcSpace) ---
  let spaceFromQto = 0;
  let spacesSkippedNoQto = 0;
  let spacesTotal = 0;

  for (const modelId of openModelIds) {
    const spaceIds = ifcApi.GetLineIDsWithType(modelId, IFCSPACE);
    for (let i = 0; i < spaceIds.size(); i += 1) {
      spacesTotal += 1;
      const expressID = spaceIds.get(i);

      const storey = resolveStoreyForElement(storeyByModelElement, modelId, expressID);
      const floor = ensureFloor(
        storey?.key ?? "none",
        storey?.name ?? "Bez kondygnacji",
        storey?.elevation ?? null
      );

      const psets = (await getQuantityPsets?.(modelId, expressID)) || [];
      const named = extractNamedAreas(psets);
      const quantities = extractQuantitiesFromPsets(psets);

      const net = named.netFloor ?? named.netArea ?? null;
      const gross = named.grossFloor ?? named.grossArea ?? null;
      const fallback = quantities.area;
      const netValue = net > 0 ? net : gross > 0 ? null : fallback;
      const grossValue = gross > 0 ? gross : net > 0 ? null : fallback;

      if (!(netValue > 0) && !(grossValue > 0) && !(net > 0) && !(gross > 0) && !(fallback > 0)) {
        spacesSkippedNoQto += 1;
        continue;
      }

      const resolvedNet = net > 0 ? net : netValue > 0 ? netValue : gross > 0 ? gross : grossValue;
      const resolvedGross = gross > 0 ? gross : grossValue > 0 ? grossValue : resolvedNet;

      floor.spaceCount += 1;
      floor.spaceNetArea += resolvedNet > 0 ? resolvedNet : 0;
      floor.spaceGrossArea += resolvedGross > 0 ? resolvedGross : 0;
      spaceFromQto += 1;
    }
  }

  // --- Walls + floor slabs ---
  let slabsExcluded = 0;
  for (const element of byElement.values()) {
    const floor = ensureFloor(
      element.storeyKey || "none",
      element.storeyName || "Bez kondygnacji",
      null
    );

    if (isSlabType(element.typeName, element.typeId)) {
      if (element.predefinedType && EXCLUDED_SLAB_TYPES.has(element.predefinedType)) {
        floor.excludedSlabCount += 1;
        slabsExcluded += 1;
        continue;
      }

      const psets = (await getQuantityPsets?.(element.modelId, element.expressID)) || [];
      const named = extractNamedAreas(psets);
      // Prefer NetArea / NetFloorArea over generic first-"area" (often GrossArea in Qto_Slab).
      const area =
        named.netArea ??
        named.netFloor ??
        named.grossArea ??
        named.grossFloor ??
        footprintAreaFromBox(element.box);

      floor.slabCount += 1;
      floor.slabArea += area > 0 ? area : 0;
      continue;
    }

    if (isWallType(element.typeName, element.typeId)) {
      const psets = (await getQuantityPsets?.(element.modelId, element.expressID)) || [];
      const named = extractNamedAreas(psets);
      const quantities = extractQuantitiesFromPsets(psets);

      floor.wallCount += 1;
      const meshFallback = element.meshOneSidedArea > 0 ? element.meshOneSidedArea : 0;
      const net = named.netSide ?? null;
      const gross = named.grossSide ?? null;
      const qtoArea = quantities.area;
      const fallback = meshFallback > 0 ? meshFallback : 0;
      const netValue = net > 0 ? net : qtoArea > 0 && !gross ? qtoArea : fallback;
      const grossValue = gross > 0 ? gross : netValue;
      floor.wallNetArea += netValue > 0 ? netValue : 0;
      floor.wallGrossArea += grossValue > 0 ? grossValue : 0;
    }
  }

  const storeyRows = [...floors.values()]
    .filter(
      (row) =>
        row.spaceCount ||
        row.slabCount ||
        row.wallCount ||
        row.excludedSlabCount ||
        row.storeyKey !== "none"
    )
    .sort((a, b) => (a.elevation ?? 0) - (b.elevation ?? 0));

  const totals = storeyRows.reduce(
    (acc, row) => {
      acc.spaceNetArea += row.spaceNetArea;
      acc.spaceGrossArea += row.spaceGrossArea;
      acc.slabArea += row.slabArea;
      acc.wallNetArea += row.wallNetArea;
      acc.wallGrossArea += row.wallGrossArea;
      return acc;
    },
    { spaceNetArea: 0, spaceGrossArea: 0, slabArea: 0, wallNetArea: 0, wallGrossArea: 0 }
  );

  return {
    storeyCount: allStoreys.length,
    storeyRows,
    totals,
    meta: {
      spaceFromQto,
      spacesTotal,
      spacesSkippedNoQto,
      slabsExcluded,
      areaUnitNote,
      slabFilterNote:
        "Do powierzchni kondygnacji wliczane są IfcSlab bez PredefinedType albo FLOOR; wykluczone: ROOF, BASESLAB, LANDING, APPROACH_SLAB. Dla Qto preferowane NetArea/NetFloorArea (nie pierwsza trafiona „area”)."
    },
    generatedAt: new Date().toISOString()
  };
};

export const formatArea = (value) => {
  if (!(value > 0)) return "0";
  if (value >= 100) return value.toFixed(1);
  if (value >= 1) return value.toFixed(2);
  if (value >= 0.01) return value.toFixed(3);
  return value.toExponential(2);
};
