import { RawRetailRow } from './seedDataset.ts';

export interface CleaningIssue {
  rowNumber: number;
  transactionId: string;
  action: 'cleaned' | 'rejected';
  field: string;
  reason: string;
  originalValue?: string;
  correctedValue?: string;
}

export interface DataCleaningResult {
  valid: boolean;
  error?: string;
  filename: string;
  totalRowsRead: number;
  rowsAccepted: number;
  rowsCleaned: number;
  rowsRejected: number;
  duplicatesRemoved: number;
  formulaCorrections: number;
  missingValuesImputed: number;
  detectedColumns: Record<string, string>;
  issues: CleaningIssue[];
  cleanRows: RawRetailRow[];
}

const COLUMN_ALIASES: Record<string, string[]> = {
  transaction_id: ['transaction id', 'transaction_id', 'txn id', 'txn_id', 'order id', 'order_id', 'id', 'invoice id'],
  date: ['date', 'transaction date', 'order date', 'sale date', 'timestamp', 'invoice date'],
  customer_id: ['customer id', 'customer_id', 'cust id', 'client id', 'user id'],
  gender: ['gender', 'sex', 'customer gender'],
  age: ['age', 'customer age', 'buyer age'],
  product_category: ['product category', 'product_category', 'category', 'department', 'item category', 'product line'],
  quantity: ['quantity', 'qty', 'units', 'items sold', 'order quantity'],
  price_per_unit: ['price per unit', 'price_per_unit', 'unit price', 'unit_price', 'price', 'item price', 'rate'],
  total_amount: ['total amount', 'total_amount', 'total', 'sales', 'revenue', 'amount', 'total sales', 'net amount'],
};

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function normalizeDate(raw: string): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/\//g, '-');
  // Check YYYY-MM-DD
  const isoMatch = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    if (y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const dt = new Date(Date.UTC(y, m - 1, d));
      if (!isNaN(dt.getTime()) && dt.getUTCMonth() === m - 1) {
        return dt.toISOString().slice(0, 10);
      }
    }
  }
  // Check DD-MM-YYYY or MM-DD-YYYY
  const dmyMatch = cleaned.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (dmyMatch) {
    const p1 = Number(dmyMatch[1]);
    const p2 = Number(dmyMatch[2]);
    const y = Number(dmyMatch[3]);
    const m = p1 > 12 ? p2 : p1;
    const d = p1 > 12 ? p1 : p2;
    if (y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const dt = new Date(Date.UTC(y, m - 1, d));
      if (!isNaN(dt.getTime()) && dt.getUTCMonth() === m - 1) {
        return dt.toISOString().slice(0, 10);
      }
    }
  }
  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime()) && parsed.getFullYear() >= 1990 && parsed.getFullYear() <= 2100) {
    return parsed.toISOString().slice(0, 10);
  }
  return null;
}

function parseNumeric(raw: string | undefined): number | null {
  if (raw === undefined || raw === null) return null;
  const cleaned = raw.replace(/[₹$,\s]/g, '').trim();
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

export function validateAndCleanCsv(csvContent: string, filename = 'uploaded_dataset.csv'): DataCleaningResult {
  const emptyResult = (error: string): DataCleaningResult => ({
    valid: false,
    error,
    filename,
    totalRowsRead: 0,
    rowsAccepted: 0,
    rowsCleaned: 0,
    rowsRejected: 0,
    duplicatesRemoved: 0,
    formulaCorrections: 0,
    missingValuesImputed: 0,
    detectedColumns: {},
    issues: [],
    cleanRows: [],
  });

  if (!csvContent || !csvContent.trim()) {
    return emptyResult('The uploaded CSV file is empty.');
  }

  const lines = csvContent
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.trim().length > 0);

  if (lines.length < 2) {
    return emptyResult('The CSV file must contain a header row and at least one data row.');
  }

  const rawHeaders = parseCsvLine(lines[0]);
  const headerMap: Record<string, number> = {};
  const detectedColumns: Record<string, string> = {};

  for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES)) {
    const idx = rawHeaders.findIndex((h) => aliases.includes(h.toLowerCase().trim()));
    if (idx !== -1) {
      headerMap[canonical] = idx;
      detectedColumns[canonical] = rawHeaders[idx];
    }
  }

  // Required columns for core retail BI analysis
  const required = ['date', 'product_category', 'quantity', 'price_per_unit'];
  const missingRequired = required.filter((col) => headerMap[col] === undefined);

  if (missingRequired.length > 0) {
    return emptyResult(
      `Missing required columns: ${missingRequired
        .map((c) => c.replace(/_/g, ' '))
        .join(', ')}. Expected columns: Transaction ID, Date, Customer ID, Gender, Age, Product Category, Quantity, Price per Unit, Total Amount.`
    );
  }

  const seenTxIds = new Set<string>();
  const cleanRows: RawRetailRow[] = [];
  const issues: CleaningIssue[] = [];
  let rowsCleaned = 0;
  let rowsRejected = 0;
  let duplicatesRemoved = 0;
  let formulaCorrections = 0;
  let missingValuesImputed = 0;

  for (let i = 1; i < lines.length; i++) {
    const rowNumber = i + 1;
    const cols = parseCsvLine(lines[i]);
    if (cols.every((c) => c === '')) continue;

    let wasRowCleaned = false;
    const rawTxId = headerMap.transaction_id !== undefined ? cols[headerMap.transaction_id] : '';
    let txId = rawTxId ? rawTxId.trim() : `TXN-AUTO-${String(i).padStart(4, '0')}`;

    if (!rawTxId) {
      wasRowCleaned = true;
      missingValuesImputed++;
      issues.push({
        rowNumber,
        transactionId: txId,
        action: 'cleaned',
        field: 'Transaction ID',
        reason: 'Missing Transaction ID generated automatically',
        originalValue: '',
        correctedValue: txId,
      });
    }

    if (seenTxIds.has(txId)) {
      rowsRejected++;
      duplicatesRemoved++;
      issues.push({
        rowNumber,
        transactionId: txId,
        action: 'rejected',
        field: 'Transaction ID',
        reason: 'Duplicate Transaction ID detected and skipped to prevent double-counting revenue',
        originalValue: txId,
      });
      continue;
    }

    const rawDate = cols[headerMap.date] || '';
    const normDate = normalizeDate(rawDate);
    if (!normDate) {
      rowsRejected++;
      issues.push({
        rowNumber,
        transactionId: txId,
        action: 'rejected',
        field: 'Date',
        reason: 'Invalid or unparseable transaction date',
        originalValue: rawDate,
      });
      continue;
    }

    const rawQty = cols[headerMap.quantity];
    const rawPrice = cols[headerMap.price_per_unit];
    const rawTotal = headerMap.total_amount !== undefined ? cols[headerMap.total_amount] : undefined;

    const qty = parseNumeric(rawQty);
    let price = parseNumeric(rawPrice);
    let total = parseNumeric(rawTotal);

    if (qty === null || qty <= 0 || !Number.isInteger(qty)) {
      if (qty !== null && qty > 0 && !Number.isInteger(qty)) {
        // Round fractional quantity
        wasRowCleaned = true;
      } else {
        rowsRejected++;
        issues.push({
          rowNumber,
          transactionId: txId,
          action: 'rejected',
          field: 'Quantity',
          reason: 'Quantity must be a positive number greater than zero',
          originalValue: rawQty,
        });
        continue;
      }
    }

    const finalQty = Math.round(qty);

    // Recover price or total if one is present
    if ((price === null || price <= 0) && total !== null && total > 0) {
      price = Number((total / finalQty).toFixed(2));
      wasRowCleaned = true;
      missingValuesImputed++;
      issues.push({
        rowNumber,
        transactionId: txId,
        action: 'cleaned',
        field: 'Price per Unit',
        reason: 'Derived missing unit price from Total Amount / Quantity',
        originalValue: rawPrice || '',
        correctedValue: String(price),
      });
    }

    if (price === null || price <= 0) {
      rowsRejected++;
      issues.push({
        rowNumber,
        transactionId: txId,
        action: 'rejected',
        field: 'Price per Unit',
        reason: 'Unit price is missing or non-positive and could not be derived',
        originalValue: rawPrice,
      });
      continue;
    }

    const expectedTotal = Number((finalQty * price).toFixed(2));
    if (total === null || Math.abs(total - expectedTotal) > 0.05) {
      wasRowCleaned = true;
      formulaCorrections++;
      issues.push({
        rowNumber,
        transactionId: txId,
        action: 'cleaned',
        field: 'Total Amount',
        reason:
          total === null
            ? 'Computed missing Total Amount as Quantity × Price per Unit'
            : `Corrected inconsistent Total Amount (${total}) to match Quantity (${finalQty}) × Price (${price}) = ${expectedTotal}`,
        originalValue: rawTotal || 'NULL',
        correctedValue: String(expectedTotal),
      });
      total = expectedTotal;
    }

    // Category cleaning
    let category = (cols[headerMap.product_category] || '').trim();
    if (!category) {
      category = 'Uncategorized';
      wasRowCleaned = true;
      missingValuesImputed++;
      issues.push({
        rowNumber,
        transactionId: txId,
        action: 'cleaned',
        field: 'Product Category',
        reason: 'Imputed missing Product Category as "Uncategorized"',
        originalValue: '',
        correctedValue: 'Uncategorized',
      });
    } else {
      // Standardize title case
      category = category.charAt(0).toUpperCase() + category.slice(1);
    }

    // Customer ID cleaning
    let customerId = headerMap.customer_id !== undefined ? (cols[headerMap.customer_id] || '').trim() : '';
    if (!customerId) {
      customerId = `CUST-ANON-${String(i).padStart(4, '0')}`;
      wasRowCleaned = true;
      missingValuesImputed++;
    }

    // Gender cleaning
    let gender = headerMap.gender !== undefined ? (cols[headerMap.gender] || '').trim() : '';
    if (!gender) {
      gender = 'Unspecified';
      wasRowCleaned = true;
      missingValuesImputed++;
    } else if (/^f/i.test(gender)) {
      gender = 'Female';
    } else if (/^m/i.test(gender)) {
      gender = 'Male';
    }

    // Age cleaning
    const rawAge = headerMap.age !== undefined ? cols[headerMap.age] : undefined;
    let age = parseNumeric(rawAge);
    if (age === null || age < 12 || age > 105) {
      age = 35; // Median retail customer age imputation
      wasRowCleaned = true;
      missingValuesImputed++;
      issues.push({
        rowNumber,
        transactionId: txId,
        action: 'cleaned',
        field: 'Age',
        reason: rawAge ? `Out-of-range age (${rawAge}) replaced with median (35)` : 'Missing age imputed with median (35)',
        originalValue: rawAge || '',
        correctedValue: '35',
      });
    } else {
      age = Math.round(age);
    }

    if (wasRowCleaned) {
      rowsCleaned++;
    }

    seenTxIds.add(txId);
    cleanRows.push({
      transaction_id: txId,
      date: normDate,
      customer_id: customerId,
      gender,
      age,
      product_category: category,
      quantity: finalQty,
      price_per_unit: price,
      total_amount: total,
    });
  }

  if (cleanRows.length === 0) {
    return emptyResult('No valid retail transactions remained after validation.');
  }

  return {
    valid: true,
    filename,
    totalRowsRead: lines.length - 1,
    rowsAccepted: cleanRows.length,
    rowsCleaned,
    rowsRejected,
    duplicatesRemoved,
    formulaCorrections,
    missingValuesImputed,
    detectedColumns,
    issues: issues.slice(0, 100), // Cap returned issue log for payload safety
    cleanRows,
  };
}
