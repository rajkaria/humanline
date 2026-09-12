// Durable relay state (bun:sqlite): per-source cursor and per-transaction status.
// Nothing is ever dropped — a transaction that fails stays in the table as `failed`
// so `status` can surface it and a later run can retry it.
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { dbPath } from "./config";

export type TxStatus = "pending" | "submitted" | "done" | "already" | "failed";

export interface TxRecord {
  source: string;
  txHash: string;
  sourceBlock: number;
  txIndex: number;
  status: TxStatus;
  cc3TxHash: string | null;
  attempts: number;
  lastError: string | null;
  updatedAt: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cursor (
  source TEXT PRIMARY KEY,
  block  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS txs (
  source       TEXT    NOT NULL,
  tx_hash      TEXT    NOT NULL,
  source_block INTEGER NOT NULL,
  tx_index     INTEGER NOT NULL DEFAULT -1,
  status       TEXT    NOT NULL,
  cc3_tx_hash  TEXT,
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (source, tx_hash)
);
CREATE INDEX IF NOT EXISTS txs_by_block ON txs (source, source_block);
CREATE INDEX IF NOT EXISTS txs_by_status ON txs (source, status);
`;

export class RelayStore {
  readonly db: Database;
  readonly path: string;

  constructor(path = dbPath()) {
    this.path = path;
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  // --- cursor ---

  getCursor(source: string): number | undefined {
    const row = this.db.query("SELECT block FROM cursor WHERE source = ?").get(source) as
      | { block: number }
      | null;
    return row?.block;
  }

  setCursor(source: string, block: number): void {
    this.db.run(
      "INSERT INTO cursor (source, block) VALUES (?, ?) ON CONFLICT(source) DO UPDATE SET block = excluded.block",
      [source, block],
    );
  }

  /** Only ever advances; a lower value is ignored. */
  advanceCursor(source: string, block: number): void {
    const cur = this.getCursor(source);
    if (cur === undefined || block > cur) this.setCursor(source, block);
  }

  // --- transactions ---

  upsertPending(source: string, txHash: string, sourceBlock: number, txIndex: number): void {
    this.db.run(
      `INSERT INTO txs (source, tx_hash, source_block, tx_index, status, attempts, updated_at)
       VALUES (?, ?, ?, ?, 'pending', 0, ?)
       ON CONFLICT(source, tx_hash) DO UPDATE SET source_block = excluded.source_block,
                                                  tx_index = excluded.tx_index`,
      [source, txHash.toLowerCase(), sourceBlock, txIndex, Date.now()],
    );
  }

  markStatus(
    source: string,
    txHash: string,
    status: TxStatus,
    opts: { cc3TxHash?: string | null; error?: string | null; bumpAttempts?: boolean } = {},
  ): void {
    this.db.run(
      `UPDATE txs SET status = ?,
                      cc3_tx_hash = COALESCE(?, cc3_tx_hash),
                      last_error = ?,
                      attempts = attempts + ?,
                      updated_at = ?
       WHERE source = ? AND tx_hash = ?`,
      [
        status,
        opts.cc3TxHash ?? null,
        opts.error ?? null,
        opts.bumpAttempts ? 1 : 0,
        Date.now(),
        source,
        txHash.toLowerCase(),
      ],
    );
  }

  get(source: string, txHash: string): TxRecord | undefined {
    const row = this.db
      .query("SELECT * FROM txs WHERE source = ? AND tx_hash = ?")
      .get(source, txHash.toLowerCase()) as Record<string, unknown> | null;
    return row ? mapRow(row) : undefined;
  }

  /** True when we already relayed (or observed as already-relayed) this transaction. */
  isSettled(source: string, txHash: string): boolean {
    const rec = this.get(source, txHash);
    return rec?.status === "done" || rec?.status === "already";
  }

  byStatus(source: string, status: TxStatus): TxRecord[] {
    const rows = this.db
      .query("SELECT * FROM txs WHERE source = ? AND status = ? ORDER BY source_block, tx_index")
      .all(source, status) as Array<Record<string, unknown>>;
    return rows.map(mapRow);
  }

  counts(source: string): Record<TxStatus, number> {
    const rows = this.db
      .query("SELECT status, COUNT(*) AS n FROM txs WHERE source = ? GROUP BY status")
      .all(source) as Array<{ status: TxStatus; n: number }>;
    const out: Record<TxStatus, number> = {
      pending: 0,
      submitted: 0,
      done: 0,
      already: 0,
      failed: 0,
    };
    for (const r of rows) out[r.status] = r.n;
    return out;
  }

  recent(source: string, limit = 10): TxRecord[] {
    const rows = this.db
      .query("SELECT * FROM txs WHERE source = ? ORDER BY source_block DESC, tx_index DESC LIMIT ?")
      .all(source, limit) as Array<Record<string, unknown>>;
    return rows.map(mapRow);
  }
}

function mapRow(row: Record<string, unknown>): TxRecord {
  return {
    source: row.source as string,
    txHash: row.tx_hash as string,
    sourceBlock: row.source_block as number,
    txIndex: row.tx_index as number,
    status: row.status as TxStatus,
    cc3TxHash: (row.cc3_tx_hash as string | null) ?? null,
    attempts: row.attempts as number,
    lastError: (row.last_error as string | null) ?? null,
    updatedAt: row.updated_at as number,
  };
}
