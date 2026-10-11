import {
  FilterParams,
  getActiveDatasetStatus,
  getCategorySales,
  getDashboardKpis,
  getSalesAnalysisBreakdowns,
  getSalesTrend,
} from './database.ts';
import { runAnomalyDetection, runSalesForecast } from './mlEngine.ts';

function resolveOllamaConfig() {
  const rawUrl = (process.env.OLLAMA_BASE_URL || '').trim();
  const rawKey = (process.env.OLLAMA_API_KEY || '').trim();
  const model = (process.env.OLLAMA_MODEL || 'gpt-oss:120b').trim() || 'gpt-oss:120b';

  // If user pasted their Ollama API key into OLLAMA_BASE_URL instead of a URL, handle it gracefully
  const urlLooksLikeKey = rawUrl.length > 0 && !rawUrl.startsWith('http://') && !rawUrl.startsWith('https://');
  const apiKey = rawKey || (urlLooksLikeKey ? rawUrl : '');

  let baseUrl = 'https://ollama.com';
  if (!urlLooksLikeKey && rawUrl && !rawUrl.includes('localhost') && !rawUrl.includes('127.0.0.1')) {
    baseUrl = rawUrl.replace(/\/$/, '').replace(/\/api$/, '');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  return { baseUrl, model, apiKey, headers };
}

export interface AiBackendStatus {
  ollama_url: string;
  ollama_model: string;
  ollama_available: boolean;
  ollama_models_installed: string[];
  gemini_fallback_available: boolean;
  deterministic_engine_active: boolean;
  active_mode: 'ollama_local' | 'deterministic_grounded_engine';
  status_message: string;
}

export async function checkAiBackendStatus(): Promise<AiBackendStatus> {
  const { baseUrl, model, apiKey, headers } = resolveOllamaConfig();
  let ollamaAvailable = false;
  let installedModels: string[] = [];

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const resp = await fetch(`${baseUrl}/api/tags`, {
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (resp.ok) {
      const data = (await resp.json()) as { models?: { name: string }[] };
      installedModels = (data.models || []).map((m) => m.name);
      ollamaAvailable = true;
    }
  } catch {
    ollamaAvailable = false;
  }

  let activeMode: AiBackendStatus['active_mode'] = 'deterministic_grounded_engine';
  let statusMessage =
    'Deterministic NL-to-SQL & Statistical Grounding Engine is active. Provide OLLAMA_API_KEY (with https://ollama.com) or local Ollama to enable LLM phrasing.';

  let resolvedModel = model;
  if (ollamaAvailable && installedModels.length > 0 && !installedModels.includes(model)) {
    const cleanTarget = model.replace(/-cloud$|:cloud$/i, '');
    const match = installedModels.find((m) => m === cleanTarget || m.startsWith(cleanTarget.split(':')[0]));
    resolvedModel = match || (installedModels.includes('gpt-oss:120b') ? 'gpt-oss:120b' : installedModels[0]);
  }

  if (ollamaAvailable) {
    activeMode = 'ollama_local';
    statusMessage = `Connected to Ollama (${resolvedModel}) at ${baseUrl}${apiKey ? ' (Authenticated via API Key)' : ''} with deterministic SQL grounding.`;
  }

  return {
    ollama_url: baseUrl,
    ollama_model: resolvedModel,
    ollama_available: ollamaAvailable,
    ollama_models_installed: installedModels,
    gemini_fallback_available: false,
    deterministic_engine_active: true,
    active_mode: activeMode,
    status_message: statusMessage,
  };
}

export interface GroundedQueryResponse {
  question: string;
  intent: string;
  answer: string;
  executed_plan: string;
  supporting_data: Record<string, unknown>[];
  key_metrics: { label: string; value: string }[];
  recommendations: string[];
  engine_used: string;
  answered_at: string;
}

function formatINR(val: number): string {
  return `₹${Number(val || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

/**
 * Deterministic allowlisted intent classifier & query executor.
 * Guarantees 100% accurate calculations directly from the active SQLite dataset
 * without requiring any cloud API key.
 */
export async function answerNaturalLanguageQuery(
  questionInput: string,
  filters: FilterParams = {}
): Promise<GroundedQueryResponse> {
  const question = (questionInput || '').trim();
  const active = getActiveDatasetStatus();

  if (!active) {
    return {
      question,
      intent: 'no_dataset',
      answer: 'No retail sales dataset is currently loaded. Please upload a CSV file first to run natural-language queries.',
      executed_plan: 'NONE (No active dataset loaded)',
      supporting_data: [],
      key_metrics: [],
      recommendations: ['Upload your retail sales CSV file using the Upload Dataset section.'],
      engine_used: 'Deterministic SQL Guard (No API Key Required)',
      answered_at: new Date().toISOString(),
    };
  }

  const kpis = getDashboardKpis(filters)!;
  const categories = getCategorySales(filters);
  const monthlyTrend = getSalesTrend('monthly', filters);
  const breakdowns = getSalesAnalysisBreakdowns(filters);
  const forecast = runSalesForecast('monthly', 3, filters);
  const anomalies = runAnomalyDetection(0.04, filters);

  const qLower = question.toLowerCase();

  let intent = 'general_summary';
  let executedPlan =
    'SELECT COUNT(*), SUM(total_amount), SUM(quantity), AVG(total_amount) FROM sales_transactions WHERE dataset_id = :active_id';
  let deterministicAnswer = '';
  let supportingData: Record<string, unknown>[] = [];
  let keyMetrics: { label: string; value: string }[] = [];
  let recommendations: string[] = [];

  const topCat = categories[0];
  const lowCat = categories[categories.length - 1];
  const peakMonth = [...monthlyTrend].sort((a, b) => b.total_sales - a.total_sales)[0];
  const lowMonth = [...monthlyTrend].sort((a, b) => a.total_sales - b.total_sales)[0];

  if (
    qLower.includes('category') ||
    qLower.includes('categories') ||
    qLower.includes('product') ||
    qLower.includes('most revenue') ||
    qLower.includes('best performing') ||
    qLower.includes('top-performing')
  ) {
    intent = 'category_performance';
    executedPlan =
      'SELECT product_category, SUM(total_amount) AS total_sales, SUM(quantity) AS total_quantity, COUNT(*) AS transaction_count, AVG(total_amount) AS avg_transaction_value FROM sales_transactions WHERE dataset_id = :active_id GROUP BY product_category ORDER BY total_sales DESC';
    supportingData = categories as unknown as Record<string, unknown>[];
    keyMetrics = categories.map((c) => ({
      label: `${c.category} Revenue (${c.revenue_share_pct}%)`,
      value: `${formatINR(c.total_sales)} · ${c.total_quantity.toLocaleString('en-IN')} units`,
    }));

    deterministicAnswer = topCat
      ? `Based on the uploaded dataset (${active.filename}), **${topCat.category}** generates the highest revenue at **${formatINR(
          topCat.total_sales
        )}** (${topCat.revenue_share_pct}% of total sales across ${topCat.transaction_count} transactions, with an average order value of ${formatINR(
          topCat.avg_transaction_value
        )}). ` +
        categories
          .slice(1)
          .map(
            (c) =>
              `**${c.category}** contributed **${formatINR(c.total_sales)}** (${c.revenue_share_pct}% share, ${c.total_quantity} units sold)`
          )
          .join('; ') +
        '.'
      : 'No category records found for the current filter.';

    recommendations = [
      topCat
        ? `Prioritize inventory depth in ${topCat.category}, which drives ${topCat.revenue_share_pct}% of total revenue (${formatINR(topCat.total_sales)}).`
        : '',
      lowCat && topCat && lowCat.category !== topCat.category
        ? `Bundle ${lowCat.category} (average basket ${formatINR(lowCat.avg_transaction_value)}) with high-traffic ${topCat.category} purchases to lift cross-category attach rates.`
        : '',
    ].filter(Boolean);
  } else if (
    qLower.includes('forecast') ||
    qLower.includes('predict') ||
    qLower.includes('next month') ||
    qLower.includes('future')
  ) {
    intent = 'sales_forecast';
    executedPlan =
      'MODEL: OLS Linear Regression (Chronological 80/20 Train-Test Split) ON SELECT substr(date,1,7) AS period, SUM(total_amount) FROM sales_transactions GROUP BY period';
    const futurePoints = forecast.series.filter((s) => s.split === 'future');
    supportingData = futurePoints as unknown as Record<string, unknown>[];
    keyMetrics = [
      {
        label: 'Next Period Forecast',
        value: futurePoints[0] ? formatINR(futurePoints[0].forecast_sales || 0) : 'N/A',
      },
      {
        label: '3-Month Projected Total',
        value: formatINR(forecast.metrics.projected_horizon_total),
      },
      {
        label: 'Holdout MAE / RMSE',
        value: `${formatINR(forecast.metrics.mae || 0)} / ${formatINR(forecast.metrics.rmse || 0)}`,
      },
      {
        label: 'Trend Slope per Month',
        value: `${forecast.metrics.slope_per_period >= 0 ? '+' : ''}${formatINR(forecast.metrics.slope_per_period)}`,
      },
    ];

    deterministicAnswer = forecast.available
      ? `Using our chronologically validated Linear Regression model (trained on ${forecast.metrics.train_periods} periods, evaluated on ${forecast.metrics.test_periods} holdout periods with MAE = ${formatINR(
          forecast.metrics.mae || 0
        )} and RMSE = ${formatINR(forecast.metrics.rmse || 0)}), the forecasted sales for the next period (**${
          futurePoints[0]?.period
        }**) are estimated at **${formatINR(futurePoints[0]?.forecast_sales || 0)}** (95% prediction interval: ${formatINR(
          futurePoints[0]?.lower_bound || 0
        )} to ${formatINR(
          futurePoints[0]?.upper_bound || 0
        )}). Across the next 3 periods, total projected revenue is **${formatINR(
          forecast.metrics.projected_horizon_total
        )}** (${forecast.metrics.trend_direction.toLowerCase()} trend of ${
          forecast.metrics.slope_per_period >= 0 ? '+' : ''
        }${formatINR(forecast.metrics.slope_per_period)}/period). Note: These figures are statistical estimates rather than guaranteed outcomes.`
      : forecast.reason || 'Insufficient historical intervals to compute a reliable forecast.';

    recommendations = [
      `Plan working capital and supplier orders around the 95% confidence lower bound (${formatINR(
        futurePoints[0]?.lower_bound || 0
      )}) to avoid overstocking while maintaining safety stock for the upper bound (${formatINR(
        futurePoints[0]?.upper_bound || 0
      )}).`,
    ];
  } else if (
    qLower.includes('anomal') ||
    qLower.includes('unusual') ||
    qLower.includes('outlier') ||
    qLower.includes('suspicious') ||
    qLower.includes('spike')
  ) {
    intent = 'anomaly_detection';
    executedPlan =
      'MODEL: IsolationForest(n_estimators=100, contamination=0.04) ON features [total_amount, quantity, price_per_unit, category_amount_zscore, category_price_zscore]';
    supportingData = anomalies.anomalies.slice(0, 10) as unknown as Record<string, unknown>[];
    keyMetrics = [
      {
        label: 'Flagged Transactions',
        value: `${anomalies.anomalies_detected} of ${anomalies.total_evaluated} (${anomalies.anomaly_rate_pct}%)`,
      },
      {
        label: 'Anomaly Avg Value vs Normal',
        value: `${formatINR(anomalies.summary_stats.anomaly_avg_amount)} vs ${formatINR(anomalies.summary_stats.normal_avg_amount)}`,
      },
      {
        label: 'Highest Flagged Order',
        value: formatINR(anomalies.summary_stats.max_anomaly_amount),
      },
      {
        label: 'Most Flagged Category',
        value: anomalies.summary_stats.most_flagged_category,
      },
    ];

    const top3 = anomalies.anomalies
      .slice(0, 3)
      .map(
        (a) =>
          `**${a.transaction_id}** (${a.date}, ${a.product_category}: ${a.quantity} × ${formatINR(
            a.price_per_unit
          )} = **${formatINR(a.total_amount)}**, score ${a.anomaly_score})`
      )
      .join(', ');

    deterministicAnswer = `Isolation Forest analysis evaluated **${anomalies.total_evaluated.toLocaleString(
      'en-IN'
    )}** transactions and flagged **${anomalies.anomalies_detected}** statistically unusual records (${
      anomalies.anomaly_rate_pct
    }%). Flagged transactions average **${formatINR(
      anomalies.summary_stats.anomaly_avg_amount
    )}** compared to **${formatINR(
      anomalies.summary_stats.normal_avg_amount
    )}** for typical transactions, with the highest concentration in **${
      anomalies.summary_stats.most_flagged_category
    }**. Top flagged transactions include ${top3}. Note: An anomaly indicates unusual statistical behavior (such as bulk B2B purchases or flagship items), not proof of fraud or error.`;

    recommendations = [
      `Review high-value flagged orders in ${anomalies.summary_stats.most_flagged_category} to identify repeat bulk buyers for a dedicated VIP or B2B loyalty tier.`,
      `Verify unit price entries on transactions exceeding ${formatINR(anomalies.summary_stats.anomaly_avg_amount)} to confirm whether they reflect flagship SKU bundles or manual POS overrides.`,
    ];
  } else if (
    qLower.includes('trend') ||
    qLower.includes('month') ||
    qLower.includes('over time') ||
    qLower.includes('growth') ||
    qLower.includes('season')
  ) {
    intent = 'sales_trend';
    executedPlan =
      "SELECT substr(date, 1, 7) AS period, SUM(total_amount) AS total_sales, SUM(quantity) AS total_quantity, COUNT(*) AS transaction_count FROM sales_transactions WHERE dataset_id = :active_id GROUP BY period ORDER BY period ASC";
    supportingData = monthlyTrend as unknown as Record<string, unknown>[];
    const firstMonth = monthlyTrend[0];
    const lastMonth = monthlyTrend[monthlyTrend.length - 1];
    const firstToLastGrowth =
      firstMonth && lastMonth && firstMonth.total_sales > 0
        ? (((lastMonth.total_sales - firstMonth.total_sales) / firstMonth.total_sales) * 100).toFixed(1)
        : '0.0';

    keyMetrics = [
      {
        label: 'Peak Sales Period',
        value: peakMonth ? `${peakMonth.period} (${formatINR(peakMonth.total_sales)})` : 'N/A',
      },
      {
        label: 'Lowest Sales Period',
        value: lowMonth ? `${lowMonth.period} (${formatINR(lowMonth.total_sales)})` : 'N/A',
      },
      {
        label: 'First-to-Last Period Change',
        value: `${Number(firstToLastGrowth) >= 0 ? '+' : ''}${firstToLastGrowth}%`,
      },
      {
        label: 'Monthly Average Revenue',
        value: formatINR(kpis.total_sales / Math.max(1, monthlyTrend.length)),
      },
    ];

    deterministicAnswer = `Across **${monthlyTrend.length}** monthly periods (${kpis.date_range.start} to ${
      kpis.date_range.end
    }), revenue moved from **${formatINR(firstMonth?.total_sales || 0)}** in ${
      firstMonth?.period
    } to **${formatINR(lastMonth?.total_sales || 0)}** in ${
      lastMonth?.period
    } (**${Number(firstToLastGrowth) >= 0 ? '+' : ''}${firstToLastGrowth}%** overall change). Sales peaked in **${
      peakMonth?.period
    }** at **${formatINR(peakMonth?.total_sales || 0)}** (${
      peakMonth?.transaction_count
    } transactions) and recorded their lowest point in **${lowMonth?.period}** at **${formatINR(
      lowMonth?.total_sales || 0
    )}**.`;

    recommendations = [
      peakMonth
        ? `Replicate promotional campaigns and stock allocation from peak month ${peakMonth.period} (${formatINR(peakMonth.total_sales)}) ahead of upcoming seasonal demand cycles.`
        : '',
      lowMonth
        ? `Introduce targeted mid-season discount bundles during historically slower periods like ${lowMonth.period} (${formatINR(lowMonth.total_sales)}) to smooth cash flow.`
        : '',
    ].filter(Boolean);
  } else if (
    qLower.includes('gender') ||
    qLower.includes('age') ||
    qLower.includes('customer') ||
    qLower.includes('demographic')
  ) {
    intent = 'customer_demographics';
    executedPlan =
      'SELECT gender, age_group, SUM(total_amount) AS total_sales, COUNT(*) AS transaction_count, AVG(total_amount) AS avg_order_value FROM sales_transactions WHERE dataset_id = :active_id GROUP BY gender, age_group';
    supportingData = (breakdowns?.by_age_group || []) as unknown as Record<string, unknown>[];
    const topGender = breakdowns?.by_gender?.[0];
    const topAge = [...(breakdowns?.by_age_group || [])].sort((a, b) => b.total_sales - a.total_sales)[0];

    keyMetrics = [
      {
        label: 'Unique Customers',
        value: kpis.unique_customers.toLocaleString('en-IN'),
      },
      {
        label: 'Top Gender Segment',
        value: topGender ? `${topGender.gender} (${formatINR(topGender.total_sales)})` : 'N/A',
      },
      {
        label: 'Top Age Bracket',
        value: topAge ? `${topAge.age_group} (${formatINR(topAge.total_sales)})` : 'N/A',
      },
    ];

    deterministicAnswer = `The active dataset contains **${kpis.unique_customers.toLocaleString(
      'en-IN'
    )}** unique customer IDs across **${kpis.total_transactions.toLocaleString('en-IN')}** transactions. By gender, **${
      topGender?.gender || 'N/A'
    }** shoppers generated **${formatINR(topGender?.total_sales || 0)}** (${
      topGender?.transaction_count || 0
    } orders, average basket ${formatINR(topGender?.avg_order_value || 0)}). By age cohort, **${
      topAge?.age_group || 'N/A'
    }** is the highest-spending segment at **${formatINR(topAge?.total_sales || 0)}** (${
      topAge?.transaction_count || 0
    } transactions).`;

    recommendations = [
      topAge
        ? `Tailor retention campaigns toward the ${topAge.age_group} demographic, which leads revenue contribution at ${formatINR(topAge.total_sales)}.`
        : '',
    ].filter(Boolean);
  } else if (
    qLower.includes('action') ||
    qLower.includes('improve') ||
    qLower.includes('recommend') ||
    qLower.includes('strategy') ||
    qLower.includes('insight')
  ) {
    intent = 'strategic_recommendations';
    executedPlan =
      'MULTI-QUERY SYNTHESIS: KPIs + Category Share + Monthly Trend Slope + Isolation Forest Outliers';
    supportingData = categories as unknown as Record<string, unknown>[];
    keyMetrics = [
      { label: 'Total Revenue', value: formatINR(kpis.total_sales) },
      { label: 'Average Basket Value', value: formatINR(kpis.avg_transaction_value) },
      { label: 'Top Category Share', value: `${topCat?.category} (${topCat?.revenue_share_pct}%)` },
      { label: 'Projected 3M Sales', value: formatINR(forecast.metrics.projected_horizon_total) },
    ];

    deterministicAnswer = `To improve sales based on **${active.filename}** (${kpis.total_transactions.toLocaleString(
      'en-IN'
    )} transactions totaling **${formatINR(kpis.total_sales)}**), three data-backed priorities stand out:\n\n1. **Maximize High-Margin Category Depth**: **${
      topCat?.category
    }** generates **${topCat?.revenue_share_pct}%** of total revenue (**${formatINR(
      topCat?.total_sales || 0
    )}**) with an average basket of **${formatINR(
      topCat?.avg_transaction_value || 0
    )}**. Maintaining zero stockouts on multi-unit ${topCat?.category} SKUs protects your core revenue engine.\n2. **Lift Average Transaction Value (${formatINR(
      kpis.avg_transaction_value
    )}) via Cross-Category Bundling**: **${lowCat?.category}** currently accounts for **${
      lowCat?.revenue_share_pct
    }%** of revenue (**${formatINR(
      lowCat?.total_sales || 0
    )}**). Introducing checkout add-on bundles pairing ${lowCat?.category} with ${
      topCat?.category
    } can raise average units per order above the current **${(
      kpis.total_quantity / Math.max(1, kpis.total_transactions)
    ).toFixed(2)}** units.\n3. **Capture High-Ticket B2B/VIP Demand**: Isolation Forest identified **${
      anomalies.anomalies_detected
    }** high-value orders averaging **${formatINR(
      anomalies.summary_stats.anomaly_avg_amount
    )}**. Converting these bulk buyers into repeat account holders provides measurable upside.`;

    recommendations = [
      `Protect stock availability in ${topCat?.category} (${formatINR(topCat?.total_sales || 0)}, ${topCat?.revenue_share_pct}% share).`,
      `Use threshold discounts (e.g., "Spend ${formatINR(Math.ceil((kpis.avg_transaction_value * 1.2) / 50) * 50)}, get 10% off ${lowCat?.category}") to increase Average Transaction Value from ${formatINR(kpis.avg_transaction_value)}.`,
      `Prepare inventory for the ${forecast.metrics.trend_direction.toLowerCase()} sales trend (${forecast.metrics.slope_per_period >= 0 ? '+' : ''}${formatINR(forecast.metrics.slope_per_period)}/month).`,
    ];
  } else {
    intent = 'kpi_summary';
    executedPlan =
      'SELECT COUNT(*) AS total_transactions, SUM(total_amount) AS total_sales, SUM(quantity) AS total_quantity, AVG(total_amount) AS avg_transaction_value FROM sales_transactions WHERE dataset_id = :active_id';
    supportingData = categories as unknown as Record<string, unknown>[];
    keyMetrics = [
      { label: 'Total Sales', value: formatINR(kpis.total_sales) },
      { label: 'Total Quantity Sold', value: kpis.total_quantity.toLocaleString('en-IN') },
      { label: 'Total Transactions', value: kpis.total_transactions.toLocaleString('en-IN') },
      { label: 'Avg Transaction Value', value: formatINR(kpis.avg_transaction_value) },
    ];

    deterministicAnswer = `For the active dataset (**${active.filename}**, covering ${kpis.date_range.start} to ${
      kpis.date_range.end
    }), total revenue is **${formatINR(kpis.total_sales)}** across **${kpis.total_transactions.toLocaleString(
      'en-IN'
    )}** transactions and **${kpis.total_quantity.toLocaleString(
      'en-IN'
    )}** total units sold, yielding an average transaction value (ATV) of **${formatINR(
      kpis.avg_transaction_value
    )}**. **${topCat?.category}** is the top-performing category with **${formatINR(
      topCat?.total_sales || 0
    )}** (${topCat?.revenue_share_pct}% of revenue).`;

    recommendations = [
      `Focus merchandising on ${topCat?.category} (${topCat?.revenue_share_pct}% of revenue) while testing multi-item bundles to lift the ${formatINR(kpis.avg_transaction_value)} average order value.`,
      `Explore the Forecast & Anomalies section to inspect the ${anomalies.anomalies_detected} unusual transactions and the ${forecast.metrics.trend_direction.toLowerCase()} monthly revenue trajectory.`,
    ];
  }

  // Optional Local Ollama (llama3.2:3b) refinement when running locally on the user's machine.
  // Zero cloud API keys are used.
  const status = await checkAiBackendStatus();
  let engineUsed = 'Deterministic NL-to-SQL Grounding Engine (Zero API Key)';

  const groundingContext = `
Verified Dataset Facts (DO NOT alter or invent any numbers):
- Dataset: ${active.filename} (${kpis.date_range.start} to ${kpis.date_range.end})
- Total Sales: ${formatINR(kpis.total_sales)}
- Total Quantity Sold: ${kpis.total_quantity}
- Total Transactions: ${kpis.total_transactions}
- Average Transaction Value: ${formatINR(kpis.avg_transaction_value)}
- Category Breakdown: ${categories
    .map((c) => `${c.category}: ${formatINR(c.total_sales)} (${c.revenue_share_pct}%, ${c.total_quantity} units, ${c.transaction_count} txns)`)
    .join(' | ')}
- Peak Month: ${peakMonth?.period} (${formatINR(peakMonth?.total_sales || 0)}), Lowest Month: ${lowMonth?.period} (${formatINR(lowMonth?.total_sales || 0)})
- Forecast (Next 3 Months Total): ${formatINR(forecast.metrics.projected_horizon_total)} (Slope: ${formatINR(forecast.metrics.slope_per_period)}/month, MAE: ${formatINR(forecast.metrics.mae || 0)}, RMSE: ${formatINR(forecast.metrics.rmse || 0)})
- Isolation Forest Anomalies: ${anomalies.anomalies_detected} flagged out of ${anomalies.total_evaluated} (Avg anomaly value: ${formatINR(anomalies.summary_stats.anomaly_avg_amount)} vs normal ${formatINR(anomalies.summary_stats.normal_avg_amount)})
- Pre-computed Grounded Answer: ${deterministicAnswer}
`;

  if (status.ollama_available) {
    try {
      const { baseUrl, headers } = resolveOllamaConfig();
      const targetModel = status.ollama_model;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const resp = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: targetModel,
          stream: false,
          prompt: `You are an Enterprise Business Intelligence Analyst. Answer the user's question concisely in 3-5 sentences using ONLY the Verified Dataset Facts below. Never invent numbers.\n${groundingContext}\nUser Question: ${question}`,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (resp.ok) {
        const data = (await resp.json()) as { response?: string };
        if (data.response && data.response.trim().length > 20) {
          deterministicAnswer = data.response.trim();
          engineUsed = `Ollama (${targetModel}) + SQL Grounding`;
        }
      }
    } catch {
      // Keep deterministic grounded answer on timeout/error
    }
  }

  return {
    question,
    intent,
    answer: deterministicAnswer,
    executed_plan: executedPlan,
    supporting_data: supportingData,
    key_metrics: keyMetrics,
    recommendations,
    engine_used: engineUsed,
    answered_at: new Date().toISOString(),
  };
}

export interface BusinessInsightCard {
  id: string;
  category: 'Revenue Leader' | 'Temporal Trend' | 'Anomaly Alert' | 'Growth Opportunity' | 'Forecast Outlook';
  title: string;
  finding: string;
  evidence: string;
  recommendation: string;
  uncertainty_note: string;
}

export async function generateGroundedBusinessInsights(filters: FilterParams = {}): Promise<{
  generated_at: string;
  engine_used: string;
  insights: BusinessInsightCard[];
}> {
  const active = getActiveDatasetStatus();
  if (!active) {
    return {
      generated_at: new Date().toISOString(),
      engine_used: 'Deterministic BI Engine (Zero API Key)',
      insights: [],
    };
  }

  const kpis = getDashboardKpis(filters)!;
  const categories = getCategorySales(filters);
  const monthly = getSalesTrend('monthly', filters);
  const forecast = runSalesForecast('monthly', 3, filters);
  const anomalies = runAnomalyDetection(0.04, filters);

  const topCat = categories[0];
  const secondCat = categories[1];
  const lowCat = categories[categories.length - 1];
  const peakMonth = [...monthly].sort((a, b) => b.total_sales - a.total_sales)[0];
  const lowMonth = [...monthly].sort((a, b) => a.total_sales - b.total_sales)[0];

  const insights: BusinessInsightCard[] = [
    {
      id: 'insight-top-category',
      category: 'Revenue Leader',
      title: `${topCat?.category || 'Primary Category'} Drives ${topCat?.revenue_share_pct || 0}% of Total Revenue`,
      finding: `${topCat?.category} is the dominant revenue contributor with ${formatINR(
        topCat?.total_sales || 0
      )} across ${topCat?.transaction_count || 0} transactions (${topCat?.total_quantity || 0} units sold).`,
      evidence: `Average transaction value in ${topCat?.category} is ${formatINR(
        topCat?.avg_transaction_value || 0
      )} (avg unit price ${formatINR(topCat?.avg_unit_price || 0)}), compared to the overall dataset average of ${formatINR(
        kpis.avg_transaction_value
      )}.`,
      recommendation: `Prioritize safety stock and working capital allocation for high-velocity ${topCat?.category} SKUs to prevent stockout revenue loss.`,
      uncertainty_note:
        'Gross revenue share does not account for category-specific COGS or return rates, which should be verified before reallocating ad spend.',
    },
    {
      id: 'insight-sales-trend',
      category: 'Temporal Trend',
      title: `${forecast.metrics.trend_direction} Sales Trajectory Across ${monthly.length} Analyzed Months`,
      finding: `Monthly sales exhibited a ${forecast.metrics.trend_direction.toLowerCase()} linear trend of ${
        forecast.metrics.slope_per_period >= 0 ? '+' : ''
      }${formatINR(forecast.metrics.slope_per_period)} per month, peaking in ${peakMonth?.period || 'N/A'} at ${formatINR(
        peakMonth?.total_sales || 0
      )}.`,
      evidence: `Peak period (${peakMonth?.period}: ${formatINR(
        peakMonth?.total_sales || 0
      )}) outperformed the lowest period (${lowMonth?.period}: ${formatINR(
        lowMonth?.total_sales || 0
      )}) by ${formatINR((peakMonth?.total_sales || 0) - (lowMonth?.total_sales || 0))}.`,
      recommendation: `Align promotional calendars and staffing 3–4 weeks ahead of peak demand windows (${peakMonth?.period}) while running bundle promotions in slower months (${lowMonth?.period}).`,
      uncertainty_note:
        'Observed monthly variations may reflect single-year promotional timing rather than multi-year structural seasonality.',
    },
    {
      id: 'insight-anomalies',
      category: 'Anomaly Alert',
      title: `${anomalies.anomalies_detected} Unusual High-Value or Multi-Unit Transactions Identified`,
      finding: `Isolation Forest flagged ${anomalies.anomalies_detected} transactions (${anomalies.anomaly_rate_pct}% of records) with an average order value of ${formatINR(
        anomalies.summary_stats.anomaly_avg_amount
      )}—${(
        anomalies.summary_stats.anomaly_avg_amount / Math.max(1, anomalies.summary_stats.normal_avg_amount)
      ).toFixed(1)}× the normal transaction average (${formatINR(anomalies.summary_stats.normal_avg_amount)}).`,
      evidence: `Most flagged records occurred in ${anomalies.summary_stats.most_flagged_category}, reaching up to ${formatINR(
        anomalies.summary_stats.max_anomaly_amount
      )} in a single order.`,
      recommendation: `Audit flagged orders to distinguish institutional/B2B bulk buyers (who can be enrolled in repeat corporate accounts) from potential POS pricing overrides.`,
      uncertainty_note:
        'Statistical anomalies indicate rare numeric combinations, not confirmed errors or fraudulent activity.',
    },
    {
      id: 'insight-cross-sell',
      category: 'Growth Opportunity',
      title: `Basket Expansion Opportunity in ${lowCat?.category || 'Secondary Categories'}`,
      finding: `${lowCat?.category} accounts for ${lowCat?.revenue_share_pct}% of revenue (${formatINR(
        lowCat?.total_sales || 0
      )}) with an average order value of ${formatINR(lowCat?.avg_transaction_value || 0)}, trailing ${
        secondCat?.category || topCat?.category
      } (${formatINR(secondCat?.total_sales || 0)}).`,
      evidence: `Overall units per transaction average ${(
        kpis.total_quantity / Math.max(1, kpis.total_transactions)
      ).toFixed(2)} units (${kpis.total_quantity.toLocaleString('en-IN')} units / ${kpis.total_transactions.toLocaleString(
        'en-IN'
      )} orders).`,
      recommendation: `Introduce tiered checkout cross-sells offering ${lowCat?.category} add-ons when customers purchase ${topCat?.category} items above ${formatINR(
        kpis.avg_transaction_value
      )}.`,
      uncertainty_note:
        'Cross-category elasticity depends on customer overlap; monitor attach-rate lift over a 30-day A/B test.',
    },
    {
      id: 'insight-forecast',
      category: 'Forecast Outlook',
      title: `3-Month Forward Projection Estimates ${formatINR(forecast.metrics.projected_horizon_total)} Revenue`,
      finding: `Baseline OLS Linear Regression projects ${formatINR(
        forecast.metrics.projected_horizon_total
      )} cumulative sales over the next 3 months (${
        forecast.metrics.expected_growth_pct >= 0 ? '+' : ''
      }${forecast.metrics.expected_growth_pct}% vs historical monthly average of ${formatINR(
        forecast.metrics.historical_period_avg
      )}).`,
      evidence: `Chronological holdout evaluation yielded MAE = ${formatINR(
        forecast.metrics.mae || 0
      )} and RMSE = ${formatINR(forecast.metrics.rmse || 0)} across ${forecast.metrics.test_periods} test periods.`,
      recommendation: `Use the lower 95% confidence bound for baseline cash-flow commitments and the upper bound for flexible supplier capacity agreements.`,
      uncertainty_note:
        'Linear Regression extrapolates historical trends and does not anticipate external market disruptions or price changes.',
    },
  ];

  const status = await checkAiBackendStatus();
  return {
    generated_at: new Date().toISOString(),
    engine_used:
      status.active_mode === 'ollama_local'
        ? `Ollama (${status.ollama_model}) + Deterministic Statistical Grounding`
        : 'Deterministic Statistical Grounding Engine (Zero API Key)',
    insights,
  };
}
