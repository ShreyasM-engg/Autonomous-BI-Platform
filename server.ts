import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import {
  answerNaturalLanguageQuery,
  checkAiBackendStatus,
  generateGroundedBusinessInsights,
} from './server/aiEngine.ts';
import { validateAndCleanCsv } from './server/dataCleaner.ts';
import {
  activateDatasetById,
  appendManualTransaction,
  clearAllDatasets,
  deleteDatasetById,
  FilterParams,
  getActiveDatasetStatus,
  getCategorySales,
  getDashboardKpis,
  getDatasetPreview,
  getSalesAnalysisBreakdowns,
  getSalesTrend,
  listAllDatasets,
  saveCleanedDataset,
} from './server/database.ts';
import { runAnomalyDetection, runSalesForecast } from './server/mlEngine.ts';
import { generateExecutivePdfBuffer } from './server/pdfGenerator.ts';
import { ensureSampleDatasets } from './server/seedDataset.ts';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB max CSV size
});

// Ensure reference CSV file exists in dataset/ directory for optional user download,
// but do NOT pre-populate dummy data into the live SQLite database automatically.
const { cleanCsvPath, dirtyCsvPath } = ensureSampleDatasets();
const migrationMarker = path.resolve(process.cwd(), 'data', '.clean_start_v2');
if (!fs.existsSync(migrationMarker)) {
  clearAllDatasets();
  fs.writeFileSync(migrationMarker, new Date().toISOString(), 'utf-8');
}

function extractFilters(query: Record<string, unknown>): FilterParams {
  return {
    category: typeof query.category === 'string' ? query.category : undefined,
    startDate: typeof query.startDate === 'string' ? query.startDate : undefined,
    endDate: typeof query.endDate === 'string' ? query.endDate : undefined,
    gender: typeof query.gender === 'string' ? query.gender : undefined,
    search: typeof query.search === 'string' ? query.search : undefined,
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  // 1. Health check
  app.get(['/health', '/api/health'], async (_req, res) => {
    const active = getActiveDatasetStatus();
    const aiStatus = await checkAiBackendStatus();
    res.json({
      status: 'healthy',
      service: 'Autonomous Business Intelligence Platform API',
      timestamp: new Date().toISOString(),
      database_connected: true,
      active_dataset: active ? active.filename : null,
      active_rows: active ? active.rows_accepted : 0,
      ai_backend: aiStatus,
    });
  });

  // 2. Upload CSV (supports multipart/form-data file OR JSON { csvContent, filename })
  app.post('/api/upload', upload.single('file'), (req, res) => {
    try {
      let csvContent = '';
      let filename = 'uploaded_sales.csv';

      if (req.file) {
        filename = path.basename(req.file.originalname || 'uploaded_sales.csv');
        if (!filename.toLowerCase().endsWith('.csv')) {
          res.status(400).json({
            valid: false,
            error: 'Invalid file extension. Only .csv files are accepted.',
          });
          return;
        }
        csvContent = req.file.buffer.toString('utf-8');
      } else if (req.body && typeof req.body.csvContent === 'string') {
        filename = path.basename(req.body.filename || 'uploaded_sales.csv');
        csvContent = req.body.csvContent;
      } else {
        res.status(400).json({
          valid: false,
          error: 'No CSV file provided. Upload a .csv file via multipart form-data or JSON payload.',
        });
        return;
      }

      const cleaningResult = validateAndCleanCsv(csvContent, filename);
      if (!cleaningResult.valid) {
        res.status(422).json(cleaningResult);
        return;
      }

      const savedMeta = saveCleanedDataset(cleaningResult);
      const kpis = getDashboardKpis();
      const preview = getDatasetPreview(15, 0);

      res.json({
        valid: true,
        message: `Successfully validated, cleaned, and stored ${cleaningResult.rowsAccepted} transactions from ${filename}.`,
        dataset: savedMeta,
        cleaning_summary: {
          filename: cleaningResult.filename,
          total_rows_read: cleaningResult.totalRowsRead,
          rows_accepted: cleaningResult.rowsAccepted,
          rows_cleaned: cleaningResult.rowsCleaned,
          rows_rejected: cleaningResult.rowsRejected,
          duplicates_removed: cleaningResult.duplicatesRemoved,
          formula_corrections: cleaningResult.formulaCorrections,
          missing_values_imputed: cleaningResult.missingValuesImputed,
          detected_columns: cleaningResult.detectedColumns,
          issues: cleaningResult.issues,
        },
        kpis,
        preview: preview.rows,
      });
    } catch (error) {
      res.status(500).json({
        valid: false,
        error: error instanceof Error ? error.message : 'Failed to process uploaded CSV file.',
      });
    }
  });

  // Add a single manual transaction row via interactive form
  app.post('/api/transactions/add', (req, res) => {
    try {
      const { transaction_id, date, customer_id, gender, age, product_category, quantity, price_per_unit } =
        req.body || {};
      if (!date || !product_category || !quantity || !price_per_unit) {
        res.status(400).json({
          error: 'Date, Product Category, Quantity, and Price per Unit are required.',
        });
        return;
      }
      const dataset = appendManualTransaction({
        transaction_id,
        date: String(date),
        customer_id,
        gender,
        age: Number(age) || 30,
        product_category: String(product_category),
        quantity: Number(quantity),
        price_per_unit: Number(price_per_unit),
      });
      res.json({
        valid: true,
        message: `Added transaction (${quantity} × ₹${price_per_unit} in ${product_category}) to active dataset (${dataset.rows_accepted} total rows).`,
        dataset,
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to add manual transaction.',
      });
    }
  });

  // Load built-in sample dataset (clean or dirty test sample)
  app.post('/api/datasets/load-preset', (req, res) => {
    try {
      const preset = req.body?.preset === 'dirty' ? 'dirty' : 'clean';
      const targetPath = preset === 'dirty' ? dirtyCsvPath : cleanCsvPath;
      const targetName = preset === 'dirty' ? 'retail_sales_dirty_sample.csv' : 'retail_sales.csv';
      const content = fs.readFileSync(targetPath, 'utf-8');
      const cleaningResult = validateAndCleanCsv(content, targetName);
      if (!cleaningResult.valid) {
        res.status(422).json(cleaningResult);
        return;
      }
      const savedMeta = saveCleanedDataset(cleaningResult);
      res.json({
        valid: true,
        message: `Loaded preset dataset ${targetName} (${cleaningResult.rowsAccepted} valid rows).`,
        dataset: savedMeta,
        cleaning_summary: {
          filename: cleaningResult.filename,
          total_rows_read: cleaningResult.totalRowsRead,
          rows_accepted: cleaningResult.rowsAccepted,
          rows_cleaned: cleaningResult.rowsCleaned,
          rows_rejected: cleaningResult.rowsRejected,
          duplicates_removed: cleaningResult.duplicatesRemoved,
          formula_corrections: cleaningResult.formulaCorrections,
          missing_values_imputed: cleaningResult.missingValuesImputed,
          detected_columns: cleaningResult.detectedColumns,
          issues: cleaningResult.issues,
        },
      });
    } catch (error) {
      res.status(500).json({
        valid: false,
        error: error instanceof Error ? error.message : 'Failed to load preset dataset.',
      });
    }
  });

  // Download raw sample CSVs
  app.get('/api/datasets/sample-download', (req, res) => {
    const type = req.query.type === 'dirty' ? 'dirty' : 'clean';
    const targetPath = type === 'dirty' ? dirtyCsvPath : cleanCsvPath;
    const downloadName = type === 'dirty' ? 'retail_sales_dirty_sample.csv' : 'retail_sales.csv';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    res.send(fs.readFileSync(targetPath, 'utf-8'));
  });

  // Dataset status, list, preview, summary
  app.get('/api/data/status', (_req, res) => {
    const active = getActiveDatasetStatus();
    const history = listAllDatasets();
    res.json({
      has_dataset: Boolean(active),
      active_dataset: active,
      datasets: history,
    });
  });

  app.post('/api/datasets/activate/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid dataset ID.' });
      return;
    }
    const activated = activateDatasetById(id);
    if (!activated) {
      res.status(404).json({ error: 'Dataset not found.' });
      return;
    }
    res.json({ active_dataset: activated });
  });

  app.post('/api/datasets/clear', (_req, res) => {
    clearAllDatasets();
    res.json({
      cleared: true,
      message: 'All datasets have been removed from the workspace.',
    });
  });

  app.delete('/api/datasets/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid dataset ID.' });
      return;
    }
    deleteDatasetById(id);
    res.json({
      deleted: true,
      active_dataset: getActiveDatasetStatus(),
      datasets: listAllDatasets(),
    });
  });

  app.get('/api/data/preview', (req, res) => {
    const limit = Number(req.query.limit) || 25;
    const offset = Number(req.query.offset) || 0;
    const filters = extractFilters(req.query as Record<string, unknown>);
    const preview = getDatasetPreview(limit, offset, filters);
    res.json(preview);
  });

  app.get('/api/data/summary', (req, res) => {
    const filters = extractFilters(req.query as Record<string, unknown>);
    const active = getActiveDatasetStatus();
    const kpis = getDashboardKpis(filters);
    const categories = getCategorySales(filters);
    res.json({
      dataset: active,
      kpis,
      categories,
    });
  });

  // 3. Dashboard endpoints
  app.get('/api/dashboard/kpis', (req, res) => {
    const filters = extractFilters(req.query as Record<string, unknown>);
    const kpis = getDashboardKpis(filters);
    res.json(kpis);
  });

  app.get('/api/dashboard/sales-trend', (req, res) => {
    const interval = (req.query.interval as 'daily' | 'weekly' | 'monthly') || 'monthly';
    const filters = extractFilters(req.query as Record<string, unknown>);
    const series = getSalesTrend(interval, filters);
    res.json({ interval, series });
  });

  app.get('/api/dashboard/category-sales', (req, res) => {
    const filters = extractFilters(req.query as Record<string, unknown>);
    const categories = getCategorySales(filters);
    res.json({ categories });
  });

  app.get('/api/sales-analysis', (req, res) => {
    const interval = (req.query.interval as 'daily' | 'weekly' | 'monthly') || 'monthly';
    const filters = extractFilters(req.query as Record<string, unknown>);
    const kpis = getDashboardKpis(filters);
    const trend = getSalesTrend(interval, filters);
    const categories = getCategorySales(filters);
    const breakdowns = getSalesAnalysisBreakdowns(filters);
    res.json({
      kpis,
      interval,
      trend,
      categories,
      breakdowns,
    });
  });

  // 4. Machine Learning endpoints
  app.get('/api/forecast', (req, res) => {
    const interval = (req.query.interval as 'daily' | 'weekly' | 'monthly') || 'monthly';
    const horizon = Number(req.query.horizon) || 6;
    const filters = extractFilters(req.query as Record<string, unknown>);
    const result = runSalesForecast(interval, horizon, filters);
    res.json(result);
  });

  app.get('/api/anomalies', (req, res) => {
    const contamination = Number(req.query.contamination) || 0.04;
    const filters = extractFilters(req.query as Record<string, unknown>);
    const result = runAnomalyDetection(contamination, filters);
    res.json(result);
  });

  // 5. AI endpoints
  app.get('/api/ai/status', async (_req, res) => {
    const status = await checkAiBackendStatus();
    res.json(status);
  });

  app.post('/api/ai/query', async (req, res) => {
    try {
      const question = String(req.body?.question || '').trim();
      if (!question) {
        res.status(400).json({ error: 'Please provide a non-empty natural-language question.' });
        return;
      }
      if (question.length > 500) {
        res.status(400).json({ error: 'Question exceeds maximum length of 500 characters.' });
        return;
      }
      const filters = extractFilters((req.body?.filters || {}) as Record<string, unknown>);
      const result = await answerNaturalLanguageQuery(question, filters);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to process natural-language query.',
      });
    }
  });

  app.get('/api/ai/insights', async (req, res) => {
    try {
      const filters = extractFilters(req.query as Record<string, unknown>);
      const result = await generateGroundedBusinessInsights(filters);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to generate business insights.',
      });
    }
  });

  // 6. PDF Report Generation endpoint
  app.post('/api/reports/generate', async (req, res) => {
    try {
      const config = req.body || {};
      const { buffer, filename } = await generateExecutivePdfBuffer(config);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to generate PDF report.',
      });
    }
  });

  // Mount Vite or Static Assets
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Autonomous Business Intelligence Platform running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
