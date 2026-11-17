/**
 * Test model for the material take-off (WF-12) and system-based discipline
 * classification (WF-06). Every element is a box, so all expected values are analytic.
 * Output: test-models/materials-systems.ifc (dev-only).
 *
 * Expected material volumes [m3]:
 *   Cegla 7.5 | Welna mineralna 3.6 | Tynk 0.9 | Beton 12.28 | Stal 0.3 | brak 0.28 | suma 24.86
 * Expected disciplines: Konstrukcja 5, Stolarka 1, HVAC 1, WodKan 1, Elektryka 1, MEP 1
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createIfcWriter } from "./lib/ifc-writer.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, "..", "test-models", "materials-systems.ifc");

const ifc = createIfcWriter({
  seed: 0x3a7e41a1,
  projectName: "Model materialowy",
  description: "Warstwy materialowe, Qto i systemy instalacyjne"
});
const storey = ifc.addStorey("Parter", 0);

const brick = ifc.material("Cegla");
const wool = ifc.material("Welna mineralna");
const plaster = ifc.material("Tynk");
const concrete = ifc.material("Beton");
const steel = ifc.material("Stal");

const WALL_COLOR = [0.84, 0.8, 0.72];
const CONCRETE_COLOR = [0.6, 0.6, 0.62];
const wallLayers = () =>
  ifc.materialLayerSetUsage("Sciana warstwowa 40", [
    { material: brick, thickness: 0.25 },
    { material: wool, thickness: 0.12 },
    { material: plaster, thickness: 0.03 }
  ]);

// 1) Layered wall with Qto: layer volume = NetSideArea × thickness (18 × 0.25 / 0.12 / 0.03).
const wallQto = ifc.addBox(storey, {
  type: "IFCWALL",
  name: "Sciana_warstwowa_Qto",
  origin: [3, 0, 0.25],
  size: [6, 0.4],
  height: 3,
  color: WALL_COLOR,
  extraAttributes: [".STANDARD."]
});
ifc.addQuantities(wallQto, "Qto_WallBaseQuantities", {
  area: { NetSideArea: 18 },
  volume: { NetVolume: 7.2 }
});
ifc.associateMaterial([wallQto], wallLayers());

// 2) Layered wall without Qto: mesh volume 4.8 split by thickness share.
const wallMesh = ifc.addBox(storey, {
  type: "IFCWALL",
  name: "Sciana_warstwowa_bez_Qto",
  origin: [2, 6, 0.25],
  size: [4, 0.4],
  height: 3,
  color: WALL_COLOR,
  extraAttributes: [".STANDARD."]
});
ifc.associateMaterial([wallMesh], wallLayers());

// 3) Slab, single material, Qto volume (11.5) deliberately differs from the mesh volume (12.0)
//    to show that quantities from the file take precedence over geometry.
const slab = ifc.addBox(storey, {
  type: "IFCSLAB",
  name: "Plyta_Qto",
  origin: [4, 3, 0],
  size: [8, 6],
  height: 0.25,
  color: CONCRETE_COLOR,
  extraAttributes: [".FLOOR."]
});
ifc.addQuantities(slab, "Qto_SlabBaseQuantities", {
  area: { NetArea: 46 },
  volume: { NetVolume: 11.5 }
});

// 4) Column, single material, no Qto: mesh volume 0.4 × 0.4 × 3 = 0.48.
const column = ifc.addBox(storey, {
  type: "IFCCOLUMN",
  name: "Slup_bez_Qto",
  origin: [7, 3, 0.25],
  size: [0.4, 0.4],
  height: 3,
  color: CONCRETE_COLOR
});
ifc.associateMaterial([slab, column], concrete);

// 5) Beam with two constituents and no thickness: 0.6 m3 split equally.
const beam = ifc.addBox(storey, {
  type: "IFCBEAM",
  name: "Belka_zespolona",
  origin: [4, 3, 3.3],
  size: [4, 0.3],
  height: 0.5,
  color: [0.42, 0.48, 0.62]
});
ifc.associateMaterial(
  [beam],
  ifc.materialConstituentSet("Belka zespolona", [
    { name: "Profil", material: steel },
    { name: "Otulina", material: concrete }
  ])
);

// 6) Door without any material: 0.2 m3 → "Brak / nieprzypisany".
ifc.addBox(storey, {
  type: "IFCDOOR",
  name: "Drzwi_bez_materialu",
  origin: [1, 3, 0.25],
  size: [1, 0.1],
  height: 2,
  color: [0.5, 0.34, 0.2]
});

// Generic IfcFlowSegment elements: the discipline can only come from the assigned
// system (A, B), the ObjectType (C) or stays undetermined (D). Names carry no hints.
const flow = (name, y, objectType = null) =>
  ifc.addBox(storey, {
    type: "IFCFLOWSEGMENT",
    name,
    objectType,
    origin: [4, y, 2.6],
    size: [2, 0.1],
    height: 0.1,
    color: [0.2, 0.6, 0.8]
  });

const segmentA = flow("Segment_A", 1.0);
const segmentB = flow("Segment_B", 1.6);
flow("Segment_C", 4.4, "Cable tray");
flow("Segment_D", 5.0);
ifc.distributionSystem("Wentylacja nawiewna N1", [segmentA]);
ifc.distributionSystem("Instalacja CWU", [segmentB]);

const { entityCount } = ifc.write(outPath);
console.log(`Generated ${outPath} (${entityCount} entities)`);
