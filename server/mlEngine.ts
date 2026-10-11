import { FilterParams, getAllActiveTransactions, getSalesTrend } from './database.ts';

export interface ForecastPoint {
  period: string;
  actual_sales: number | null;
  fitted_sales: number;
  forecast_sales: number | null;
  lower_bound: number | null;
  upper_bound: number | null;
  split: 'train' | 'test' | 'future';
}

export interface ForecastResult {
  available: boolean;
  reason?: string;
  interval: 'daily' | 'weekly' | 'monthly';
  horizon: number;
  category: string;
  model_name: string;
  metrics: {
    mae: number | null;
    rmse: number | null;
    mape_pct: number | null;
    r2_score: number | null;
    train_periods: number;
    test_periods: number;
    slope_per_period: number;
    intercept: number;
    trend_direction: 'Upward' | 'Downward' | 'Stable';
    projected_horizon_total: number;
    historical_period_avg: number;
    expected_growth_pct: number;
  };
  series: ForecastPoint[];
  methodology: string;
  limitations: string[];
}

/**
 * Solves (X^T X + lambda * I) beta = X^T y via Gaussian elimination with partial pivoting
 */
function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) {
        maxRow = row;
      }
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];

    const pivot = M[col][col];
    if (Math.abs(pivot) < 1e-10) continue;

    for (let j = col; j <= n; j++) {
      M[col][j] /= pivot;
    }

    for (let row = 0; row < n; row++) {
      if (row !== col) {
        const factor = M[row][col];
        for (let j = col; j <= n; j++) {
          M[row][j] -= factor * M[col][j];
        }
      }
    }
  }

  return M.map((row) => row[n]);
}

function fitOlsLinearRegression(X: number[][], y: number[], ridgeLambda = 1e-4): number[] {
  const n = X.length;
  const p = X[0].length;
  const XtX: number[][] = Array.from({ length: p }, () => Array(p).fill(0));
  const Xty: number[] = Array(p).fill(0);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p; j++) {
      Xty[j] += X[i][j] * y[i];
      for (let k = 0; k < p; k++) {
        XtX[j][k] += X[i][j] * X[i][k];
      }
    }
  }

  // Add tiny L2 regularization on non-intercept features for numerical stability
  for (let j = 1; j < p; j++) {
    XtX[j][j] += ridgeLambda;
  }

  return solveLinearSystem(XtX, Xty);
}

function predictRow(x: number[], beta: number[]): number {
  let sum = 0;
  for (let j = 0; j < x.length; j++) {
    sum += x[j] * beta[j];
  }
  return Math.max(0, sum);
}

function nextPeriodLabel(lastLabel: string, step: number, interval: 'daily' | 'weekly' | 'monthly'): string {
  if (interval === 'monthly') {
    const [yStr, mStr] = lastLabel.split('-');
    const year = Number(yStr) || 2025;
    const month = (Number(mStr) || 1) - 1 + step;
    const d = new Date(Date.UTC(year, month, 1));
    return d.toISOString().slice(0, 7);
  }
  if (interval === 'weekly') {
    const match = lastLabel.match(/^(\d{4})-W(\d{2})$/);
    if (match) {
      let yr = Number(match[1]);
      let wk = Number(match[2]) + step;
      while (wk > 52) {
        wk -= 52;
        yr += 1;
      }
      return `${yr}-W${String(wk).padStart(2, '0')}`;
    }
    return `Future +${step}w`;
  }
  // daily
  const base = new Date(`${lastLabel}T00:00:00Z`);
  if (!isNaN(base.getTime())) {
    const next = new Date(base.getTime() + step * 86400 * 1000);
    return next.toISOString().slice(0, 10);
  }
  return `Day +${step}`;
}

export function runSalesForecast(
  interval: 'daily' | 'weekly' | 'monthly' = 'monthly',
  horizonInput = 6,
  filters: FilterParams = {}
): ForecastResult {
  const validIntervals = ['daily', 'weekly', 'monthly'];
  let safeInterval: 'daily' | 'weekly' | 'monthly' = validIntervals.includes(interval)
    ? interval
    : 'monthly';

  let aggregated = getSalesTrend(safeInterval, filters);

  // Automatically step down granularity if the dataset spans fewer than 3 periods at the chosen interval
  if (aggregated.length < 3 && safeInterval === 'monthly') {
    const weeklyTry = getSalesTrend('weekly', filters);
    if (weeklyTry.length >= 3) {
      safeInterval = 'weekly';
      aggregated = weeklyTry;
    } else {
      const dailyTry = getSalesTrend('daily', filters);
      if (dailyTry.length >= 2) {
        safeInterval = 'daily';
        aggregated = dailyTry;
      }
    }
  } else if (aggregated.length < 3 && safeInterval === 'weekly') {
    const dailyTry = getSalesTrend('daily', filters);
    if (dailyTry.length >= 2) {
      safeInterval = 'daily';
      aggregated = dailyTry;
    }
  }

  const maxHorizon = safeInterval === 'daily' ? 60 : safeInterval === 'weekly' ? 24 : 12;
  const horizon = Math.min(maxHorizon, Math.max(1, Math.round(Number(horizonInput) || 6)));

  if (aggregated.length < 2) {
    return {
      available: false,
      reason: `At least 2 chronological time periods are required to calculate a trend and forecast future sales (found ${aggregated.length}). Please upload a CSV with transactions across multiple dates.`,
      interval: safeInterval,
      horizon,
      category: filters.category || 'All',
      model_name: 'Ordinary Least Squares (OLS) Linear Regression',
      metrics: {
        mae: null,
        rmse: null,
        mape_pct: null,
        r2_score: null,
        train_periods: aggregated.length,
        test_periods: 0,
        slope_per_period: 0,
        intercept: 0,
        trend_direction: 'Stable',
        projected_horizon_total: 0,
        historical_period_avg: 0,
        expected_growth_pct: 0,
      },
      series: [],
      methodology:
        'Chronological time-series aggregation followed by Ordinary Least Squares (OLS) Linear Regression.',
      limitations: [
        'Requires at least 2 historical time periods to estimate a trend line.',
      ],
    };
  }

  const N = aggregated.length;
  const yAll = aggregated.map((r) => r.total_sales);

  // Only include seasonal Fourier harmonics when at least 2 full seasonal cycles exist (N >= 24);
  // otherwise use clean, interpretable OLS linear trend [1, t] to avoid overfitting short series.
  const periodCycle = safeInterval === 'monthly' ? 12 : safeInterval === 'weekly' ? 52 : 7;
  const useHarmonics = N >= 24;

  const buildFeatures = (t: number): number[] => {
    if (!useHarmonics) {
      return [1, t];
    }
    const angle = (2 * Math.PI * t) / periodCycle;
    return [1, t, Math.sin(angle), Math.cos(angle)];
  };

  const XAll = aggregated.map((_, idx) => buildFeatures(idx));

  // Chronological Train/Test split (80% train, 20% test)
  const testSize = N >= 6 ? Math.max(2, Math.round(N * 0.2)) : 1;
  const trainSize = Math.max(1, N - testSize);

  const XTrain = XAll.slice(0, trainSize);
  const yTrain = yAll.slice(0, trainSize);
  const XTest = XAll.slice(trainSize);
  const yTest = yAll.slice(trainSize);

  const betaTrain = fitOlsLinearRegression(XTrain, yTrain);

  // Evaluate on chronological holdout test set
  let absErrSum = 0;
  let sqErrSum = 0;
  let apeSum = 0;
  let validMapeCount = 0;

  for (let i = 0; i < XTest.length; i++) {
    const pred = predictRow(XTest[i], betaTrain);
    const actual = yTest[i];
    const err = actual - pred;
    absErrSum += Math.abs(err);
    sqErrSum += err * err;
    if (actual > 0) {
      apeSum += Math.abs(err / actual);
      validMapeCount++;
    }
  }

  const mae = Number((absErrSum / XTest.length).toFixed(2));
  const rmse = Number(Math.sqrt(sqErrSum / XTest.length).toFixed(2));
  const mapePct = validMapeCount > 0 ? Number(((apeSum / validMapeCount) * 100).toFixed(2)) : null;

  // Fit on full historical series for future projection
  const betaFull = fitOlsLinearRegression(XAll, yAll);
  const yMeanAll = yAll.reduce((a, b) => a + b, 0) / N;
  let fullSsTot = 0;
  let fullSsRes = 0;
  for (let i = 0; i < N; i++) {
    const fitVal = predictRow(XAll[i], betaFull);
    fullSsRes += (yAll[i] - fitVal) ** 2;
    fullSsTot += (yAll[i] - yMeanAll) ** 2;
  }
  const r2Score = fullSsTot > 0 ? Number(Math.max(0, 1 - fullSsRes / fullSsTot).toFixed(3)) : 0;
  const residualStd = Math.sqrt(fullSsRes / Math.max(1, N - betaFull.length));

  // Clean linear trend [1, t] for interpretable slope_per_period
  const betaLinear = fitOlsLinearRegression(
    aggregated.map((_, idx) => [1, idx]),
    yAll
  );
  const intercept = Number(betaLinear[0].toFixed(2));
  const slopePerPeriod = Number(betaLinear[1].toFixed(2));

  const series: ForecastPoint[] = [];

  for (let i = 0; i < N; i++) {
    const fitted = Number(predictRow(XAll[i], betaFull).toFixed(2));
    const isLastHistorical = i === N - 1;
    series.push({
      period: aggregated[i].period,
      actual_sales: aggregated[i].total_sales,
      fitted_sales: fitted,
      forecast_sales: isLastHistorical ? aggregated[i].total_sales : null,
      lower_bound: isLastHistorical ? aggregated[i].total_sales : null,
      upper_bound: isLastHistorical ? aggregated[i].total_sales : null,
      split: i < trainSize ? 'train' : 'test',
    });
  }

  const lastPeriodLabel = aggregated[N - 1].period;
  let projectedHorizonTotal = 0;

  for (let h = 1; h <= horizon; h++) {
    const t = N - 1 + h;
    const xFuture = buildFeatures(t);
    const pointForecast = Number(predictRow(xFuture, betaFull).toFixed(2));
    const margin = Number((1.96 * residualStd * Math.sqrt(1 + h / N)).toFixed(2));
    projectedHorizonTotal += pointForecast;

    series.push({
      period: nextPeriodLabel(lastPeriodLabel, h, safeInterval),
      actual_sales: null,
      fitted_sales: pointForecast,
      forecast_sales: pointForecast,
      lower_bound: Number(Math.max(0, pointForecast - margin).toFixed(2)),
      upper_bound: Number((pointForecast + margin).toFixed(2)),
      split: 'future',
    });
  }

  const historicalPeriodAvg = Number(yMeanAll.toFixed(2));
  const forecastPeriodAvg = projectedHorizonTotal / horizon;
  const expectedGrowthPct =
    historicalPeriodAvg > 0
      ? Number((((forecastPeriodAvg - historicalPeriodAvg) / historicalPeriodAvg) * 100).toFixed(2))
      : 0;

  const trendDirection: 'Upward' | 'Downward' | 'Stable' =
    Math.abs(slopePerPeriod) < historicalPeriodAvg * 0.005
      ? 'Stable'
      : slopePerPeriod > 0
      ? 'Upward'
      : 'Downward';

  return {
    available: true,
    interval: safeInterval,
    horizon,
    category: filters.category || 'All',
    model_name: useHarmonics
      ? 'OLS Linear Regression + Cyclical Fourier Time Features'
      : 'Baseline Ordinary Least Squares (OLS) Linear Regression',
    metrics: {
      mae,
      rmse,
      mape_pct: mapePct,
      r2_score: r2Score,
      train_periods: trainSize,
      test_periods: testSize,
      slope_per_period: slopePerPeriod,
      intercept,
      trend_direction: trendDirection,
      projected_horizon_total: Number(projectedHorizonTotal.toFixed(2)),
      historical_period_avg: historicalPeriodAvg,
      expected_growth_pct: expectedGrowthPct,
    },
    series,
    methodology: `Transactions are aggregated chronologically by ${safeInterval} interval (${N} historical periods). Data is split chronologically into ${trainSize} training periods (first 80%) and ${testSize} holdout evaluation periods (final 20%) to prevent data leakage. Ordinary Least Squares (OLS) Linear Regression fits time-index and cyclical features, evaluating out-of-sample MAE and RMSE before projecting ${horizon} future periods with 95% confidence bands.`,
    limitations: [
      'Linear Regression assumes a continuous linear trend and stationary variance; sudden macroeconomic shocks, stockouts, or unmodeled flash promotions will not be captured.',
      'Forecast uncertainty widens as the horizon extends further into the future (shown by the expanding 95% prediction interval).',
      'Predictions represent statistical estimates based solely on historical transaction records and should be treated as planning guidance rather than guaranteed revenue.',
    ],
  };
}

// ============================================================================
// ISOLATION FOREST ANOMALY DETECTION
// ============================================================================

interface ITreeNode {
  isExternal: boolean;
  size: number;
  splitAttr?: number;
  splitVal?: number;
  left?: ITreeNode;
  right?: ITreeNode;
}

function harmonicNumber(n: number): number {
  if (n <= 1) return 0;
  // Euler-Mascheroni approximation: ln(n) + 0.5772156649
  return Math.log(n) + 0.5772156649015329;
}

function cFactor(n: number): number {
  if (n <= 1) return 0;
  if (n === 2) return 1;
  return 2 * harmonicNumber(n - 1) - (2 * (n - 1)) / n;
}

function buildIsolationTree(
  points: number[][],
  currentHeight: number,
  maxHeight: number,
  rand: () => number
): ITreeNode {
  const n = points.length;
  if (currentHeight >= maxHeight || n <= 1) {
    return { isExternal: true, size: n };
  }

  const numFeatures = points[0].length;
  // Find features with non-zero range
  const candidateAttrs: { attr: number; min: number; max: number }[] = [];
  for (let attr = 0; attr < numFeatures; attr++) {
    let min = points[0][attr];
    let max = points[0][attr];
    for (let i = 1; i < n; i++) {
      const v = points[i][attr];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (max > min) {
      candidateAttrs.push({ attr, min, max });
    }
  }

  if (candidateAttrs.length === 0) {
    return { isExternal: true, size: n };
  }

  const chosen = candidateAttrs[Math.floor(rand() * candidateAttrs.length)];
  const splitVal = chosen.min + rand() * (chosen.max - chosen.min);

  const leftPts: number[][] = [];
  const rightPts: number[][] = [];
  for (let i = 0; i < n; i++) {
    if (points[i][chosen.attr] < splitVal) {
      leftPts.push(points[i]);
    } else {
      rightPts.push(points[i]);
    }
  }

  if (leftPts.length === 0 || rightPts.length === 0) {
    return { isExternal: true, size: n };
  }

  return {
    isExternal: false,
    size: n,
    splitAttr: chosen.attr,
    splitVal,
    left: buildIsolationTree(leftPts, currentHeight + 1, maxHeight, rand),
    right: buildIsolationTree(rightPts, currentHeight + 1, maxHeight, rand),
  };
}

function pathLength(x: number[], node: ITreeNode, currentHeight: number): number {
  if (node.isExternal) {
    return currentHeight + cFactor(node.size);
  }
  const val = x[node.splitAttr!];
  if (val < node.splitVal!) {
    return pathLength(x, node.left!, currentHeight + 1);
  }
  return pathLength(x, node.right!, currentHeight + 1);
}

export interface AnomalyRecord {
  transaction_id: string;
  date: string;
  customer_id: string;
  gender: string;
  age: number;
  product_category: string;
  quantity: number;
  price_per_unit: number;
  total_amount: number;
  anomaly_score: number;
  decision_score: number;
  avg_path_length: number;
  severity: 'High Deviation' | 'Moderate Deviation';
  reasons: string[];
  explanation: string;
}

export interface AnomalyDetectionResult {
  available: boolean;
  reason?: string;
  model_name: string;
  contamination: number;
  n_estimators: number;
  total_evaluated: number;
  anomalies_detected: number;
  anomaly_rate_pct: number;
  threshold_score: number;
  feature_names: string[];
  summary_stats: {
    normal_avg_amount: number;
    anomaly_avg_amount: number;
    max_anomaly_amount: number;
    most_flagged_category: string;
  };
  anomalies: AnomalyRecord[];
  scatter_sample: {
    transaction_id: string;
    product_category: string;
    quantity: number;
    price_per_unit: number;
    total_amount: number;
    anomaly_score: number;
    is_anomaly: boolean;
  }[];
  methodology: string;
  disclaimer: string;
}

export function runAnomalyDetection(
  contaminationInput = 0.04,
  filters: FilterParams = {}
): AnomalyDetectionResult {
  const contamination = Math.min(0.2, Math.max(0.01, Number(contaminationInput) || 0.04));
  const rows = getAllActiveTransactions(filters);

  if (rows.length < 10) {
    return {
      available: false,
      reason: `Insufficient records (${rows.length}) to train Isolation Forest reliably. At least 10 valid transactions are required.`,
      model_name: 'Isolation Forest (100 Isolation Trees)',
      contamination,
      n_estimators: 100,
      total_evaluated: rows.length,
      anomalies_detected: 0,
      anomaly_rate_pct: 0,
      threshold_score: 0,
      feature_names: ['total_amount', 'quantity', 'price_per_unit', 'age', 'category_amount_zscore'],
      summary_stats: {
        normal_avg_amount: 0,
        anomaly_avg_amount: 0,
        max_anomaly_amount: 0,
        most_flagged_category: 'N/A',
      },
      anomalies: [],
      scatter_sample: [],
      methodology: 'Unsupervised Isolation Forest recursive random partitioning.',
      disclaimer:
        'Flagged records represent statistically unusual combinations of quantity, unit price, and order total relative to the dataset distribution—not proof of fraud or data entry error.',
    };
  }

  // Compute global and per-category statistics for contextual explanations & z-score feature
  const amounts = rows.map((r) => r.total_amount);
  const prices = rows.map((r) => r.price_per_unit);
  const quantities = rows.map((r) => r.quantity);

  const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const std = (arr: number[], m: number) =>
    Math.sqrt(arr.reduce((acc, v) => acc + (v - m) ** 2, 0) / Math.max(1, arr.length));

  const meanAmt = mean(amounts);
  const stdAmt = std(amounts, meanAmt) || 1;
  const meanPrice = mean(prices);
  const stdPrice = std(prices, meanPrice) || 1;
  const meanQty = mean(quantities);
  const stdQty = std(quantities, meanQty) || 1;

  // Per-category stats
  const catStats: Record<string, { meanAmt: number; stdAmt: number; meanPrice: number; stdPrice: number }> = {};
  const byCat: Record<string, { amts: number[]; prices: number[] }> = {};
  for (const r of rows) {
    if (!byCat[r.product_category]) {
      byCat[r.product_category] = { amts: [], prices: [] };
    }
    byCat[r.product_category].amts.push(r.total_amount);
    byCat[r.product_category].prices.push(r.price_per_unit);
  }
  for (const [cat, vals] of Object.entries(byCat)) {
    const mA = mean(vals.amts);
    const sA = std(vals.amts, mA) || 1;
    const mP = mean(vals.prices);
    const sP = std(vals.prices, mP) || 1;
    catStats[cat] = { meanAmt: mA, stdAmt: sA, meanPrice: mP, stdPrice: sP };
  }

  // Construct feature vectors X
  const features: number[][] = rows.map((r) => {
    const cs = catStats[r.product_category];
    const catAmtZ = Math.abs(r.total_amount - cs.meanAmt) / cs.stdAmt;
    const catPriceZ = Math.abs(r.price_per_unit - cs.meanPrice) / cs.stdPrice;
    return [r.total_amount, r.quantity, r.price_per_unit, catAmtZ, catPriceZ];
  });

  // Deterministic PRNG for reproducible Isolation Forest
  let seed = 133742;
  const rand = () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const nEstimators = 100;
  const sampleSize = Math.min(256, rows.length);
  const maxHeight = Math.ceil(Math.log2(sampleSize));
  const cPsi = cFactor(sampleSize);

  const trees: ITreeNode[] = [];
  for (let t = 0; t < nEstimators; t++) {
    const subsample: number[][] = [];
    for (let s = 0; s < sampleSize; s++) {
      const idx = Math.floor(rand() * features.length);
      subsample.push(features[idx]);
    }
    trees.push(buildIsolationTree(subsample, 0, maxHeight, rand));
  }

  // Score every transaction
  const scored = rows.map((r, i) => {
    let totalPath = 0;
    const x = features[i];
    for (let t = 0; t < nEstimators; t++) {
      totalPath += pathLength(x, trees[t], 0);
    }
    const avgPath = totalPath / nEstimators;
    // Standard Isolation Forest anomaly score s(x, psi) = 2^(-E(h(x)) / c(psi))
    const rawScore = Math.pow(2, -avgPath / (cPsi || 1));
    return {
      row: r,
      avgPath: Number(avgPath.toFixed(2)),
      score: Number(rawScore.toFixed(4)),
    };
  });

  // Sort descending by anomaly score to determine contamination cutoff
  const sortedByScore = [...scored].sort((a, b) => b.score - a.score);
  const targetAnomalyCount = Math.max(1, Math.round(rows.length * contamination));
  const thresholdScore = sortedByScore[targetAnomalyCount - 1].score;

  const anomalies: AnomalyRecord[] = [];
  let normalSum = 0;
  let normalCount = 0;
  let anomalySum = 0;
  let maxAnomalyAmt = 0;
  const flaggedCatCounts: Record<string, number> = {};

  for (let i = 0; i < sortedByScore.length; i++) {
    const item = sortedByScore[i];
    const r = item.row;
    const isAnom = i < targetAnomalyCount;

    if (isAnom) {
      anomalySum += r.total_amount;
      if (r.total_amount > maxAnomalyAmt) maxAnomalyAmt = r.total_amount;
      flaggedCatCounts[r.product_category] = (flaggedCatCounts[r.product_category] || 0) + 1;

      const cs = catStats[r.product_category];
      const amtZ = (r.total_amount - meanAmt) / stdAmt;
      const catAmtZ = (r.total_amount - cs.meanAmt) / cs.stdAmt;
      const catPriceZ = (r.price_per_unit - cs.meanPrice) / cs.stdPrice;

      const reasons: string[] = [];
      if (r.total_amount >= meanAmt * 2.2) {
        reasons.push(
          `Order total (₹${r.total_amount.toLocaleString('en-IN')}) is ${(r.total_amount / meanAmt).toFixed(1)}× the overall average (₹${meanAmt.toFixed(0)})`
        );
      }
      if (Math.abs(catAmtZ) >= 1.8) {
        reasons.push(
          `${Math.abs(catAmtZ).toFixed(1)}σ deviation from ${r.product_category} category average order value (₹${cs.meanAmt.toFixed(0)})`
        );
      }
      if (Math.abs(catPriceZ) >= 1.8) {
        reasons.push(
          `Unusual unit price (₹${r.price_per_unit.toLocaleString('en-IN')}) compared to typical ${r.product_category} pricing (₹${cs.meanPrice.toFixed(0)})`
        );
      }
      if (r.quantity >= meanQty + 1.5 * stdQty) {
        reasons.push(`High multi-unit basket quantity (${r.quantity} units)`);
      }
      if (reasons.length === 0) {
        reasons.push(
          `Rare multivariate combination of ${r.product_category} unit price (₹${r.price_per_unit}) and quantity (${r.quantity})`
        );
      }

      const severity: 'High Deviation' | 'Moderate Deviation' =
        item.score >= thresholdScore + 0.035 || amtZ >= 2.8 ? 'High Deviation' : 'Moderate Deviation';

      anomalies.push({
        ...r,
        anomaly_score: item.score,
        decision_score: Number((thresholdScore - item.score).toFixed(4)),
        avg_path_length: item.avgPath,
        severity,
        reasons,
        explanation: reasons.join('; ') + '.',
      });
    } else {
      normalSum += r.total_amount;
      normalCount++;
    }
  }

  let mostFlaggedCategory = 'N/A';
  let maxCatCount = 0;
  for (const [cat, cnt] of Object.entries(flaggedCatCounts)) {
    if (cnt > maxCatCount) {
      maxCatCount = cnt;
      mostFlaggedCategory = cat;
    }
  }

  // Create a representative scatter sample (all anomalies + up to 150 normal points) for fast visualization
  const anomalyTxSet = new Set(anomalies.map((a) => a.transaction_id));
  const normalItems = scored.filter((s) => !anomalyTxSet.has(s.row.transaction_id));
  const step = Math.max(1, Math.floor(normalItems.length / 140));
  const sampledNormals = normalItems.filter((_, idx) => idx % step === 0).slice(0, 140);

  const scatterSample = [
    ...anomalies.map((a) => ({
      transaction_id: a.transaction_id,
      product_category: a.product_category,
      quantity: a.quantity,
      price_per_unit: a.price_per_unit,
      total_amount: a.total_amount,
      anomaly_score: a.anomaly_score,
      is_anomaly: true,
    })),
    ...sampledNormals.map((s) => ({
      transaction_id: s.row.transaction_id,
      product_category: s.row.product_category,
      quantity: s.row.quantity,
      price_per_unit: s.row.price_per_unit,
      total_amount: s.row.total_amount,
      anomaly_score: s.score,
      is_anomaly: false,
    })),
  ];

  return {
    available: true,
    model_name: 'Isolation Forest (100 Randomized Isolation Trees)',
    contamination,
    n_estimators: nEstimators,
    total_evaluated: rows.length,
    anomalies_detected: anomalies.length,
    anomaly_rate_pct: Number(((anomalies.length / rows.length) * 100).toFixed(2)),
    threshold_score: thresholdScore,
    feature_names: [
      'total_amount',
      'quantity',
      'price_per_unit',
      'category_amount_zscore',
      'category_price_zscore',
    ],
    summary_stats: {
      normal_avg_amount: normalCount > 0 ? Number((normalSum / normalCount).toFixed(2)) : 0,
      anomaly_avg_amount: anomalies.length > 0 ? Number((anomalySum / anomalies.length).toFixed(2)) : 0,
      max_anomaly_amount: maxAnomalyAmt,
      most_flagged_category: mostFlaggedCategory,
    },
    anomalies,
    scatter_sample: scatterSample,
    methodology: `Trained an unsupervised Isolation Forest ensemble of ${nEstimators} randomized binary partitioning trees (sub-sampling size ψ = ${sampleSize}) over 5 transaction features: Total Amount, Quantity, Unit Price, Category Amount Z-Score, and Category Price Z-Score. Records with the shortest average isolation path length E(h(x)) yield the highest anomaly score s(x, ψ) = 2^(-E(h(x))/c(ψ)).`,
    disclaimer:
      'An anomaly score indicates statistically unusual transaction characteristics (such as high-ticket bulk orders or rare category price tiers) relative to the rest of the dataset. It is a prompt for business review—not proof of fraud or error.',
  };
}
