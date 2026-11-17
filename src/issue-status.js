/**
 * Review status of detected issues (collision pairs and duplicate groups).
 *
 * Statuses are kept in localStorage, grouped by the set of files the issue belongs to,
 * so they come back when the same file (or the same pair of files) is loaded again.
 * Elements are identified by GlobalId, which survives a re-export of the model;
 * ExpressID is only a fallback for elements without one.
 */
const STORAGE_KEY = "bimviewer.issueStatuses.v1";

export const ISSUE_STATUS = Object.freeze({
  TODO: "todo",
  IGNORED: "ignored",
  CONFIRMED: "confirmed"
});

export const DEFAULT_ISSUE_STATUS = ISSUE_STATUS.TODO;

export const ISSUE_STATUS_LABELS = Object.freeze({
  [ISSUE_STATUS.TODO]: "Do sprawdzenia",
  [ISSUE_STATUS.IGNORED]: "Ignoruj",
  [ISSUE_STATUS.CONFIRMED]: "Potwierdzony"
});

export const ISSUE_STATUS_ORDER = Object.freeze([
  ISSUE_STATUS.TODO,
  ISSUE_STATUS.CONFIRMED,
  ISSUE_STATUS.IGNORED
]);

const isKnownStatus = (status) => ISSUE_STATUS_ORDER.includes(status);

const hasGlobalId = (entity) => Boolean(entity?.globalId) && entity.globalId !== "brak";

const elementRef = (entity) => {
  const file = entity?.sourceFile ?? "?";
  const id = hasGlobalId(entity) ? `g:${entity.globalId}` : `e:${entity?.expressID ?? "?"}`;
  return `${file}#${id}`;
};

const fileScope = (entities) =>
  [...new Set(entities.map((entity) => entity?.sourceFile ?? "?"))].sort().join(" + ");

/**
 * Identity of a collision pair. Independent of the order of the two elements and of
 * the layers and tolerance used, so the status follows the pair between analyses.
 */
export const describeCollisionIssue = (pair) => {
  const entities = [pair?.leftMesh, pair?.rightMesh].filter(Boolean);
  return {
    scope: fileScope(entities),
    key: `clash|${entities.map(elementRef).sort().join("|")}`
  };
};

/** Identity of a duplicate group: the repeated GlobalId or the set of its elements. */
export const describeDuplicateIssue = (group) => {
  const entities = (group?.items ?? []).map((item) => item.entity).filter(Boolean);
  const key =
    group?.kind === "globalId"
      ? `dup-gid|${group.globalId}`
      : `dup-geo|${entities.map(elementRef).sort().join("|")}`;
  return { scope: fileScope(entities), key };
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

/**
 * Status store with an in-memory copy, so rendering a list of thousands of issues
 * does not parse localStorage once per row.
 */
export const createIssueStatusStore = () => {
  let map = readStoredMap();

  const get = (issue) => {
    const status = map[issue?.scope]?.[issue?.key];
    return isKnownStatus(status) ? status : DEFAULT_ISSUE_STATUS;
  };

  /** The default status is not stored: setting it removes the entry. */
  const set = (issue, status) => {
    if (!issue?.scope || !issue?.key) return;
    // Another tab may have written in the meantime.
    map = readStoredMap();

    if (!isKnownStatus(status) || status === DEFAULT_ISSUE_STATUS) {
      if (!map[issue.scope] || !(issue.key in map[issue.scope])) return;
      delete map[issue.scope][issue.key];
      if (!Object.keys(map[issue.scope]).length) delete map[issue.scope];
    } else {
      (map[issue.scope] ??= {})[issue.key] = status;
    }
    writeStoredMap(map);
  };

  return { get, set };
};

/** Number of issues per status; `getStatus` maps an issue object to its status. */
export const countIssueStatuses = (issues, getStatus) => {
  const counts = Object.fromEntries(ISSUE_STATUS_ORDER.map((status) => [status, 0]));
  for (const issue of issues ?? []) counts[getStatus(issue)] += 1;
  return counts;
};

/** `filter` is a status or "all". */
export const filterIssuesByStatus = (issues, filter, getStatus) =>
  !isKnownStatus(filter) ? [...(issues ?? [])] : (issues ?? []).filter((issue) => getStatus(issue) === filter);
