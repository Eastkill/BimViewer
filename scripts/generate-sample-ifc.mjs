/**
 * Generates a small multi-discipline IFC4 sample building for BimViewer tests.
 * Includes structure, architecture, electrical, water/sewage, HVAC and intentional collisions.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, "..", "samples", "test-building.ifc");

let nextId = 1;
const lines = [];
const id = () => nextId++;

const esc = (value) => String(value).replace(/\\/g, "\\\\").replace(/'/g, "''");
const emit = (entity) => {
  const expressId = id();
  lines.push(`#${expressId}=${entity};`);
  return expressId;
};

const point = (x, y, z) => emit(`IFCCARTESIANPOINT((${x},${y},${z}))`);
const direction = (x, y, z) => emit(`IFCDIRECTION((${x},${y},${z}))`);

const axis2Placement3D = (originId, axisId = null, refId = null) => {
  const a = axisId ?? direction(0, 0, 1);
  const r = refId ?? direction(1, 0, 0);
  return emit(`IFCAXIS2PLACEMENT3D(#${originId},#${a},#${r})`);
};

const localPlacement = (relativeTo, origin, axis = [0, 0, 1], ref = [1, 0, 0]) => {
  const originId = point(...origin);
  const axisId = direction(...axis);
  const refId = direction(...ref);
  const placement3d = axis2Placement3D(originId, axisId, refId);
  if (relativeTo == null) {
    return emit(`IFCLOCALPLACEMENT($,#${placement3d})`);
  }
  return emit(`IFCLOCALPLACEMENT(#${relativeTo},#${placement3d})`);
};

const rectangleProfile = (name, xDim, yDim) => {
  const origin2d = emit("IFCCARTESIANPOINT((0.,0.))");
  const dir2d = emit("IFCDIRECTION((1.,0.))");
  const placement2d = emit(`IFCAXIS2PLACEMENT2D(#${origin2d},#${dir2d})`);
  return emit(`IFCRECTANGLEPROFILEDEF(.AREA.,'${esc(name)}',#${placement2d},${xDim},${yDim})`);
};

const extrudedSolid = (profileId, depth, dir = [0, 0, 1]) => {
  const solidOrigin = point(0, 0, 0);
  const solidAxis = direction(...dir);
  const solidRef = direction(1, 0, 0);
  const solidPlacement = axis2Placement3D(solidOrigin, solidAxis, solidRef);
  const extrudeDir = direction(...dir);
  return emit(
    `IFCEXTRUDEDAREASOLID(#${profileId},#${solidPlacement},#${extrudeDir},${depth})`
  );
};

const shapeRep = (solidId) => {
  const context = contexts.model;
  return emit(`IFCSHAPEREPRESENTATION(#${context},'Body','SweptSolid',(#${solidId}))`);
};

const productShape = (repId) => emit(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${repId}))`);

const colourRgb = (r, g, b) => emit(`IFCCOLOURRGB($,${r},${g},${b})`);
const surfaceStyleRendering = (colourId) =>
  emit(`IFCSURFACESTYLERENDERING(#${colourId},0.,$,$,$,$,$,$,.FLAT.)`);
const surfaceStyle = (name, renderingId) =>
  emit(`IFCSURFACESTYLE('${esc(name)}',.BOTH.,(#${renderingId}))`);
const styledItem = (itemId, styleId) => emit(`IFCSTYLEDITEM(#${itemId},(#${styleId}),$)`);

const styleSolid = (solidId, name, rgb) => {
  const colour = colourRgb(...rgb);
  const rendering = surfaceStyleRendering(colour);
  const style = surfaceStyle(name, rendering);
  styledItem(solidId, style);
};

const ownerHistory = (() => {
  const person = emit("IFCPERSON($,'BimViewer',$,$,$,$,$,$)");
  const org = emit("IFCORGANIZATION($,'BimViewer Lab',$,$,$)");
  const personOrg = emit(`IFCPERSONANDORGANIZATION(#${person},#${org},$)`);
  const app = emit(
    "IFCAPPLICATION(#" +
      org +
      ",'1.0','BimViewer Sample Generator','BimViewer')"
  );
  return emit(
    `IFCOWNERHISTORY(#${personOrg},#${app},$,.ADDED.,$,$,$,1710000000)`
  );
})();

const geometricRepresentationContext = emit(
  `IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.0E-5,#${axis2Placement3D(point(0, 0, 0))},$)`
);
const contexts = {
  model: emit(
    `IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,#${geometricRepresentationContext},$,.MODEL_VIEW.,$)`
  )
};

const projectPlacement = localPlacement(null, [0, 0, 0]);
const sitePlacement = localPlacement(projectPlacement, [0, 0, 0]);
const buildingPlacement = localPlacement(sitePlacement, [0, 0, 0]);
const storeyPlacement = localPlacement(buildingPlacement, [0, 0, 0]);

const lengthUnit = emit("IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)");
const areaUnit = emit("IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)");
const volumeUnit = emit("IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)");
const planeAngleUnit = emit("IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)");
const unitAssignment = emit(
  `IFCUNITASSIGNMENT((#${lengthUnit},#${areaUnit},#${volumeUnit},#${planeAngleUnit}))`
);

const project = emit(
  `IFCPROJECT('2O2Fr$t4X7Zf8NOew3FLOH',#${ownerHistory},'BimViewer Test Building',` +
    `'Symulacja budynku do testow warstw i kolizji',$,$,$,(#${geometricRepresentationContext}),#${unitAssignment})`
);

const site = emit(
  `IFCSITE('3$1j_N28jBeP5FQqJlDB5x',#${ownerHistory},'Dzialka testowa',$,$,#${sitePlacement},$,$,.ELEMENT.,$,$,$,$,$)`
);
const building = emit(
  `IFCBUILDING('1xS3BCk291UvhgP2DvNs$9',#${ownerHistory},'Budynek biurowo-techniczny',$,$,#${buildingPlacement},$,$,.ELEMENT.,$,$,$)`
);
const storey = emit(
  `IFCBUILDINGSTOREY('2$QrKcj0X7w8P1Yb3LmN0a',#${ownerHistory},'Parter',$,$,#${storeyPlacement},$,$,.ELEMENT.,0.)`
);

const relAggregates = (relating, related, name) =>
  emit(
    `IFCRELAGGREGATES('${guid()}',#${ownerHistory},'${esc(name)}',$,#${relating},(${related
      .map((x) => `#${x}`)
      .join(",")}))`
  );

const relContained = (storeyId, elements, name) =>
  emit(
    `IFCRELCONTAINEDINSPATIALSTRUCTURE('${guid()}',#${ownerHistory},'${esc(name)}',$,(${elements
      .map((x) => `#${x}`)
      .join(",")}),#${storeyId})`
  );

function guid() {
  // IFC compressed GUID-like tokens (22 chars); uniqueness is enough for sample.
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
  let out = "";
  for (let i = 0; i < 22; i += 1) {
    out += alphabet[(Math.random() * alphabet.length) | 0];
  }
  return out;
}

const createExtrudedProduct = ({
  typeName,
  name,
  description,
  placementParent,
  origin,
  axis = [0, 0, 1],
  ref = [1, 0, 0],
  profileSize,
  depth,
  color,
  tag = null
}) => {
  const placement = localPlacement(placementParent, origin, axis, ref);
  const profile = rectangleProfile(name, profileSize[0], profileSize[1]);
  const solid = extrudedSolid(profile, depth);
  styleSolid(solid, name, color);
  const rep = shapeRep(solid);
  const shape = productShape(rep);
  const tagPart = tag == null ? "$" : `'${esc(tag)}'`;
  const product = emit(
    `${typeName}('${guid()}',#${ownerHistory},'${esc(name)}','${esc(description)}',$,#${placement},#${shape},${tagPart})`
  );
  return product;
};

const elements = [];

// --- Structure: slab 10 x 8 x 0.3 ---
elements.push(
  createExtrudedProduct({
    typeName: "IFCSLAB",
    name: "Plyta_parter",
    description: "Plyta stropowa/podlogowa",
    placementParent: storeyPlacement,
    origin: [0, 0, 0],
    profileSize: [10, 8],
    depth: 0.3,
    color: [0.55, 0.55, 0.55],
    tag: "S-SLAB-01"
  })
);

// --- Structure: roof slab ---
elements.push(
  createExtrudedProduct({
    typeName: "IFCROOF",
    name: "Dach_plaski",
    description: "Dach plaski",
    placementParent: storeyPlacement,
    origin: [0, 0, 3.3],
    profileSize: [10.4, 8.4],
    depth: 0.25,
    color: [0.35, 0.35, 0.4],
    tag: "S-ROOF-01"
  })
);

// Walls: south, north, west, east
const wallDefs = [
  { name: "Sciana_S", origin: [0, -0.15, 0.3], size: [10, 0.3], depth: 3 },
  { name: "Sciana_N", origin: [0, 7.85, 0.3], size: [10, 0.3], depth: 3 },
  { name: "Sciana_W", origin: [-0.15, 0, 0.3], size: [0.3, 8], depth: 3 },
  { name: "Sciana_E", origin: [9.85, 0, 0.3], size: [0.3, 8], depth: 3 }
];
for (const wall of wallDefs) {
  elements.push(
    createExtrudedProduct({
      typeName: "IFCWALL",
      name: wall.name,
      description: "Sciana konstrukcyjna",
      placementParent: storeyPlacement,
      origin: wall.origin,
      profileSize: wall.size,
      depth: wall.depth,
      color: [0.82, 0.78, 0.7],
      tag: wall.name
    })
  );
}

// Columns
const columns = [
  [0.4, 0.4],
  [9.2, 0.4],
  [0.4, 7.2],
  [9.2, 7.2],
  [4.8, 4]
];
columns.forEach((xy, index) => {
  elements.push(
    createExtrudedProduct({
      typeName: "IFCCOLUMN",
      name: `Slup_${index + 1}`,
      description: "Slup zelbetowy",
      placementParent: storeyPlacement,
      origin: [xy[0], xy[1], 0.3],
      profileSize: [0.4, 0.4],
      depth: 3,
      color: [0.7, 0.7, 0.72],
      tag: `S-COL-${index + 1}`
    })
  );
});

// Beams
elements.push(
  createExtrudedProduct({
    typeName: "IFCBEAM",
    name: "Belka_glowna_X",
    description: "Belka stropowa",
    placementParent: storeyPlacement,
    origin: [0.5, 3.8, 3.0],
    profileSize: [9, 0.3],
    depth: 0.4,
    color: [0.45, 0.5, 0.65],
    tag: "S-BEAM-01"
  })
);

elements.push(
  createExtrudedProduct({
    typeName: "IFCFOOTING",
    name: "Lawa_fundamentowa",
    description: "Fundament",
    placementParent: storeyPlacement,
    origin: [-0.4, -0.4, -0.5],
    profileSize: [10.8, 8.8],
    depth: 0.5,
    color: [0.4, 0.38, 0.35],
    tag: "S-FOOT-01"
  })
);

// Architecture
elements.push(
  createExtrudedProduct({
    typeName: "IFCDOOR",
    name: "Drzwi_wejscie",
    description: "Drzwi wejsciowe",
    placementParent: storeyPlacement,
    origin: [4.2, -0.2, 0.3],
    profileSize: [1.2, 0.12],
    depth: 2.1,
    color: [0.45, 0.28, 0.15],
    tag: "A-DOOR-01"
  })
);

elements.push(
  createExtrudedProduct({
    typeName: "IFCWINDOW",
    name: "Okno_N",
    description: "Okno fasadowe",
    placementParent: storeyPlacement,
    origin: [3.5, 7.9, 1.2],
    profileSize: [2.0, 0.12],
    depth: 1.4,
    color: [0.55, 0.75, 0.9],
    tag: "A-WIN-01"
  })
);

elements.push(
  createExtrudedProduct({
    typeName: "IFCWINDOW",
    name: "Okno_E",
    description: "Okno boczne",
    placementParent: storeyPlacement,
    origin: [9.9, 2.5, 1.1],
    profileSize: [0.12, 1.8],
    depth: 1.5,
    color: [0.55, 0.75, 0.9],
    tag: "A-WIN-02"
  })
);

// Electrical
elements.push(
  createExtrudedProduct({
    typeName: "IFCLIGHTFIXTURE",
    name: "Oprawa_LED_1",
    description: "Oprawa sufitowa",
    placementParent: storeyPlacement,
    origin: [2.5, 2.5, 3.1],
    profileSize: [0.6, 0.6],
    depth: 0.12,
    color: [0.95, 0.9, 0.4],
    tag: "E-LGT-01"
  })
);

elements.push(
  createExtrudedProduct({
    typeName: "IFCLIGHTFIXTURE",
    name: "Oprawa_LED_2",
    description: "Oprawa sufitowa",
    placementParent: storeyPlacement,
    origin: [7, 5.5, 3.1],
    profileSize: [0.6, 0.6],
    depth: 0.12,
    color: [0.95, 0.9, 0.4],
    tag: "E-LGT-02"
  })
);

elements.push(
  createExtrudedProduct({
    typeName: "IFCELECTRICDISTRIBUTIONBOARD",
    name: "Rozdzielnica_RG",
    description: "Tablica rozdzielcza",
    placementParent: storeyPlacement,
    origin: [0.2, 5.5, 1.0],
    profileSize: [0.25, 0.8],
    depth: 1.2,
    color: [0.2, 0.35, 0.75],
    tag: "E-DB-01"
  })
);

// Water / sewage
// Horizontal pipe intentionally intersects east wall (collision STRUCTURE x WodKan)
elements.push(
  createExtrudedProduct({
    typeName: "IFCPIPESEGMENT",
    name: "Rura_CWU_kolizyjna",
    description: "Rura przechodzaca przez sciane - kolizja testowa",
    placementParent: storeyPlacement,
    origin: [8.5, 3.7, 1.6],
    profileSize: [2.0, 0.12],
    depth: 0.12,
    color: [0.15, 0.55, 0.85],
    tag: "P-PIPE-COL"
  })
);

elements.push(
  createExtrudedProduct({
    typeName: "IFCPIPESEGMENT",
    name: "Rura_kanal_pion",
    description: "Pion kanalizacyjny",
    placementParent: storeyPlacement,
    origin: [1.2, 1.2, 0.3],
    profileSize: [0.15, 0.15],
    depth: 3.0,
    color: [0.2, 0.65, 0.35],
    tag: "P-PIPE-02"
  })
);

elements.push(
  createExtrudedProduct({
    typeName: "IFCPIPEFITTING",
    name: "Kolanko_90",
    description: "Ksztaltka rurowa",
    placementParent: storeyPlacement,
    origin: [1.1, 1.1, 3.1],
    profileSize: [0.25, 0.25],
    depth: 0.25,
    color: [0.2, 0.7, 0.45],
    tag: "P-FIT-01"
  })
);

elements.push(
  createExtrudedProduct({
    typeName: "IFCSANITARYTERMINAL",
    name: "Umywalka",
    description: "Umysel sanitarny",
    placementParent: storeyPlacement,
    origin: [1.5, 0.4, 0.8],
    profileSize: [0.6, 0.45],
    depth: 0.2,
    color: [0.9, 0.9, 0.92],
    tag: "P-SAN-01"
  })
);

// HVAC
// Duct intentionally intersects main beam (collision STRUCTURE x HVAC)
elements.push(
  createExtrudedProduct({
    typeName: "IFCDUCTSEGMENT",
    name: "Kanal_nawiew_kolizyjny",
    description: "Kanal HVAC przecinajacy belke - kolizja testowa",
    placementParent: storeyPlacement,
    origin: [4.2, 3.5, 2.85],
    profileSize: [0.5, 1.2],
    depth: 0.4,
    color: [0.85, 0.55, 0.2],
    tag: "H-DUCT-COL"
  })
);

elements.push(
  createExtrudedProduct({
    typeName: "IFCDUCTSEGMENT",
    name: "Kanal_wywiew",
    description: "Kanal wywiewny",
    placementParent: storeyPlacement,
    origin: [6.5, 1.0, 2.9],
    profileSize: [2.5, 0.4],
    depth: 0.35,
    color: [0.9, 0.6, 0.25],
    tag: "H-DUCT-02"
  })
);

elements.push(
  createExtrudedProduct({
    typeName: "IFCDUCTFITTING",
    name: "Trojnik_HVAC",
    description: "Ksztaltka kanalowa",
    placementParent: storeyPlacement,
    origin: [6.3, 0.9, 2.85],
    profileSize: [0.5, 0.5],
    depth: 0.45,
    color: [0.95, 0.65, 0.3],
    tag: "H-FIT-01"
  })
);

elements.push(
  createExtrudedProduct({
    typeName: "IFCAIRTERMINAL",
    name: "Nawiewnik",
    description: "Nawiewnik sufitowy",
    placementParent: storeyPlacement,
    origin: [5.0, 2.0, 3.15],
    profileSize: [0.5, 0.5],
    depth: 0.08,
    color: [0.85, 0.85, 0.88],
    tag: "H-AT-01"
  })
);

elements.push(
  createExtrudedProduct({
    typeName: "IFCFLOWCONTROLLER",
    name: "Przepustnica",
    description: "Przepustnica powietrza",
    placementParent: storeyPlacement,
    origin: [7.8, 1.05, 2.95],
    profileSize: [0.2, 0.35],
    depth: 0.25,
    color: [0.7, 0.45, 0.2],
    tag: "H-FC-01"
  })
);

// Near-duplicate geometry pair for duplicate detection (same size boxes, separate products)
elements.push(
  createExtrudedProduct({
    typeName: "IFCPIPESEGMENT",
    name: "Rura_duplikat_A",
    description: "Segment A do testu duplikatow",
    placementParent: storeyPlacement,
    origin: [3.0, 6.0, 0.5],
    profileSize: [0.1, 0.1],
    depth: 1.0,
    color: [0.1, 0.5, 0.8],
    tag: "P-DUP-A"
  })
);
elements.push(
  createExtrudedProduct({
    typeName: "IFCPIPESEGMENT",
    name: "Rura_duplikat_B",
    description: "Segment B do testu duplikatow (identyczna geometria lokalna)",
    placementParent: storeyPlacement,
    origin: [3.4, 6.0, 0.5],
    profileSize: [0.1, 0.1],
    depth: 1.0,
    color: [0.1, 0.5, 0.8],
    tag: "P-DUP-B"
  })
);

relAggregates(project, [site], "ProjectContainer");
relAggregates(site, [building], "SiteContainer");
relAggregates(building, [storey], "BuildingContainer");
relContained(storey, elements, "StoreyElements");

const content = [
  "ISO-10303-21;",
  "HEADER;",
  "FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');",
  "FILE_NAME('test-building.ifc','2026-03-26T12:00:00',('BimViewer'),('BimViewer Lab'),'BimViewer Sample Generator','BimViewer','');",
  "FILE_SCHEMA(('IFC4'));",
  "ENDSEC;",
  "DATA;",
  ...lines,
  "ENDSEC;",
  "END-ISO-10303-21;"
].join("\n");

writeFileSync(outPath, content, "utf8");
console.log(`Generated ${outPath}`);
console.log(`Entities: ${lines.length}, products: ${elements.length}`);
