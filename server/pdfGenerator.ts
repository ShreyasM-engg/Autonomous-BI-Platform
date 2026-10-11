import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  FilterParams,
  getActiveDatasetStatus,
  getCategorySales,
  getDashboardKpis,
  getSalesTrend,
} from './database.ts';
import { generateGroundedBusinessInsights } from './aiEngine.ts';
import { runAnomalyDetection, runSalesForecast } from './mlEngine.ts';

function formatRs(val: number): string {
  return `INR ${Number(val || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

export interface ReportConfig {
  title?: string;
  prepared_for?: string;
  include_forecast?: boolean;
  include_anomalies?: boolean;
  include_insights?: boolean;
  forecast_horizon?: number;
  anomaly_contamination?: number;
  filters?: FilterParams;
}

export async function generateExecutivePdfBuffer(config: ReportConfig = {}): Promise<{
  buffer: Buffer;
  filename: string;
}> {
  const active = getActiveDatasetStatus();
  if (!active) {
    throw new Error('No active dataset loaded. Please upload a retail sales CSV first.');
  }

  const filters = config.filters || {};
  const kpis = getDashboardKpis(filters)!;
  const categories = getCategorySales(filters);
  const monthlyTrend = getSalesTrend('monthly', filters);
  const forecast = runSalesForecast('monthly', config.forecast_horizon || 6, filters);
  const anomalies = runAnomalyDetection(config.anomaly_contamination || 0.04, filters);
  const insightsBundle = await generateGroundedBusinessInsights(filters);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 18;

  // Header Banner
  doc.setFillColor(15, 23, 42); // Slate 900
  doc.rect(0, 0, pageWidth, 34, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(config.title || 'Autonomous Business Intelligence — Executive Report', 14, 15);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(203, 213, 225);
  const generatedDate = new Date().toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
  doc.text(
    `Dataset: ${active.filename}  |  Analysis Period: ${kpis.date_range.start} to ${kpis.date_range.end}  |  Generated: ${generatedDate}`,
    14,
    24
  );
  if (config.prepared_for) {
    doc.text(`Prepared For: ${config.prepared_for}`, 14, 30);
  }

  y = 44;

  // 1. Dataset & Executive KPI Summary
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('1. Executive KPI Summary & Dataset Validation', 14, y);
  y += 4;

  autoTable(doc, {
    startY: y,
    head: [['Metric', 'Calculated Value', 'Dataset Audit Metric', 'Status']],
    body: [
      ['Total Revenue', formatRs(kpis.total_sales), 'Total Rows Read', String(active.total_rows_read)],
      [
        'Total Quantity Sold',
        `${kpis.total_quantity.toLocaleString('en-IN')} units`,
        'Valid Rows Accepted',
        String(active.rows_accepted),
      ],
      [
        'Total Transactions',
        kpis.total_transactions.toLocaleString('en-IN'),
        'Rows Cleaned / Imputed',
        String(active.rows_cleaned),
      ],
      [
        'Average Transaction Value',
        formatRs(kpis.avg_transaction_value),
        'Invalid Rows Rejected',
        String(active.rows_rejected),
      ],
      [
        'Top Performing Category',
        `${kpis.top_category} (${formatRs(kpis.top_category_sales)})`,
        'Unique Customers',
        kpis.unique_customers.toLocaleString('en-IN'),
      ],
    ],
    theme: 'grid',
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontSize: 9 },
    styles: { fontSize: 8.5, cellPadding: 2.5 },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 9;

  // 2. Product Category Performance
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('2. Product Category Performance Analysis', 14, y);
  y += 4;

  autoTable(doc, {
    startY: y,
    head: [['Product Category', 'Total Sales', 'Revenue Share', 'Units Sold', 'Transactions', 'Avg Order Value']],
    body: categories.map((c) => [
      c.category,
      formatRs(c.total_sales),
      `${c.revenue_share_pct}%`,
      c.total_quantity.toLocaleString('en-IN'),
      c.transaction_count.toLocaleString('en-IN'),
      formatRs(c.avg_transaction_value),
    ]),
    theme: 'striped',
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontSize: 9 },
    styles: { fontSize: 8.5, cellPadding: 2.5 },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 9;

  // 3. Monthly Sales Trend Summary
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('3. Chronological Sales Trend Summary', 14, y);
  y += 4;

  autoTable(doc, {
    startY: y,
    head: [['Period (YYYY-MM)', 'Total Sales', 'Units Sold', 'Transactions', 'Avg Basket Value']],
    body: monthlyTrend.slice(-12).map((m) => [
      m.period,
      formatRs(m.total_sales),
      m.total_quantity.toLocaleString('en-IN'),
      m.transaction_count.toLocaleString('en-IN'),
      formatRs(m.avg_order_value),
    ]),
    theme: 'grid',
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontSize: 9 },
    styles: { fontSize: 8, cellPadding: 2 },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 10;

  // Page 2 for ML Forecast, Anomalies, Insights, and Methodology
  doc.addPage();
  y = 18;

  if (config.include_forecast !== false) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('4. Machine Learning Sales Forecast (OLS Linear Regression)', 14, y);
    y += 5;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const evalText = forecast.available
      ? `Model: ${forecast.model_name} | Holdout MAE: ${formatRs(
          forecast.metrics.mae || 0
        )} | Holdout RMSE: ${formatRs(forecast.metrics.rmse || 0)} | R²: ${
          forecast.metrics.r2_score
        } | Trend Slope: ${formatRs(forecast.metrics.slope_per_period)}/period`
      : forecast.reason || 'Forecast unavailable.';
    doc.text(evalText, 14, y);
    y += 4;

    if (forecast.available) {
      const futureRows = forecast.series.filter((s) => s.split === 'future');
      autoTable(doc, {
        startY: y,
        head: [['Future Period', 'Point Forecast', '95% Lower Bound', '95% Upper Bound']],
        body: futureRows.map((f) => [
          f.period,
          formatRs(f.forecast_sales || 0),
          formatRs(f.lower_bound || 0),
          formatRs(f.upper_bound || 0),
        ]),
        theme: 'striped',
        headStyles: { fillColor: [22, 163, 74], textColor: 255, fontSize: 9 },
        styles: { fontSize: 8.5, cellPadding: 2.2 },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      y = (doc as any).lastAutoTable.finalY + 9;
    }
  }

  if (config.include_anomalies !== false && anomalies.available) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(
      `5. Isolation Forest Anomaly Detection Summary (${anomalies.anomalies_detected} Flagged of ${anomalies.total_evaluated})`,
      14,
      y
    );
    y += 4;

    autoTable(doc, {
      startY: y,
      head: [['Txn ID', 'Date', 'Category', 'Qty', 'Unit Price', 'Total Amount', 'Score', 'Statistical Explanation']],
      body: anomalies.anomalies.slice(0, 10).map((a) => [
        a.transaction_id,
        a.date,
        a.product_category,
        String(a.quantity),
        formatRs(a.price_per_unit),
        formatRs(a.total_amount),
        String(a.anomaly_score),
        a.explanation,
      ]),
      theme: 'grid',
      headStyles: { fillColor: [217, 119, 6], textColor: 255, fontSize: 8.5 },
      styles: { fontSize: 7.5, cellPadding: 2 },
      columnStyles: {
        7: { cellWidth: 58 },
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 9;
  }

  if (config.include_insights !== false) {
    if (y > 220) {
      doc.addPage();
      y = 18;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('6. AI-Grounded Business Insights & Strategic Recommendations', 14, y);
    y += 4;

    autoTable(doc, {
      startY: y,
      head: [['Area', 'Finding & Supporting Evidence', 'Actionable Recommendation']],
      body: insightsBundle.insights.map((ins) => [
        ins.category,
        `${ins.finding} (${ins.evidence})`,
        `${ins.recommendation} [Note: ${ins.uncertainty_note}]`,
      ]),
      theme: 'striped',
      headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 8.5 },
      styles: { fontSize: 7.8, cellPadding: 2.5 },
      columnStyles: {
        0: { cellWidth: 28 },
        1: { cellWidth: 74 },
        2: { cellWidth: 74 },
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 8;
  }

  // 7. Methodology & Limitations
  if (y > 245) {
    doc.addPage();
    y = 18;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text('7. Methodology & Analytical Limitations', 14, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.2);
  doc.setTextColor(71, 85, 105);
  const notes = [
    '• Data Hygiene: All figures are computed from validated SQLite records where Quantity × Unit Price = Total Amount.',
    '• Forecasting Limitation: OLS Linear Regression captures baseline trend and seasonal harmonics; forecasts are statistical estimates, not guarantees.',
    '• Anomaly Disclaimer: Isolation Forest flags multivariate statistical outliers (short average binary tree path lengths). Flagged records indicate unusual purchasing patterns (e.g., B2B bulk orders) and are not proof of fraud.',
  ];
  for (const line of notes) {
    const split = doc.splitTextToSize(line, pageWidth - 28);
    doc.text(split, 14, y);
    y += split.length * 4.2;
  }

  const arrayBuffer = doc.output('arraybuffer');
  const safeDate = new Date().toISOString().slice(0, 10);
  return {
    buffer: Buffer.from(arrayBuffer),
    filename: `ABI_Executive_Report_${safeDate}.pdf`,
  };
}
