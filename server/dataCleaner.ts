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
  transaction_id: [
    'transaction id', 'transaction_id', 'txn id', 'txn_id', 'order id', 'order_id',
    'id', 'invoice id', 'invoice_id', 'invoice no', 'invoice', 'record id', 'row id',
    'serial', 's.no', 'sno', 'code', 'sku', 'ref', 'reference',
  ],
  date: [
    'date', 'transaction date', 'order date', 'sale date', 'timestamp', 'invoice date',
    'created at', 'created_at', 'time', 'day', 'period', 'month', 'year', 'ship date',
    'booking date', 'payment date', 'entry date', 'dt',
  ],
  customer_id: [
    'customer id', 'customer_id', 'cust id', 'client id', 'user id', 'customer',
    'customer name', 'client', 'buyer', 'account id', 'member id', 'employee id',
    'student id', 'patient id', 'vendor',
  ],
  gender: [
    'gender', 'sex', 'customer gender', 'segment', 'customer type', 'payment method',
    'payment_mode', 'ship mode', 'channel', 'status', 'tier',
  ],
  age: [
    'age', 'customer age', 'buyer age', 'tenure', 'years', 'experience', 'rating',
  ],
  product_category: [
    'product category', 'product_category', 'category', 'department', 'item category',
    'product line', 'product', 'product name', 'item', 'item name', 'sub-category',
    'subcategory', 'brand', 'region', 'city', 'country', 'state', 'branch', 'store',
    'division', 'group', 'type', 'class', 'sector', 'course', 'subject', 'role',
  ],
  quantity: [
    'quantity', 'qty', 'units', 'items sold', 'order quantity', 'count', 'volume',
    'pieces', 'packs', 'orders', 'stock', 'headcount', 'hours',
  ],
  price_per_unit: [
    'price per unit', 'price_per_unit', 'unit price', 'unit_price', 'price',
    'item price', 'rate', 'cost', 'unit cost', 'mrp', 'selling price', 'list price',
    'fee', 'charge', 'tariff', 'wage', 'hourly rate',
  ],
  total_amount: [
    'total amount', 'total_amount', 'total', 'sales', 'revenue', 'amount',
    'total sales', 'net amount', 'gross amount', 'turnover', 'profit', 'income',
    'spend', 'payment', 'value', 'salary', 'balance', 'score', 'marks', 'budget',
    'expense', 'cost_total',
  ],
};

function parseCsvLine(line: string, delimiter = ','): string[] {
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
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function detectDelimiter(headerLine: string): string {
  const candidates = [',', ';', '\t', '|'];
  let best = ',';
  let bestCount = 0;
  for (const delim of candidates) {
    const parts = parseCsvLine(headerLine, delim);
    if (parts.length > bestCount) {
      bestCount = parts.length;
      best = delim;
    }
  }
  return best;
}

function normalizeDate(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  // Pure 4-digit year e.g. "2023"
  if (/^(19\d\d|20\d\d)$/.test(trimmed)) {
    return `${trimmed}-01-01`;
  }
  // YYYY-MM format e.g. "2024-05" or "2024/05"
  const ymMatch = trimmed.replace(/\//g, '-').match(/^(19\d\d|20\d\d)-(\d{1,2})$/);
  if (ymMatch) {
    const y = Number(ymMatch[1]);
    const m = Number(ymMatch[2]);
    if (m >= 1 && m <= 12) {
      return `${y}-${String(m).padStart(2, '0')}-01`;
    }
  }
  const cleaned = trimmed.replace(/[/.]/g, '-').split(' ')[0];
  // Check YYYY-MM-DD
  const isoMatch = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    if (y >= 1970 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
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
    if (y >= 1970 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const dt = new Date(Date.UTC(y, m - 1, d));
      if (!isNaN(dt.getTime()) && dt.getUTCMonth() === m - 1) {
        return dt.toISOString().slice(0, 10);
      }
    }
  }
  // Check DD-MM-YY or MM-DD-YY
  const shortYearMatch = cleaned.match(/^(\d{1,2})-(\d{1,2})-(\d{2})$/);
  if (shortYearMatch) {
    const p1 = Number(shortYearMatch[1]);
    const p2 = Number(shortYearMatch[2]);
    const yShort = Number(shortYearMatch[3]);
    const y = yShort >= 70 ? 1900 + yShort : 2000 + yShort;
    const m = p1 > 12 ? p2 : p1;
    const d = p1 > 12 ? p1 : p2;
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const dt = new Date(Date.UTC(y, m - 1, d));
      if (!isNaN(dt.getTime()) && dt.getUTCMonth() === m - 1) {
        return dt.toISOString().slice(0, 10);
      }
    }
  }
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime()) && parsed.getFullYear() >= 1970 && parsed.getFullYear() <= 2100) {
    return parsed.toISOString().slice(0, 10);
  }
  return null;
}

function parseNumeric(raw: string | undefined): number | null {
  if (raw === undefined || raw === null) return null;
  const cleaned = raw.replace(/[₹$€£¥,\s%]/g, '').trim();
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
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.trim().length > 0);

  if (lines.length < 2) {
    return emptyResult('The CSV file must contain a header row and at least one data row.');
  }

  const delimiter = detectDelimiter(lines[0]);
  const rawHeaders = parseCsvLine(lines[0], delimiter);
  const headerMap: Record<string, number> = {};
  const detectedColumns: Record<string, string> = {};
  const usedIndices = new Set<number>();

  // Pass 1: Exact alias match
  for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES)) {
    const idx = rawHeaders.findIndex(
      (h, i) => !usedIndices.has(i) && aliases.includes(h.toLowerCase().replace(/[_-]/g, ' ').trim())
    );
    if (idx !== -1) {
      headerMap[canonical] = idx;
      detectedColumns[canonical] = rawHeaders[idx];
      usedIndices.add(idx);
    }
  }

  // Pass 2: Substring / keyword match on remaining unmapped headers
  for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES)) {
    if (headerMap[canonical] !== undefined) continue;
    const idx = rawHeaders.findIndex((h, i) => {
      if (usedIndices.has(i)) return false;
      const norm = h.toLowerCase().replace(/[_-]/g, ' ').trim();
      return aliases.some((a) => a.length >= 3 && norm.includes(a));
    });
    if (idx !== -1) {
      headerMap[canonical] = idx;
      detectedColumns[canonical] = rawHeaders[idx];
      usedIndices.add(idx);
    }
  }

  // Pass 3: Heuristic data-type inference across sample rows for any arbitrary CSV dataset
  const sampleRows = lines.slice(1, Math.min(lines.length, 25)).map((l) => parseCsvLine(l, delimiter));
  if (sampleRows.length > 0) {
    for (let colIdx = 0; colIdx < rawHeaders.length; colIdx++) {
      if (usedIndices.has(colIdx)) continue;
      const values = sampleRows.map((r) => r[colIdx] || '').filter((v) => v.length > 0);
      if (values.length === 0) continue;

      const dateCount = values.filter((v) => normalizeDate(v) !== null && isNaN(Number(v))).length;
      const numValues = values.map((v) => parseNumeric(v)).filter((n): n is number => n !== null);

      // 1) Auto-detect Date column if not yet mapped
      if (headerMap.date === undefined && dateCount >= Math.ceil(values.length * 0.6)) {
        headerMap.date = colIdx;
        detectedColumns.date = `${rawHeaders[colIdx]} (auto-detected date)`;
        usedIndices.add(colIdx);
        continue;
      }

      // 2) Auto-detect Numeric columns (total_amount, price_per_unit, quantity)
      if (numValues.length >= Math.ceil(values.length * 0.7)) {
        const allIntegers = numValues.every((n) => Number.isInteger(n) && n >= 0 && n <= 10000);
        if (headerMap.total_amount === undefined && headerMap.price_per_unit === undefined) {
          headerMap.total_amount = colIdx;
          detectedColumns.total_amount = `${rawHeaders[colIdx]} (auto-detected metric)`;
          usedIndices.add(colIdx);
          continue;
        }
        if (headerMap.quantity === undefined && allIntegers) {
          headerMap.quantity = colIdx;
          detectedColumns.quantity = `${rawHeaders[colIdx]} (auto-detected count)`;
          usedIndices.add(colIdx);
          continue;
        }
        if (headerMap.price_per_unit === undefined) {
          headerMap.price_per_unit = colIdx;
          detectedColumns.price_per_unit = `${rawHeaders[colIdx]} (auto-detected value)`;
          usedIndices.add(colIdx);
          continue;
        }
      }

      // 3) Auto-detect Category / Text grouping column
      if (headerMap.product_category === undefined && numValues.length < values.length * 0.3) {
        headerMap.product_category = colIdx;
        detectedColumns.product_category = `${rawHeaders[colIdx]} (auto-detected category)`;
        usedIndices.add(colIdx);
        continue;
      }

      // 4) Secondary text column can serve as gender / cohort segment or customer_id
      if (headerMap.gender === undefined && numValues.length < values.length * 0.3) {
        headerMap.gender = colIdx;
        detectedColumns.gender = `${rawHeaders[colIdx]} (auto-detected segment)`;
        usedIndices.add(colIdx);
        continue;
      }
    }
  }

  // Must have at least one numeric column (total_amount, price_per_unit, or quantity) to analyze
  if (
    headerMap.total_amount === undefined &&
    headerMap.price_per_unit === undefined &&
    headerMap.quantity === undefined
  ) {
    return emptyResult(
      `Could not find any numeric value/metric column in "${filename}" (detected headers: ${rawHeaders.join(
        ', '
      )}). Please upload a CSV file with at least one numeric column.`
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
    const cols = parseCsvLine(lines[i], delimiter);
    if (cols.every((c) => c === '')) continue;

    let wasRowCleaned = false;
    const rawTxId = headerMap.transaction_id !== undefined ? cols[headerMap.transaction_id] : '';
    let txId = rawTxId ? rawTxId.trim() : `TXN-AUTO-${String(i).padStart(4, '0')}`;

    if (!rawTxId && headerMap.transaction_id !== undefined) {
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
      if (headerMap.transaction_id !== undefined) {
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
      } else {
        txId = `${txId}-${i}`;
      }
    }

    let normDate: string | null = null;
    if (headerMap.date !== undefined) {
      const rawDate = cols[headerMap.date] || '';
      normDate = normalizeDate(rawDate);
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
    } else {
      // Synthetic chronological date when uploading a non-time-series dataset
      const syntheticTime = Date.UTC(2025, 0, 1) + Math.floor((i - 1) / 3) * 86400000;
      normDate = new Date(syntheticTime).toISOString().slice(0, 10);
    }

    const rawQty = headerMap.quantity !== undefined ? cols[headerMap.quantity] : undefined;
    const rawPrice = headerMap.price_per_unit !== undefined ? cols[headerMap.price_per_unit] : undefined;
    const rawTotal = headerMap.total_amount !== undefined ? cols[headerMap.total_amount] : undefined;

    let qty = parseNumeric(rawQty);
    let price = parseNumeric(rawPrice);
    let total = parseNumeric(rawTotal);

    // If quantity column doesn't exist in this dataset, default quantity to 1
    if (headerMap.quantity === undefined && (qty === null || qty <= 0)) {
      qty = 1;
    }

    if (qty === null || qty <= 0 || !Number.isInteger(qty)) {
      if (qty !== null && qty > 0 && !Number.isInteger(qty)) {
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

    const finalQty = Math.max(1, Math.round(qty));

    // If dataset only has Quantity column and no Price/Total column, use Quantity as metric
    if (
      headerMap.price_per_unit === undefined &&
      headerMap.total_amount === undefined &&
      price === null &&
      total === null
    ) {
      price = 1;
      total = finalQty;
    }

    // Recover price or total if one is present
    if ((price === null || price <= 0) && total !== null && total > 0) {
      price = Number((total / finalQty).toFixed(2));
      if (headerMap.price_per_unit !== undefined) {
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
    if (headerMap.total_amount === undefined) {
      total = expectedTotal;
    } else if (total === null || Math.abs(total - expectedTotal) > 0.05) {
      // Only flag formula correction if both quantity and price_per_unit were explicitly in the CSV
      if (headerMap.quantity !== undefined && headerMap.price_per_unit !== undefined) {
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
      }
      total = expectedTotal;
    }

    // Category / Dimension cleaning
    let category =
      headerMap.product_category !== undefined
        ? (cols[headerMap.product_category] || '').trim()
        : 'General';
    if (!category) {
      category = 'Uncategorized';
      if (headerMap.product_category !== undefined) {
        wasRowCleaned = true;
        missingValuesImputed++;
        issues.push({
          rowNumber,
          transactionId: txId,
          action: 'cleaned',
          field: 'Category',
          reason: 'Imputed missing Category as "Uncategorized"',
          originalValue: '',
          correctedValue: 'Uncategorized',
        });
      }
    } else {
      category = category.charAt(0).toUpperCase() + category.slice(1);
    }

    // Customer / Entity ID cleaning
    let customerId =
      headerMap.customer_id !== undefined ? (cols[headerMap.customer_id] || '').trim() : '';
    if (!customerId) {
      customerId = `CUST-ANON-${String(i).padStart(4, '0')}`;
      if (headerMap.customer_id !== undefined) {
        wasRowCleaned = true;
        missingValuesImputed++;
      }
    }

    // Gender / Segment cleaning
    let gender = headerMap.gender !== undefined ? (cols[headerMap.gender] || '').trim() : '';
    if (!gender) {
      gender = 'Unspecified';
      if (headerMap.gender !== undefined) {
        wasRowCleaned = true;
        missingValuesImputed++;
      }
    } else if (/^(f|female|woman|women)$/i.test(gender)) {
      gender = 'Female';
    } else if (/^(m|male|man|men)$/i.test(gender)) {
      gender = 'Male';
    } else {
      gender = gender.charAt(0).toUpperCase() + gender.slice(1);
    }

    // Age cleaning
    const rawAge = headerMap.age !== undefined ? cols[headerMap.age] : undefined;
    let age = parseNumeric(rawAge);
    if (headerMap.age === undefined) {
      age = 35;
    } else if (age === null || age < 1 || age > 120) {
      age = 35; // Median age imputation
      wasRowCleaned = true;
      missingValuesImputed++;
      issues.push({
        rowNumber,
        transactionId: txId,
        action: 'cleaned',
        field: 'Age',
        reason: rawAge
          ? `Out-of-range age (${rawAge}) replaced with median (35)`
          : 'Missing age imputed with median (35)',
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
    return emptyResult('No valid data rows remained after validation. Please ensure your CSV contains at least one positive numeric value column.');
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
