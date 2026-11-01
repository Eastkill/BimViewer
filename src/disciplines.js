export const DISCIPLINES = {
  STRUCTURE: "Konstrukcja",
  ARCHITECTURE: "Stolarka",
  ELECTRICAL: "Elektryka",
  WATER_SEWAGE: "WodKan",
  HVAC: "HVAC",
  MEP: "MEP",
  OTHER: "Inne"
};

// Unambiguous product types (web-ifc type codes from ifc-schema.d.ts).
const TYPE_TO_DISCIPLINE = new Map([
  [2391406946, DISCIPLINES.STRUCTURE], // IFCWALL
  [3512223829, DISCIPLINES.STRUCTURE], // IFCWALLSTANDARDCASE
  [1529196076, DISCIPLINES.STRUCTURE], // IFCSLAB
  [3027962421, DISCIPLINES.STRUCTURE], // IFCSLABSTANDARDCASE
  [753842376, DISCIPLINES.STRUCTURE], // IFCBEAM
  [2906023776, DISCIPLINES.STRUCTURE], // IFCBEAMSTANDARDCASE
  [843113511, DISCIPLINES.STRUCTURE], // IFCCOLUMN
  [905975707, DISCIPLINES.STRUCTURE], // IFCCOLUMNSTANDARDCASE
  [900683007, DISCIPLINES.STRUCTURE], // IFCFOOTING
  [1687234759, DISCIPLINES.STRUCTURE], // IFCPILE
  [2016517767, DISCIPLINES.STRUCTURE], // IFCROOF
  [331165859, DISCIPLINES.STRUCTURE], // IFCSTAIR
  [4252922144, DISCIPLINES.STRUCTURE], // IFCSTAIRFLIGHT
  [3024970846, DISCIPLINES.STRUCTURE], // IFCRAMP
  [3283111854, DISCIPLINES.STRUCTURE], // IFCRAMPFLIGHT
  [1073191201, DISCIPLINES.STRUCTURE], // IFCMEMBER
  [3171933400, DISCIPLINES.STRUCTURE], // IFCPLATE

  [395920057, DISCIPLINES.ARCHITECTURE], // IFCDOOR
  [3242481149, DISCIPLINES.ARCHITECTURE], // IFCDOORSTANDARDCASE
  [3304561284, DISCIPLINES.ARCHITECTURE], // IFCWINDOW
  [486154966, DISCIPLINES.ARCHITECTURE], // IFCWINDOWSTANDARDCASE
  [3495092785, DISCIPLINES.ARCHITECTURE], // IFCCURTAINWALL
  [3856911033, DISCIPLINES.ARCHITECTURE], // IFCSPACE
  [1973544240, DISCIPLINES.ARCHITECTURE], // IFCCOVERING
  [2262370178, DISCIPLINES.ARCHITECTURE], // IFCRAILING
  [263784265, DISCIPLINES.ARCHITECTURE], // IFCFURNISHINGELEMENT

  [862014818, DISCIPLINES.ELECTRICAL], // IFCELECTRICDISTRIBUTIONBOARD
  [264262732, DISCIPLINES.ELECTRICAL], // IFCELECTRICGENERATOR
  [629592764, DISCIPLINES.ELECTRICAL], // IFCLIGHTFIXTURE
  [4217484030, DISCIPLINES.ELECTRICAL], // IFCCABLESEGMENT
  [1051757585, DISCIPLINES.ELECTRICAL], // IFCCABLEFITTING
  [3758799889, DISCIPLINES.ELECTRICAL], // IFCCABLECARRIERSEGMENT
  [635142910, DISCIPLINES.ELECTRICAL], // IFCCABLECARRIERFITTING
  [3694346114, DISCIPLINES.ELECTRICAL], // IFCOUTLET
  [1162798199, DISCIPLINES.ELECTRICAL], // IFCSWITCHINGDEVICE
  [76236018, DISCIPLINES.ELECTRICAL], // IFCLAMP
  [2176052936, DISCIPLINES.ELECTRICAL], // IFCJUNCTIONBOX
  [738039164, DISCIPLINES.ELECTRICAL], // IFCPROTECTIVEDEVICE
  [3825984169, DISCIPLINES.ELECTRICAL], // IFCTRANSFORMER

  [3612865200, DISCIPLINES.WATER_SEWAGE], // IFCPIPESEGMENT
  [310824031, DISCIPLINES.WATER_SEWAGE], // IFCPIPEFITTING
  [3053780830, DISCIPLINES.WATER_SEWAGE], // IFCSANITARYTERMINAL
  [4237592921, DISCIPLINES.WATER_SEWAGE], // IFCWASTETERMINAL
  [1404847402, DISCIPLINES.WATER_SEWAGE], // IFCSTACKTERMINAL
  [4175244083, DISCIPLINES.WATER_SEWAGE], // IFCINTERCEPTOR
  [90941305, DISCIPLINES.WATER_SEWAGE], // IFCPUMP
  [812556717, DISCIPLINES.WATER_SEWAGE], // IFCTANK

  [3518393246, DISCIPLINES.HVAC], // IFCDUCTSEGMENT
  [342316401, DISCIPLINES.HVAC], // IFCDUCTFITTING
  [1634111441, DISCIPLINES.HVAC], // IFCAIRTERMINAL
  [177149247, DISCIPLINES.HVAC], // IFCAIRTERMINALBOX
  [3415622556, DISCIPLINES.HVAC], // IFCFAN
  [4074379575, DISCIPLINES.HVAC], // IFCDAMPER
  [1360408905, DISCIPLINES.HVAC], // IFCDUCTSILENCER
  [1999602285, DISCIPLINES.HVAC], // IFCSPACEHEATER
  [32344328, DISCIPLINES.HVAC], // IFCBOILER
  [3902619387, DISCIPLINES.HVAC], // IFCCHILLER
  [4292641817, DISCIPLINES.HVAC] // IFCUNITARYEQUIPMENT
]);

// Abstract / shared MEP parents — need Name/ObjectType/system context.
const AMBIGUOUS_FLOW_TYPES = new Set([
  987401354, // IFCFLOWSEGMENT
  4278956645, // IFCFLOWFITTING
  2223149337, // IFCFLOWTERMINAL
  2058353004, // IFCFLOWCONTROLLER
  3132237377, // IFCFLOWMOVINGDEVICE
  707683696, // IFCFLOWSTORAGEDEVICE
  3508470533, // IFCFLOWTREATMENTDEVICE
  2188021234, // IFCFLOWMETER
  182646315 // IFCFLOWINSTRUMENT
]);

const IFCRELASSIGNSTOGROUP = 1307041759;
const IFCDISTRIBUTIONSYSTEM = 3205830791;

const asText = (value) => {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value?.value === "string" || typeof value?.value === "number") return String(value.value);
  return "";
};

const collectHintText = (...parts) =>
  parts
    .map(asText)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

const WATER_HINTS = [
  "pipe",
  "piping",
  "plumbing",
  "wod",
  "woda",
  "hydraul",
  "sanitar",
  "kanal",
  "ściek",
  "sciek",
  "sewage",
  "drainage",
  "drain",
  "domesticcoldwater",
  "domestichotwater",
  "coldwater",
  "hotwater",
  "cwu",
  "zwu",
  "pcw",
  "phw",
  "sprinkler",
  "fireprotection",
  "gas",
  "gaz"
];

const HVAC_HINTS = [
  "duct",
  "hvac",
  "air",
  "wentyl",
  "klima",
  "ventilation",
  "airconditioning",
  "exhaust",
  "supplyair",
  "returnair",
  "nawiew",
  "wywiew",
  "chlod",
  "chłod",
  "heating",
  "cooling",
  "fan",
  "damper",
  "ahs",
  "ahu",
  "cwu-hvac"
];

const ELECTRICAL_HINTS = [
  "cable",
  "electr",
  "power",
  "lighting",
  "oświet",
  "oswiet",
  "prad",
  "prąd",
  "tray",
  "conduit",
  "data",
  "ict",
  "teletech",
  "lowvoltage",
  "highvoltage"
];

const matchDisciplineByHints = (text) => {
  if (!text) return null;
  if (WATER_HINTS.some((hint) => text.includes(hint))) return DISCIPLINES.WATER_SEWAGE;
  if (HVAC_HINTS.some((hint) => text.includes(hint))) return DISCIPLINES.HVAC;
  if (ELECTRICAL_HINTS.some((hint) => text.includes(hint))) return DISCIPLINES.ELECTRICAL;
  return null;
};

/**
 * Build expressID -> system hint text from IfcRelAssignsToGroup / IfcDistributionSystem.
 */
export const buildElementSystemHints = (ifcApi, modelId) => {
  const hints = new Map();
  const relCount = ifcApi.GetLineIDsWithType(modelId, IFCRELASSIGNSTOGROUP);
  const size = relCount.size();

  for (let i = 0; i < size; i += 1) {
    const relId = relCount.get(i);
    let rel;
    try {
      rel = ifcApi.GetLine(modelId, relId, true);
    } catch {
      continue;
    }

    const groupId = rel?.RelatingGroup?.value ?? rel?.RelatingGroup;
    if (!groupId || typeof groupId !== "number") continue;

    let groupType = null;
    let groupLine = null;
    try {
      groupType = ifcApi.GetLineType(modelId, groupId);
      groupLine = ifcApi.GetLine(modelId, groupId, true);
    } catch {
      continue;
    }

    const systemHint = collectHintText(
      groupType === IFCDISTRIBUTIONSYSTEM ? "distributionsystem" : "",
      groupLine?.Name,
      groupLine?.Description,
      groupLine?.ObjectType,
      groupLine?.PredefinedType,
      groupLine?.LongName
    );

    const related = rel?.RelatedObjects;
    if (!Array.isArray(related)) continue;

    for (const item of related) {
      const expressId = item?.value ?? item;
      if (typeof expressId !== "number") continue;
      const previous = hints.get(expressId) ?? "";
      hints.set(expressId, collectHintText(previous, systemHint));
    }
  }

  return hints;
};

export const getDisciplineForType = (ifcTypeId) => TYPE_TO_DISCIPLINE.get(ifcTypeId) ?? DISCIPLINES.OTHER;

/**
 * Resolve discipline using concrete type first, then system/object hints for ambiguous flow types.
 */
export const resolveDiscipline = ({ typeId, line = null, systemHint = "" }) => {
  const concrete = TYPE_TO_DISCIPLINE.get(typeId);
  if (concrete) return concrete;

  if (!AMBIGUOUS_FLOW_TYPES.has(typeId)) {
    return DISCIPLINES.OTHER;
  }

  const elementHint = collectHintText(
    systemHint,
    line?.Name,
    line?.Description,
    line?.ObjectType,
    line?.Tag,
    line?.PredefinedType
  );

  const fromHints = matchDisciplineByHints(elementHint);
  if (fromHints) return fromHints;

  // Ambiguous flow entity without usable metadata.
  return DISCIPLINES.MEP;
};

export const ALL_DISCIPLINES = Object.values(DISCIPLINES);
