/**
 * Database Service
 * 
 * SQLite persistence for clients, settlements, netting rounds, and audit logs
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

// Ensure data directory exists
const dataDir = path.join(__dirname, '../../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'anduin.db');
export const db = new Database(dbPath);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

/**
 * Initialize database schema
 */
export function initializeDatabase() {
  // Clients table
  db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      address TEXT UNIQUE NOT NULL,
      name TEXT,
      vault_address TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      metadata TEXT
    )
  `);

  // Settlements table
  db.exec(`
    CREATE TABLE IF NOT EXISTS settlements (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      vault_address TEXT NOT NULL,
      amount TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('credit', 'debit')),
      status TEXT NOT NULL CHECK(status IN ('pending', 'confirmed', 'failed')),
      transaction_hash TEXT,
      ref_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      confirmed_at INTEGER,
      metadata TEXT,
      FOREIGN KEY (client_id) REFERENCES clients(id)
    )
  `);

  // Netting rounds table
  db.exec(`
    CREATE TABLE IF NOT EXISTS netting_rounds (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      merkle_root TEXT NOT NULL,
      vault_address TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'submitted', 'finalized', 'failed')),
      transaction_hash TEXT,
      created_at INTEGER NOT NULL,
      submitted_at INTEGER,
      finalized_at INTEGER,
      settlement_count INTEGER NOT NULL,
      total_credit TEXT NOT NULL,
      total_debit TEXT NOT NULL,
      metadata TEXT
    )
  `);

  // Insurance events table
  db.exec(`
    CREATE TABLE IF NOT EXISTS insurance_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL CHECK(event_type IN ('deposit', 'withdrawal', 'socialized_loss')),
      amount TEXT NOT NULL,
      vault_address TEXT NOT NULL,
      transaction_hash TEXT,
      created_at INTEGER NOT NULL,
      metadata TEXT
    )
  `);

  // Audit log table
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      actor TEXT,
      entity_type TEXT,
      entity_id TEXT,
      details TEXT,
      created_at INTEGER NOT NULL
    )
  `);

  // Create indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_settlements_client_id ON settlements(client_id);
    CREATE INDEX IF NOT EXISTS idx_settlements_status ON settlements(status);
    CREATE INDEX IF NOT EXISTS idx_settlements_created_at ON settlements(created_at);
    CREATE INDEX IF NOT EXISTS idx_netting_rounds_status ON netting_rounds(status);
    CREATE INDEX IF NOT EXISTS idx_insurance_events_created_at ON insurance_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);
  `);

  console.log('✅ Database initialized');
}

// Client operations
export const clientDb = {
  create: db.prepare(`
    INSERT INTO clients (id, address, name, vault_address, created_at, updated_at, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  
  findById: db.prepare(`SELECT * FROM clients WHERE id = ?`),
  
  findByAddress: db.prepare(`SELECT * FROM clients WHERE address = ?`),
  
  list: db.prepare(`SELECT * FROM clients ORDER BY created_at DESC`),
  
  update: db.prepare(`
    UPDATE clients 
    SET name = ?, vault_address = ?, updated_at = ?, metadata = ?
    WHERE id = ?
  `),
  
  delete: db.prepare(`DELETE FROM clients WHERE id = ?`),
};

// Settlement operations
export const settlementDb = {
  create: db.prepare(`
    INSERT INTO settlements (id, client_id, vault_address, amount, type, status, transaction_hash, ref_id, created_at, confirmed_at, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  
  findById: db.prepare(`SELECT * FROM settlements WHERE id = ?`),
  
  findByClientId: db.prepare(`
    SELECT * FROM settlements 
    WHERE client_id = ? 
    ORDER BY created_at DESC
  `),
  
  findByStatus: db.prepare(`
    SELECT * FROM settlements 
    WHERE status = ? 
    ORDER BY created_at DESC
  `),
  
  list: db.prepare(`SELECT * FROM settlements ORDER BY created_at DESC LIMIT ? OFFSET ?`),
  
  updateStatus: db.prepare(`
    UPDATE settlements 
    SET status = ?, transaction_hash = ?, confirmed_at = ?
    WHERE id = ?
  `),
  
  count: db.prepare(`SELECT COUNT(*) as count FROM settlements`),
};

// Netting round operations
export const nettingRoundDb = {
  create: db.prepare(`
    INSERT INTO netting_rounds (id, batch_id, merkle_root, vault_address, status, transaction_hash, created_at, submitted_at, finalized_at, settlement_count, total_credit, total_debit, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  
  findById: db.prepare(`SELECT * FROM netting_rounds WHERE id = ?`),
  
  findByBatchId: db.prepare(`SELECT * FROM netting_rounds WHERE batch_id = ?`),
  
  findByStatus: db.prepare(`
    SELECT * FROM netting_rounds 
    WHERE status = ? 
    ORDER BY created_at DESC
  `),
  
  list: db.prepare(`SELECT * FROM netting_rounds ORDER BY created_at DESC LIMIT ? OFFSET ?`),
  
  updateStatus: db.prepare(`
    UPDATE netting_rounds 
    SET status = ?, transaction_hash = ?, submitted_at = ?, finalized_at = ?
    WHERE id = ?
  `),
  
  count: db.prepare(`SELECT COUNT(*) as count FROM netting_rounds`),
};

// Insurance event operations
export const insuranceEventDb = {
  create: db.prepare(`
    INSERT INTO insurance_events (event_type, amount, vault_address, transaction_hash, created_at, metadata)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  
  list: db.prepare(`
    SELECT * FROM insurance_events 
    ORDER BY created_at DESC 
    LIMIT ? OFFSET ?
  `),
  
  count: db.prepare(`SELECT COUNT(*) as count FROM insurance_events`),
};

// Audit log operations
export const auditLogDb = {
  log: db.prepare(`
    INSERT INTO audit_log (action, actor, entity_type, entity_id, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  
  list: db.prepare(`
    SELECT * FROM audit_log 
    ORDER BY created_at DESC 
    LIMIT ? OFFSET ?
  `),
  
  count: db.prepare(`SELECT COUNT(*) as count FROM audit_log`),
};

/**
 * Helper function to log audit events
 */
export function logAudit(params: {
  action: string;
  actor?: string;
  entityType?: string;
  entityId?: string;
  details?: any;
}) {
  auditLogDb.log.run(
    params.action,
    params.actor || null,
    params.entityType || null,
    params.entityId || null,
    params.details ? JSON.stringify(params.details) : null,
    Date.now()
  );
}

// Initialize on import
initializeDatabase();
