import { detectLayerCollisions } from "./src/collisions.js";
import { createIfcService } from "./src/ifc-service.js";
import { createSelectionManager } from "./src/selection.js";
import { createUI } from "./src/ui.js";
import { createViewer } from "./src/viewer.js";
import * as THREE from "three";

const ui = createUI();
const viewer = createViewer(ui.canvas);
const ifcService = createIfcService();
const selection = createSelectionManager({ showModelInfo: ui.showModelInfo });

const layerOpacityByDiscipline = new Map();
const CLICK_MOVE_THRESHOLD_PX = 5;
const ISOLATION_DIM_OPACITY = 0.14;

let pointerDownPos = null;
let lastCollisionResult = null;
let activeCollisionPair = null;

const boot = async () => {
  try {
    await viewer.start();
    ui.writeOutput('Viewer gotowy. Wybierz plik IFC (np. samples/test-building.ifc) i kliknij "Wczytaj IFC".');
  } catch (error) {
    ui.writeOutput(
      `Blad inicjalizacji WebGPU: ${error?.message ?? String(error)}\n` +
        "Upewnij sie, ze uzywasz Chrome/Edge z wlaczonym WebGPU."
    );
  }
};

boot();

const collectCollidingMeshes = (result) => {
  const meshes = new Set();
  for (const pair of result?.samplePairs ?? []) {
    if (pair.leftMesh) meshes.add(pair.leftMesh);
    if (pair.rightMesh) meshes.add(pair.rightMesh);
  }
  return meshes;
};

const setMeshVisualOpacity = (mesh, opacity) => {
  const material = mesh.material;
  if (!material) return;
  const clamped = Math.max(0, Math.min(1, opacity));
  material.opacity = clamped;
  material.transparent = clamped < 0.999;
  material.depthWrite = clamped >= 0.999;
  material.needsUpdate = true;
};

const applyMeshOpacity = (mesh) => {
  const baseOpacity = mesh.userData.baseOpacity ?? 1;
  const discipline = mesh.userData.discipline;
  const layerOpacity = layerOpacityByDiscipline.get(discipline) ?? 1;
  setMeshVisualOpacity(mesh, baseOpacity * layerOpacity);
};

const restoreAllLayerOpacities = () => {
  const modelGroup = viewer.getModelGroup();
  for (const mesh of modelGroup.children) {
    if (!mesh.isMesh) continue;
    applyMeshOpacity(mesh);
  }
};

const applyCollisionIsolationView = () => {
  const modelGroup = viewer.getModelGroup();
  const isolationOn = ui.isCollisionIsolationEnabled();
  const hasCollisions = Boolean(lastCollisionResult?.samplePairs?.length);

  if (!isolationOn || !hasCollisions) {
    selection.clearSelection();
    restoreAllLayerOpacities();
    return;
  }

  const allColliding = collectCollidingMeshes(lastCollisionResult);
  const focusMeshes = activeCollisionPair
    ? new Set([activeCollisionPair.leftMesh, activeCollisionPair.rightMesh].filter(Boolean))
    : allColliding;

  for (const mesh of modelGroup.children) {
    if (!mesh.isMesh) continue;
    if (focusMeshes.has(mesh)) {
      setMeshVisualOpacity(mesh, mesh.userData.baseOpacity ?? 1);
    } else {
      setMeshVisualOpacity(mesh, ISOLATION_DIM_OPACITY);
    }
  }

  const focusList = [...focusMeshes];
  selection.selectMeshes(focusList, {
    colorHex: 0xef4444,
    intensity: 1,
    infoText: activeCollisionPair
      ? [
          "Tryb izolacji kolizji (aktywna para):",
          `A ExpressID: ${activeCollisionPair.leftExpressId}`,
          `A warstwa: ${activeCollisionPair.leftDiscipline}`,
          `B ExpressID: ${activeCollisionPair.rightExpressId}`,
          `B warstwa: ${activeCollisionPair.rightDiscipline}`
        ].join("\n")
      : [
          "Tryb izolacji kolizji:",
          `Podswietlone obiekty kolidujace: ${focusList.length}`,
          "Kliknij pare na liscie, aby zawęzic widok do jednej kolizji."
        ].join("\n")
  });
};

const resetModelGroup = () => {
  ifcService.closeCurrentModel();
  selection.clearSelection();
  layerOpacityByDiscipline.clear();
  lastCollisionResult = null;
  activeCollisionPair = null;
  ui.setCollisionIsolationEnabled(false);
  viewer.replaceModelGroup(new THREE.Group());
};

const setLayerVisibility = (discipline, visible) => {
  const modelGroup = viewer.getModelGroup();
  for (const mesh of modelGroup.children) {
    if (!mesh.isMesh) continue;
    if (mesh.userData.discipline !== discipline) continue;
    mesh.visible = visible;
  }
};

const setLayerOpacity = (discipline, opacityPercent) => {
  const opacity = Math.max(0, Math.min(100, opacityPercent)) / 100;
  layerOpacityByDiscipline.set(discipline, opacity);

  if (ui.isCollisionIsolationEnabled() && lastCollisionResult?.samplePairs?.length) {
    applyCollisionIsolationView();
    return;
  }

  const modelGroup = viewer.getModelGroup();
  for (const mesh of modelGroup.children) {
    if (!mesh.isMesh) continue;
    if (mesh.userData.discipline !== discipline) continue;
    applyMeshOpacity(mesh);
  }
};

const focusCollisionPair = (pair) => {
  activeCollisionPair = pair;
  if (ui.isCollisionIsolationEnabled()) {
    applyCollisionIsolationView();
    return;
  }
  selection.highlightCollisionPair(pair.leftMesh, pair.rightMesh, pair);
};

const loadIfcFile = async (file) => {
  ui.setLoading(true);

  try {
    await ifcService.init();
    resetModelGroup();

    const modelGroup = viewer.getModelGroup();
    const { summary, disciplineCounts } = await ifcService.loadIntoGroup(file, modelGroup);
    viewer.fitCameraToObject(modelGroup);

    for (const discipline of Object.keys(disciplineCounts)) {
      layerOpacityByDiscipline.set(discipline, 1);
    }

    for (const mesh of modelGroup.children) {
      if (!mesh.isMesh) continue;
      const material = mesh.material;
      mesh.userData.baseOpacity = material?.opacity ?? 1;
      applyMeshOpacity(mesh);
    }

    ui.renderLayerControls(disciplineCounts, {
      onLayerToggle: setLayerVisibility,
      onLayerOpacityChange: setLayerOpacity
    });
    ui.setCollisionLayerOptions(Object.keys(disciplineCounts));
    ui.setCollisionOutput("Brak analizy kolizji.");
    ui.setBaseModelInfo(summary);
    ui.showModelInfo();
  } catch (error) {
    console.error(error);
    ui.writeOutput(`Blad wczytywania IFC: ${error?.message ?? String(error)}`);
  } finally {
    ui.setLoading(false);
  }
};

ui.loadButton.addEventListener("click", async () => {
  const file = ui.fileInput.files?.[0];
  if (!file) {
    ui.writeOutput("Wybierz plik IFC przed uruchomieniem albo kliknij \"Zaladuj sample\".");
    return;
  }
  await loadIfcFile(file);
});

const loadSampleByPath = async (relativePath, fileName) => {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}${relativePath}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} przy pobieraniu ${fileName}`);
    }
    const blob = await response.blob();
    const file = new File([blob], fileName, { type: "application/x-step" });
    await loadIfcFile(file);
  } catch (error) {
    console.error(error);
    ui.writeOutput(`Blad ladowania sample: ${error?.message ?? String(error)}`);
  }
};

ui.loadSampleButton.addEventListener("click", () => {
  loadSampleByPath("samples/test-building.ifc", "test-building.ifc");
});

ui.loadRealisticSampleButton.addEventListener("click", () => {
  loadSampleByPath("samples/office-building-with-errors.ifc", "office-building-with-errors.ifc");
});

ui.canvas.addEventListener("pointerdown", (event) => {
  pointerDownPos = { x: event.clientX, y: event.clientY };
});

ui.canvas.addEventListener("pointerup", (event) => {
  if (!pointerDownPos) return;

  const dx = event.clientX - pointerDownPos.x;
  const dy = event.clientY - pointerDownPos.y;
  const moved = Math.hypot(dx, dy);
  pointerDownPos = null;

  if (moved > CLICK_MOVE_THRESHOLD_PX) return;

  const pickedMesh = viewer.getPick(event);
  if (!pickedMesh) return;

  // In isolation mode keep dimming context; only update red focus to picked colliding mesh pair if possible.
  if (ui.isCollisionIsolationEnabled() && lastCollisionResult?.samplePairs?.length) {
    const relatedPair =
      lastCollisionResult.samplePairs.find(
        (pair) => pair.leftMesh === pickedMesh || pair.rightMesh === pickedMesh
      ) ?? null;
    if (relatedPair) {
      focusCollisionPair(relatedPair);
      return;
    }
  }

  selection.selectMesh(pickedMesh);
});

ui.canvas.addEventListener("pointercancel", () => {
  pointerDownPos = null;
});

ui.onCollisionIsolationChange(() => {
  if (!lastCollisionResult?.samplePairs?.length && ui.isCollisionIsolationEnabled()) {
    ui.writeOutput("Najpierw wykryj kolizje, potem wlacz tryb izolacji.");
  }
  applyCollisionIsolationView();
});

ui.detectCollisionsButton.addEventListener("click", () => {
  const modelGroup = viewer.getModelGroup();
  if (!modelGroup.children.length) {
    ui.setCollisionOutput("Najpierw wczytaj model IFC.");
    return;
  }

  const { layerA, layerB } = ui.getSelectedCollisionLayers();
  if (!layerA || !layerB) {
    ui.setCollisionOutput("Wybierz warstwy do analizy kolizji.");
    return;
  }

  selection.clearSelection();
  activeCollisionPair = null;
  lastCollisionResult = detectLayerCollisions(modelGroup, layerA, layerB);
  ui.renderCollisionResults(lastCollisionResult, focusCollisionPair);
  applyCollisionIsolationView();
});
