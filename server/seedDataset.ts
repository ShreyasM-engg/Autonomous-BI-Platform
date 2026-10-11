import fs from 'fs';
import path from 'path';

export interface RawRetailRow {
  transaction_id: string;
  date: string;
  customer_id: string;
  gender: string;
  age: number;
  product_category: string;
  quantity: number;
  price_per_unit: number;
  total_amount: number;
}

/**
 * Deterministically generates the reference dataset `dataset/retail_sales.csv`
 * matching the exact college project reference benchmarks:
 * - Total transactions: 1,000
 * - Total quantity sold: 2,514
 * - Total sales: ₹4,56,000 (456000)
 * - Average transaction value: ₹456
 */
export function ensureSampleDatasets(): { cleanCsvPath: string; dirtyCsvPath: string } {
  const datasetDir = path.resolve(process.cwd(), 'dataset');
  if (!fs.existsSync(datasetDir)) {
    fs.mkdirSync(datasetDir, { recursive: true });
  }

  const cleanCsvPath = path.join(datasetDir, 'retail_sales.csv');
  const dirtyCsvPath = path.join(datasetDir, 'retail_sales_dirty_sample.csv');

  // Simple deterministic PRNG (Mulberry32) so dataset is 100% reproducible
  let seed = 20251010;
  const rand = () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Construct 1,000 quantities summing to exactly 2,514
  // Start with 514 transactions of qty=3, 486 transactions of qty=2 => 514*3 + 486*2 = 1542 + 972 = 2514!
  // Let's make a richer distribution: qty in [1, 2, 3, 4] summing to 2,514:
  // 200 * 1 = 200
  // 290 * 2 = 580
  // 306 * 3 = 918
  // 204 * 4 = 816
  // Total transactions = 200 + 290 + 306 + 204 = 1,000
  // Total quantity = 200 + 580 + 918 + 816 = 2,514!
  // Now let's assign unit prices so that sum(qty * price_per_unit) = 456,000!
  // Wait: let's verify exact integer arithmetic so every single row satisfies:
  // total_amount = quantity * price_per_unit AND sum(total_amount) = 456,000!
  const rows: { qty: number; price: number; category: string }[] = [];

  // Let's check exact sum of (qty * price) across 1,000 rows:
  // Group A (Electronics - 340 rows):
  //   100 rows: qty=4, price=300 => total=1,200 each => 120,000
  //   140 rows: qty=3, price=200 => total=600 each   => 84,000
  //   100 rows: qty=2, price=250 => total=500 each   => 50,000
  //   Subtotal Group A: 340 rows, qty = 400 + 420 + 200 = 1,020, sales = 254,000
  //
  // Group B (Clothing - 350 rows):
  //   80 rows:  qty=4, price=150 => total=600 each   => 48,000
  //   110 rows: qty=3, price=120 => total=360 each   => 39,600
  //   100 rows: qty=2, price=150 => total=300 each   => 30,000
  //   60 rows:  qty=1, price=200 => total=200 each   => 12,000
  //   Subtotal Group B: 350 rows, qty = 320 + 330 + 200 + 60 = 910, sales = 129,600
  //
  // Group C (Beauty - 310 rows):
  //   24 rows:  qty=4, price=250 => total=1,000 each => 24,000 (high-value bulk beauty orders / anomalies)
  //   56 rows:  qty=3, price=100 => total=300 each   => 16,800
  //   90 rows:  qty=2, price=100 => total=200 each   => 18,000
  //   140 rows: qty=1, price=90  => total=90 each    => 12,600
  //   Wait: 24,000 + 16,800 + 18,000 + 12,600 = 71,400.
  //   Total sales so far = 254,000 + 129,600 + 71,400 = 455,000! We need +1,000 more sales with same quantities!
  //   Let's adjust 10 rows of Group C (qty=1) from price=90 to price=190 (+100 each * 10 = +1,000):
  //   - 130 rows: qty=1, price=90  => 11,700
  //   - 10 rows:  qty=1, price=190 => 1,900
  //   Let's verify totals!
  //   Total rows: 340 + 350 + (24 + 56 + 90 + 130 + 10) = 340 + 350 + 310 = 1,000 rows!
  //   Total quantity:
  //     Group A: 100*4 + 140*3 + 100*2 = 400 + 420 + 200 = 1,020
  //     Group B: 80*4 + 110*3 + 100*2 + 60*1 = 320 + 330 + 200 + 60 = 910
  //     Group C: 24*4 + 56*3 + 90*2 + 130*1 + 10*1 = 96 + 168 + 180 + 130 + 10 = 584
  //     Sum of quantity = 1,020 + 910 + 584 = 2,514!
  //   Total sales:
  //     Group A: 120,000 + 84,000 + 50,000 = 254,000
  //     Group B: 48,000 + 39,600 + 30,000 + 12,000 = 129,600
  //     Group C: 24,000 + 16,800 + 18,000 + 11,700 + 1,900 = 72,400
  //     Sum of sales = 254,000 + 129,600 + 72,400 = 456,000!
  //   Average transaction value = 456,000 / 1,000 = 456!
  // Let's also make a few extreme outlier transactions in Electronics (keeping sum identical) so Isolation Forest detects realistic high-ticket & unusual unit-price transactions!
  // For example, in Group A (100 rows of qty=4, price=300 => 1200):
  //   Change 8 rows to qty=4, price=525 (total=2,100 each => +900*8 = +7,200)
  //   And change 72 rows to qty=4, price=275 (total=1,100 each => -100*72 = -7,200)
  //   And keep 20 rows at qty=4, price=300 (total=1,200 each).
  //   Sum of qty = (8+72+20)*4 = 400. Sum of sales = 8*2100 + 72*1100 + 20*1200 = 16,800 + 79,200 + 24,000 = 120,000!

  const addSpec = (count: number, qty: number, price: number, category: string) => {
    for (let i = 0; i < count; i++) {
      rows.push({ qty, price, category });
    }
  };

  // Electronics (340 rows, 1020 qty, ₹2,54,000 sales)
  addSpec(8, 4, 525, 'Electronics');   // ₹2,100 high-value flagship transactions
  addSpec(20, 4, 300, 'Electronics');  // ₹1,200 transactions
  addSpec(72, 4, 275, 'Electronics');  // ₹1,100 transactions
  addSpec(140, 3, 200, 'Electronics'); // ₹600 transactions
  addSpec(100, 2, 250, 'Electronics'); // ₹500 transactions

  // Clothing (350 rows, 910 qty, ₹1,29,600 sales)
  addSpec(80, 4, 150, 'Clothing');     // ₹600 transactions
  addSpec(110, 3, 120, 'Clothing');    // ₹360 transactions
  addSpec(100, 2, 150, 'Clothing');    // ₹300 transactions
  addSpec(60, 1, 200, 'Clothing');     // ₹200 transactions

  // Beauty (310 rows, 584 qty, ₹72,400 sales)
  addSpec(24, 4, 250, 'Beauty');       // ₹1,000 bulk luxury beauty orders
  addSpec(56, 3, 100, 'Beauty');       // ₹300 transactions
  addSpec(90, 2, 100, 'Beauty');       // ₹200 transactions
  addSpec(130, 1, 90, 'Beauty');       // ₹90 transactions
  addSpec(10, 1, 190, 'Beauty');       // ₹190 premium single-unit beauty orders

  // Sort rows slightly by total amount + noise so that when mapped across the year 2025,
  // there is a genuine upward seasonal sales trend (Q1 -> Q4 festive growth) for Linear Regression!
  const decorated = rows.map((r) => ({
    ...r,
    total: r.qty * r.price,
    sortScore: (r.qty * r.price) * 0.35 + rand() * 550,
  }));
  decorated.sort((a, b) => a.sortScore - b.sortScore);

  const startDate = new Date('2025-01-01T00:00:00Z').getTime();
  const dayMs = 86400 * 1000;

  const csvLines: string[] = [
    'Transaction ID,Date,Customer ID,Gender,Age,Product Category,Quantity,Price per Unit,Total Amount',
  ];

  for (let i = 0; i < decorated.length; i++) {
    const item = decorated[i];
    // Map index 0..999 across 365 days of 2025
    const dayOffset = Math.min(364, Math.floor((i / 1000) * 365));
    const dateStr = new Date(startDate + dayOffset * dayMs).toISOString().slice(0, 10);
    const txId = `TXN-${String(i + 1).padStart(4, '0')}`;
    const custNum = ((i * 7 + Math.floor(rand() * 300)) % 450) + 1;
    const customerId = `CUST-${String(custNum).padStart(3, '0')}`;
    const gender = rand() > 0.48 ? 'Female' : 'Male';
    const age = 19 + Math.floor(rand() * 46); // 19 to 64

    csvLines.push(
      `${txId},${dateStr},${customerId},${gender},${age},${item.category},${item.qty},${item.price},${item.total}`
    );
  }

  fs.writeFileSync(cleanCsvPath, csvLines.join('\n') + '\n', 'utf-8');

  // Also create a dirty/edge-case test CSV for demonstrating the cleaning & validation pipeline
  const dirtyLines = [
    ...csvLines.slice(0, 120),
    // Duplicate transaction ID
    csvLines[5],
    // Missing Product Category & Age (will be imputed/cleaned)
    'TXN-9001,2025-03-15,CUST-102,Female,,Clothing,2,150,300',
    // Formula mismatch: Quantity(3) * Price(200) != Total Amount(999) -> auto-recalculated & flagged
    'TXN-9002,2025-03-18,CUST-108,Male,34,Electronics,3,200,999',
    // Invalid date -> rejected safely
    'TXN-9003,not-a-date,CUST-110,Female,29,Beauty,1,100,100',
    // Negative quantity -> rejected safely
    'TXN-9004,2025-04-02,CUST-115,Male,41,Electronics,-2,300,-600',
    // Missing price and total -> rejected safely
    'TXN-9005,2025-04-05,CUST-120,Female,27,Beauty,2,,',
  ];
  fs.writeFileSync(dirtyCsvPath, dirtyLines.join('\n') + '\n', 'utf-8');

  return { cleanCsvPath, dirtyCsvPath };
}
