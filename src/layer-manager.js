let layerSeq = 1;

const createLayer = ({ name, kind, binding }) => ({
  id: `layer-${layerSeq++}`,
  name,
  kind, // "default" | "custom"
  visible: true,
  opacity: 1,
  binding // { type: "discipline"|"file"|"entity", value: string }
});

const meshMatchesBinding = (mesh, binding) => {
  if (!binding) return false;
  if (binding.type === "discipline") {
    return mesh.userData.discipline === binding.value;
  }
  if (binding.type === "file") {
    return mesh.userData.sourceFile === binding.value;
  }
  if (binding.type === "entity") {
    return mesh.userData.typeName === binding.value;
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
   * Assign each mesh to exactly one layer.
   * Custom bindings win over defaults (later custom layers override earlier ones).
   */
  const assignMeshes = (modelGroup) => {
    const defaults = layers.filter((layer) => layer.kind === "default");
    const customs = layers.filter((layer) => layer.kind === "custom");
    const counts = Object.fromEntries(layers.map((layer) => [layer.id, 0]));

    for (const mesh of modelGroup.children) {
      if (!mesh.isMesh) continue;

      let assigned = null;

      // Later custom layers take precedence.
      for (let i = customs.length - 1; i >= 0; i -= 1) {
        const custom = customs[i];
        if (meshMatchesBinding(mesh, custom.binding)) {
          assigned = custom;
          break;
        }
      }

      if (!assigned) {
        assigned =
          defaults.find((layer) => meshMatchesBinding(mesh, layer.binding)) ??
          defaults.find((layer) => layer.binding?.value === "Inne") ??
          defaults[0] ??
          null;
      }

      if (!assigned) {
        mesh.userData.layerId = null;
        mesh.userData.layerName = "brak";
        continue;
      }

      mesh.userData.layerId = assigned.id;
      mesh.userData.layerName = assigned.name;
      counts[assigned.id] += 1;
    }

    return counts;
  };

  const applyVisibilityAndOpacity = (modelGroup, { setMeshOpacity }) => {
    for (const mesh of modelGroup.children) {
      if (!mesh.isMesh) continue;
      const layer = getLayerById(mesh.userData.layerId);
      if (!layer) {
        mesh.visible = true;
        setMeshOpacity?.(mesh, mesh.userData.baseOpacity ?? 1);
        continue;
      }
      mesh.visible = layer.visible;
      const opacity = (mesh.userData.baseOpacity ?? 1) * layer.opacity;
      setMeshOpacity?.(mesh, opacity);
    }
  };

  const collectBindingOptions = (modelGroup) => {
    const files = new Set();
    const entities = new Set();
    for (const mesh of modelGroup.children) {
      if (!mesh.isMesh) continue;
      if (mesh.userData.sourceFile) files.add(mesh.userData.sourceFile);
      if (mesh.userData.typeName) entities.add(mesh.userData.typeName);
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
