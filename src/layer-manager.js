import { getEntities, refreshBatchTransparency, syncEntityAppearance } from "./entities.js";

let layerSeq = 1;

const createLayer = ({ name, kind, binding }) => ({
  id: `layer-${layerSeq++}`,
  name,
  kind, // "default" | "custom"
  visible: true,
  opacity: 1,
  binding // { type: "discipline"|"file"|"entity", value: string }
});

const entityMatchesBinding = (entity, binding) => {
  if (!binding) return false;
  if (binding.type === "discipline") {
    return entity.discipline === binding.value;
  }
  if (binding.type === "file") {
    return entity.sourceFile === binding.value;
  }
  if (binding.type === "entity") {
    return entity.typeName === binding.value;
  }
  return false;
};

export const createLayerManager = () => {
  let layers = [];

  const reset = () => {
    layers = [];
  };

  const getLayers = () => layers.slice();

  const getLayerById = (layerId) => layers.find((layer) => layer.id === layerId) ?? null;

  const getLayerNames = () => layers.map((layer) => layer.name);

  const ensureUniqueName = (desiredName) => {
    const base = String(desiredName || "Nowa warstwa").trim() || "Nowa warstwa";
    const existing = new Set(layers.map((layer) => layer.name));
    if (!existing.has(base)) return base;
    let index = 2;
    while (existing.has(`${base} (${index})`)) index += 1;
    return `${base} (${index})`;
  };

  /**
   * Build default discipline layers from loaded model stats.
   * Keeps existing custom layers and re-applies assignment afterwards.
   */
  const syncDefaultLayersFromCounts = (disciplineCounts = {}) => {
    const custom = layers.filter((layer) => layer.kind === "custom");
    const defaults = Object.entries(disciplineCounts)
      .filter(([, count]) => count > 0)
      .map(([discipline]) =>
        createLayer({
          name: discipline,
          kind: "default",
          binding: { type: "discipline", value: discipline }
        })
      );
    layers = [...defaults, ...custom];
    return layers;
  };

  const addCustomLayer = ({ name, bindType, bindValue }) => {
    if (!bindType || !bindValue) {
      throw new Error("Custom warstwa wymaga typu powiazania i wartosci.");
    }
    if (!["file", "entity"].includes(bindType)) {
      throw new Error("Dozwolone powiazania custom: file albo entity.");
    }

    const layer = createLayer({
      name: ensureUniqueName(name),
      kind: "custom",
      binding: { type: bindType, value: bindValue }
    });
    layers.push(layer);
    return layer;
  };

  const removeLayer = (layerId) => {
    const layer = getLayerById(layerId);
    if (!layer) return false;
    if (layer.kind === "default") {
      throw new Error("Nie mozna usunac warstwy domyslnej.");
    }
    layers = layers.filter((item) => item.id !== layerId);
    return true;
  };

  const setLayerVisibility = (layerId, visible) => {
    const layer = getLayerById(layerId);
    if (!layer) return;
    layer.visible = Boolean(visible);
  };

  const setLayerOpacity = (layerId, opacity01) => {
    const layer = getLayerById(layerId);
    if (!layer) return;
    layer.opacity = Math.max(0, Math.min(1, opacity01));
  };

  /**
   * Assign each entity to exactly one layer.
   * Custom bindings win over defaults (later custom layers override earlier ones).
   */
  const assignMeshes = (modelGroup) => {
    const defaults = layers.filter((layer) => layer.kind === "default");
    const customs = layers.filter((layer) => layer.kind === "custom");
    const counts = Object.fromEntries(layers.map((layer) => [layer.id, 0]));

    for (const entity of getEntities(modelGroup)) {
      let assigned = null;

      // Later custom layers take precedence.
      for (let i = customs.length - 1; i >= 0; i -= 1) {
        const custom = customs[i];
        if (entityMatchesBinding(entity, custom.binding)) {
          assigned = custom;
          break;
        }
      }

      if (!assigned) {
        assigned =
          defaults.find((layer) => entityMatchesBinding(entity, layer.binding)) ??
          defaults.find((layer) => layer.binding?.value === "Inne") ??
          defaults[0] ??
          null;
      }

      if (!assigned) {
        entity.layerId = null;
        entity.layerName = "brak";
        continue;
      }

      entity.layerId = assigned.id;
      entity.layerName = assigned.name;
      counts[assigned.id] += 1;
    }

    return counts;
  };

  const applyVisibilityAndOpacity = (modelGroup) => {
    for (const entity of getEntities(modelGroup)) {
      const layer = getLayerById(entity.layerId);
      if (!layer) {
        entity.layerVisible = true;
        entity.layerOpacity = 1;
      } else {
        entity.layerVisible = layer.visible;
        entity.layerOpacity = layer.opacity;
      }
      syncEntityAppearance(entity);
    }
    refreshBatchTransparency(modelGroup);
  };

  const collectBindingOptions = (modelGroup) => {
    const files = new Set();
    const entities = new Set();
    for (const entity of getEntities(modelGroup)) {
      if (entity.sourceFile) files.add(entity.sourceFile);
      if (entity.typeName) entities.add(entity.typeName);
    }
    return {
      files: [...files].sort(),
      entities: [...entities].sort()
    };
  };

  const resetToDefaults = (disciplineCounts) => {
    layers = [];
    syncDefaultLayersFromCounts(disciplineCounts);
  };

  return {
    reset,
    getLayers,
    getLayerById,
    getLayerNames,
    syncDefaultLayersFromCounts,
    addCustomLayer,
    removeLayer,
    setLayerVisibility,
    setLayerOpacity,
    assignMeshes,
    applyVisibilityAndOpacity,
    collectBindingOptions,
    resetToDefaults
  };
};
