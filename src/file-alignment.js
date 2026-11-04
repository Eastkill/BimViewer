import * as THREE from "three";

const STORAGE_KEY = "bimviewer.fileTransforms.v1";

export const createEmptyFileTransform = () => ({
  x: 0,
  y: 0,
  z: 0,
  rx: 0,
  ry: 0,
  rz: 0
});

const normalizeTransform = (transform = {}) => ({
  x: Number(transform.x) || 0,
  y: Number(transform.y) || 0,
  z: Number(transform.z) || 0,
  rx: Number(transform.rx) || 0,
  ry: Number(transform.ry) || 0,
  rz: Number(transform.rz) || 0
});

const isIdentityTransform = (transform) => {
  const t = normalizeTransform(transform);
  return t.x === 0 && t.y === 0 && t.z === 0 && t.rx === 0 && t.ry === 0 && t.rz === 0;
};

const readStoredMap = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const writeStoredMap = (map) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Quota / private mode — ignore persistence failures.
  }
};

export const getStoredFileTransform = (fileName) => {
  if (!fileName) return null;
  const map = readStoredMap();
  const saved = map[fileName];
  return saved ? normalizeTransform(saved) : null;
};

export const persistFileTransform = (fileName, transform) => {
  if (!fileName) return;
  const map = readStoredMap();
  const next = normalizeTransform(transform);

  if (isIdentityTransform(next)) {
    delete map[fileName];
  } else {
    map[fileName] = next;
  }

  writeStoredMap(map);
};

export const clearStoredFileTransform = (fileName) => {
  if (!fileName) return;
  const map = readStoredMap();
  if (!(fileName in map)) return;
  delete map[fileName];
  writeStoredMap(map);
};

export const getFileGroups = (modelGroup) => modelGroup?.userData?.fileGroups ?? [];

export const getFileGroupByName = (modelGroup, fileName) =>
  getFileGroups(modelGroup).find((entry) => entry.name === fileName) ?? null;

export const applyFileTransform = (fileEntry, transform, { persist = true } = {}) => {
  if (!fileEntry?.group) return;

  const next = normalizeTransform(transform);
  fileEntry.transform = next;
  fileEntry.group.position.set(next.x, next.y, next.z);
  fileEntry.group.rotation.set(
    THREE.MathUtils.degToRad(next.rx),
    THREE.MathUtils.degToRad(next.ry),
    THREE.MathUtils.degToRad(next.rz)
  );
  fileEntry.group.updateMatrixWorld(true);

  if (persist) {
    persistFileTransform(fileEntry.name, next);
  }
};

export const readTransformFromGroup = (fileEntry) => {
  if (!fileEntry?.group) return createEmptyFileTransform();
  const { position, rotation } = fileEntry.group;
  return {
    x: Number(position.x.toFixed(4)),
    y: Number(position.y.toFixed(4)),
    z: Number(position.z.toFixed(4)),
    rx: Number(THREE.MathUtils.radToDeg(rotation.x).toFixed(3)),
    ry: Number(THREE.MathUtils.radToDeg(rotation.y).toFixed(3)),
    rz: Number(THREE.MathUtils.radToDeg(rotation.z).toFixed(3))
  };
};

export const resetFileTransform = (fileEntry) => {
  applyFileTransform(fileEntry, createEmptyFileTransform(), { persist: true });
  clearStoredFileTransform(fileEntry?.name);
};

/**
 * Restore saved transforms for loaded file groups (matched by file name).
 * @returns {number} how many files were restored from storage
 */
export const restoreStoredFileTransforms = (fileEntries = []) => {
  let restored = 0;
  for (const entry of fileEntries) {
    const saved = getStoredFileTransform(entry.name);
    if (!saved || isIdentityTransform(saved)) continue;
    applyFileTransform(entry, saved, { persist: false });
    restored += 1;
  }
  return restored;
};
