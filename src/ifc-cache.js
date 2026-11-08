import * as THREE from "three";

const DB_NAME = "bimviewer-ifc-cache";
const DB_VERSION = 1;
const STORE_NAME = "processedFiles";
export const IFC_CACHE_SCHEMA_VERSION = 2;
const MAX_ENTRIES = 12;

const openDb = () =>
  new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB niedostepne"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "key" });
        store.createIndex("savedAt", "savedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
  });

const toHex = (buffer) =>
  [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/**
 * Stable fingerprint: name + size + hash(head/tail).
 * Avoids File.lastModified (unstable for File-from-Blob samples).
 */
export const buildFileCacheKey = async (file, data) => {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const size = bytes.byteLength;
  const sliceSize = Math.min(65536, size);
  const head = bytes.subarray(0, sliceSize);
  const tail = size > sliceSize ? bytes.subarray(size - sliceSize) : head;
  const token = new Uint8Array(head.byteLength + tail.byteLength + 8);
  token.set(head, 0);
  token.set(tail, head.byteLength);
  const view = new DataView(token.buffer);
  view.setUint32(head.byteLength + tail.byteLength, size >>> 0, true);
  view.setUint32(head.byteLength + tail.byteLength + 4, Math.floor(size / 0x100000000), true);

  let hashHex = "nohash";
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", token);
    hashHex = toHex(digest).slice(0, 32);
  } else {
    let sum = 0;
    for (let i = 0; i < token.length; i += 97) sum = (sum + token[i]) >>> 0;
    hashHex = `c${sum.toString(16)}`;
  }

  return `v${IFC_CACHE_SCHEMA_VERSION}|${file.name}|${size}|${hashHex}`;
};

export const getCachedProcessedFile = async (key) => {
  try {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const request = tx.objectStore(STORE_NAME).get(key);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
};

export const setCachedProcessedFile = async (entry) => {
  try {
    const db = await openDb();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);

        store.put({
          ...entry,
          schemaVersion: IFC_CACHE_SCHEMA_VERSION,
          savedAt: Date.now()
        });

        const countReq = store.count();
        countReq.onsuccess = () => {
          const count = countReq.result || 0;
          if (count <= MAX_ENTRIES) return;

          let removed = 0;
          const removeCount = count - MAX_ENTRIES;
          const cursorReq = store.index("savedAt").openCursor();
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (!cursor || removed >= removeCount) return;
            cursor.delete();
            removed += 1;
            cursor.continue();
          };
        };

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("IndexedDB write failed"));
        tx.onabort = () => reject(tx.error || new Error("IndexedDB write aborted"));
      });
      return true;
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
};

export const serializeGeometries = (geometryCache, placements) => {
  const geometries = {};
  const used = new Set();

  for (const placement of placements) {
    if (used.has(placement.geometryExpressID)) continue;
    const geometry = geometryCache.get(placement.geometryKey);
    if (!geometry) continue;
    const position = geometry.getAttribute("position")?.array;
    const normal = geometry.getAttribute("normal")?.array;
    const index = geometry.getIndex()?.array;
    if (!position || !normal || !index) continue;

    geometries[String(placement.geometryExpressID)] = {
      position: position instanceof Float32Array ? position : new Float32Array(position),
      normal: normal instanceof Float32Array ? normal : new Float32Array(normal),
      index: index instanceof Uint32Array ? index : new Uint32Array(index)
    };
    used.add(placement.geometryExpressID);
  }

  return geometries;
};

export const serializePlacements = (placements) =>
  placements.map((placement) => ({
    geometryExpressID: placement.geometryExpressID,
    flatTransformation: Array.from(placement.flatTransformation),
    color: { ...placement.color },
    opacity: placement.opacity,
    expressID: placement.expressID,
    typeId: placement.typeId,
    typeName: placement.typeName,
    objectType: placement.objectType,
    name: placement.name,
    globalId: placement.globalId ?? null,
    discipline: placement.discipline
  }));

export const hydrateGeometryCache = (geometries, modelId, geometryCache) => {
  for (const [expressId, payload] of Object.entries(geometries || {})) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(
        payload.position instanceof Float32Array ? payload.position : new Float32Array(payload.position),
        3
      )
    );
    geometry.setAttribute(
      "normal",
      new THREE.BufferAttribute(
        payload.normal instanceof Float32Array ? payload.normal : new Float32Array(payload.normal),
        3
      )
    );
    geometry.setIndex(
      new THREE.BufferAttribute(
        payload.index instanceof Uint32Array ? payload.index : new Uint32Array(payload.index),
        1
      )
    );
    geometry.computeBoundingBox();
    geometryCache.set(`${modelId}:${expressId}`, geometry);
  }
};

export const rebuildPlacementsFromCache = (cachedPlacements, fileName, modelId) =>
  (cachedPlacements || []).map((item) => ({
    geometryKey: `${modelId}:${item.geometryExpressID}`,
    flatTransformation: item.flatTransformation,
    color: item.color,
    opacity: item.opacity,
    expressID: item.expressID,
    geometryExpressID: item.geometryExpressID,
    typeId: item.typeId,
    typeName: item.typeName,
    objectType: item.objectType,
    name: item.name,
    globalId: item.globalId ?? null,
    discipline: item.discipline,
    sourceFile: fileName,
    modelId
  }));
