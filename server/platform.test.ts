import fs from 'fs';
import { answerNaturalLanguageQuery, generateGroundedBusinessInsights } from './aiEngine.ts';
import { validateAndCleanCsv } from './dataCleaner.ts';
import {
  getActiveDatasetStatus,
  getCategorySales,
  getDashboardKpis,
  getSalesTrend,
  saveCleanedDataset,
} from './database.ts';
import { runAnomalyDetection, runSalesForecast } from './mlEngine.ts';
import { generateExecutivePdfBuffer } from './pdfGenerator.ts';
import { ensureSampleDatasets } from './seedDataset.ts';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

async function runAllTests() {
  console.log('=== Autonomous Business Intelligence Platform — End-to-End Test Suite ===');

  // 1. Seed & Reference Dataset Validation
  const { cleanCsvPath, dirtyCsvPath } = ensureSampleDatasets();
  const cleanCsv = fs.readFileSync(cleanCsvPath, 'utf-8');
  const cleanResult = validateAndCleanCsv(cleanCsv, 'retail_sales.csv');

  assert(cleanResult.valid === true, 'Clean reference CSV should be valid');
  assert(cleanResult.rowsAccepted === 1000, `Expected 1000 accepted rows, got ${cleanResult.rowsAccepted}`);
  assert(cleanResult.rowsRejected === 0, `Expected 0 rejected rows, got ${cleanResult.rowsRejected}`);
  console.log('[PASS] 1. Reference CSV validation (1,000 valid rows)');

  // 2. Edge-Case & Dirty CSV Validation
  const emptyResult = validateAndCleanCsv('', 'empty.csv');
  assert(emptyResult.valid === false, 'Empty CSV should be rejected');

  const missingColResult = validateAndCleanCsv('ColA,ColB\n1,2', 'bad_cols.csv');
  assert(missingColResult.valid === false, 'CSV with missing required columns should be rejected');

  const dirtyCsv = fs.readFileSync(dirtyCsvPath, 'utf-8');
  const dirtyResult = validateAndCleanCsv(dirtyCsv, 'retail_sales_dirty_sample.csv');
  assert(dirtyResult.valid === true, 'Dirty sample CSV should be cleaned and accepted');
  assert(dirtyResult.duplicatesRemoved >= 1, 'Duplicate transaction ID should be detected and skipped');
  assert(dirtyResult.formulaCorrections >= 1, 'Price*Quantity mismatch should be repaired and logged');
  assert(dirtyResult.rowsRejected >= 3, 'Invalid date, negative qty, and missing price rows should be rejected');
  console.log(
    `[PASS] 2. Edge-case & dirty CSV cleaning (${dirtyResult.rowsAccepted} accepted, ${dirtyResult.rowsCleaned} cleaned, ${dirtyResult.rowsRejected} rejected)`
  );

  // 3. Database Storage & Exact Reference KPI Verification
  saveCleanedDataset(cleanResult);
  const status = getActiveDatasetStatus();
  assert(status !== null && status.filename === 'retail_sales.csv', 'Active dataset must be retail_sales.csv');

  const kpis = getDashboardKpis();
  assert(kpis !== null, 'KPIs must be returned');
  assert(kpis!.total_sales === 456000, `Expected total_sales 456000, got ${kpis!.total_sales}`);
  assert(kpis!.total_quantity === 2514, `Expected total_quantity 2514, got ${kpis!.total_quantity}`);
  assert(kpis!.total_transactions === 1000, `Expected total_transactions 1000, got ${kpis!.total_transactions}`);
  assert(
    kpis!.avg_transaction_value === 456,
    `Expected avg_transaction_value 456, got ${kpis!.avg_transaction_value}`
  );
  console.log('[PASS] 3. SQLite KPI Verification (₹4,56,000 sales | 2,514 qty | 1,000 txns | ₹456 avg)');

  // 4. Sales Trend & Category Aggregation
  const monthlyTrend = getSalesTrend('monthly');
  assert(monthlyTrend.length === 12, `Expected 12 monthly intervals, got ${monthlyTrend.length}`);
  const categories = getCategorySales();
  assert(categories.length === 3, `Expected 3 product categories, got ${categories.length}`);
  const sumCatSales = categories.reduce((acc, c) => acc + c.total_sales, 0);
  assert(Math.abs(sumCatSales - 456000) < 0.01, 'Category sales sum must equal total sales (456,000)');
  console.log('[PASS] 4. Chronological trend & category sales aggregations');

  // 5. Machine Learning — OLS Linear Regression Forecasting
  const forecast = runSalesForecast('monthly', 6);
  assert(forecast.available === true, 'Monthly forecast should be available');
  assert(forecast.metrics.mae !== null && forecast.metrics.mae >= 0, 'Holdout MAE must be computed');
  assert(forecast.metrics.rmse !== null && forecast.metrics.rmse >= 0, 'Holdout RMSE must be computed');
  const futurePts = forecast.series.filter((s) => s.split === 'future');
  assert(futurePts.length === 6, `Expected 6 future forecast points, got ${futurePts.length}`);
  console.log(
    `[PASS] 5. OLS Linear Regression Forecasting (MAE: ₹${forecast.metrics.mae}, RMSE: ₹${forecast.metrics.rmse}, Slope: ₹${forecast.metrics.slope_per_period}/mo)`
  );

  // 6. Machine Learning — Isolation Forest Anomaly Detection
  const anomalies = runAnomalyDetection(0.04);
  assert(anomalies.available === true, 'Isolation Forest must run on 1,000 transactions');
  assert(anomalies.anomalies.length === 40, `Expected 40 flagged anomalies at 4%, got ${anomalies.anomalies.length}`);
  assert(
    anomalies.summary_stats.anomaly_avg_amount > anomalies.summary_stats.normal_avg_amount,
    'Flagged high-value anomalies should have higher average amount than normal records'
  );
  console.log(
    `[PASS] 6. Isolation Forest Anomaly Detection (${anomalies.anomalies_detected} flagged, cutoff score: ${anomalies.threshold_score})`
  );

  // 7. Grounded Natural-Language Querying & Insights (Fallback & Accuracy)
  const nlRes = await answerNaturalLanguageQuery('Which product category generates the most revenue?');
  assert(nlRes.answer.includes('Electronics'), 'Grounded answer must identify Electronics as top category');
  assert(nlRes.answer.includes('2,54,000'), 'Grounded answer must cite exact Electronics revenue ₹2,54,000');
  const insightsRes = await generateGroundedBusinessInsights();
  assert(insightsRes.insights.length >= 4, 'Should generate at least 4 grounded business insights');
  console.log(`[PASS] 7. Grounded AI Query & Insights Engine (${nlRes.engine_used})`);

  // 8. Executive PDF Report Generation
  const pdfOut = await generateExecutivePdfBuffer({
    title: 'Test Executive Report',
    include_forecast: true,
    include_anomalies: true,
    include_insights: true,
  });
  const headerStr = pdfOut.buffer.subarray(0, 5).toString('ascii');
  assert(headerStr === '%PDF-', `Expected valid %PDF- binary header, got ${headerStr}`);
  assert(pdfOut.buffer.length > 3000, `Expected multi-page PDF > 3KB, got ${pdfOut.buffer.length} bytes`);
  console.log(`[PASS] 8. PDF Business Report Generation (${pdfOut.filename}, ${pdfOut.buffer.length} bytes)`);

  console.log('=== ALL 8 END-TO-END TEST SUITES PASSED SUCCESSFULLY ===');
}

runAllTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
