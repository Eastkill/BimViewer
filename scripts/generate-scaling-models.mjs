/**
 * Synthetic models of growing size for performance tests (loading, rendering,
 * collision detection). Each floor: 1 slab, nx·ny columns, nx·ny pipe segments and
 * exactly two intentional clashes (pipe through a column, riser through the slab),
 * so the expected result of "Konstrukcja × WodKan" is 2 × floors.
 * Output: test-models/scaling-<name>.ifc (dev-only).
 *
 * Usage: node scripts/generate-scaling-models.mjs [S M L XL]   (default: all presets)
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createIfcWriter } from "./lib/ifc-writer.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const SCALING_PRESETS = {
  S: { floors: 5, nx: 10, ny: 10 },
  M: { floors: 10, nx: 16, ny: 16 },
  L: { floors: 20, nx: 22, ny: 22 },
  XL: { floors: 40, nx: 25, ny: 25 }
};

const GRID = 3; // column spacing [m]
const FLOOR_HEIGHT = 3.5;
const SLAB = 0.28;

const generate = (name, { floors, nx, ny }) => {
  const ifc = createIfcWriter({
    seed: 0x5ca1e000 + floors * 1000 + nx * 31 + ny,
    projectName: `Model skalowany ${name}`,
    description: `${floors} kondygnacji, siatka ${nx}x${ny}`
  });

  let structure = 0;
  let pipes = 0;

  for (let f = 0; f < floors; f += 1) {
    const storey = ifc.addStorey(`Kondygnacja ${f}`, f * FLOOR_HEIGHT);

    ifc.addBox(storey, {
      type: "IFCSLAB",
      name: `Plyta_${f}`,
      origin: [(nx * GRID) / 2, (ny * GRID) / 2, 0],
      size: [nx * GRID, ny * GRID],
      height: SLAB,
      color: [0.55, 0.55, 0.55],
      extraAttributes: [".FLOOR."]
    });
    structure += 1;

    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        ifc.addBox(storey, {
          type: "IFCCOLUMN",
          name: `Slup_${f}_${i}_${j}`,
          origin: [i * GRID + 1.5, j * GRID + 1.5, SLAB],
          size: [0.4, 0.4],
          height: 3.2,
          color: [0.68, 0.68, 0.7]
        });
        ifc.addBox(storey, {
          type: "IFCPIPESEGMENT",
          name: `Rura_${f}_${i}_${j}`,
          origin: [i * GRID + 1.5, j * GRID + 0.5, 2.7],
          size: [2.9, 0.1],
          height: 0.1,
          color: [0.15, 0.55, 0.85]
        });
        structure += 1;
        pipes += 1;
      }
    }

    ifc.addBox(storey, {
      type: "IFCPIPESEGMENT",
      name: `ERROR_Rura_przez_slup_${f}`,
      origin: [1.5, 1.5, 1.5],
      size: [1.2, 0.1],
      height: 0.1,
      color: [0.9, 0.2, 0.2]
    });
    ifc.addBox(storey, {
      type: "IFCPIPESEGMENT",
      name: `ERROR_Pion_przez_plyte_${f}`,
      origin: [nx * GRID - 1, ny * GRID - 1, -0.2],
      size: [0.15, 0.15],
      height: 1.0,
      color: [0.9, 0.2, 0.2]
    });
    pipes += 2;
  }

  const outPath = join(__dirname, "..", "test-models", `scaling-${name}.ifc`);
  const { bytes } = ifc.write(outPath);
  console.log(
    `Generated scaling-${name}.ifc: ${structure + pipes} elements ` +
      `(Konstrukcja ${structure}, WodKan ${pipes}), expected clashes ${2 * floors}, ` +
      `${(bytes / 1048576).toFixed(1)} MiB`
  );
};

const requested = process.argv.slice(2).map((arg) => arg.toUpperCase());
const names = requested.length ? requested : Object.keys(SCALING_PRESETS);
for (const name of names) {
  const preset = SCALING_PRESETS[name];
  if (!preset) {
    console.error(`Nieznany rozmiar "${name}". Dostępne: ${Object.keys(SCALING_PRESETS).join(", ")}`);
    process.exit(1);
  }
  generate(name, preset);
}
