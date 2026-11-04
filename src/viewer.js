import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { WebGPURenderer } from "three/webgpu";
import { disposeBatchedModelGroup, getEntityFromPick, getEntityWorldBox } from "./entities.js";
import { readTransformFromGroup } from "./file-alignment.js";

export const createViewer = (canvas) => {
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
    forceWebGL: false
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

  const transformControls = new TransformControls(camera, canvas);
  transformControls.setSize(0.9);
  const transformHelper = transformControls.getHelper();
  scene.add(transformHelper);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let ready = false;
  let needsRender = true;
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
    renderer.render(scene, camera);
    needsRender = controlsMoved;
  };

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
    getModelGroup,
    replaceModelGroup,
    fitCameraToObject,
    fitCameraToEntities,
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
