/**
 * Realistic 2-storey office IFC4 sample with intentional coordination errors.
 * Output: samples/office-building-with-errors.ifc
 */
import { copyFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, "..", "samples", "office-building-with-errors.ifc");
const publicPath = join(__dirname, "..", "public", "samples", "office-building-with-errors.ifc");

let nextId = 1;
const lines = [];
const id = () => nextId++;
const esc = (value) => String(value).replace(/\\/g, "\\\\").replace(/'/g, "''");
const emit = (entity) => {
  const expressId = id();
  lines.push(`#${expressId}=${entity};`);
  return expressId;
};

/** Deterministic PRNG (mulberry32) — stable GlobalId across regenerations. */
const mulberry32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const rand = mulberry32(0x0ff1ce01);

const guid = () => {
  // IFC compressed GUID: first char encodes 2 bits → must be in 0–3.
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
  let out = alphabet[(rand() * 4) | 0];
  for (let i = 1; i < 22; i += 1) out += alphabet[(rand() * alphabet.length) | 0];
  return out;
};

const point = (x, y, z) => emit(`IFCCARTESIANPOINT((${x},${y},${z}))`);
const direction = (x, y, z) => emit(`IFCDIRECTION((${x},${y},${z}))`);
const axis2Placement3D = (originId, axisId = null, refId = null) => {
  const a = axisId ?? direction(0, 0, 1);
  const r = refId ?? direction(1, 0, 0);
  return emit(`IFCAXIS2PLACEMENT3D(#${originId},#${a},#${r})`);
};
const localPlacement = (relativeTo, origin, axis = [0, 0, 1], ref = [1, 0, 0]) => {
  const placement3d = axis2Placement3D(point(...origin), direction(...axis), direction(...ref));
  return relativeTo == null
    ? emit(`IFCLOCALPLACEMENT($,#${placement3d})`)
    : emit(`IFCLOCALPLACEMENT(#${relativeTo},#${placement3d})`);
};
const rectangleProfile = (name, xDim, yDim) => {
  const placement2d = emit(
    `IFCAXIS2PLACEMENT2D(#${emit("IFCCARTESIANPOINT((0.,0.))")},#${emit("IFCDIRECTION((1.,0.))")})`
  );
  return emit(`IFCRECTANGLEPROFILEDEF(.AREA.,'${esc(name)}',#${placement2d},${xDim},${yDim})`);
};
const extrudedSolid = (profileId, depth) => {
  const solidPlacement = axis2Placement3D(point(0, 0, 0), direction(0, 0, 1), direction(1, 0, 0));
  return emit(`IFCEXTRUDEDAREASOLID(#${profileId},#${solidPlacement},#${direction(0, 0, 1)},${depth})`);
};

const person = emit("IFCPERSON($,'Koordynator',$,$,$,$,$,$)");
const org = emit("IFCORGANIZATION($,'BimViewer Lab',$,$,$)");
const personOrg = emit(`IFCPERSONANDORGANIZATION(#${person},#${org},$)`);
const app = emit(`IFCAPPLICATION(#${org},'1.0','BimViewer Realistic Sample','BimViewer')`);
const ownerHistory = emit(`IFCOWNERHISTORY(#${personOrg},#${app},$,.ADDED.,$,$,$,1730000000)`);

const world = axis2Placement3D(point(0, 0, 0));
const geometricRepresentationContext = emit(
  `IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.0E-5,#${world},$)`
);
const bodyContext = emit(
  `IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,#${geometricRepresentationContext},$,.MODEL_VIEW.,$)`
);

const lengthUnit = emit("IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)");
const areaUnit = emit("IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)");
const volumeUnit = emit("IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)");
const planeAngleUnit = emit("IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)");
const unitAssignment = emit(
  `IFCUNITASSIGNMENT((#${lengthUnit},#${areaUnit},#${volumeUnit},#${planeAngleUnit}))`
);

const projectPlacement = localPlacement(null, [0, 0, 0]);
const sitePlacement = localPlacement(projectPlacement, [0, 0, 0]);
const buildingPlacement = localPlacement(sitePlacement, [0, 0, 0]);

const project = emit(
  `IFCPROJECT('${guid()}',#${ownerHistory},'Biurowiec Riverview',` +
    `'Sample 2 kondygnacje z celowymi kolizjami MEP',$,$,$,(#${geometricRepresentationContext}),#${unitAssignment})`
);
const site = emit(
  `IFCSITE('${guid()}',#${ownerHistory},'Dzialka A12',$,$,#${sitePlacement},$,$,.ELEMENT.,$,$,$,$,$)`
);
const building = emit(
  `IFCBUILDING('${guid()}',#${ownerHistory},'Biurowiec Riverview',$,$,#${buildingPlacement},$,$,.ELEMENT.,$,$,$)`
);

const storey0Placement = localPlacement(buildingPlacement, [0, 0, 0]);
const storey1Placement = localPlacement(buildingPlacement, [0, 0, 3.5]);
const storey0 = emit(
  `IFCBUILDINGSTOREY('${guid()}',#${ownerHistory},'Parter',$,$,#${storey0Placement},$,$,.ELEMENT.,0.)`
);
const storey1 = emit(
  `IFCBUILDINGSTOREY('${guid()}',#${ownerHistory},'Pietro 1',$,$,#${storey1Placement},$,$,.ELEMENT.,3.5)`
);

const shapeRep = (solidId) =>
  emit(`IFCSHAPEREPRESENTATION(#${bodyContext},'Body','SweptSolid',(#${solidId}))`);
const productShape = (repId) => emit(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${repId}))`);
const colourRgb = (r, g, b) => emit(`IFCCOLOURRGB($,${r},${g},${b})`);
const styleSolid = (solidId, name, rgb) => {
  const rendering = emit(`IFCSURFACESTYLERENDERING(#${colourRgb(...rgb)},0.,$,$,$,$,$,$,.FLAT.)`);
  const style = emit(`IFCSURFACESTYLE('${esc(name)}',.BOTH.,(#${rendering}))`);
  emit(`IFCSTYLEDITEM(#${solidId},(#${style}),$)`);
};

const attachAreaQuantities = (productId, qtoName, quantities) => {
  const refs = [];
  for (const [qName, value] of Object.entries(quantities || {})) {
    if (!(value > 0)) continue;
    refs.push(emit(`IFCQUANTITYAREA('${esc(qName)}','${esc(qName)}',$,${value},$)`));
  }
  if (!refs.length) return;
  const eq = emit(
    `IFCELEMENTQUANTITY('${guid()}',#${ownerHistory},'${esc(qtoName)}',$,$,(${refs.map((id) => `#${id}`).join(",")}))`
  );
  emit(`IFCRELDEFINESBYPROPERTIES('${guid()}',#${ownerHistory},$,$,(#${productId}),#${eq})`);
};

const createBox = ({
  typeName,
  name,
  description,
  parentPlacement,
  origin,
  size,
  depth,
  color,
  tag,
  predefinedType = null,
  globalId = null,
  areaQuantities = null,
  qtoName = "Qto_BaseQuantities",
  axis = [0, 0, 1],
  ref = [1, 0, 0]
}) => {
  const placement = localPlacement(parentPlacement, origin, axis, ref);
  const profile = rectangleProfile(name, size[0], size[1]);
  const solid = extrudedSolid(profile, depth);
  styleSolid(solid, name, color);
  const shape = productShape(shapeRep(solid));
  const typeSuffix = predefinedType ? `,.${predefinedType}.` : "";
  const product = emit(
    `${typeName}('${globalId || guid()}',#${ownerHistory},'${esc(name)}','${esc(description)}',$,#${placement},#${shape},'${esc(tag)}'${typeSuffix})`
  );
  if (areaQuantities) attachAreaQuantities(product, qtoName, areaQuantities);
  return product;
};

const createSpace = ({
  name,
  longName,
  parentPlacement,
  origin,
  size,
  depth,
  netArea,
  grossArea
}) => {
  const placement = localPlacement(parentPlacement, origin);
  const profile = rectangleProfile(name, size[0], size[1]);
  const solid = extrudedSolid(profile, depth);
  styleSolid(solid, name, [0.55, 0.75, 0.95]);
  const shape = productShape(shapeRep(solid));
  const space = emit(
    `IFCSPACE('${guid()}',#${ownerHistory},'${esc(name)}','Pomieszczenie',$,#${placement},#${shape},'${esc(
      longName
    )}',.ELEMENT.,.INTERNAL.,$)`
  );
  attachAreaQuantities(space, "Qto_SpaceBaseQuantities", {
    NetFloorArea: netArea,
    GrossFloorArea: grossArea
  });
  return space;
};

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

const W = 18;
const D = 12;
const H = 3.2;
const WALL = 0.3;
const elements0 = [];
const elements1 = [];

const addStoreyShell = (bucket, placement, levelTag) => {
  bucket.push(
    createBox({
      typeName: "IFCSLAB",
      name: `Plyta_${levelTag}`,
      description: "Plyta stropowa/podlogowa",
      parentPlacement: placement,
      origin: [0, 0, 0],
      size: [W, D],
      depth: 0.28,
      color: [0.55, 0.55, 0.55],
      tag: `S-SLAB-${levelTag}`,
      predefinedType: "FLOOR",
      qtoName: "Qto_SlabBaseQuantities",
      areaQuantities: { NetArea: W * D, GrossArea: W * D }
    })
  );

  // W without Qto (along plan Y → mesh-area path); diagonal without Qto on P0 only.
  const walls = [
    { name: `Sciana_S_${levelTag}`, origin: [0, -WALL / 2, 0.28], size: [W, WALL], netSide: W * H, withQto: true },
    { name: `Sciana_N_${levelTag}`, origin: [0, D - WALL / 2, 0.28], size: [W, WALL], netSide: W * H, withQto: true },
    { name: `Sciana_W_${levelTag}`, origin: [-WALL / 2, 0, 0.28], size: [WALL, D], netSide: D * H, withQto: false },
    { name: `Sciana_E_${levelTag}`, origin: [W - WALL / 2, 0, 0.28], size: [WALL, D], netSide: D * H, withQto: true },
    { name: `Sciana_kor_A_${levelTag}`, origin: [0, 4.85, 0.28], size: [7.5, 0.2], netSide: 7.5 * H, withQto: true },
    { name: `Sciana_kor_B_${levelTag}`, origin: [10.5, 4.85, 0.28], size: [7.5, 0.2], netSide: 7.5 * H, withQto: true }
  ];
  for (const wall of walls) {
    bucket.push(
      createBox({
        typeName: "IFCWALL",
        name: wall.name,
        description: "Sciana murowana/zelbet",
        parentPlacement: placement,
        origin: wall.origin,
        size: wall.size,
        depth: H,
        color: [0.84, 0.8, 0.72],
        tag: wall.name,
        predefinedType: "STANDARD",
        ...(wall.withQto
          ? {
              qtoName: "Qto_WallBaseQuantities",
              areaQuantities: {
                NetSideArea: wall.netSide,
                GrossSideArea: wall.netSide
              }
            }
          : {})
      })
    );
  }

  if (levelTag === "P0") {
    bucket.push(
      createBox({
        typeName: "IFCWALL",
        name: "Sciana_ukosna_P0",
        description: "Sciana ukosna bez Qto (test powierzchni z siatki)",
        parentPlacement: placement,
        origin: [6.0, 2.0, 0.28],
        axis: [0, 0, 1],
        ref: [Math.SQRT1_2, Math.SQRT1_2, 0],
        size: [5.0, WALL],
        depth: H,
        color: [0.78, 0.74, 0.66],
        tag: "Sciana_ukosna_P0",
        predefinedType: "STANDARD"
      })
    );
  }

  const columnXY = [
    [0.5, 0.5],
    [8.75, 0.5],
    [17.1, 0.5],
    [0.5, 5.8],
    [8.75, 5.8],
    [17.1, 5.8],
    [0.5, 11.1],
    [8.75, 11.1],
    [17.1, 11.1]
  ];
  columnXY.forEach((xy, i) => {
    bucket.push(
      createBox({
        typeName: "IFCCOLUMN",
        name: `Slup_${levelTag}_${i + 1}`,
        description: "Slup zelbetowy 40x40",
        parentPlacement: placement,
        origin: [xy[0], xy[1], 0.28],
        size: [0.4, 0.4],
        depth: H,
        color: [0.68, 0.68, 0.7],
        tag: `S-COL-${levelTag}-${i + 1}`
      })
    );
  });

  bucket.push(
    createBox({
      typeName: "IFCBEAM",
      name: `Belka_X_${levelTag}`,
      description: "Belka glowna stropu",
      parentPlacement: placement,
      origin: [0.4, 5.7, 3.15],
      size: [17.2, 0.35],
      depth: 0.4,
      color: [0.42, 0.48, 0.62],
      tag: `S-BEAM-${levelTag}-X`
    })
  );
  bucket.push(
    createBox({
      typeName: "IFCBEAM",
      name: `Belka_Y_${levelTag}`,
      description: "Belka poprzeczna",
      parentPlacement: placement,
      origin: [8.6, 0.4, 3.15],
      size: [0.35, 11.2],
      depth: 0.4,
      color: [0.42, 0.48, 0.62],
      tag: `S-BEAM-${levelTag}-Y`
    })
  );
};

addStoreyShell(elements0, storey0Placement, "P0");
addStoreyShell(elements1, storey1Placement, "P1");

// Foundation + roof
elements0.push(
  createBox({
    typeName: "IFCFOOTING",
    name: "Lawa_fundamentowa",
    description: "Fundament ciagly",
    parentPlacement: storey0Placement,
    origin: [-0.5, -0.5, -0.6],
    size: [W + 1, D + 1],
    depth: 0.6,
    color: [0.38, 0.36, 0.33],
    tag: "S-FOOT-01"
  })
);
elements1.push(
  createBox({
    typeName: "IFCROOF",
    name: "Dach_plaski",
    description: "Dach plaski biurowca",
    parentPlacement: storey1Placement,
    origin: [-0.3, -0.3, 3.5],
    size: [W + 0.6, D + 0.6],
    depth: 0.3,
    color: [0.32, 0.34, 0.38],
    tag: "S-ROOF-01"
  })
);

// Architecture: doors / windows
const openings0 = [
  {
    typeName: "IFCDOOR",
    name: "Drzwi_wejscie_gl",
    origin: [8.2, -0.12, 0.28],
    size: [1.6, 0.12],
    depth: 2.2,
    color: [0.42, 0.26, 0.14],
    tag: "A-DOOR-01"
  },
  {
    typeName: "IFCDOOR",
    name: "Drzwi_biuro_1",
    origin: [3.2, 4.88, 0.28],
    size: [1.0, 0.1],
    depth: 2.1,
    color: [0.5, 0.34, 0.2],
    tag: "A-DOOR-02"
  },
  {
    typeName: "IFCWINDOW",
    name: "Okno_S_1",
    origin: [2.0, -0.08, 1.1],
    size: [2.4, 0.1],
    depth: 1.5,
    color: [0.55, 0.75, 0.9],
    tag: "A-WIN-01"
  },
  {
    typeName: "IFCWINDOW",
    name: "Okno_S_2",
    origin: [12.5, -0.08, 1.1],
    size: [2.4, 0.1],
    depth: 1.5,
    color: [0.55, 0.75, 0.9],
    tag: "A-WIN-02"
  },
  {
    typeName: "IFCWINDOW",
    name: "Okno_N_1",
    origin: [4.0, 11.9, 1.1],
    size: [3.0, 0.1],
    depth: 1.5,
    color: [0.55, 0.75, 0.9],
    tag: "A-WIN-03"
  }
];
for (const item of openings0) {
  elements0.push(
    createBox({
      typeName: item.typeName,
      name: item.name,
      description: item.name,
      parentPlacement: storey0Placement,
      origin: item.origin,
      size: item.size,
      depth: item.depth,
      color: item.color,
      tag: item.tag
    })
  );
}

elements1.push(
  createBox({
    typeName: "IFCWINDOW",
    name: "Okno_S_P1",
    description: "Pas okienny pietro",
    parentPlacement: storey1Placement,
    origin: [1.5, -0.08, 1.0],
    size: [15, 0.1],
    depth: 1.6,
    color: [0.5, 0.72, 0.88],
    tag: "A-WIN-P1"
  })
);

// Electrical
for (const [x, y, tag] of [
  [3, 2.5, "E-LGT-01"],
  [9, 2.5, "E-LGT-02"],
  [14, 2.5, "E-LGT-03"],
  [3, 8, "E-LGT-04"],
  [9, 8, "E-LGT-05"],
  [14, 8, "E-LGT-06"]
]) {
  elements0.push(
    createBox({
      typeName: "IFCLIGHTFIXTURE",
      name: `Oprawa_${tag}`,
      description: "Oprawa LED 600x600",
      parentPlacement: storey0Placement,
      origin: [x, y, 3.25],
      size: [0.6, 0.6],
      depth: 0.1,
      color: [0.95, 0.9, 0.45],
      tag
    })
  );
}
elements0.push(
  createBox({
    typeName: "IFCELECTRICDISTRIBUTIONBOARD",
    name: "RG_parter",
    description: "Rozdzielnica glowna",
    parentPlacement: storey0Placement,
    origin: [0.2, 9.5, 1.0],
    size: [0.3, 1.0],
    depth: 1.4,
    color: [0.15, 0.35, 0.75],
    tag: "E-DB-01"
  })
);

// Water / sewage - realistic routes + intentional errors
elements0.push(
  createBox({
    typeName: "IFCPIPESEGMENT",
    name: "Rura_CWU_trasa",
    description: "Trasa CWU pod stropem",
    parentPlacement: storey0Placement,
    origin: [1.0, 1.5, 2.7],
    size: [10.0, 0.1],
    depth: 0.1,
    color: [0.15, 0.55, 0.85],
    tag: "P-CWU-01"
  })
);
elements0.push(
  createBox({
    typeName: "IFCPIPESEGMENT",
    name: "ERROR_Rura_przez_sciane",
    description: "BLAD: rura przecina sciane zewnetrzna W",
    parentPlacement: storey0Placement,
    origin: [-0.4, 7.0, 1.4],
    size: [1.2, 0.12],
    depth: 0.12,
    color: [0.05, 0.45, 0.9],
    tag: "P-ERR-WALL"
  })
);
elements0.push(
  createBox({
    typeName: "IFCPIPESEGMENT",
    name: "ERROR_Rura_przez_slup",
    description: "BLAD: rura koliduje ze slupem srodkowym",
    parentPlacement: storey0Placement,
    origin: [8.4, 5.75, 1.8],
    size: [1.2, 0.12],
    depth: 0.12,
    color: [0.05, 0.5, 0.85],
    tag: "P-ERR-COL"
  })
);
// Fully inside middle column [8.75, 5.8] 0.4×0.4 — shorter than column thickness (containment)
elements0.push(
  createBox({
    typeName: "IFCPIPESEGMENT",
    name: "ERROR_Rura_wewnatrz_slupa",
    description: "BLAD: krotka rura calkowicie wewnatrz slupa (bez przeciecia powierzchni)",
    parentPlacement: storey0Placement,
    origin: [8.85, 5.9, 1.5],
    size: [0.15, 0.08],
    depth: 0.08,
    color: [0.05, 0.4, 0.95],
    tag: "P-ERR-INSIDE"
  })
);
elements0.push(
  createBox({
    typeName: "IFCSANITARYTERMINAL",
    name: "Umywalka_WC",
    description: "Umysel w toalecie",
    parentPlacement: storey0Placement,
    origin: [1.2, 10.2, 0.85],
    size: [0.55, 0.4],
    depth: 0.18,
    color: [0.92, 0.92, 0.94],
    tag: "P-SAN-01"
  })
);
elements0.push(
  createBox({
    typeName: "IFCPIPEFITTING",
    name: "Trojnik_CWU",
    description: "Ksztaltka rurowa",
    parentPlacement: storey0Placement,
    origin: [10.9, 1.4, 2.65],
    size: [0.25, 0.25],
    depth: 0.25,
    color: [0.2, 0.65, 0.45],
    tag: "P-FIT-01"
  })
);

// Exact near-duplicate pipes for geometric duplicate testing (centers ~5 cm apart)
elements0.push(
  createBox({
    typeName: "IFCPIPESEGMENT",
    name: "ERROR_Duplikat_rury_A",
    description: "BLAD: zdublowana instalacja A",
    parentPlacement: storey0Placement,
    origin: [12.0, 8.0, 0.6],
    size: [0.12, 0.12],
    depth: 2.0,
    color: [0.1, 0.5, 0.8],
    tag: "P-DUP-A"
  })
);
elements0.push(
  createBox({
    typeName: "IFCPIPESEGMENT",
    name: "ERROR_Duplikat_rury_B",
    description: "BLAD: zdublowana instalacja B (prawie ten sam element)",
    parentPlacement: storey0Placement,
    origin: [12.05, 8.02, 0.6],
    size: [0.12, 0.12],
    depth: 2.0,
    color: [0.1, 0.5, 0.8],
    tag: "P-DUP-B"
  })
);

// Identical GlobalId pair (WF-09) — far apart so only GlobalId detection fires.
// Same GUID as test-building.ifc → „Oba sample naraz” → 1 grupa × 4 elementy (expected).
const DUP_GLOBAL_ID = "0DupGidTestSample00001";
elements0.push(
  createBox({
    typeName: "IFCPIPESEGMENT",
    name: "ERROR_GlobalId_dup_A",
    description: "BLAD: powtorzony GlobalId A",
    parentPlacement: storey0Placement,
    origin: [2.0, 9.0, 0.5],
    size: [0.1, 0.1],
    depth: 1.2,
    color: [0.85, 0.2, 0.2],
    tag: "P-GID-A",
    globalId: DUP_GLOBAL_ID
  })
);
elements0.push(
  createBox({
    typeName: "IFCPIPESEGMENT",
    name: "ERROR_GlobalId_dup_B",
    description: "BLAD: powtorzony GlobalId B (ten sam GUID)",
    parentPlacement: storey0Placement,
    origin: [16.0, 1.0, 0.5],
    size: [0.1, 0.1],
    depth: 1.2,
    color: [0.85, 0.2, 0.2],
    tag: "P-GID-B",
    globalId: DUP_GLOBAL_ID
  })
);

// HVAC
elements0.push(
  createBox({
    typeName: "IFCDUCTSEGMENT",
    name: "Kanal_nawiew_korytarz",
    description: "Kanal nawiewny nad korytarzem",
    parentPlacement: storey0Placement,
    origin: [1.0, 5.2, 2.85],
    size: [16.0, 0.45],
    depth: 0.35,
    color: [0.9, 0.58, 0.22],
    tag: "H-DUCT-01"
  })
);
elements0.push(
  createBox({
    typeName: "IFCDUCTSEGMENT",
    name: "ERROR_Kanal_przez_belke",
    description: "BLAD: kanal HVAC przecina belke glowna",
    parentPlacement: storey0Placement,
    origin: [8.4, 5.4, 3.0],
    size: [0.5, 1.0],
    depth: 0.45,
    color: [0.95, 0.4, 0.1],
    tag: "H-ERR-BEAM"
  })
);
elements0.push(
  createBox({
    typeName: "IFCAIRTERMINAL",
    name: "Nawiewnik_1",
    description: "Nawiewnik sufitowy",
    parentPlacement: storey0Placement,
    origin: [4.5, 2.2, 3.3],
    size: [0.5, 0.5],
    depth: 0.08,
    color: [0.85, 0.85, 0.88],
    tag: "H-AT-01"
  })
);
elements0.push(
  createBox({
    typeName: "IFCFLOWCONTROLLER",
    name: "Przepustnica_1",
    description: "Przepustnica powietrza",
    parentPlacement: storey0Placement,
    origin: [15.5, 5.25, 2.9],
    size: [0.25, 0.4],
    depth: 0.25,
    color: [0.75, 0.45, 0.2],
    tag: "H-FC-01"
  })
);

// Electrical vs HVAC clash: cable duct / light body into air duct
elements0.push(
  createBox({
    typeName: "IFCLIGHTFIXTURE",
    name: "ERROR_Oprawa_w_kanale",
    description: "BLAD: oprawa wchodzi w kanal HVAC",
    parentPlacement: storey0Placement,
    origin: [7.7, 5.15, 2.95],
    size: [0.55, 0.55],
    depth: 0.25,
    color: [0.98, 0.85, 0.2],
    tag: "E-ERR-HVAC"
  })
);

// Door colliding with column (architecture vs structure)
elements0.push(
  createBox({
    typeName: "IFCDOOR",
    name: "ERROR_Drzwi_w_slupie",
    description: "BLAD: drzwi nachodza na slup konstrukcyjny",
    parentPlacement: storey0Placement,
    origin: [8.55, 5.7, 0.28],
    size: [0.9, 0.12],
    depth: 2.1,
    color: [0.55, 0.25, 0.12],
    tag: "A-ERR-COL"
  })
);

// Upper floor lighter MEP
elements1.push(
  createBox({
    typeName: "IFCDUCTSEGMENT",
    name: "Kanal_P1",
    description: "Kanal HVAC pietro 1",
    parentPlacement: storey1Placement,
    origin: [2.0, 6.0, 2.9],
    size: [12.0, 0.4],
    depth: 0.3,
    color: [0.88, 0.55, 0.2],
    tag: "H-DUCT-P1"
  })
);
elements1.push(
  createBox({
    typeName: "IFCPIPESEGMENT",
    name: "ERROR_Pion_przez_plyte",
    description: "BLAD: pion bez otworu w plycie (kolizja ze stropem P1)",
    parentPlacement: storey1Placement,
    origin: [15.5, 2.0, -0.2],
    size: [0.15, 0.15],
    depth: 1.0,
    color: [0.1, 0.55, 0.75],
    tag: "P-ERR-SLAB"
  })
);

// Spaces (aggregated into storey — not ContainedInSpatialStructure)
const spaces0 = [
  createSpace({
    name: "Biuro_P0_A",
    longName: "Biuro open-space Parter A",
    parentPlacement: storey0Placement,
    origin: [1.0, 0.5, 0.28],
    size: [7.0, 4.0],
    depth: 2.9,
    netArea: 28.0,
    grossArea: 30.0
  }),
  createSpace({
    name: "Korytarz_P0",
    longName: "Korytarz parter",
    parentPlacement: storey0Placement,
    origin: [1.0, 5.2, 0.28],
    size: [16.0, 1.5],
    depth: 2.9,
    netArea: 24.0,
    grossArea: 25.5
  })
];
const spaces1 = [
  createSpace({
    name: "Sala_P1",
    longName: "Sala konferencyjna Piętro 1",
    parentPlacement: storey1Placement,
    origin: [2.0, 1.0, 0.28],
    size: [8.0, 5.0],
    depth: 2.9,
    netArea: 40.0,
    grossArea: 42.0
  })
];

// Space without Qto — should appear as skipped in the report
{
  const placement = localPlacement(storey1Placement, [12.0, 1.0, 0.28]);
  const profile = rectangleProfile("Magazyn_P1_bez_Qto", 3.0, 2.5);
  const solid = extrudedSolid(profile, 2.9);
  styleSolid(solid, "Magazyn_P1_bez_Qto", [0.7, 0.75, 0.8]);
  const shape = productShape(shapeRep(solid));
  spaces1.push(
    emit(
      `IFCSPACE('${guid()}',#${ownerHistory},'Magazyn_P1_bez_Qto','Pomieszczenie bez quantities',$,#${placement},#${shape},'Magazyn bez Qto',.ELEMENT.,.INTERNAL.,$)`
    )
  );
}

relAggregates(project, [site], "ProjectContainer");
relAggregates(site, [building], "SiteContainer");
relAggregates(building, [storey0, storey1], "BuildingStoreys");
relAggregates(storey0, spaces0, "ParterSpaces");
relAggregates(storey1, spaces1, "Pietro1Spaces");
relContained(storey0, elements0, "ParterElements");
relContained(storey1, elements1, "Pietro1Elements");

const content = [
  "ISO-10303-21;",
  "HEADER;",
  "FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');",
  "FILE_NAME('office-building-with-errors.ifc','2026-03-26T15:00:00',('BimViewer'),('BimViewer Lab'),'BimViewer Realistic Sample','BimViewer','');",
  "FILE_SCHEMA(('IFC4'));",
  "ENDSEC;",
  "DATA;",
  ...lines,
  "ENDSEC;",
  "END-ISO-10303-21;"
].join("\n");

writeFileSync(outPath, content, "utf8");
copyFileSync(outPath, publicPath);
console.log(`Generated ${outPath}`);
console.log(`Copied to ${publicPath}`);
console.log(`Entities: ${lines.length}, products floor0: ${elements0.length}, floor1: ${elements1.length}`);
