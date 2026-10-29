const hasEmissive = (material) =>
  Boolean(material && material.emissive && typeof material.emissive.setHex === "function");

const restoreMeshHighlight = (mesh) => {
  const material = mesh.material;
  if (!hasEmissive(material) || !mesh.userData.originalEmissive) return;
  material.emissive.copy(mesh.userData.originalEmissive);
  material.emissiveIntensity = mesh.userData.originalEmissiveIntensity ?? 1;
  delete mesh.userData.originalEmissive;
  delete mesh.userData.originalEmissiveIntensity;
  delete mesh.userData.highlightMode;
};

const applyMeshHighlight = (mesh, colorHex, intensity) => {
  const material = mesh.material;
  if (!hasEmissive(material)) return;

  if (!mesh.userData.originalEmissive) {
    mesh.userData.originalEmissive = material.emissive.clone();
    mesh.userData.originalEmissiveIntensity = material.emissiveIntensity ?? 1;
  }

  material.emissive.setHex(colorHex);
  material.emissiveIntensity = intensity;
};

export const createSelectionManager = ({ showModelInfo }) => {
  let selectedMeshes = [];

  const clearSelection = () => {
    for (const mesh of selectedMeshes) {
      restoreMeshHighlight(mesh);
    }
    selectedMeshes = [];
  };

  const selectMeshes = (meshes, { colorHex = 0x22d3ee, intensity = 0.65, infoText = null } = {}) => {
    const unique = [...new Set(meshes.filter(Boolean))];
    clearSelection();
    selectedMeshes = unique;

    for (const mesh of selectedMeshes) {
      applyMeshHighlight(mesh, colorHex, intensity);
      mesh.userData.highlightMode = colorHex === 0xef4444 ? "collision" : "selection";
    }

    if (infoText) {
      showModelInfo(infoText);
    }
  };

  const selectMesh = (mesh) => {
    const expressId = mesh.userData.expressID ?? "brak";
    const geometryId = mesh.userData.geometryExpressID ?? "brak";
    const discipline = mesh.userData.discipline ?? "brak";
    selectMeshes([mesh], {
      colorHex: 0x22d3ee,
      intensity: 0.6,
      infoText: `Zaznaczenie:\nExpressID: ${expressId}\nGeometryID: ${geometryId}\nWarstwa: ${discipline}`
    });
  };

  const highlightCollisionPair = (leftMesh, rightMesh, pairMeta = {}) => {
    selectMeshes([leftMesh, rightMesh], {
      colorHex: 0xef4444,
      intensity: 0.95,
      infoText: [
        "Kolizja (czerwone podswietlenie):",
        `A ExpressID: ${pairMeta.leftExpressId ?? leftMesh?.userData.expressID ?? "brak"}`,
        `A warstwa: ${leftMesh?.userData.discipline ?? "brak"}`,
        `B ExpressID: ${pairMeta.rightExpressId ?? rightMesh?.userData.expressID ?? "brak"}`,
        `B warstwa: ${rightMesh?.userData.discipline ?? "brak"}`
      ].join("\n")
    });
  };

  return {
    clearSelection,
    selectMesh,
    selectMeshes,
    highlightCollisionPair
  };
};
