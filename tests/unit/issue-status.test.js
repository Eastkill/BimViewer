import { beforeEach, describe, expect, it } from "vitest";
import {
  countIssueStatuses,
  createIssueStatusStore,
  describeCollisionIssue,
  describeDuplicateIssue,
  filterIssuesByStatus,
  ISSUE_STATUS
} from "../../src/issue-status.js";

const STORAGE_KEY = "bimviewer.issueStatuses.v1";

// Minimal in-memory localStorage for the Node test environment.
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key)
};

const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
const element = (sourceFile, globalId, expressID = 1) => ({ sourceFile, globalId, expressID });
const pair = (left, right) => ({ leftMesh: left, rightMesh: right });
const group = (kind, entities, globalId) => ({
  kind,
  globalId,
  items: entities.map((entity) => ({ entity }))
});

describe("tożsamość problemu", () => {
  it("klucz kolizji nie zależy od kolejności elementów ani od ExpressID", () => {
    const a = describeCollisionIssue(pair(element("k.ifc", "G1", 10), element("i.ifc", "G2", 20)));
    const b = describeCollisionIssue(pair(element("i.ifc", "G2", 99), element("k.ifc", "G1", 77)));
    expect(b).toEqual(a);
    expect(a.scope).toBe("i.ifc + k.ifc");
  });

  it("elementy bez GlobalId są rozróżniane po ExpressID", () => {
    const a = describeCollisionIssue(pair(element("k.ifc", "brak", 10), element("k.ifc", null, 20)));
    const b = describeCollisionIssue(pair(element("k.ifc", "brak", 10), element("k.ifc", null, 21)));
    expect(a.key).not.toBe(b.key);
    expect(a.scope).toBe("k.ifc");
  });

  it("ten sam GlobalId w dwóch plikach daje różne klucze kolizji", () => {
    const a = describeCollisionIssue(pair(element("a.ifc", "G1"), element("a.ifc", "G2")));
    const b = describeCollisionIssue(pair(element("b.ifc", "G1"), element("b.ifc", "G2")));
    expect(a.key).not.toBe(b.key);
    expect(a.scope).not.toBe(b.scope);
  });

  it("grupa powtórzonego GlobalId jest identyfikowana tym identyfikatorem", () => {
    const issue = describeDuplicateIssue(
      group("globalId", [element("a.ifc", "G1", 1), element("b.ifc", "G1", 2)], "G1")
    );
    expect(issue).toEqual({ scope: "a.ifc + b.ifc", key: "dup-gid|G1" });
  });

  it("grupa geometryczna jest identyfikowana zbiorem elementów", () => {
    const a = describeDuplicateIssue(group("geometry", [element("a.ifc", "G1"), element("a.ifc", "G2")]));
    const b = describeDuplicateIssue(group("geometry", [element("a.ifc", "G2"), element("a.ifc", "G1")]));
    const c = describeDuplicateIssue(group("geometry", [element("a.ifc", "G1"), element("a.ifc", "G3")]));
    expect(b).toEqual(a);
    expect(c.key).not.toBe(a.key);
  });
});

describe("zapis statusów", () => {
  beforeEach(() => store.clear());

  const issue = { scope: "a.ifc", key: "clash|x|y" };

  it("status domyślny to „do sprawdzenia” i nie jest zapisywany", () => {
    const statuses = createIssueStatusStore();
    expect(statuses.get(issue)).toBe(ISSUE_STATUS.TODO);
    statuses.set(issue, ISSUE_STATUS.TODO);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("zapisuje status w grupie pliku i odtwarza go w nowym magazynie", () => {
    createIssueStatusStore().set(issue, ISSUE_STATUS.CONFIRMED);
    expect(stored()).toEqual({ "a.ifc": { "clash|x|y": "confirmed" } });
    expect(createIssueStatusStore().get(issue)).toBe(ISSUE_STATUS.CONFIRMED);
  });

  it("nie przenosi statusu na inny plik", () => {
    createIssueStatusStore().set(issue, ISSUE_STATUS.IGNORED);
    expect(createIssueStatusStore().get({ scope: "b.ifc", key: issue.key })).toBe(ISSUE_STATUS.TODO);
  });

  it("powrót do statusu domyślnego usuwa wpis i pustą grupę pliku", () => {
    const statuses = createIssueStatusStore();
    statuses.set(issue, ISSUE_STATUS.IGNORED);
    statuses.set(issue, ISSUE_STATUS.TODO);
    expect(stored()).toEqual({});
    expect(statuses.get(issue)).toBe(ISSUE_STATUS.TODO);
  });

  it("ignoruje nieznane wartości i uszkodzone dane", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ "a.ifc": { "clash|x|y": "cokolwiek" } }));
    expect(createIssueStatusStore().get(issue)).toBe(ISSUE_STATUS.TODO);

    localStorage.setItem(STORAGE_KEY, "{nie json");
    const statuses = createIssueStatusStore();
    expect(statuses.get(issue)).toBe(ISSUE_STATUS.TODO);
    statuses.set(issue, ISSUE_STATUS.CONFIRMED);
    expect(stored()).toEqual({ "a.ifc": { "clash|x|y": "confirmed" } });
  });
});

describe("filtrowanie", () => {
  const issues = [{ s: "todo" }, { s: "confirmed" }, { s: "ignored" }, { s: "todo" }];
  const getStatus = (issue) => issue.s;

  it("zlicza problemy według statusu", () => {
    expect(countIssueStatuses(issues, getStatus)).toEqual({ todo: 2, confirmed: 1, ignored: 1 });
  });

  it("filtruje według statusu, a „all” zwraca wszystko", () => {
    expect(filterIssuesByStatus(issues, "todo", getStatus)).toEqual([issues[0], issues[3]]);
    expect(filterIssuesByStatus(issues, "ignored", getStatus)).toEqual([issues[2]]);
    expect(filterIssuesByStatus(issues, "all", getStatus)).toEqual(issues);
  });
});
