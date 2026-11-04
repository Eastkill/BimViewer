const IFC_MATERIAL = 1838606355;
const IFC_MATERIAL_LAYER_SET = 3303938423;
const IFC_MATERIAL_LAYER_SET_USAGE = 1303795690;
const IFC_MATERIAL_LIST = 2199411900;
const IFC_MATERIAL_CONSTITUENT_SET = 2852063980;

const readValue = (value) => {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value?.value === "string" || typeof value?.value === "number") return String(value.value);
  return null;
};

const pushUnique = (list, value) => {
  if (!value) return;
  const trimmed = String(value).trim();
  if (!trimmed) return;
  if (!list.includes(trimmed)) list.push(trimmed);
};

const typeOf = (node) => Number(node?.type) || 0;
const typeNameOf = (node) => String(node?.constructor?.name || "");

/**
 * Collect human-readable material names from web-ifc material definitions.
 */
export const collectMaterialNames = (node, names = [], seen = new Set()) => {
  if (!node || typeof node !== "object") return names;

  const expressID = node.expressID;
  if (expressID != null) {
    if (seen.has(expressID)) return names;
    seen.add(expressID);
  }

  const type = typeOf(node);
  const typeName = typeNameOf(node);

  if (type === IFC_MATERIAL || typeName === "IfcMaterial") {
    pushUnique(names, readValue(node.Name) || readValue(node.Category));
  }

  if (type === IFC_MATERIAL_LAYER_SET || typeName === "IfcMaterialLayerSet") {
    pushUnique(names, readValue(node.LayerSetName));
  }

  if (type === IFC_MATERIAL_LIST || typeName === "IfcMaterialList") {
    // names come from nested Materials
  }

  if (type === IFC_MATERIAL_LAYER_SET_USAGE || typeName === "IfcMaterialLayerSetUsage") {
    collectMaterialNames(node.ForLayerSet, names, seen);
  }

  if (type === IFC_MATERIAL_CONSTITUENT_SET || typeName === "IfcMaterialConstituentSet") {
    pushUnique(names, readValue(node.Name));
  }

  if (node.Material) {
    const materialName = readValue(node.Material?.Name);
    const thickness = readValue(node.LayerThickness);
    if (materialName && thickness != null) pushUnique(names, `${materialName} (${thickness})`);
    else if (materialName) pushUnique(names, materialName);
    else collectMaterialNames(node.Material, names, seen);
  }

  for (const collection of [
    node.Materials,
    node.MaterialLayers,
    node.MaterialConstituents,
    node.MaterialProfiles,
    node.ForLayerSet?.MaterialLayers
  ]) {
    if (!Array.isArray(collection)) continue;
    for (const item of collection) collectMaterialNames(item, names, seen);
  }

  if (node.ForLayerSet) collectMaterialNames(node.ForLayerSet, names, seen);
  if (node.ForProfileSet) collectMaterialNames(node.ForProfileSet, names, seen);

  return names;
};

export const formatMaterialsLabel = (materialNodes) => {
  const names = [];
  for (const node of materialNodes || []) {
    collectMaterialNames(node, names);
  }
  return names.length ? names.join(", ") : "brak";
};
