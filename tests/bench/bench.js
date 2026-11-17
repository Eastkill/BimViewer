/**
 * Dev-only test bench (not part of the production build). It drives the real
 * application modules against the generated test models and records results as JSON.
 *
 * Run:  npm run testdata:generate  &&  npm run dev
 * Open: http://localhost:5173/tests/bench/            (WebGPU, falls back to WebGL 2)
 *       http://localhost:5173/tests/bench/?renderer=webgl   (forced WebGL 2)
 * Optional: ?sizes=S,M,L,XL  ?runs=5  ?autorun=all
 */
import * as THREE from "three";
import { detectLayerCollisions } from "../../src/collisions.js";
import { detectDuplicates } from "../../src/duplicates.js";
import { computeEntityOneSidedSurfaceArea, getEntities, getEntityWorldBox } from "../../src/entities.js";
import { buildFileCacheKey, getCachedProcessedFile } from "../../src/ifc-cache.js";
import { createIfcService } from "../../src/ifc-service.js";
import { createLayerManager } from "../../src/layer-manager.js";
import { computeEntityMeshVolume } from "../../src/material-takeoff.js";
import { createViewer } from "../../src/viewer.js";

const params = new URLSearchParams(window.location.search);
const forceWebGL = params.get("renderer") === "webgl";
const RUNS = Math.max(1, Number(params.get("runs")) || 5);
const SIZES = (params.get("sizes") || "S,M,L,XL").split(",").map((s) => s.trim().toUpperCase());
const MODELS_URL = `${window.location.origin}/test-models/`;

const statusEl = document.querySelector("#status");
const logEl = document.querySelector("#log");
const canvas = document.querySelector("#benchCanvas");

const results = { startedAt: new Date().toISOString(), environment: null, suites: {} };
window.__bench = { results, state: "init", progress: "" };

const setStatus = (text) => {
  statusEl.textContent = text;
  window.__bench.progress = text;
};
const show = () => {
  logEl.textContent = JSON.stringify(results, null, 2);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// requestAnimationFrame is suspended while the tab is not being painted (hidden panel,
// background tab), which would stall a run forever — fall back to a timer after 250 ms.
let stalledFrames = 0;
const nextFrame = () =>
  new Promise((resolve) => {
    const timer = setTimeout(() => {
      stalledFrames += 1;
      window.__bench.stalledFrames = stalledFrames;
      resolve();
    }, 250);
    requestAnimationFrame(() => {
      clearTimeout(timer);
      resolve();
    });
  });
const round = (value, digits = 3) => (Number.isFinite(value) ? Number(value.toFixed(digits)) : value);
const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return {
    median: round(median, 1),
    min: round(sorted[0], 1),
    max: round(sorted[sorted.length - 1], 1),
    runs: values.map((value) => round(value, 1))
  };
};

const viewer = createViewer(canvas, { forceWebGL });
const ifcService = createIfcService();
const layerManager = createLayerManager();
const fileCache = new Map();

const fetchFile = async (name) => {
  if (!fileCache.has(name)) {
    const response = await fetch(MODELS_URL + name);
    const blob = response.ok ? await response.blob() : null;
    // The dev server answers unknown paths with index.html, so check the STEP header too.
    const header = blob ? await blob.slice(0, 13).text() : "";
    if (header !== "ISO-10303-21;") {
      throw new Error(`Brak modelu ${name} — uruchom "npm run testdata:generate".`);
    }
    fileCache.set(name, new File([blob], name));
  }
  return fileCache.get(name);
};

const clearGeometryCache = () =>
  new Promise((resolve) => {
    const request = indexedDB.deleteDatabase("bimviewer-ifc-cache");
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });

const waitForCacheEntries = async (files, timeoutMs = 60000) => {
  const keys = [];
  for (const file of files) {
    keys.push(await buildFileCacheKey(file, new Uint8Array(await file.arrayBuffer())));
  }
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const entries = await Promise.all(keys.map((key) => getCachedProcessedFile(key)));
    if (entries.every(Boolean)) return true;
    await sleep(100);
  }
  return false;
};

/** Loads models exactly like the application does and returns the load time. */
const loadModels = async (names) => {
  const files = await Promise.all(names.map(fetchFile));
  const group = new THREE.Group();
  viewer.replaceModelGroup(group);
  const t0 = performance.now();
  const loaded = await ifcService.loadFilesIntoGroup(files, group);
  const loadMs = performance.now() - t0;

  layerManager.reset();
  layerManager.syncDefaultLayersFromCounts(loaded.disciplineCounts);
  layerManager.assignMeshes(group);
  layerManager.applyVisibilityAndOpacity(group);
  viewer.fitCameraToObject(group);
  viewer.requestRender();
  await nextFrame();
  await nextFrame();

  return { group, files, loadMs, loaded, entities: getEntities(group) };
};

const describePair = (pair) => {
  const boxA = getEntityWorldBox(pair.leftMesh);
  const boxB = getEntityWorldBox(pair.rightMesh);
  // Penetration depth of the bounding boxes: 0 means the elements only touch.
  const depth = Math.min(
    Math.min(boxA.max.x, boxB.max.x) - Math.max(boxA.min.x, boxB.min.x),
    Math.min(boxA.max.y, boxB.max.y) - Math.max(boxA.min.y, boxB.min.y),
    Math.min(boxA.max.z, boxB.max.z) - Math.max(boxA.min.z, boxB.min.z)
  );
  return {
    a: pair.leftMesh.name,
    b: pair.rightMesh.name,
    layers: `${pair.leftMesh.layerName} × ${pair.rightMesh.layerName}`,
    kind: pair.kind,
    aabbPenetration: round(depth, 4)
  };
};

const collisionSummary = (result) => ({
  tolerance: result.tolerance,
  tested: `${result.testedA} × ${result.testedB}`,
  aabbCandidates: result.aabbCandidates,
  meshRejected: result.meshRejected,
  soft: result.softClashCount,
  solid: result.collisionsCount - result.softClashCount,
  total: result.collisionsCount,
  elapsedMs: result.elapsedMs
});

// ---------------------------------------------------------------------------
// Suite: validation (collisions, tolerance, duplicates)
// ---------------------------------------------------------------------------

const EXPECTED_CLASH_ELEMENTS = [
  "ERROR_Rura_przez_sciane",
  "ERROR_Rura_przez_slup",
  "ERROR_Rura_wewnatrz_slupa",
  "ERROR_Kanal_przez_belke",
  "ERROR_Oprawa_w_kanale",
  "ERROR_Drzwi_w_slupie",
  "ERROR_Pion_przez_plyte"
];

const pairKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);

const fetchOracle = async (modelName) => {
  const response = await fetch(MODELS_URL + modelName.replace(/\.ifc$/, ".oracle.json"));
  return response.json();
};

/** Runs the detector for every layer pair (including a layer against itself). */
const collectDetectedPairs = (group, tolerance) => {
  const layers = layerManager.getLayerNames();
  const pairs = new Map();
  const perLayerPair = [];
  for (let i = 0; i < layers.length; i += 1) {
    for (let j = i; j < layers.length; j += 1) {
      const result = detectLayerCollisions(group, layers[i], layers[j], { tolerance });
      if (result.testedA === 0 || result.testedB === 0) continue;
      perLayerPair.push({ layers: `${layers[i]} × ${layers[j]}`, ...collisionSummary(result) });
      for (const pair of result.samplePairs) {
        const key = pairKey(pair.leftMesh.expressID, pair.rightMesh.expressID);
        pairs.set(key, { key, names: [pair.leftMesh.name, pair.rightMesh.name], kind: pair.kind });
      }
    }
  }
  return { pairs, perLayerPair };
};

/**
 * Confusion matrix of the detector against the oracle (single-file model).
 * The detector reports touching elements at tolerance 0, so touching pairs are
 * counted separately from real penetrations.
 */
const compareWithOracle = (model, oracle, tolerance, { perLayerPair = true } = {}) => {
  const loaded = new Set(model.entities.map((entity) => entity.expressID));
  const reference = oracle.pairs.filter((pair) => loaded.has(pair.a) && loaded.has(pair.b));
  const minDepth = tolerance < 0 ? -tolerance : 0;
  const penetrating = reference.filter((pair) => pair.kind === "penetrating" && pair.depth > minDepth);
  const touching = tolerance < 0 ? [] : reference.filter((pair) => pair.kind === "touching");
  const referenceKeys = new Map([...penetrating, ...touching].map((pair) => [pairKey(pair.a, pair.b), pair]));

  const detected = collectDetectedPairs(model.group, tolerance);
  const label = (pair) => `${pair.names[0]} × ${pair.names[1]}${pair.depth != null ? ` (${pair.depth} m)` : ""}`;
  const missed = (list) => list.filter((pair) => !detected.pairs.has(pairKey(pair.a, pair.b)));
  const falsePositives = [...detected.pairs.values()].filter((pair) => !referenceKeys.has(pair.key));
  const totalPairs = (model.entities.length * (model.entities.length - 1)) / 2;

  return {
    tolerance,
    allElementPairs: totalPairs,
    oraclePenetrating: penetrating.length,
    detectedPenetrating: penetrating.length - missed(penetrating).length,
    missedPenetrating: missed(penetrating).map(label),
    oracleTouching: touching.length,
    detectedTouching: touching.length - missed(touching).length,
    missedTouching: missed(touching).map(label),
    falsePositives: falsePositives.map(label),
    aabbCandidates: detected.perLayerPair.reduce((sum, row) => sum + row.aabbCandidates, 0),
    meshRejected: detected.perLayerPair.reduce((sum, row) => sum + row.meshRejected, 0),
    ...(perLayerPair ? { perLayerPair: detected.perLayerPair } : {})
  };
};

const runValidation = async () => {
  const suite = {};
  results.suites.validation = suite;

  // --- Collisions vs the independent oracle: every layer pair (also a layer with itself) ---
  setStatus("walidacja: model biurowca");
  let office = await loadModels(["office-building-with-errors.ifc"]);
  const officeOracle = await fetchOracle("office-building-with-errors.ifc");
  suite.officeCollisions = {
    elements: office.entities.length,
    disciplineCounts: office.loaded.disciplineCounts,
    tolerance0: compareWithOracle(office, officeOracle, 0),
    toleranceMinus1mm: compareWithOracle(office, officeOracle, -0.001, { perLayerPair: false }),
    errorElements: EXPECTED_CLASH_ELEMENTS.map((name) => {
      const partners = (pairs) =>
        pairs.filter((pair) => pair.names.includes(name)).map((pair) => pair.names.find((n) => n !== name));
      const detected = collectDetectedPairs(office.group, 0);
      return {
        name,
        oraclePartners: partners(officeOracle.pairs.filter((pair) => pair.kind === "penetrating")).sort(),
        detectedPartners: partners(
          [...detected.pairs.values()].filter((pair) => {
            const reference = officeOracle.pairs.find((p) => pairKey(p.a, p.b) === pair.key);
            return reference?.kind === "penetrating";
          })
        ).sort()
      };
    })
  };

  setStatus("walidacja: model prosty");
  const simple = await loadModels(["test-building.ifc"]);
  suite.testBuildingCollisions = {
    elements: simple.entities.length,
    tolerance0: compareWithOracle(simple, await fetchOracle("test-building.ifc"), 0, { perLayerPair: false })
  };
  office = await loadModels(["office-building-with-errors.ifc"]);

  // --- Tolerance sweep ---
  setStatus("walidacja: tolerancja");
  const tolerances = [-0.2, -0.1, -0.05, -0.02, -0.01, 0, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5];
  suite.toleranceSweep = {};
  for (const [a, b] of [
    ["Konstrukcja", "WodKan"],
    ["Konstrukcja", "HVAC"],
    ["Konstrukcja", "Stolarka"],
    ["Elektryka", "HVAC"]
  ]) {
    suite.toleranceSweep[`${a} × ${b}`] = tolerances.map((tolerance) =>
      collisionSummary(detectLayerCollisions(office.group, a, b, { tolerance }))
    );
  }

  // --- Duplicates: single file and federated (shared GlobalId across files) ---
  setStatus("walidacja: duplikaty");
  const describeGroups = (result) =>
    result.groups.map((group) => ({
      kind: group.kind,
      label: group.label,
      elements: group.items.map((item) => `${item.entity.name} [${item.entity.sourceFile}]`)
    }));

  const officeDup = detectDuplicates(office.group);
  suite.duplicatesOffice = {
    elementCount: officeDup.elementCount,
    globalIdGroups: officeDup.globalIdDuplicateGroups,
    geometricGroups: officeDup.geometricDuplicateGroups,
    groups: describeGroups(officeDup)
  };

  suite.duplicateToleranceSweep = {
    positionTolerance: [0.01, 0.03, 0.05, 0.06, 0.1, 0.2, 0.5, 1, 3].map((positionTolerance) => {
      const result = detectDuplicates(office.group, { positionTolerance, sizeTolerance: 0.05 });
      return { positionTolerance, geometricGroups: result.geometricDuplicateGroups, labels: result.groups.filter((g) => g.kind === "geometry").map((g) => g.items.map((item) => item.entity.name).join(" / ")) };
    }),
    sizeTolerance: [0.001, 0.01, 0.05, 0.2, 1].map((sizeTolerance) => {
      const result = detectDuplicates(office.group, { positionTolerance: 0.1, sizeTolerance });
      return { sizeTolerance, geometricGroups: result.geometricDuplicateGroups };
    })
  };

  const both = await loadModels(["test-building.ifc", "office-building-with-errors.ifc"]);
  const bothDup = detectDuplicates(both.group);
  suite.duplicatesFederated = {
    elementCount: bothDup.elementCount,
    globalIdGroups: bothDup.globalIdDuplicateGroups,
    geometricGroups: bothDup.geometricDuplicateGroups,
    groups: describeGroups(bothDup)
  };

  // --- Scaling model S: analytically known number of clashes ---
  setStatus("walidacja: model skalowany S");
  const scaling = await loadModels(["scaling-S.ifc"]);
  const scalingResult = detectLayerCollisions(scaling.group, "Konstrukcja", "WodKan", { tolerance: 0 });
  const scalingPairs = scalingResult.samplePairs.map(describePair);
  suite.scalingGroundTruth = {
    expectedByConstruction: 10,
    crossLayer: collisionSummary(scalingResult),
    allPairsInvolveErrorElement: scalingPairs.every((pair) => pair.a.startsWith("ERROR_") || pair.b.startsWith("ERROR_")),
    allLayersVsOracle: compareWithOracle(scaling, await fetchOracle("scaling-S.ifc"), 0, { perLayerPair: false })
  };
  show();
};

// ---------------------------------------------------------------------------
// Suite: calculations (volumes, areas, materials, disciplines from systems)
// ---------------------------------------------------------------------------

const relErr = (measured, expected) => round(((measured - expected) / expected) * 100, 2);

const runCalculations = async () => {
  const suite = {};
  results.suites.calculations = suite;

  setStatus("obliczenia: model materiałowy");
  const model = await loadModels(["materials-systems.ifc"]);

  suite.disciplinesFromSystems = {
    expected: { Konstrukcja: 5, Stolarka: 1, Elektryka: 1, WodKan: 1, HVAC: 1, MEP: 1, Inne: 0 },
    measured: model.loaded.disciplineCounts,
    perElement: model.entities
      .filter((entity) => entity.typeName === "IFCFLOWSEGMENT")
      .map((entity) => ({ name: entity.name, discipline: entity.discipline }))
  };

  const expectedVolumes = {
    Sciana_warstwowa_Qto: 7.2,
    Sciana_warstwowa_bez_Qto: 4.8,
    Plyta_Qto: 12,
    Slup_bez_Qto: 0.48,
    Belka_zespolona: 0.6,
    Drzwi_bez_materialu: 0.2,
    Segment_A: 0.02,
    Segment_B: 0.02,
    Segment_C: 0.02,
    Segment_D: 0.02
  };
  suite.meshVolume = model.entities.map((entity) => {
    const measured = computeEntityMeshVolume(entity);
    const expected = expectedVolumes[entity.name];
    return { name: entity.name, expected, measured: round(measured, 5), errorPercent: relErr(measured, expected) };
  });

  const takeoff = await ifcService.buildProjectMaterialTakeoff(model.entities);
  const expectedMaterials = {
    Cegla: 7.5,
    "Welna mineralna": 3.6,
    Tynk: 0.9,
    Beton: 12.28,
    Stal: 0.3,
    "Brak / nieprzypisany": 0.28
  };
  suite.materialTakeoff = {
    expectedTotal: 24.86,
    measuredTotal: round(takeoff.totalVolumeM3, 4),
    elementCount: takeoff.elementCount,
    elementsWithMaterials: takeoff.elementsWithMaterials,
    elementsFromQto: takeoff.elementsFromQto,
    elementsFromGeometry: takeoff.elementsFromGeometry,
    rows: Object.entries(expectedMaterials).map(([material, expected]) => {
      const row = takeoff.rows.find((item) => item.material === material);
      return {
        material,
        expected,
        measured: row ? round(row.volumeM3, 4) : null,
        errorPercent: row ? relErr(row.volumeM3, expected) : null,
        sources: row?.sources ?? []
      };
    }),
    unexpectedRows: takeoff.rows.filter((row) => !(row.material in expectedMaterials)).map((row) => row.material)
  };

  setStatus("obliczenia: model biurowca");
  const office = await loadModels(["office-building-with-errors.ifc"]);

  const officeOracle = await fetchOracle("office-building-with-errors.ifc");
  const reference = new Map(officeOracle.products.map((product) => [product.expressID, product]));

  // Geometry pipeline (web-ifc → BatchedMesh) vs the oracle: volume and box dimensions of every element.
  let maxVolumeError = 0;
  let maxSizeDeviation = 0;
  for (const entity of office.entities) {
    const product = reference.get(entity.expressID);
    maxVolumeError = Math.max(maxVolumeError, Math.abs(computeEntityMeshVolume(entity) - product.volume) / product.volume);
    const box = getEntityWorldBox(entity);
    const measuredSize = [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z].sort((a, b) => a - b);
    const expectedSize = product.max.map((value, i) => value - product.min[i]).sort((a, b) => a - b);
    measuredSize.forEach((value, i) => {
      maxSizeDeviation = Math.max(maxSizeDeviation, Math.abs(value - expectedSize[i]));
    });
  }
  suite.geometryVsOracle = {
    elements: office.entities.length,
    maxRelativeVolumeErrorPercent: round(maxVolumeError * 100, 4),
    maxBoxSizeDeviationM: round(maxSizeDeviation, 6)
  };

  // Walls: one-sided area estimated from the mesh vs the analytic side area (length × height).
  suite.wallAreaFromMesh = office.entities
    .filter((entity) => entity.typeName?.toUpperCase().startsWith("IFCWALL"))
    .map((entity) => {
      const product = reference.get(entity.expressID);
      const measured = computeEntityOneSidedSurfaceArea(entity);
      const size = product.max.map((value, i) => value - product.min[i]);
      return {
        name: entity.name,
        analyticSide: round(product.sideArea, 3),
        measured: round(measured, 3),
        errorPercent: relErr(measured, product.sideArea),
        // thickness / length — the predicted relative error if end faces are included
        endFaceShare: round((Math.min(size[0], size[1]) / Math.max(size[0], size[1])) * 100, 2)
      };
    });

  const spatial = await ifcService.buildProjectSpatialAreas(office.entities);
  // Rows are sorted by elevation: ground floor first (it has the extra diagonal wall, 16 m²).
  const expectedStoreys = [
    { spaceNet: 52, spaceGross: 55.5, slab: 216, wallAnalytic: 256 },
    { spaceNet: 40, spaceGross: 42, slab: 216, wallAnalytic: 240 }
  ];
  suite.spatialAreas = {
    storeyCount: spatial.storeyCount,
    spacesTotal: spatial.meta.spacesTotal,
    spacesSkippedNoQto: spatial.meta.spacesSkippedNoQto,
    slabsExcluded: spatial.meta.slabsExcluded,
    rows: spatial.storeyRows.map((row, index) => {
      const expected = expectedStoreys[index] ?? null;
      return {
        storey: row.storeyName,
        spaceNet: round(row.spaceNetArea, 2),
        spaceGross: round(row.spaceGrossArea, 2),
        slab: round(row.slabArea, 2),
        wallNet: round(row.wallNetArea, 2),
        expected,
        wallErrorPercent: expected ? relErr(row.wallNetArea, expected.wallAnalytic) : null
      };
    })
  };

  const officeTakeoff = await ifcService.buildProjectMaterialTakeoff(office.entities);
  suite.officeVolume = {
    totalVolumeM3: round(officeTakeoff.totalVolumeM3, 3),
    elementCount: officeTakeoff.elementCount,
    elementsFromGeometry: officeTakeoff.elementsFromGeometry
  };
  show();
};

// ---------------------------------------------------------------------------
// Suite: performance (loading, collisions, rendering)
// ---------------------------------------------------------------------------

const measureRendering = async (durationMs = 3000) => {
  // Idle: on-demand rendering must not draw anything while nothing changes.
  await sleep(600);
  const idleStart = viewer.getRenderStats();
  await sleep(1500);
  const idleEnd = viewer.getRenderStats();

  // Active: continuous camera movement (alternating zoom) driven through the real controls.
  const before = viewer.getRenderStats();
  const stalledBefore = stalledFrames;
  const frameTimes = [];
  let last = performance.now();
  const t0 = last;
  let frame = 0;
  while (performance.now() - t0 < durationMs) {
    canvas.dispatchEvent(
      new WheelEvent("wheel", { deltaY: (frame >> 4) % 2 ? 40 : -40, bubbles: true, cancelable: true })
    );
    await nextFrame();
    const now = performance.now();
    frameTimes.push(now - last);
    last = now;
    frame += 1;
  }
  const after = viewer.getRenderStats();
  const elapsed = performance.now() - t0;
  const rendered = after.frames - before.frames;
  const sorted = [...frameTimes].sort((a, b) => a - b);

  return {
    // > 0 means the tab was not being painted and the frame timings below are not valid
    stalledFrames: stalledFrames - stalledBefore,
    idleFramesIn1500ms: idleEnd.frames - idleStart.frames,
    fps: round((frameTimes.length / elapsed) * 1000, 1),
    renderedFrames: rendered,
    frameTimeMedianMs: round(sorted[sorted.length >> 1], 2),
    frameTimeP95Ms: round(sorted[Math.floor(sorted.length * 0.95)], 2),
    renderCpuMsPerFrame: rendered ? round((after.cpuMs - before.cpuMs) / rendered, 3) : null,
    drawCalls: after.drawCalls,
    triangles: after.triangles
  };
};

const runPerformance = async () => {
  const suite = { runsPerMeasurement: RUNS, models: [] };
  results.suites.performance = suite;

  for (const size of SIZES) {
    const name = `scaling-${size}.ifc`;
    const row = { model: name };
    suite.models.push(row);

    // Cold load: geometry cache removed before every run.
    const cold = [];
    let model = null;
    for (let i = 0; i < RUNS; i += 1) {
      setStatus(`wydajność ${size}: wczytywanie bez pamięci podręcznej ${i + 1}/${RUNS}`);
      await clearGeometryCache();
      model = await loadModels([name]);
      if (model.loaded.cacheStats.hits !== 0) throw new Error("Oczekiwano braku wpisu w pamięci podręcznej.");
      cold.push(model.loadMs);
    }
    row.fileSizeMiB = round(model.files[0].size / 1048576, 2);
    row.elements = model.entities.length;
    row.loadColdMs = stats(cold);

    // Warm load: wait until the background cache write has finished.
    const cached = await waitForCacheEntries(model.files);
    row.cacheWritten = cached;
    if (cached) {
      const warm = [];
      for (let i = 0; i < RUNS; i += 1) {
        setStatus(`wydajność ${size}: wczytywanie z pamięci podręcznej ${i + 1}/${RUNS}`);
        model = await loadModels([name]);
        if (model.loaded.cacheStats.hits !== 1) throw new Error("Oczekiwano trafienia w pamięci podręcznej.");
        warm.push(model.loadMs);
      }
      row.loadWarmMs = stats(warm);
      row.cacheSpeedup = round(row.loadColdMs.median / row.loadWarmMs.median, 2);
    }

    setStatus(`wydajność ${size}: kolizje`);
    const collisionTimes = [];
    let collision = null;
    for (let i = 0; i < RUNS; i += 1) {
      const t0 = performance.now();
      collision = detectLayerCollisions(model.group, "Konstrukcja", "WodKan", { tolerance: 0 });
      collisionTimes.push(performance.now() - t0);
      await nextFrame();
    }
    row.collisions = {
      tested: `${collision.testedA} × ${collision.testedB}`,
      pairsChecked: collision.testedA * collision.testedB,
      aabbCandidates: collision.aabbCandidates,
      meshRejected: collision.meshRejected,
      found: collision.collisionsCount,
      timeMs: stats(collisionTimes)
    };

    setStatus(`wydajność ${size}: duplikaty`);
    const duplicateTimes = [];
    for (let i = 0; i < Math.min(RUNS, 3); i += 1) {
      const t0 = performance.now();
      detectDuplicates(model.group);
      duplicateTimes.push(performance.now() - t0);
      await nextFrame();
    }
    row.duplicatesTimeMs = stats(duplicateTimes);

    setStatus(`wydajność ${size}: raport`);
    const reportStart = performance.now();
    await Promise.all([
      ifcService.buildProjectMaterialTakeoff(model.entities),
      ifcService.buildProjectSpatialAreas(model.entities)
    ]);
    row.reportMs = round(performance.now() - reportStart, 0);

    setStatus(`wydajność ${size}: renderowanie`);
    row.rendering = await measureRendering();
    row.jsHeapMiB = performance.memory ? round(performance.memory.usedJSHeapSize / 1048576, 0) : null;
    show();
  }
};

// ---------------------------------------------------------------------------

const readEnvironment = async () => {
  const env = {
    backend: viewer.getBackendName(),
    forcedWebGL: forceWebGL,
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    deviceMemoryGiB: navigator.deviceMemory ?? null,
    devicePixelRatio: window.devicePixelRatio,
    canvasCssSize: `${canvas.clientWidth}×${canvas.clientHeight}`,
    crossOriginIsolated: window.crossOriginIsolated,
    webgpuAdapter: null,
    webglRenderer: null
  };
  try {
    const adapter = await navigator.gpu?.requestAdapter();
    if (adapter?.info) {
      const { vendor, architecture, device, description } = adapter.info;
      env.webgpuAdapter = { vendor, architecture, device, description };
    }
  } catch {
    // WebGPU unavailable
  }
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    if (ext) env.webglRenderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
  } catch {
    // WebGL unavailable
  }
  return env;
};

// Rendering only (short): one load per model, then idle and camera-motion measurements.
const runRender = async () => {
  const suite = { models: [] };
  results.suites.render = suite;
  for (const size of SIZES) {
    setStatus(`renderowanie ${size}: wczytywanie`);
    const model = await loadModels([`scaling-${size}.ifc`]);
    setStatus(`renderowanie ${size}: pomiar`);
    suite.models.push({
      model: `scaling-${size}.ifc`,
      elements: model.entities.length,
      batches: model.group.userData.batches.length,
      ...(await measureRendering(5000))
    });
    show();
  }
};

/** Stores one suite in tests/results/ through the dev-server endpoint (see vite.config.js). */
const saveSuite = async (name, startedAt) => {
  const backend = results.environment.backend.replace(/\s/g, "").toLowerCase();
  const payload = {
    suite: name,
    startedAt,
    finishedAt: new Date().toISOString(),
    environment: results.environment,
    results: results.suites[name]
  };
  try {
    await fetch(`${window.location.origin}/__bench-results?name=${name}-${backend}`, {
      method: "POST",
      body: JSON.stringify(payload, null, 2)
    });
  } catch (error) {
    console.warn("Nie zapisano wyników na dysku:", error);
  }
};

const SUITES = {
  validation: runValidation,
  calculations: runCalculations,
  performance: runPerformance,
  render: runRender
};
const buttons = [...document.querySelectorAll("button[data-suite]")];

const runSuites = async (which) => {
  const names = which === "all" ? Object.keys(SUITES) : [which];
  buttons.forEach((button) => (button.disabled = true));
  window.__bench.state = "running";
  try {
    for (const name of names) {
      const startedAt = new Date().toISOString();
      await SUITES[name]();
      await saveSuite(name, startedAt);
    }
    results.finishedAt = new Date().toISOString();
    window.__bench.state = "done";
    setStatus("zakończono");
  } catch (error) {
    console.error(error);
    results.error = error?.message ?? String(error);
    results.errorStack = error?.stack ?? null;
    window.__bench.state = "error";
    setStatus(`błąd: ${results.error}`);
  } finally {
    buttons.forEach((button) => (button.disabled = false));
    show();
  }
};
window.__bench.run = runSuites;
Object.assign(window.__bench, { viewer, ifcService, layerManager, loadModels, fetchFile });

buttons.forEach((button) => button.addEventListener("click", () => runSuites(button.dataset.suite)));
document.querySelector("#download").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(results, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `bimviewer-bench-${results.environment?.backend?.replace(/\s/g, "") ?? "x"}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
});

try {
  await viewer.start();
  await ifcService.init();
  results.environment = await readEnvironment();
  window.__bench.state = "ready";
  setStatus(`gotowe — renderer: ${results.environment.backend}`);
  show();
  const autorun = params.get("autorun");
  if (autorun) void runSuites(autorun);
} catch (error) {
  console.error(error);
  window.__bench.state = "error";
  setStatus(`błąd inicjalizacji: ${error?.message ?? error}`);
}
