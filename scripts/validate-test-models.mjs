/**
 * Smoke-checks the generated test models with web-ifc (Node build):
 * every model must open, contain renderable geometry and classify into disciplines.
 * Run `npm run testdata:generate` first.
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_DISCIPLINES, resolveDiscipline } from "../src/disciplines.js";

const require = createRequire(import.meta.url);
const { IfcAPI } = require("web-ifc");

const __dirname = dirname(fileURLToPath(import.meta.url));
const modelsDir = join(__dirname, "..", "test-models");
const wasmPath = join(__dirname, "..", "node_modules", "web-ifc") + "/";
const MODELS = [
  "test-building.ifc",
  "office-building-with-errors.ifc",
  "materials-systems.ifc",
  "scaling-S.ifc"
];

const ifcApi = new IfcAPI();
await ifcApi.SetWasmPath(wasmPath, true);
await ifcApi.Init();

let failed = false;

for (const fileName of MODELS) {
  const ifcPath = join(modelsDir, fileName);
  if (!existsSync(ifcPath)) {
    console.error(`[FAIL] ${fileName}: brak pliku — uruchom "npm run testdata:generate".`);
    failed = true;
    continue;
  }

  const modelId = ifcApi.OpenModel(new Uint8Array(readFileSync(ifcPath)), { COORDINATE_TO_ORIGIN: true });
  if (modelId < 0) {
    console.error(`[FAIL] ${fileName}: web-ifc nie otworzył modelu.`);
    failed = true;
    continue;
  }

  const disciplineCounts = Object.fromEntries(ALL_DISCIPLINES.map((discipline) => [discipline, 0]));
  let elementCount = 0;
  let geometryCount = 0;

  ifcApi.StreamAllMeshes(modelId, (mesh) => {
    const typeId = ifcApi.GetLineType(modelId, mesh.expressID);
    const line = ifcApi.GetLine(modelId, mesh.expressID, false);
    disciplineCounts[resolveDiscipline({ typeId, line })] += mesh.geometries.size();
    geometryCount += mesh.geometries.size();
    elementCount += 1;
  });
  ifcApi.CloseModel(modelId);

  const ok = elementCount > 0 && geometryCount > 0;
  failed ||= !ok;
  console.log(`[${ok ? "OK" : "FAIL"}] ${fileName}`, { elementCount, geometryCount, disciplineCounts });
}

process.exit(failed ? 1 : 0);
