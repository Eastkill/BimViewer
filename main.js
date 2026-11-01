import { detectLayerCollisions } from "./src/collisions.js";
import { createIfcService } from "./src/ifc-service.js";
import { createLayerManager } from "./src/layer-manager.js";
import { createSelectionManager } from "./src/selection.js";
import { createUI } from "./src/ui.js";
import { createViewer } from "./src/viewer.js";
import * as THREE from "three";

const ui = createUI();
const viewer = createViewer(ui.canvas);
const ifcService = createIfcService();
const layerManager = createLayerManager();
const selection = createSelectionManager({ showModelInfo: ui.showModelInfo });

const CLICK_MOVE_THRESHOLD_PX = 5;
const ISOLATION_DIM_OPACITY = 0.14;

let pointerDownPos = null;
let lastCollisionResult = null;
let activeCollisionPair = null;
let lastDisciplineCounts = {};

const boot = async () => {
  try {
    await viewer.start();
    ui.writeOutput(
      'Viewer gotowy. Wczytaj IFC, a potem dodawaj custom warstwy (plik / entity). Domyslne warstwy = branze.'
    );
  } catch (error) {
    ui.writeOutput(
      `Blad inicjalizacji WebGPU: ${error?.message ?? String(error)}\n` +
        "Upewnij sie, ze uzywasz Chrome/Edge z wlaczonym WebGPU."
    );
  }
};

boot();

const setMeshVisualOpacity = (mesh, opacity) => {
  const material = mesh.material;
  if (!material) return;
  const clamped = Math.max(0, Math.min(1, opacity));
  material.opacity = clamped;
  material.transparent = clamped < 0.999;
  material.depthWrite = clamped >= 0.999;
  material.needsUpdate = true;
};

const collectCollidingMeshes = (result) => {
  const meshes = new Set();
  for (const pair of result?.samplePairs ?? []) {
    if (pair.leftMesh) meshes.add(pair.leftMesh);
    if (pair.rightMesh) meshes.add(pair.rightMesh);
  }
  return meshes;
};

const refreshLayersUi = () => {
  const modelGroup = viewer.getModelGroup();
  const countsById = layerManager.assignMeshes(modelGroup);
  layerManager.applyVisibilityAndOpacity(modelGroup, { setMeshOpacity: setMeshVisualOpacity });

  ui.renderLayerControls(
    layerManager.getLayers(),
    countsById,
    layerManager.collectBindingOptions(modelGroup),
    {
      onLayerToggle: (layerId, visible) => {
        layerManager.setLayerVisibility(layerId, visible);
        layerManager.applyVisibilityAndOpacity(viewer.getModelGroup(), {
          setMeshOpacity: setMeshVisualOpacity
        });
      },
      onLayerOpacityChange: (layerId, opacityPercent) => {
        layerManager.setLayerOpacity(layerId, opacityPercent / 100);
        if (ui.isCollisionIsolationEnabled() && lastCollisionResult?.samplePairs?.length) {
          applyCollisionIsolationView();
          return;
        }
        layerManager.applyVisibilityAndOpacity(viewer.getModelGroup(), {
          setMeshOpacity: setMeshVisualOpacity
        });
      },
      onAddCustomLayer: ({ name, bindType, bindValue }) => {
        try {
          if (!bindValue) {
            ui.writeOutput("Wybierz plik albo entity do powiazania custom warstwy.");
            return;
          }
          layerManager.addCustomLayer({ name, bindType, bindValue });
          refreshLayersUi();
          ui.setCollisionLayerOptions(layerManager.getLayerNames());
        } catch (error) {
          ui.writeOutput(`Blad warstwy: ${error?.message ?? String(error)}`);
        }
      },
      onRemoveLayer: (layerId) => {
        try {
          layerManager.removeLayer(layerId);
          refreshLayersUi();
          ui.setCollisionLayerOptions(layerManager.getLayerNames());
        } catch (error) {
          ui.writeOutput(`Blad warstwy: ${error?.message ?? String(error)}`);
        }
      },
      onResetDefaults: () => {
        layerManager.resetToDefaults(lastDisciplineCounts);
        refreshLayersUi();
        ui.setCollisionLayerOptions(layerManager.getLayerNames());
        ui.writeOutput("Przywrocono warstwy domyslne (branze).");
      }
    }
  );
};

const restoreAllLayerOpacities = () => {
  layerManager.applyVisibilityAndOpacity(viewer.getModelGroup(), {
    setMeshOpacity: setMeshVisualOpacity
  });
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
      mesh.visible = true;
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
          `A warstwa: ${activeCollisionPair.leftMesh?.userData.layerName ?? activeCollisionPair.leftDiscipline}`,
          `B ExpressID: ${activeCollisionPair.rightExpressId}`,
          `B warstwa: ${activeCollisionPair.rightMesh?.userData.layerName ?? activeCollisionPair.rightDiscipline}`
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
  layerManager.reset();
  lastDisciplineCounts = {};
  lastCollisionResult = null;
  activeCollisionPair = null;
  ui.setCollisionIsolationEnabled(false);
  viewer.replaceModelGroup(new THREE.Group());
};

const focusCollisionPair = (pair) => {
  activeCollisionPair = pair;
  if (ui.isCollisionIsolationEnabled()) {
    applyCollisionIsolationView();
    return;
  }
  selection.highlightCollisionPair(pair.leftMesh, pair.rightMesh, pair);
};

const loadIfcFiles = async (files) => {
  ui.setLoading(true);

  try {
    await ifcService.init();
    resetModelGroup();

    const modelGroup = viewer.getModelGroup();
    const { summary, disciplineCounts } = await ifcService.loadFilesIntoGroup(files, modelGroup);
    viewer.fitCameraToObject(modelGroup);

    lastDisciplineCounts = disciplineCounts;

    for (const mesh of modelGroup.children) {
      if (!mesh.isMesh) continue;
      mesh.userData.baseOpacity = mesh.material?.opacity ?? 1;
    }

    layerManager.syncDefaultLayersFromCounts(disciplineCounts);
    refreshLayersUi();
    ui.setCollisionLayerOptions(layerManager.getLayerNames());
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
  const files = ui.fileInput.files ? Array.from(ui.fileInput.files) : [];
  if (files.length === 0) {
    ui.writeOutput("Wybierz jeden lub wiele plikow IFC albo kliknij sample.");
    return;
  }
  await loadIfcFiles(files);
});

const fetchSampleFile = async (relativePath, fileName) => {
  const response = await fetch(`${import.meta.env.BASE_URL}${relativePath}`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} przy pobieraniu ${fileName}`);
  }
  const blob = await response.blob();
  return new File([blob], fileName, { type: "application/x-step" });
};

const loadSampleByPath = async (relativePath, fileName) => {
  try {
    const file = await fetchSampleFile(relativePath, fileName);
    await loadIfcFiles([file]);
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

ui.loadBothSamplesButton?.addEventListener("click", async () => {
  try {
    const files = await Promise.all([
      fetchSampleFile("samples/test-building.ifc", "architecture-structure.ifc"),
      fetchSampleFile("samples/office-building-with-errors.ifc", "mep-office-with-errors.ifc")
    ]);
    await loadIfcFiles(files);
  } catch (error) {
    console.error(error);
    ui.writeOutput(`Blad ladowania sample: ${error?.message ?? String(error)}`);
  }
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
