// Durable relay state. Uses an in-memory sqlite database; no network, no files.
import { beforeEach, describe, expect, test } from "bun:test";
import { RelayStore } from "../src/store";

let store: RelayStore;

beforeEach(() => {
  store = new RelayStore(":memory:");
});

describe("cursor", () => {
  test("is absent until set", () => {
    expect(store.getCursor("sepolia")).toBeUndefined();
  });

  test("round-trips per source", () => {
    store.setCursor("sepolia", 100);
    store.setCursor("mainnet", 200);
    expect(store.getCursor("sepolia")).toBe(100);
    expect(store.getCursor("mainnet")).toBe(200);
  });

  test("advanceCursor only ever moves forward", () => {
    store.advanceCursor("sepolia", 500);
    store.advanceCursor("sepolia", 400);
    expect(store.getCursor("sepolia")).toBe(500);
    store.advanceCursor("sepolia", 501);
    expect(store.getCursor("sepolia")).toBe(501);
  });

  test("setCursor can rewind when a caller deliberately asks", () => {
    store.setCursor("sepolia", 500);
    store.setCursor("sepolia", 10);
    expect(store.getCursor("sepolia")).toBe(10);
  });
});

describe("transactions", () => {
  test("upsert creates a pending record", () => {
    store.upsertPending("sepolia", "0xAA", 100, 3);
    const rec = store.get("sepolia", "0xaa");
    expect(rec).toMatchObject({ status: "pending", sourceBlock: 100, txIndex: 3, attempts: 0 });
  });

  test("hashes are stored and looked up case-insensitively", () => {
    store.upsertPending("sepolia", "0xAA", 100, 3);
    expect(store.get("sepolia", "0xAA")?.txHash).toBe("0xaa");
  });

  test("re-upserting does not reset status or attempts", () => {
    store.upsertPending("sepolia", "0xaa", 100, 3);
    store.markStatus("sepolia", "0xaa", "failed", { error: "boom", bumpAttempts: true });
    store.upsertPending("sepolia", "0xaa", 100, 3);
    const rec = store.get("sepolia", "0xaa")!;
    expect(rec.status).toBe("failed");
    expect(rec.attempts).toBe(1);
  });

  test("the same hash on two sources is two records", () => {
    store.upsertPending("sepolia", "0xaa", 1, 0);
    store.upsertPending("mainnet", "0xaa", 2, 0);
    expect(store.get("sepolia", "0xaa")!.sourceBlock).toBe(1);
    expect(store.get("mainnet", "0xaa")!.sourceBlock).toBe(2);
  });

  test("markStatus records the CC3 hash and keeps it across later updates", () => {
    store.upsertPending("sepolia", "0xaa", 100, 3);
    store.markStatus("sepolia", "0xaa", "done", { cc3TxHash: "0xcc" });
    expect(store.get("sepolia", "0xaa")!.cc3TxHash).toBe("0xcc");
    store.markStatus("sepolia", "0xaa", "done");
    expect(store.get("sepolia", "0xaa")!.cc3TxHash).toBe("0xcc");
  });

  test("attempts accumulate only when asked", () => {
    store.upsertPending("sepolia", "0xaa", 100, 3);
    store.markStatus("sepolia", "0xaa", "pending", { bumpAttempts: true });
    store.markStatus("sepolia", "0xaa", "pending", { bumpAttempts: true });
    store.markStatus("sepolia", "0xaa", "pending");
    expect(store.get("sepolia", "0xaa")!.attempts).toBe(2);
  });

  test("isSettled is true for done and already, false otherwise", () => {
    store.upsertPending("sepolia", "0xa", 1, 0);
    store.upsertPending("sepolia", "0xb", 1, 1);
    store.upsertPending("sepolia", "0xc", 1, 2);
    store.markStatus("sepolia", "0xa", "done");
    store.markStatus("sepolia", "0xb", "already");
    store.markStatus("sepolia", "0xc", "failed");
    expect(store.isSettled("sepolia", "0xa")).toBe(true);
    expect(store.isSettled("sepolia", "0xb")).toBe(true);
    expect(store.isSettled("sepolia", "0xc")).toBe(false);
    expect(store.isSettled("sepolia", "0xunknown")).toBe(false);
  });

  test("a failed transaction is never dropped and stays queryable", () => {
    store.upsertPending("sepolia", "0xaa", 100, 3);
    store.markStatus("sepolia", "0xaa", "failed", { error: "CalldataLogMismatch()" });
    const failed = store.byStatus("sepolia", "failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]!.lastError).toBe("CalldataLogMismatch()");
  });

  test("counts report every status, zero-filled", () => {
    store.upsertPending("sepolia", "0xa", 1, 0);
    store.upsertPending("sepolia", "0xb", 2, 0);
    store.markStatus("sepolia", "0xa", "done");
    expect(store.counts("sepolia")).toEqual({
      pending: 1,
      submitted: 0,
      done: 1,
      already: 0,
      failed: 0,
    });
  });

  test("byStatus returns source order", () => {
    store.upsertPending("sepolia", "0xb", 200, 0);
    store.upsertPending("sepolia", "0xa", 100, 5);
    store.upsertPending("sepolia", "0xc", 100, 1);
    expect(store.byStatus("sepolia", "pending").map((r) => r.txHash)).toEqual([
      "0xc",
      "0xa",
      "0xb",
    ]);
  });

  test("recent returns newest first", () => {
    store.upsertPending("sepolia", "0xa", 100, 0);
    store.upsertPending("sepolia", "0xb", 300, 0);
    store.upsertPending("sepolia", "0xc", 200, 0);
    expect(store.recent("sepolia", 2).map((r) => r.sourceBlock)).toEqual([300, 200]);
  });
});

describe("contract binding", () => {
  test("first bind keeps existing state", () => {
    const store = new RelayStore(":memory:");
    store.setCursor("mainnet", 100);
    expect(store.bindContract("mainnet", "0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa")).toBe(false);
    expect(store.getCursor("mainnet")).toBe(100);
    store.close();
  });

  test("re-binding the same contract is a no-op, whatever the case", () => {
    const store = new RelayStore(":memory:");
    store.bindContract("mainnet", "0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa");
    store.setCursor("mainnet", 250);
    expect(store.bindContract("mainnet", "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(false);
    expect(store.getCursor("mainnet")).toBe(250);
    store.close();
  });

  test("a redeploy resets that source's cursor and transactions", () => {
    const store = new RelayStore(":memory:");
    store.bindContract("mainnet", "0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa");
    store.setCursor("mainnet", 500);
    store.upsertPending("mainnet", "0xdead", 499, 3);

    expect(store.bindContract("mainnet", "0xBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbb")).toBe(true);
    expect(store.getCursor("mainnet")).toBeUndefined();
    expect(store.get("mainnet", "0xdead")).toBeUndefined();
    expect(store.boundContract("mainnet")).toBe("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    store.close();
  });

  test("a redeploy on one source leaves the other source alone", () => {
    const store = new RelayStore(":memory:");
    store.bindContract("mainnet", "0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa");
    store.bindContract("sepolia", "0xCCccCCccCCccCCccCCccCCccCCccCCccCCccCCcc");
    store.setCursor("mainnet", 500);
    store.setCursor("sepolia", 900);

    store.bindContract("mainnet", "0xBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbb");
    expect(store.getCursor("sepolia")).toBe(900);
    store.close();
  });

  test("an unknown address binds nothing, so a missing deployment file cannot wipe state", () => {
    const store = new RelayStore(":memory:");
    store.bindContract("mainnet", "0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa");
    store.setCursor("mainnet", 500);
    expect(store.bindContract("mainnet", undefined)).toBe(false);
    expect(store.getCursor("mainnet")).toBe(500);
    store.close();
  });
});
