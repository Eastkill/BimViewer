import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { WebGPURenderer } from "three/webgpu";
import {
  disposeBatchedModelGroup,
  extractEntityWorldPositions,
  getEntityFromPick,
  getEntityWorldBox
} from "./entities.js";
import { readTransformFromGroup } from "./file-alignment.js";

const PROBLEM_OVERLAY_MAX_ENTITIES = 24;
const PROBLEM_OVERLAY_MAX_TRIANGLES = 400_000;
const PROBLEM_OVERLAY_EDGE_TRIANGLES = 20_000;
const PROBLEM_REGION_COLOR = 0xfacc15;
/** Smallest box edge [m] the camera frames when flying to a problem. */
const PROBLEM_MIN_VIEW_SIZE = 1.5;

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ forceWebGL?: boolean }} [options] forceWebGL skips WebGPU and uses the
 *   WebGL 2 backend directly (used to compare both backends on the same machine).
 */
export const createViewer = (canvas, { forceWebGL = false } = {}) => {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1220);

  const perspectiveCamera = new THREE.PerspectiveCamera(60, 1, 0.1, 5000);
  perspectiveCamera.position.set(12, 12, 12);

  const orthographicCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 5000);
  orthographicCamera.position.copy(perspectiveCamera.position);

  let camera = perspectiveCamera;
  let projectionMode = "perspective";

  const renderer = new WebGPURenderer({
    canvas,
    antialias: true,
    forceWebGL
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.target.set(0, 2, 0);
  controls.update();

  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(8, 12, 10);
  scene.add(dirLight);
  scene.add(new THREE.GridHelper(200, 100, 0x1e3a8a, 0x334155));

  let modelGroup = new THREE.Group();
  scene.add(modelGroup);

  // Overlay with the elements of the currently inspected collision / duplicate group.
  const problemOverlay = new THREE.Group();
  scene.add(problemOverlay);

  const clearProblemOverlay = () => {
    if (!problemOverlay.children.length) return;
    for (const child of problemOverlay.children) {
      child.geometry?.dispose?.();
      child.material?.dispose?.();
      child.dispose?.();
    }
    problemOverlay.clear();
    needsRender = true;
  };

  const transformControls = new TransformControls(camera, canvas);
  transformControls.setSize(0.9);
  const transformHelper = transformControls.getHelper();
  scene.add(transformHelper);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let ready = false;
  let needsRender = true;
  // Frames actually drawn and the CPU time spent submitting them (on-demand rendering
  // means this stays flat while the camera is idle).
  const renderStats = { frames: 0, cpuMs: 0 };
  let activeFileEntry = null;
  let onFileTransformChange = null;

  const requestRender = () => {
    needsRender = true;
  };

  const getViewportAspect = () => {
    const rect = canvas.getBoundingClientRect();
    return Math.max(1, rect.width) / Math.max(1, rect.height);
  };

  const syncOrthoFrustum = (distance = camera.position.distanceTo(controls.target)) => {
    const aspect = getViewportAspect();
    const halfHeight =
      Math.tan(THREE.MathUtils.degToRad(perspectiveCamera.fov) / 2) * Math.max(distance, 0.01);
    orthographicCamera.left = -halfHeight * aspect;
    orthographicCamera.right = halfHeight * aspect;
    orthographicCamera.top = halfHeight;
    orthographicCamera.bottom = -halfHeight;
    orthographicCamera.near = camera.near;
    orthographicCamera.far = camera.far;
    orthographicCamera.updateProjectionMatrix();
  };

  const applyCameraNearFar = (maxDim) => {
    const near = Math.max(0.01, maxDim / 500);
    const far = Math.max(5000, maxDim * 20);
    perspectiveCamera.near = near;
    perspectiveCamera.far = far;
    orthographicCamera.near = near;
    orthographicCamera.far = far;
    perspectiveCamera.updateProjectionMatrix();
    if (projectionMode === "orthographic") {
      syncOrthoFrustum();
    } else {
      orthographicCamera.updateProjectionMatrix();
    }
  };

  controls.addEventListener("change", requestRender);
  transformControls.addEventListener("change", () => {
    // The overlay is built in world coordinates, so it goes stale once a file moves.
    if (transformControls.dragging) clearProblemOverlay();
    if (activeFileEntry) {
      activeFileEntry.transform = readTransformFromGroup(activeFileEntry);
    }
    requestRender();
  });
  transformControls.addEventListener("dragging-changed", (event) => {
    controls.enabled = !event.value;
    if (!event.value && activeFileEntry) {
      activeFileEntry.transform = readTransformFromGroup(activeFileEntry);
      onFileTransformChange?.(activeFileEntry);
    }
  });

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const aspect = width / height;
    perspectiveCamera.aspect = aspect;
    perspectiveCamera.updateProjectionMatrix();
    if (projectionMode === "orthographic") {
      const viewHeight = orthographicCamera.top - orthographicCamera.bottom;
      const viewWidth = viewHeight * aspect;
      orthographicCamera.left = -viewWidth / 2;
      orthographicCamera.right = viewWidth / 2;
      orthographicCamera.updateProjectionMatrix();
    }
    renderer.setSize(width, height, false);
    requestRender();
  };

  const animate = () => {
    if (!ready) return;
    const controlsMoved = controls.update();
    if (!needsRender && !controlsMoved) return;
    const t0 = performance.now();
    renderer.render(scene, camera);
    renderStats.cpuMs += performance.now() - t0;
    renderStats.frames += 1;
    needsRender = controlsMoved;
  };

  /** "WebGPU" or "WebGL 2" — known only after start(). */
  const getBackendName = () => {
    if (!ready) return "nieznany";
    return renderer.backend?.isWebGPUBackend ? "WebGPU" : "WebGL 2";
  };

  const getRenderStats = () => ({
    ...renderStats,
    drawCalls: renderer.info?.render?.drawCalls ?? null,
    triangles: renderer.info?.render?.triangles ?? null
  });

  const start = async () => {
    await renderer.init();
    ready = true;
    window.addEventListener("resize", resize);
    resize();
    renderer.setAnimationLoop(animate);
    requestRender();
  };

  const clearFileTransformGizmo = () => {
    transformControls.detach();
    activeFileEntry = null;
    requestRender();
  };

  const replaceModelGroup = (newGroup) => {
    clearFileTransformGizmo();
    clearProblemOverlay();
    scene.remove(modelGroup);
    disposeBatchedModelGroup(modelGroup);
    modelGroup = newGroup;
    scene.add(modelGroup);
    requestRender();
  };

  const getModelGroup = () => modelGroup;

  const getModelBounds = () => {
    modelGroup.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(modelGroup);
    if (bounds.isEmpty()) {
      return {
        center: controls.target.clone(),
        maxDim: Math.max(controls.target.distanceTo(camera.position) / 1.8, 1)
      };
    }
    const size = bounds.getSize(new THREE.Vector3());
    return {
      center: bounds.getCenter(new THREE.Vector3()),
      maxDim: Math.max(size.x, size.y, size.z, 1)
    };
  };

  const fitCameraToBounds = (bounds, padding = 2.2) => {
    if (!bounds || bounds.isEmpty()) return;

    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 0.25);
    const distance = Math.max(maxDim * padding, 1.5);

    camera.up.set(0, 1, 0);
    camera.position.set(center.x + distance, center.y + distance * 0.75, center.z + distance);
    controls.target.copy(center);
    orthographicCamera.zoom = 1;
    applyCameraNearFar(maxDim);
    if (projectionMode === "orthographic") {
      syncOrthoFrustum(distance);
    }
    controls.update();
    requestRender();
  };

  const fitCameraToObject = (object3D) => {
    object3D.updateMatrixWorld(true);
    fitCameraToBounds(new THREE.Box3().setFromObject(object3D), 1.8);
  };

  const fitCameraToEntities = (entities = []) => {
    const bounds = new THREE.Box3();
    let hasBounds = false;
    for (const entity of entities) {
      if (!entity) continue;
      const box = getEntityWorldBox(entity);
      if (box.isEmpty()) continue;
      if (!hasBounds) {
        bounds.copy(box);
        hasBounds = true;
      } else {
        bounds.union(box);
      }
    }
    if (!hasBounds) return;
    fitCameraToBounds(bounds);
  };

  /**
   * Draws the given entities and the problem region on top of the model (no depth
   * test), so a clash stays visible even when it is buried inside a large building.
   * @param {{ entity: object, color: number }[]} items
   * @param {THREE.Box3 | null} region
   */
  const showProblemOverlay = (items = [], region = null) => {
    clearProblemOverlay();

    let triangleBudget = PROBLEM_OVERLAY_MAX_TRIANGLES;
    for (const { entity, color } of items.slice(0, PROBLEM_OVERLAY_MAX_ENTITIES)) {
      const positions = extractEntityWorldPositions(entity);
      if (!positions) continue;
      const triangles = positions.length / 9;
      if (triangles > triangleBudget) continue;
      triangleBudget -= triangles;

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

      const fill = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.45,
          side: THREE.DoubleSide,
          depthTest: false,
          depthWrite: false
        })
      );
      fill.renderOrder = 1000;
      problemOverlay.add(fill);

      // Outline only moderately sized meshes: EdgesGeometry is O(n) but allocates a lot.
      if (triangles <= PROBLEM_OVERLAY_EDGE_TRIANGLES) {
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(geometry, 30),
          new THREE.LineBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true })
        );
        edges.renderOrder = 1001;
        problemOverlay.add(edges);
      }
    }

    if (region && !region.isEmpty()) {
      // Keep the frame visible when the region is flat or tiny (touching faces, thin overlap).
      const frame = region.clone();
      const size = frame.getSize(new THREE.Vector3());
      const minSize = Math.max(0.05, Math.max(size.x, size.y, size.z) * 0.05);
      frame.expandByVector(
        new THREE.Vector3(
          Math.max(0, minSize - size.x) / 2,
          Math.max(0, minSize - size.y) / 2,
          Math.max(0, minSize - size.z) / 2
        )
      );
      const helper = new THREE.Box3Helper(frame, PROBLEM_REGION_COLOR);
      helper.material.depthTest = false;
      helper.material.depthWrite = false;
      helper.material.transparent = true;
      helper.renderOrder = 1002;
      problemOverlay.add(helper);
    }

    requestRender();
  };

  /** Moves the camera so that the given box fills most of the view. */
  const fitCameraToRegion = (region) => {
    if (!region || region.isEmpty()) return;
    const size = region.getSize(new THREE.Vector3());
    // Small regions: keep enough surroundings in view to recognise the place.
    const frame = region.clone();
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim < PROBLEM_MIN_VIEW_SIZE) frame.expandByScalar((PROBLEM_MIN_VIEW_SIZE - maxDim) / 2);
    fitCameraToBounds(frame, 1.6);
  };

  const VIEW_PRESETS = {
    top: { dir: new THREE.Vector3(0, 1, 0), up: new THREE.Vector3(0, 0, -1) },
    bottom: { dir: new THREE.Vector3(0, -1, 0), up: new THREE.Vector3(0, 0, 1) },
    front: { dir: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0) },
    back: { dir: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0) },
    right: { dir: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0) },
    left: { dir: new THREE.Vector3(-1, 0, 0), up: new THREE.Vector3(0, 1, 0) },
    iso: { dir: new THREE.Vector3(1, 0.75, 1).normalize(), up: new THREE.Vector3(0, 1, 0) }
  };

  const setCameraView = (viewName) => {
    const preset = VIEW_PRESETS[viewName];
    if (!preset) return;

    const { center, maxDim } = getModelBounds();
    const distance = maxDim * 1.8;

    camera.up.copy(preset.up);
    camera.position.copy(center).addScaledVector(preset.dir, distance);
    controls.target.copy(center);
    orthographicCamera.zoom = 1;
    applyCameraNearFar(maxDim);
    if (projectionMode === "orthographic") {
      syncOrthoFrustum(distance);
    }
    controls.update();
    requestRender();
  };

  const getProjectionMode = () => projectionMode;

  const setProjectionMode = (mode) => {
    const next = mode === "orthographic" ? "orthographic" : "perspective";
    if (next === projectionMode) return projectionMode;

    const from = camera;
    const to = next === "orthographic" ? orthographicCamera : perspectiveCamera;
    const offset = new THREE.Vector3().subVectors(from.position, controls.target);
    const distance =
      offset.length() / (from.isOrthographicCamera ? Math.max(from.zoom, 0.0001) : 1);

    to.up.copy(from.up);
    to.near = from.near;
    to.far = from.far;

    if (offset.lengthSq() < 1e-10) {
      to.position.copy(controls.target).add(new THREE.Vector3(0, 0, Math.max(distance, 1)));
    } else {
      to.position.copy(controls.target).addScaledVector(offset.normalize(), Math.max(distance, 0.01));
    }

    if (next === "orthographic") {
      orthographicCamera.zoom = 1;
      syncOrthoFrustum(distance);
    } else {
      perspectiveCamera.aspect = getViewportAspect();
      perspectiveCamera.updateProjectionMatrix();
    }

    camera = to;
    projectionMode = next;
    controls.object = camera;
    transformControls.camera = camera;
    controls.update();
    requestRender();
    return projectionMode;
  };

  const toggleProjectionMode = () =>
    setProjectionMode(projectionMode === "orthographic" ? "perspective" : "orthographic");

  const getPick = (event) => {
    if (transformControls.dragging) return null;

    const batches = modelGroup.userData.batches ?? [];
    if (!batches.length) return null;

    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    const intersections = raycaster.intersectObjects(batches, false);
    if (!intersections.length) return null;
    return getEntityFromPick(intersections[0]);
  };

  const attachFileTransformGizmo = (fileEntry, mode = "translate") => {
    if (!fileEntry?.group) {
      clearFileTransformGizmo();
      return;
    }
    activeFileEntry = fileEntry;
    transformControls.setMode(mode);
    transformControls.attach(fileEntry.group);
    requestRender();
  };

  const setTransformMode = (mode) => {
    if (!["translate", "rotate", "scale"].includes(mode)) return;
    // Scale not useful for BIM alignment — allow only translate/rotate from UI.
    if (mode === "scale") return;
    transformControls.setMode(mode);
    requestRender();
  };

  const setFileTransformChangeHandler = (handler) => {
    onFileTransformChange = handler;
  };

  const isTransformDragging = () => Boolean(transformControls.dragging);

  return {
    start,
    getBackendName,
    getRenderStats,
    getModelGroup,
    replaceModelGroup,
    fitCameraToObject,
    fitCameraToEntities,
    fitCameraToRegion,
    showProblemOverlay,
    clearProblemOverlay,
    setCameraView,
    getProjectionMode,
    setProjectionMode,
    toggleProjectionMode,
    getPick,
    requestRender,
    attachFileTransformGizmo,
    clearFileTransformGizmo,
    setTransformMode,
    setFileTransformChangeHandler,
    isTransformDragging
  };
};
