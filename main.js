import { detectLayerCollisions } from "./src/collisions.js";
import { detectDuplicates } from "./src/duplicates.js";
import { getEntities, getProblemRegion, syncEntityAppearance } from "./src/entities.js";
import {
  applyFileTransform,
  getFileGroupByName,
  getFileGroups,
  persistFileTransform,
  resetFileTransform,
  restoreStoredFileTransforms
} from "./src/file-alignment.js";
import { createIfcService } from "./src/ifc-service.js";
import {
  createIssueStatusStore,
  describeCollisionIssue,
  describeDuplicateIssue,
  ISSUE_STATUS
} from "./src/issue-status.js";
import { createLayerManager } from "./src/layer-manager.js";
import { createSelectionManager, HIGHLIGHT_PROBLEM } from "./src/selection.js";
import { createUI } from "./src/ui.js";
import { createViewer } from "./src/viewer.js";
import * as THREE from "three";

const ui = createUI();
// "?renderer=webgl" forces the WebGL 2 backend (diagnostics / backend comparison).
const forceWebGL = new URLSearchParams(window.location.search).get("renderer") === "webgl";
const viewer = createViewer(ui.canvas, { forceWebGL });
const ifcService = createIfcService();
const layerManager = createLayerManager();
const selection = createSelectionManager({
  showModelInfo: ui.showModelInfo,
  resolveMaterials: async (entity) =>
    ifcService.getElementMaterialsLabel(entity?.modelId, entity?.expressID)
});

const CLICK_MOVE_THRESHOLD_PX = 5;
const ISOLATION_DIM = 0.22;
// Overlay colours of the inspected problem: element A, element B (and further ones).
const PROBLEM_COLOR_A = 0xef4444;
const PROBLEM_COLOR_B = 0xf59e0b;

let pointerDownPos = null;
let lastCollisionResult = null;
let activeCollisionPair = null;
// True while a collision pair / duplicate group is shown with the overlay and dimming.
let problemFocusActive = false;
let lastDuplicateResult = null;
let lastDisciplineCounts = {};
let selectedAlignFileName = null;
let fileAlignGizmoEnabled = false;
let fileAlignMode = "translate";
let suppressAlignUiRefresh = false;
let lastMaterialReport = null;
let reportLoading = false;
// Bumped whenever the model changes, so a report still running for the previous
// model cannot overwrite the current one.
let reportToken = 0;

const issueStatuses = createIssueStatusStore();

// The identity of an issue is derived once and kept on the pair / group object.
const collisionIssue = (pair) => (pair.issue ??= describeCollisionIssue(pair));
const duplicateIssue = (group) => (group.issue ??= describeDuplicateIssue(group));

const collisionStatusApi = {
  get: (pair) => issueStatuses.get(collisionIssue(pair)),
  set: (pair, status) => {
    issueStatuses.set(collisionIssue(pair), status);
    // Ignored pairs drop out of the isolation view.
    if (ui.isCollisionIsolationEnabled() && !activeCollisionPair) applyCollisionIsolationView();
  }
};

const duplicateStatusApi = {
  get: (group) => issueStatuses.get(duplicateIssue(group)),
  set: (group, status) => issueStatuses.set(duplicateIssue(group), status)
};

const collectCollidingEntities = (result) => {
  const entities = new Set();
  for (const pair of result?.samplePairs ?? []) {
    if (collisionStatusApi.get(pair) === ISSUE_STATUS.IGNORED) continue;
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
      viewer.clearProblemOverlay();
      viewer.requestRender();
      // Keep numeric fields in sync without full rebuild while typing is done via change event.
      refreshFileAlignUi();
    },
    onReset: (fileName) => {
      const entry = getFileGroupByName(viewer.getModelGroup(), fileName);
      if (!entry) return;
      resetFileTransform(entry);
      viewer.clearProblemOverlay();
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
            ui.writeOutput("Wybierz plik albo typ encji do powiązania z warstwą użytkownika.");
            return;
          }
          layerManager.addCustomLayer({ name, bindType, bindValue });
          refreshLayersUi();
          ui.setCollisionLayerOptions(layerManager.getLayerNames());
        } catch (error) {
          ui.writeOutput(`Błąd warstwy: ${error?.message ?? String(error)}`);
        }
      },
      onRemoveLayer: (layerId) => {
        try {
          layerManager.removeLayer(layerId);
          refreshLayersUi();
          ui.setCollisionLayerOptions(layerManager.getLayerNames());
        } catch (error) {
          ui.writeOutput(`Błąd warstwy: ${error?.message ?? String(error)}`);
        }
      },
      onResetDefaults: () => {
        layerManager.resetToDefaults(lastDisciplineCounts);
        refreshLayersUi();
        ui.setCollisionLayerOptions(layerManager.getLayerNames());
        ui.writeOutput("Przywrócono warstwy domyślne (branże).");
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
    problemFocusActive = false;
    activeCollisionPair = null;
    viewer.clearProblemOverlay();
    selection.clearSelection();
    restoreAllLayerOpacities();
    return;
  }

  // Without an active pair the overlay (e.g. of a duplicate group) no longer applies.
  if (!activeCollisionPair) {
    problemFocusActive = false;
    viewer.clearProblemOverlay();
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
    color: HIGHLIGHT_PROBLEM,
    infoText: activeCollisionPair
      ? [
          "Tryb izolacji kolizji (aktywna para):",
          `A ExpressID: ${activeCollisionPair.leftExpressId}`,
          `A warstwa: ${activeCollisionPair.leftMesh?.layerName ?? activeCollisionPair.leftDiscipline}`,
          `B ExpressID: ${activeCollisionPair.rightExpressId}`,
          `B warstwa: ${activeCollisionPair.rightMesh?.layerName ?? activeCollisionPair.rightDiscipline}`,
          activeCollisionPair.locationText
        ]
          .filter(Boolean)
          .join("\n")
      : [
          "Tryb izolacji kolizji:",
          `Podświetlone obiekty kolidujące: ${focusList.length}`,
          "Kliknij parę na liście, aby zawęzić widok do jednej kolizji."
        ].join("\n")
  });
  viewer.requestRender();
};

const refreshMaterialReport = async () => {
  const token = ++reportToken;
  const entities = getEntities(viewer.getModelGroup());
  if (!entities.length) {
    lastMaterialReport = null;
    reportLoading = false;
    ui.renderMaterialReport(null);
    return;
  }

  reportLoading = true;
  ui.renderMaterialReport(null, { loading: true });
  try {
    const [materials, spatial] = await Promise.all([
      ifcService.buildProjectMaterialTakeoff(entities),
      ifcService.buildProjectSpatialAreas(entities)
    ]);
    if (token !== reportToken) return;
    lastMaterialReport = { ...materials, spatial };
    ui.renderMaterialReport(lastMaterialReport);
  } catch (error) {
    if (token !== reportToken) return;
    console.error(error);
    lastMaterialReport = null;
    ui.renderMaterialReport(null, { error: error?.message ?? String(error) });
  } finally {
    if (token === reportToken) reportLoading = false;
  }
};

// The report walks every element's materials and quantities, so it is built lazily:
// on the first visit to the "Raport" tab after a model is loaded (or on demand).
const ensureMaterialReport = () => {
  if (reportLoading || lastMaterialReport) return;
  if (!getEntities(viewer.getModelGroup()).length) return;
  void refreshMaterialReport();
};

ui.onTabChange((tab) => {
  if (tab === "viewer") {
    // Canvas becomes visible again — force a redraw/resize.
    window.dispatchEvent(new Event("resize"));
    viewer.requestRender();
    return;
  }
  ensureMaterialReport();
});

ui.onRefreshReport(() => {
  void refreshMaterialReport();
});

const resetModelGroup = () => {
  ifcService.closeAllModels();
  selection.clearSelection();
  layerManager.reset();
  lastDisciplineCounts = {};
  lastCollisionResult = null;
  activeCollisionPair = null;
  problemFocusActive = false;
  lastDuplicateResult = null;
  selectedAlignFileName = null;
  fileAlignGizmoEnabled = false;
  fileAlignMode = "translate";
  lastMaterialReport = null;
  reportLoading = false;
  reportToken += 1;
  ui.setCollisionIsolationEnabled(false);
  viewer.replaceModelGroup(new THREE.Group());
  refreshFileAlignUi();
  ui.setDuplicateOutput("Brak analizy duplikatów.");
  ui.renderMaterialReport(null);
};

const formatRegionSize = (region) => {
  if (!region) return null;
  const size = region.getSize(new THREE.Vector3());
  const dims = [size.x, size.y, size.z].sort((a, b) => b - a);
  return `${dims.map((value) => value.toFixed(2)).join(" × ")} m (najmniejszy wymiar: ${Math.round(dims[2] * 1000)} mm)`;
};

/**
 * Shows where a problem is: the involved elements and the problem region are drawn
 * on top of the model and everything else is dimmed.
 * @returns {THREE.Box3 | null} the problem region
 */
const showProblem = (entities, colors) => {
  const list = [...new Set(entities.filter(Boolean))];
  const region = getProblemRegion(list);
  viewer.showProblemOverlay(
    list.map((entity, index) => ({ entity, color: colors[Math.min(index, colors.length - 1)] })),
    region
  );
  problemFocusActive = true;
  return region;
};

const dimAllExcept = (focusEntities) => {
  for (const entity of getEntities(viewer.getModelGroup())) {
    entity.isolationVisible = true;
    entity.isolationOpacity = 1;
    // Dim without transparency to avoid sorting 30k translucent instances.
    entity.isolationDim = focusEntities.has(entity) ? 1 : ISOLATION_DIM;
    syncEntityAppearance(entity);
  }
};

/** Removes the problem overlay and brings the model back to its normal look. */
const clearProblemFocus = () => {
  if (!problemFocusActive) return;
  problemFocusActive = false;
  activeCollisionPair = null;
  viewer.clearProblemOverlay();
  selection.clearSelection();
  if (ui.isCollisionIsolationEnabled() && lastCollisionResult?.samplePairs?.length) {
    applyCollisionIsolationView();
  } else {
    restoreAllLayerOpacities();
  }
};

const focusCollisionPair = (pair) => {
  activeCollisionPair = pair;
  const entities = [pair.leftMesh, pair.rightMesh];
  const region = showProblem(entities, [PROBLEM_COLOR_A, PROBLEM_COLOR_B]);
  const regionSize = formatRegionSize(region);
  pair.locationText = regionSize
    ? `${pair.kind === "soft" ? "Odstęp brył otaczających" : "Strefa nakładania brył otaczających"}: ${regionSize}`
    : null;

  if (ui.isCollisionIsolationEnabled()) {
    applyCollisionIsolationView();
  } else {
    dimAllExcept(new Set(entities.filter(Boolean)));
    void selection.highlightCollisionPair(pair.leftMesh, pair.rightMesh, pair);
    viewer.requestRender();
  }
  return region;
};

const flyToCollisionPair = (pair) => {
  viewer.fitCameraToRegion(focusCollisionPair(pair));
};

const focusDuplicateGroup = (group) => {
  const entities = group?.entities || [];
  const region = showProblem(entities, [PROBLEM_COLOR_A]);
  dimAllExcept(new Set(entities.filter(Boolean)));
  void selection.highlightDuplicateGroup(group);
  viewer.requestRender();
  return region;
};

const flyToDuplicateGroup = (group) => {
  viewer.fitCameraToRegion(focusDuplicateGroup(group));
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
    ui.setDuplicateOutput("Brak analizy duplikatów.");
    lastDuplicateResult = null;
    ui.setBaseModelInfo(
      restoredCount > 0
        ? `${summary}\n\nPrzywrócono zapisane wyrównanie (liczba plików: ${restoredCount}).`
        : summary
    );
    ui.showModelInfo();
    viewer.requestRender();
    // If the user is already looking at the report, rebuild it for the new model.
    if (ui.getActiveTab() === "report") ensureMaterialReport();
  } catch (error) {
    console.error(error);
    ui.writeOutput(`Błąd wczytywania IFC: ${error?.message ?? String(error)}`);
  } finally {
    ui.setLoading(false);
  }
};

ui.loadButton.addEventListener("click", async () => {
  const files = ui.fileInput.files ? Array.from(ui.fileInput.files) : [];
  if (files.length === 0) {
    ui.writeOutput("Wybierz jeden lub wiele plików IFC.");
    return;
  }
  await loadIfcFiles(files);
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

  clearProblemFocus();
  void selection.selectMesh(pickedEntity);
  viewer.requestRender();
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") clearProblemFocus();
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
    ui.writeOutput("Najpierw wykryj kolizje, potem włącz tryb izolacji.");
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
  lastCollisionResult = detectLayerCollisions(modelGroup, layerA, layerB, {
    tolerance: ui.getCollisionTolerance()
  });
  ui.renderCollisionResults(
    lastCollisionResult,
    focusCollisionPair,
    flyToCollisionPair,
    collisionStatusApi
  );
  applyCollisionIsolationView();
});

ui.detectDuplicatesButton?.addEventListener("click", () => {
  const modelGroup = viewer.getModelGroup();
  if (!getEntities(modelGroup).length) {
    ui.setDuplicateOutput("Najpierw wczytaj model IFC.");
    return;
  }

  clearProblemFocus();
  selection.clearSelection();
  lastDuplicateResult = detectDuplicates(modelGroup, ui.getDuplicateTolerances());
  ui.renderDuplicateResults(
    lastDuplicateResult,
    focusDuplicateGroup,
    flyToDuplicateGroup,
    duplicateStatusApi
  );
  viewer.requestRender();
});

const boot = async () => {
  try {
    await viewer.start();
    refreshFileAlignUi();
    ui.writeOutput(
      `Aplikacja gotowa (renderer: ${viewer.getBackendName()}). Wczytaj pliki IFC — warstwy domyślne odpowiadają branżom, a własne warstwy możesz powiązać z plikiem lub typem encji.`
    );
  } catch (error) {
    console.error(error);
    ui.writeOutput(
      `Błąd inicjalizacji renderera: ${error?.message ?? String(error)}\n` +
        "Upewnij się, że używasz aktualnej przeglądarki Chrome lub Edge (WebGPU albo WebGL 2)."
    );
  }
};

boot();
