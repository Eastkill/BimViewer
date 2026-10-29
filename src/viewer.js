import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { WebGPURenderer } from "three/webgpu";

export const createViewer = (canvas) => {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1220);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 5000);
  camera.position.set(12, 12, 12);

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

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let ready = false;

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };

  const animate = () => {
    if (!ready) return;
    controls.update();
    renderer.render(scene, camera);
  };

  const start = async () => {
    await renderer.init();
    ready = true;
    window.addEventListener("resize", resize);
    resize();
    renderer.setAnimationLoop(animate);
  };

  const disposeGroup = (group) => {
    group.traverse((node) => {
      if (!node.isMesh) return;
      node.geometry.dispose();
      if (Array.isArray(node.material)) {
        node.material.forEach((mat) => mat.dispose());
      } else {
        node.material.dispose();
      }
    });
  };

  const replaceModelGroup = (newGroup) => {
    scene.remove(modelGroup);
    disposeGroup(modelGroup);
    modelGroup = newGroup;
    scene.add(modelGroup);
  };

  const getModelGroup = () => modelGroup;

  const fitCameraToObject = (object3D) => {
    object3D.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(object3D);
    if (bounds.isEmpty()) return;

    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 1);

    const distance = maxDim * 1.8;
    camera.position.set(center.x + distance, center.y + distance * 0.75, center.z + distance);
    controls.target.copy(center);
    camera.near = Math.max(0.01, maxDim / 500);
    camera.far = Math.max(5000, maxDim * 20);
    camera.updateProjectionMatrix();
    controls.update();
  };

  const getPick = (event) => {
    if (!modelGroup.children.length) return null;
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    const intersections = raycaster.intersectObjects(modelGroup.children, true);
    return intersections.length ? intersections[0].object : null;
  };

  return {
    start,
    getModelGroup,
    replaceModelGroup,
    fitCameraToObject,
    getPick
  };
};
