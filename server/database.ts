import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { DataCleaningResult } from './dataCleaner.ts';
import { RawRetailRow } from './seedDataset.ts';

const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'abi_platform.sqlite');
const db = new DatabaseSync(dbPath);

// Initialize schema
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS datasets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    uploaded_at TEXT NOT NULL,
    total_rows_read INTEGER NOT NULL,
    rows_accepted INTEGER NOT NULL,
    rows_cleaned INTEGER NOT NULL,
    rows_rejected INTEGER NOT NULL,
    duplicates_removed INTEGER NOT NULL,
    formula_corrections INTEGER NOT NULL,
    missing_imputed INTEGER NOT NULL,
    min_date TEXT,
    max_date TEXT,
    issues_json TEXT NOT NULL DEFAULT '[]',
    is_active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS sales_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_id INTEGER NOT NULL,
    transaction_id TEXT NOT NULL,
    date TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    gender TEXT NOT NULL,
    age INTEGER NOT NULL,
    product_category TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    price_per_unit REAL NOT NULL,
    total_amount REAL NOT NULL,
    FOREIGN KEY (dataset_id) REFERENCES datasets(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_sales_dataset_date ON sales_transactions(dataset_id, date);
  CREATE INDEX IF NOT EXISTS idx_sales_dataset_category ON sales_transactions(dataset_id, product_category);

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'Business Analyst',
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

export interface DatasetMetadata {
  id: number;
  filename: string;
  uploaded_at: string;
  total_rows_read: number;
  rows_accepted: number;
  rows_cleaned: number;
  rows_rejected: number;
  duplicates_removed: number;
  formula_corrections: number;
  missing_imputed: number;
  min_date: string;
  max_date: string;
  issues: unknown[];
  is_active: boolean;
}

export function saveCleanedDataset(result: DataCleaningResult): DatasetMetadata {
  const dates = result.cleanRows.map((r) => r.date).sort();
  const minDate = dates[0] || '';
  const maxDate = dates[dates.length - 1] || '';
  const uploadedAt = new Date().toISOString();

  db.exec('BEGIN TRANSACTION');
  try {
    db.prepare('UPDATE datasets SET is_active = 0').run();

    const insertDataset = db.prepare(`
      INSERT INTO datasets (
        filename, uploaded_at, total_rows_read, rows_accepted, rows_cleaned,
        rows_rejected, duplicates_removed, formula_corrections, missing_imputed,
        min_date, max_date, issues_json, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);

    const info = insertDataset.run(
      result.filename,
      uploadedAt,
      result.totalRowsRead,
      result.rowsAccepted,
      result.rowsCleaned,
      result.rowsRejected,
      result.duplicatesRemoved,
      result.formulaCorrections,
      result.missingValuesImputed,
      minDate,
      maxDate,
      JSON.stringify(result.issues)
    );

    const datasetId = Number(info.lastInsertRowid);

    const insertTx = db.prepare(`
      INSERT INTO sales_transactions (
        dataset_id, transaction_id, date, customer_id, gender, age,
        product_category, quantity, price_per_unit, total_amount
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const row of result.cleanRows) {
      insertTx.run(
        datasetId,
        row.transaction_id,
        row.date,
        row.customer_id,
        row.gender,
        row.age,
        row.product_category,
        row.quantity,
        row.price_per_unit,
        row.total_amount
      );
    }

    db.exec('COMMIT');
    return getActiveDatasetStatus()!;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function appendManualTransaction(input: {
  transaction_id?: string;
  date: string;
  customer_id?: string;
  gender?: string;
  age?: number;
  product_category: string;
  quantity: number;
  price_per_unit: number;
}): DatasetMetadata {
  const dateStr = (input.date || new Date().toISOString().slice(0, 10)).trim();
  const category = (input.product_category || 'General').trim();
  const qty = Math.max(1, Math.round(Number(input.quantity) || 1));
  const price = Math.max(0.01, Number(input.price_per_unit) || 1);
  const total = Number((qty * price).toFixed(2));
  const gender = (input.gender || 'Female').trim();
  const age = Math.min(100, Math.max(15, Math.round(Number(input.age) || 30)));

  db.exec('BEGIN TRANSACTION');
  try {
    let active = getActiveDatasetStatus();
    let datasetId: number;

    if (!active) {
      const now = new Date().toISOString();
      const info = db
        .prepare(
          `INSERT INTO datasets (
            filename, uploaded_at, total_rows_read, rows_accepted, rows_cleaned,
            rows_rejected, duplicates_removed, formula_corrections, missing_imputed,
            min_date, max_date, issues_json, is_active
          ) VALUES (?, ?, 0, 0, 0, 0, 0, 0, 0, ?, ?, '[]', 1)`
        )
        .run('manual_sales_dataset.csv', now, dateStr, dateStr);
      datasetId = Number(info.lastInsertRowid);
    } else {
      datasetId = active.id;
    }

    const countRow = db
      .prepare('SELECT COUNT(*) as cnt FROM sales_transactions WHERE dataset_id = ?')
      .get(datasetId) as { cnt: number };
    const nextIdx = Number(countRow.cnt || 0) + 1;

    const txId =
      input.transaction_id && input.transaction_id.trim()
        ? input.transaction_id.trim()
        : `TXN-${String(nextIdx).padStart(4, '0')}`;
    const custId =
      input.customer_id && input.customer_id.trim()
        ? input.customer_id.trim()
        : `CUST-${String(((nextIdx - 1) % 200) + 1).padStart(3, '0')}`;

    db.prepare(
      `INSERT INTO sales_transactions (
        dataset_id, transaction_id, date, customer_id, gender, age,
        product_category, quantity, price_per_unit, total_amount
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(datasetId, txId, dateStr, custId, gender, age, category, qty, price, total);

    const bounds = db
      .prepare(
        `SELECT COUNT(*) as cnt, MIN(date) as min_d, MAX(date) as max_d
         FROM sales_transactions WHERE dataset_id = ?`
      )
      .get(datasetId) as { cnt: number; min_d: string; max_d: string };

    db.prepare(
      `UPDATE datasets
       SET total_rows_read = total_rows_read + 1,
           rows_accepted = ?,
           min_date = ?,
           max_date = ?
       WHERE id = ?`
    ).run(bounds.cnt, bounds.min_d || dateStr, bounds.max_d || dateStr, datasetId);

    db.exec('COMMIT');
    return getActiveDatasetStatus()!;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function getActiveDatasetStatus(): DatasetMetadata | null {
  const row = db
    .prepare('SELECT * FROM datasets WHERE is_active = 1 ORDER BY id DESC LIMIT 1')
    .get() as Record<string, unknown> | undefined;

  if (!row) return null;

  return {
    id: Number(row.id),
    filename: String(row.filename),
    uploaded_at: String(row.uploaded_at),
    total_rows_read: Number(row.total_rows_read),
    rows_accepted: Number(row.rows_accepted),
    rows_cleaned: Number(row.rows_cleaned),
    rows_rejected: Number(row.rows_rejected),
    duplicates_removed: Number(row.duplicates_removed),
    formula_corrections: Number(row.formula_corrections),
    missing_imputed: Number(row.missing_imputed),
    min_date: String(row.min_date || ''),
    max_date: String(row.max_date || ''),
    issues: JSON.parse(String(row.issues_json || '[]')),
    is_active: Boolean(row.is_active),
  };
}

export function listAllDatasets(): Omit<DatasetMetadata, 'issues'>[] {
  const rows = db
    .prepare('SELECT * FROM datasets ORDER BY id DESC LIMIT 20')
    .all() as Record<string, unknown>[];

  return rows.map((row) => ({
    id: Number(row.id),
    filename: String(row.filename),
    uploaded_at: String(row.uploaded_at),
    total_rows_read: Number(row.total_rows_read),
    rows_accepted: Number(row.rows_accepted),
    rows_cleaned: Number(row.rows_cleaned),
    rows_rejected: Number(row.rows_rejected),
    duplicates_removed: Number(row.duplicates_removed),
    formula_corrections: Number(row.formula_corrections),
    missing_imputed: Number(row.missing_imputed),
    min_date: String(row.min_date || ''),
    max_date: String(row.max_date || ''),
    is_active: Boolean(row.is_active),
  }));
}

export function activateDatasetById(datasetId: number): DatasetMetadata | null {
  const exists = db.prepare('SELECT id FROM datasets WHERE id = ?').get(datasetId);
  if (!exists) return null;
  db.exec('BEGIN TRANSACTION');
  try {
    db.prepare('UPDATE datasets SET is_active = 0').run();
    db.prepare('UPDATE datasets SET is_active = 1 WHERE id = ?').run(datasetId);
    db.exec('COMMIT');
    return getActiveDatasetStatus();
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function clearAllDatasets(): void {
  db.exec('BEGIN TRANSACTION');
  try {
    db.prepare('DELETE FROM sales_transactions').run();
    db.prepare('DELETE FROM datasets').run();
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function deleteDatasetById(datasetId: number): void {
  db.exec('BEGIN TRANSACTION');
  try {
    db.prepare('DELETE FROM sales_transactions WHERE dataset_id = ?').run(datasetId);
    db.prepare('DELETE FROM datasets WHERE id = ?').run(datasetId);
    // If no active dataset remains, activate the most recent remaining one if any
    const active = db.prepare('SELECT id FROM datasets WHERE is_active = 1 LIMIT 1').get();
    if (!active) {
      const latest = db.prepare('SELECT id FROM datasets ORDER BY id DESC LIMIT 1').get() as
        | { id: number }
        | undefined;
      if (latest) {
        db.prepare('UPDATE datasets SET is_active = 1 WHERE id = ?').run(latest.id);
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export interface FilterParams {
  category?: string;
  startDate?: string;
  endDate?: string;
  gender?: string;
  search?: string;
}

function buildWhereClause(datasetId: number, filters: FilterParams = {}) {
  const clauses: string[] = ['dataset_id = ?'];
  const params: (string | number)[] = [datasetId];

  if (filters.category && filters.category !== 'All') {
    clauses.push('product_category = ?');
    params.push(filters.category);
  }
  if (filters.startDate) {
    clauses.push('date >= ?');
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    clauses.push('date <= ?');
    params.push(filters.endDate);
  }
  if (filters.gender && filters.gender !== 'All') {
    clauses.push('gender = ?');
    params.push(filters.gender);
  }
  if (filters.search && filters.search.trim()) {
    clauses.push('(transaction_id LIKE ? OR customer_id LIKE ? OR product_category LIKE ?)');
    const like = `%${filters.search.trim()}%`;
    params.push(like, like, like);
  }

  return {
    whereSql: clauses.join(' AND '),
    params,
  };
}

export function getDashboardKpis(filters: FilterParams = {}) {
  const active = getActiveDatasetStatus();
  if (!active) {
    return null;
  }

  const { whereSql, params } = buildWhereClause(active.id, filters);

  const row = db
    .prepare(
      `SELECT
        COUNT(*) as total_transactions,
        COALESCE(SUM(total_amount), 0) as total_sales,
        COALESCE(SUM(quantity), 0) as total_quantity,
        COALESCE(AVG(total_amount), 0) as avg_transaction_value,
        COALESCE(MIN(total_amount), 0) as min_transaction_value,
        COALESCE(MAX(total_amount), 0) as max_transaction_value,
        COUNT(DISTINCT customer_id) as unique_customers,
        COUNT(DISTINCT product_category) as active_categories
      FROM sales_transactions
      WHERE ${whereSql}`
    )
    .get(...params) as Record<string, number>;

  // Get top category
  const topCatRow = db
    .prepare(
      `SELECT product_category, SUM(total_amount) as cat_sales
       FROM sales_transactions
       WHERE ${whereSql}
       GROUP BY product_category
       ORDER BY cat_sales DESC
       LIMIT 1`
    )
    .get(...params) as { product_category: string; cat_sales: number } | undefined;

  return {
    dataset_id: active.id,
    filename: active.filename,
    total_sales: Number(Number(row.total_sales || 0).toFixed(2)),
    total_quantity: Number(row.total_quantity || 0),
    total_transactions: Number(row.total_transactions || 0),
    avg_transaction_value: Number(Number(row.avg_transaction_value || 0).toFixed(2)),
    min_transaction_value: Number(Number(row.min_transaction_value || 0).toFixed(2)),
    max_transaction_value: Number(Number(row.max_transaction_value || 0).toFixed(2)),
    unique_customers: Number(row.unique_customers || 0),
    active_categories: Number(row.active_categories || 0),
    top_category: topCatRow?.product_category || 'N/A',
    top_category_sales: Number(Number(topCatRow?.cat_sales || 0).toFixed(2)),
    date_range: {
      start: filters.startDate || active.min_date,
      end: filters.endDate || active.max_date,
    },
  };
}

export function getSalesTrend(
  interval: 'daily' | 'weekly' | 'monthly' = 'monthly',
  filters: FilterParams = {}
) {
  const active = getActiveDatasetStatus();
  if (!active) return [];

  const { whereSql, params } = buildWhereClause(active.id, filters);

  let periodExpr = 'substr(date, 1, 7)'; // YYYY-MM
  if (interval === 'daily') {
    periodExpr = 'date';
  } else if (interval === 'weekly') {
    // Group by ISO week start or YYYY-Www
    periodExpr = "strftime('%Y-W%W', date)";
  }

  const rows = db
    .prepare(
      `SELECT
        ${periodExpr} as period,
        MIN(date) as period_start_date,
        SUM(total_amount) as total_sales,
        SUM(quantity) as total_quantity,
        COUNT(*) as transaction_count,
        AVG(total_amount) as avg_order_value
      FROM sales_transactions
      WHERE ${whereSql}
      GROUP BY period
      ORDER BY period ASC`
    )
    .all(...params) as Record<string, unknown>[];

  return rows.map((r) => ({
    period: String(r.period),
    period_start_date: String(r.period_start_date),
    total_sales: Number(Number(r.total_sales).toFixed(2)),
    total_quantity: Number(r.total_quantity),
    transaction_count: Number(r.transaction_count),
    avg_order_value: Number(Number(r.avg_order_value).toFixed(2)),
  }));
}

export function getCategorySales(filters: FilterParams = {}) {
  const active = getActiveDatasetStatus();
  if (!active) return [];

  const { whereSql, params } = buildWhereClause(active.id, filters);

  const rows = db
    .prepare(
      `SELECT
        product_category as category,
        SUM(total_amount) as total_sales,
        SUM(quantity) as total_quantity,
        COUNT(*) as transaction_count,
        AVG(total_amount) as avg_transaction_value,
        AVG(price_per_unit) as avg_unit_price
      FROM sales_transactions
      WHERE ${whereSql}
      GROUP BY product_category
      ORDER BY total_sales DESC`
    )
    .all(...params) as Record<string, unknown>[];

  const grandTotal = rows.reduce((acc, r) => acc + Number(r.total_sales), 0) || 1;

  return rows.map((r) => ({
    category: String(r.category),
    total_sales: Number(Number(r.total_sales).toFixed(2)),
    total_quantity: Number(r.total_quantity),
    transaction_count: Number(r.transaction_count),
    avg_transaction_value: Number(Number(r.avg_transaction_value).toFixed(2)),
    avg_unit_price: Number(Number(r.avg_unit_price).toFixed(2)),
    revenue_share_pct: Number(((Number(r.total_sales) / grandTotal) * 100).toFixed(2)),
  }));
}

export function getSalesAnalysisBreakdowns(filters: FilterParams = {}) {
  const active = getActiveDatasetStatus();
  if (!active) return null;

  const { whereSql, params } = buildWhereClause(active.id, filters);

  // Gender breakdown
  const byGender = db
    .prepare(
      `SELECT
        gender,
        SUM(total_amount) as total_sales,
        SUM(quantity) as total_quantity,
        COUNT(*) as transaction_count,
        AVG(total_amount) as avg_order_value
      FROM sales_transactions
      WHERE ${whereSql}
      GROUP BY gender
      ORDER BY total_sales DESC`
    )
    .all(...params) as Record<string, unknown>[];

  // Age bracket breakdown
  const byAgeGroup = db
    .prepare(
      `SELECT
        CASE
          WHEN age < 25 THEN '18–24 (Gen Z)'
          WHEN age BETWEEN 25 AND 34 THEN '25–34 (Young Adult)'
          WHEN age BETWEEN 35 AND 44 THEN '35–44 (Mid-Career)'
          WHEN age BETWEEN 45 AND 54 THEN '45–54 (Established)'
          ELSE '55+ (Senior)'
        END as age_group,
        SUM(total_amount) as total_sales,
        SUM(quantity) as total_quantity,
        COUNT(*) as transaction_count,
        AVG(total_amount) as avg_order_value
      FROM sales_transactions
      WHERE ${whereSql}
      GROUP BY age_group
      ORDER BY age_group ASC`
    )
    .all(...params) as Record<string, unknown>[];

  // Day of week breakdown
  const byDayOfWeek = db
    .prepare(
      `SELECT
        CAST(strftime('%w', date) AS INTEGER) as dow_num,
        CASE CAST(strftime('%w', date) AS INTEGER)
          WHEN 0 THEN 'Sunday'
          WHEN 1 THEN 'Monday'
          WHEN 2 THEN 'Tuesday'
          WHEN 3 THEN 'Wednesday'
          WHEN 4 THEN 'Thursday'
          WHEN 5 THEN 'Friday'
          WHEN 6 THEN 'Saturday'
        END as day_name,
        SUM(total_amount) as total_sales,
        COUNT(*) as transaction_count,
        AVG(total_amount) as avg_order_value
      FROM sales_transactions
      WHERE ${whereSql}
      GROUP BY dow_num
      ORDER BY dow_num ASC`
    )
    .all(...params) as Record<string, unknown>[];

  // Category by Month matrix for comparative analysis
  const categoryMonthly = db
    .prepare(
      `SELECT
        substr(date, 1, 7) as month,
        product_category as category,
        SUM(total_amount) as total_sales
      FROM sales_transactions
      WHERE ${whereSql}
      GROUP BY month, product_category
      ORDER BY month ASC`
    )
    .all(...params) as Record<string, unknown>[];

  return {
    by_gender: byGender.map((r) => ({
      gender: String(r.gender),
      total_sales: Number(Number(r.total_sales).toFixed(2)),
      total_quantity: Number(r.total_quantity),
      transaction_count: Number(r.transaction_count),
      avg_order_value: Number(Number(r.avg_order_value).toFixed(2)),
    })),
    by_age_group: byAgeGroup.map((r) => ({
      age_group: String(r.age_group),
      total_sales: Number(Number(r.total_sales).toFixed(2)),
      total_quantity: Number(r.total_quantity),
      transaction_count: Number(r.transaction_count),
      avg_order_value: Number(Number(r.avg_order_value).toFixed(2)),
    })),
    by_day_of_week: byDayOfWeek.map((r) => ({
      day_name: String(r.day_name),
      total_sales: Number(Number(r.total_sales).toFixed(2)),
      transaction_count: Number(r.transaction_count),
      avg_order_value: Number(Number(r.avg_order_value).toFixed(2)),
    })),
    category_monthly: categoryMonthly.map((r) => ({
      month: String(r.month),
      category: String(r.category),
      total_sales: Number(Number(r.total_sales).toFixed(2)),
    })),
  };
}

export function getDatasetPreview(
  limit = 25,
  offset = 0,
  filters: FilterParams = {}
): { total: number; rows: RawRetailRow[]; categories: string[] } {
  const active = getActiveDatasetStatus();
  if (!active) return { total: 0, rows: [], categories: [] };

  const safeLimit = Math.min(200, Math.max(1, Number(limit) || 25));
  const safeOffset = Math.max(0, Number(offset) || 0);

  const { whereSql, params } = buildWhereClause(active.id, filters);

  const countRow = db
    .prepare(`SELECT COUNT(*) as cnt FROM sales_transactions WHERE ${whereSql}`)
    .get(...params) as { cnt: number };

  const rows = db
    .prepare(
      `SELECT
        transaction_id, date, customer_id, gender, age,
        product_category, quantity, price_per_unit, total_amount
      FROM sales_transactions
      WHERE ${whereSql}
      ORDER BY date DESC, transaction_id ASC
      LIMIT ? OFFSET ?`
    )
    .all(...params, safeLimit, safeOffset) as unknown as RawRetailRow[];

  const catRows = db
    .prepare(
      `SELECT DISTINCT product_category FROM sales_transactions WHERE dataset_id = ? ORDER BY product_category ASC`
    )
    .all(active.id) as { product_category: string }[];

  return {
    total: Number(countRow.cnt || 0),
    rows,
    categories: catRows.map((c) => c.product_category),
  };
}

export function getAllActiveTransactions(filters: FilterParams = {}): RawRetailRow[] {
  const active = getActiveDatasetStatus();
  if (!active) return [];
  const { whereSql, params } = buildWhereClause(active.id, filters);

  return db
    .prepare(
      `SELECT
        transaction_id, date, customer_id, gender, age,
        product_category, quantity, price_per_unit, total_amount
      FROM sales_transactions
      WHERE ${whereSql}
      ORDER BY date ASC, transaction_id ASC`
    )
    .all(...params) as unknown as RawRetailRow[];
}

export interface AuthUser {
  id: number;
  full_name: string;
  email: string;
  role: string;
  created_at: string;
}

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

// Clean up any previously seeded demo user so only real registered accounts exist
db.prepare("DELETE FROM users WHERE lower(email) = 'admin@autonomousbi.com'").run();

function createSessionForUser(userId: number): string {
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  db.prepare(
    `INSERT INTO user_sessions (token, user_id, created_at, expires_at)
     VALUES (?, ?, ?, ?)`
  ).run(token, userId, now.toISOString(), expires.toISOString());
  return token;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function registerUserAccount(params: {
  full_name: string;
  email: string;
  password: string;
  role?: string;
}): { user: AuthUser; token: string } {
  const fullName = String(params.full_name || '').trim();
  const email = String(params.email || '').trim().toLowerCase();
  const password = String(params.password || '');
  const role = String(params.role || 'Business Analyst').trim() || 'Business Analyst';

  if (fullName.length < 2 || fullName.length > 80 || !/[a-zA-Z]/.test(fullName)) {
    throw new Error('Full name must be between 2 and 80 characters and contain letters.');
  }
  if (!EMAIL_REGEX.test(email)) {
    throw new Error('Please enter a valid email address (e.g., name@domain.com).');
  }
  if (password.length < 6) {
    throw new Error('Password must be at least 6 characters long.');
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new Error('Password must contain at least one letter and one number.');
  }

  const existing = db
    .prepare('SELECT id FROM users WHERE lower(email) = lower(?)')
    .get(email) as { id: number } | undefined;
  if (existing) {
    throw new Error('An account with this email address already exists. Please login instead.');
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  const createdAt = new Date().toISOString();

  const info = db
    .prepare(
      `INSERT INTO users (full_name, email, role, password_salt, password_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(fullName, email, role, salt, hash, createdAt);

  const userId = Number(info.lastInsertRowid);
  const token = createSessionForUser(userId);

  return {
    user: {
      id: userId,
      full_name: fullName,
      email,
      role,
      created_at: createdAt,
    },
    token,
  };
}

export function loginUserAccount(params: {
  email: string;
  password: string;
}): { user: AuthUser; token: string } {
  const email = String(params.email || '').trim().toLowerCase();
  const password = String(params.password || '');

  if (!email || !password) {
    throw new Error('Please enter both your email address and password.');
  }
  if (!EMAIL_REGEX.test(email)) {
    throw new Error('Please enter a valid email address format (e.g., name@domain.com).');
  }

  const row = db
    .prepare(
      `SELECT id, full_name, email, role, password_salt, password_hash, created_at
       FROM users
       WHERE lower(email) = lower(?)`
    )
    .get(email) as
    | {
        id: number;
        full_name: string;
        email: string;
        role: string;
        password_salt: string;
        password_hash: string;
        created_at: string;
      }
    | undefined;

  if (!row) {
    throw new Error('No account found with this email address. Please Sign Up first.');
  }

  const candidateHash = hashPassword(password, row.password_salt);
  const valid = crypto.timingSafeEqual(
    Buffer.from(candidateHash, 'hex'),
    Buffer.from(row.password_hash, 'hex')
  );

  if (!valid) {
    throw new Error('Incorrect password. Please check your password and try again.');
  }

  const token = createSessionForUser(row.id);
  return {
    user: {
      id: Number(row.id),
      full_name: String(row.full_name),
      email: String(row.email),
      role: String(row.role),
      created_at: String(row.created_at),
    },
    token,
  };
}

export function getUserFromSessionToken(token: string): AuthUser | null {
  const cleanToken = String(token || '').trim();
  if (!cleanToken) return null;

  const row = db
    .prepare(
      `SELECT u.id, u.full_name, u.email, u.role, u.created_at, s.expires_at
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    )
    .get(cleanToken) as
    | {
        id: number;
        full_name: string;
        email: string;
        role: string;
        created_at: string;
        expires_at: string;
      }
    | undefined;

  if (!row) return null;

  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM user_sessions WHERE token = ?').run(cleanToken);
    return null;
  }

  return {
    id: Number(row.id),
    full_name: String(row.full_name),
    email: String(row.email),
    role: String(row.role),
    created_at: String(row.created_at),
  };
}

export function revokeUserSessionToken(token: string): void {
  const cleanToken = String(token || '').trim();
  if (!cleanToken) return;
  db.prepare('DELETE FROM user_sessions WHERE token = ?').run(cleanToken);
}
