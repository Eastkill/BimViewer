import { detectLayerCollisions } from "./src/collisions.js";
import { getEntities, syncEntityAppearance } from "./src/entities.js";
import {
  applyFileTransform,
  getFileGroupByName,
  getFileGroups,
  persistFileTransform,
  resetFileTransform,
  restoreStoredFileTransforms
} from "./src/file-alignment.js";
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
const selection = createSelectionManager({
  showModelInfo: ui.showModelInfo,
  resolveMaterials: async (entity) =>
    ifcService.getElementMaterialsLabel(entity?.modelId, entity?.expressID)
});

const CLICK_MOVE_THRESHOLD_PX = 5;
const ISOLATION_DIM = 0.22;

let pointerDownPos = null;
let lastCollisionResult = null;
let activeCollisionPair = null;
let lastDisciplineCounts = {};
let selectedAlignFileName = null;
let fileAlignGizmoEnabled = false;
let fileAlignMode = "translate";
let suppressAlignUiRefresh = false;
let lastMaterialReport = null;
let reportLoading = false;

const collectCollidingEntities = (result) => {
  const entities = new Set();
  for (const pair of result?.samplePairs ?? []) {
    if (pair.leftMesh) entities.add(pair.leftMesh);
    if (pair.rightMesh) entities.add(pair.rightMesh);
  }
  return entities;
};

const syncFileAlignGizmo = () => {
  const modelGroup = viewer.getModelGroup();
  const entry = getFileGroupByName(modelGroup, selectedAlignFileName);
  if (fileAlignGizmoEnabled && entry) {
    viewer.attachFileTransformGizmo(entry, fileAlignMode);
  } else {
    viewer.clearFileTransformGizmo();
  }
};

const refreshFileAlignUi = () => {
  const modelGroup = viewer.getModelGroup();
  const fileEntries = getFileGroups(modelGroup);
  if (!fileEntries.length) {
    selectedAlignFileName = null;
    fileAlignGizmoEnabled = false;
    viewer.clearFileTransformGizmo();
  } else if (!fileEntries.some((entry) => entry.name === selectedAlignFileName)) {
    selectedAlignFileName = fileEntries[0].name;
  }

  ui.renderFileAlignControls(fileEntries, selectedAlignFileName, {
    gizmoEnabled: fileAlignGizmoEnabled,
    transformMode: fileAlignMode,
    onSelectFile: (fileName) => {
      selectedAlignFileName = fileName;
      syncFileAlignGizmo();
      refreshFileAlignUi();
    },
    onTransformChange: (fileName, transform) => {
      const entry = getFileGroupByName(viewer.getModelGroup(), fileName);
      if (!entry) return;
      applyFileTransform(entry, transform);
      viewer.requestRender();
      // Keep numeric fields in sync without full rebuild while typing is done via change event.
      refreshFileAlignUi();
    },
    onReset: (fileName) => {
      const entry = getFileGroupByName(viewer.getModelGroup(), fileName);
      if (!entry) return;
      resetFileTransform(entry);
      viewer.requestRender();
      refreshFileAlignUi();
    },
    onToggleGizmo: (enabled) => {
      fileAlignGizmoEnabled = enabled;
      syncFileAlignGizmo();
      refreshFileAlignUi();
    },
    onModeChange: (mode) => {
      fileAlignMode = mode === "rotate" ? "rotate" : "translate";
      viewer.setTransformMode(fileAlignMode);
      syncFileAlignGizmo();
      refreshFileAlignUi();
    }
  });
};

viewer.setFileTransformChangeHandler((fileEntry) => {
  if (fileEntry?.name && fileEntry.transform) {
    persistFileTransform(fileEntry.name, fileEntry.transform);
  }
  if (suppressAlignUiRefresh) return;
  // Debounce heavy UI rebuild while dragging — update fields after drag via next change burst.
  selectedAlignFileName = fileEntry.name;
  suppressAlignUiRefresh = true;
  refreshFileAlignUi();
  suppressAlignUiRefresh = false;
});

const refreshLayersUi = () => {
  const modelGroup = viewer.getModelGroup();
  const countsById = layerManager.assignMeshes(modelGroup);
  layerManager.applyVisibilityAndOpacity(modelGroup);
  viewer.requestRender();

  ui.renderLayerControls(
    layerManager.getLayers(),
    countsById,
    layerManager.collectBindingOptions(modelGroup),
    {
      onLayerToggle: (layerId, visible) => {
        layerManager.setLayerVisibility(layerId, visible);
        layerManager.applyVisibilityAndOpacity(viewer.getModelGroup());
        viewer.requestRender();
      },
      onLayerOpacityChange: (layerId, opacityPercent) => {
        layerManager.setLayerOpacity(layerId, opacityPercent / 100);
        if (ui.isCollisionIsolationEnabled() && lastCollisionResult?.samplePairs?.length) {
          applyCollisionIsolationView();
          return;
        }
        layerManager.applyVisibilityAndOpacity(viewer.getModelGroup());
        viewer.requestRender();
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
  const modelGroup = viewer.getModelGroup();
  for (const entity of getEntities(modelGroup)) {
    entity.isolationVisible = true;
    entity.isolationOpacity = 1;
    entity.isolationDim = 1;
  }
  layerManager.applyVisibilityAndOpacity(modelGroup);
  viewer.requestRender();
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

  const allColliding = collectCollidingEntities(lastCollisionResult);
  const focusEntities = activeCollisionPair
    ? new Set([activeCollisionPair.leftMesh, activeCollisionPair.rightMesh].filter(Boolean))
    : allColliding;

  for (const entity of getEntities(modelGroup)) {
    if (focusEntities.has(entity)) {
      entity.isolationVisible = true;
      entity.isolationOpacity = 1;
      entity.isolationDim = 1;
    } else {
      // Dim without transparency to avoid sorting 30k translucent instances.
      entity.isolationVisible = true;
      entity.isolationOpacity = 1;
      entity.isolationDim = ISOLATION_DIM;
    }
    syncEntityAppearance(entity);
  }

  const focusList = [...focusEntities];
  selection.selectMeshes(focusList, {
    colorHex: 0xef4444,
    intensity: 1,
    infoText: activeCollisionPair
      ? [
          "Tryb izolacji kolizji (aktywna para):",
          `A ExpressID: ${activeCollisionPair.leftExpressId}`,
          `A warstwa: ${activeCollisionPair.leftMesh?.layerName ?? activeCollisionPair.leftDiscipline}`,
          `B ExpressID: ${activeCollisionPair.rightExpressId}`,
          `B warstwa: ${activeCollisionPair.rightMesh?.layerName ?? activeCollisionPair.rightDiscipline}`
        ].join("\n")
      : [
          "Tryb izolacji kolizji:",
          `Podswietlone obiekty kolidujace: ${focusList.length}`,
          "Kliknij pare na liscie, aby zawęzic widok do jednej kolizji."
        ].join("\n")
  });
  viewer.requestRender();
};

const refreshMaterialReport = async () => {
  const entities = getEntities(viewer.getModelGroup());
  if (!entities.length) {
    lastMaterialReport = null;
    ui.renderMaterialReport(null);
    return;
  }

  reportLoading = true;
  ui.renderMaterialReport(null, { loading: true });
  try {
    lastMaterialReport = await ifcService.buildProjectMaterialTakeoff(entities);
    ui.renderMaterialReport(lastMaterialReport);
  } catch (error) {
    console.error(error);
    lastMaterialReport = null;
    ui.renderMaterialReport(null, { error: error?.message ?? String(error) });
  } finally {
    reportLoading = false;
  }
};

ui.onTabChange((tab) => {
  if (tab === "viewer") {
    // Canvas becomes visible again — force a redraw/resize.
    window.dispatchEvent(new Event("resize"));
    viewer.requestRender();
    return;
  }
  if (tab === "report" && !reportLoading && !lastMaterialReport && getEntities(viewer.getModelGroup()).length) {
    void refreshMaterialReport();
  }
});

ui.onRefreshReport(() => {
  void refreshMaterialReport();
});

const resetModelGroup = () => {
  ifcService.closeCurrentModel();
  selection.clearSelection();
  layerManager.reset();
  lastDisciplineCounts = {};
  lastCollisionResult = null;
  activeCollisionPair = null;
  selectedAlignFileName = null;
  fileAlignGizmoEnabled = false;
  fileAlignMode = "translate";
  lastMaterialReport = null;
  ui.setCollisionIsolationEnabled(false);
  viewer.replaceModelGroup(new THREE.Group());
  refreshFileAlignUi();
  ui.renderMaterialReport(null);
};

const focusCollisionPair = (pair) => {
  activeCollisionPair = pair;
  if (ui.isCollisionIsolationEnabled()) {
    applyCollisionIsolationView();
    return;
  }
  selection.highlightCollisionPair(pair.leftMesh, pair.rightMesh, pair);
  viewer.requestRender();
};

const flyToCollisionPair = (pair) => {
  focusCollisionPair(pair);
  viewer.fitCameraToEntities([pair.leftMesh, pair.rightMesh].filter(Boolean));
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

    layerManager.syncDefaultLayersFromCounts(disciplineCounts);
    refreshLayersUi();
    const fileEntries = getFileGroups(modelGroup);
    const restoredCount = restoreStoredFileTransforms(fileEntries);
    if (restoredCount > 0) {
      modelGroup.updateMatrixWorld(true);
      viewer.fitCameraToObject(modelGroup);
    }
    selectedAlignFileName = fileEntries[0]?.name ?? null;
    fileAlignGizmoEnabled = false;
    refreshFileAlignUi();
    ui.setCollisionLayerOptions(layerManager.getLayerNames());
    ui.setCollisionOutput("Brak analizy kolizji.");
    ui.setBaseModelInfo(
      restoredCount > 0
        ? `${summary}\n\nPrzywrocono zapisane wyrównanie dla ${restoredCount} plik(ow).`
        : summary
    );
    ui.showModelInfo();
    viewer.requestRender();
    // Precompute report in background so Raport tab is ready.
    void refreshMaterialReport();
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
  if (viewer.isTransformDragging()) return;

  const pickedEntity = viewer.getPick(event);
  if (!pickedEntity) return;

  if (ui.isCollisionIsolationEnabled() && lastCollisionResult?.samplePairs?.length) {
    const relatedPair =
      lastCollisionResult.samplePairs.find(
        (pair) => pair.leftMesh === pickedEntity || pair.rightMesh === pickedEntity
      ) ?? null;
    if (relatedPair) {
      focusCollisionPair(relatedPair);
      return;
    }
  }

  void selection.selectMesh(pickedEntity);
  viewer.requestRender();
});

ui.canvas.addEventListener("pointercancel", () => {
  pointerDownPos = null;
});

const projectionButton = document.querySelector("[data-projection='toggle']");
const syncProjectionButton = () => {
  if (!projectionButton) return;
  const isOrtho = viewer.getProjectionMode() === "orthographic";
  projectionButton.textContent = isOrtho ? "Ortho" : "Persp";
  projectionButton.classList.toggle("is-ortho", isOrtho);
  projectionButton.title = isOrtho
    ? "Projekcja ortogonalna (kliknij: perspektywa)"
    : "Projekcja perspektywiczna (kliknij: ortogonalna)";
};

document.querySelector(".view-gizmo")?.addEventListener("click", (event) => {
  const projectionToggle = event.target.closest("[data-projection='toggle']");
  if (projectionToggle) {
    viewer.toggleProjectionMode();
    syncProjectionButton();
    return;
  }

  const button = event.target.closest("[data-view]");
  if (!button) return;
  viewer.setCameraView(button.dataset.view);
});

syncProjectionButton();

ui.onCollisionIsolationChange(() => {
  if (!lastCollisionResult?.samplePairs?.length && ui.isCollisionIsolationEnabled()) {
    ui.writeOutput("Najpierw wykryj kolizje, potem wlacz tryb izolacji.");
  }
  applyCollisionIsolationView();
});

ui.detectCollisionsButton.addEventListener("click", () => {
  const modelGroup = viewer.getModelGroup();
  if (!getEntities(modelGroup).length) {
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
  ui.renderCollisionResults(lastCollisionResult, focusCollisionPair, flyToCollisionPair);
  applyCollisionIsolationView();
});

const boot = async () => {
  try {
    await viewer.start();
    refreshFileAlignUi();
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
