import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getDisciplineForType, ALL_DISCIPLINES } from "../src/disciplines.js";

const require = createRequire(import.meta.url);
const { IfcAPI } = require("web-ifc");

const __dirname = dirname(fileURLToPath(import.meta.url));
const ifcPath = join(__dirname, "..", "samples", "test-building.ifc");
const wasmPath = join(__dirname, "..", "node_modules", "web-ifc") + "/";

const ifcApi = new IfcAPI();
await ifcApi.SetWasmPath(wasmPath, true);
await ifcApi.Init();

const data = new Uint8Array(readFileSync(ifcPath));
const modelId = ifcApi.OpenModel(data, { COORDINATE_TO_ORIGIN: true });

const disciplineCounts = Object.fromEntries(ALL_DISCIPLINES.map((d) => [d, 0]));
let meshCount = 0;

ifcApi.StreamAllMeshes(modelId, (mesh) => {
  const typeId = ifcApi.GetLineType(modelId, mesh.expressID);
  const discipline = getDisciplineForType(typeId);
  disciplineCounts[discipline] += mesh.geometries.size();
  meshCount += 1;
});

console.log({ meshCount, disciplineCounts });
ifcApi.CloseModel(modelId);
