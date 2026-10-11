import React, { useState } from 'react';
import { CategorySalesItem, ForecastResponse, SalesTrendPoint } from '../services/api.ts';

export function formatCurrencyINR(value: number): string {
  return `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export const SalesTrendLineChart: React.FC<{
  data: SalesTrendPoint[];
  height?: number;
}> = ({ data, height = 270 }) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg">
        No time-series data available for the selected filter criteria.
      </div>
    );
  }

  const width = 760;
  const padLeft = 68;
  const padRight = 24;
  const padTop = 22;
  const padBottom = 38;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const values = data.map((d) => d.total_sales);
  const maxVal = Math.max(...values, 1) * 1.08;
  const minVal = 0;

  const getX = (i: number) =>
    data.length === 1 ? padLeft + plotW / 2 : padLeft + (i / (data.length - 1)) * plotW;
  const getY = (val: number) =>
    padTop + plotH - ((val - minVal) / (maxVal - minVal || 1)) * plotH;

  const points = data.map((d, i) => `${getX(i)},${getY(d.total_sales)}`).join(' ');
  const areaPoints = `${getX(0)},${padTop + plotH} ${points} ${getX(data.length - 1)},${padTop + plotH}`;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(minVal + t * (maxVal - minVal)));

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto overflow-visible select-none"
        onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id="salesAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#3B82F6" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {yTicks.map((tick, idx) => {
          const y = getY(tick);
          return (
            <g key={idx}>
              <line
                x1={padLeft}
                y1={y}
                x2={width - padRight}
                y2={y}
                className="stroke-slate-200 dark:stroke-slate-800"
                strokeDasharray={idx === 0 ? undefined : '3 3'}
              />
              <text
                x={padLeft - 10}
                y={y + 4}
                textAnchor="end"
                className="fill-slate-500 dark:fill-slate-400 text-[11px] font-mono tabular-nums"
              >
                ₹{tick >= 1000 ? `${(tick / 1000).toFixed(0)}k` : tick}
              </text>
            </g>
          );
        })}

        <polygon points={areaPoints} fill="url(#salesAreaGrad)" />
        <polyline
          fill="none"
          stroke="#3B82F6"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={points}
        />

        {data.map((d, i) => {
          const cx = getX(i);
          const cy = getY(d.total_sales);
          const showLabel =
            data.length <= 14 || i === 0 || i === data.length - 1 || i % Math.ceil(data.length / 8) === 0;

          return (
            <g key={d.period}>
              {showLabel && (
                <text
                  x={cx}
                  y={height - 10}
                  textAnchor="middle"
                  className="fill-slate-500 dark:fill-slate-400 text-[10.5px] font-mono tabular-nums"
                >
                  {d.period}
                </text>
              )}
              {hoverIdx === i && (
                <line
                  x1={cx}
                  y1={padTop}
                  x2={cx}
                  y2={padTop + plotH}
                  stroke="#64748B"
                  strokeDasharray="2 2"
                />
              )}
              <circle
                cx={cx}
                cy={cy}
                r={hoverIdx === i ? 5.5 : 3.5}
                className="transition-transform duration-150 cursor-pointer"
                fill={hoverIdx === i ? '#2563EB' : '#0F172A'}
                stroke="#3B82F6"
                strokeWidth="2.2"
                onMouseEnter={() => setHoverIdx(i)}
              />
              <rect
                x={cx - plotW / Math.max(data.length, 2) / 2}
                y={padTop}
                width={plotW / Math.max(data.length, 2)}
                height={plotH}
                fill="transparent"
                className="cursor-pointer"
                onMouseEnter={() => setHoverIdx(i)}
              />
            </g>
          );
        })}
      </svg>

      {hoverIdx !== null && data[hoverIdx] && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-4 px-3.5 py-2 bg-slate-900 dark:bg-slate-800 text-white text-xs rounded-lg font-mono tabular-nums border border-slate-700">
          <span>Period: {data[hoverIdx].period}</span>
          <span>Sales: {formatCurrencyINR(data[hoverIdx].total_sales)}</span>
          <span>Quantity: {data[hoverIdx].total_quantity.toLocaleString('en-IN')} units</span>
          <span>Transactions: {data[hoverIdx].transaction_count}</span>
          <span>Avg Basket: {formatCurrencyINR(data[hoverIdx].avg_order_value)}</span>
        </div>
      )}
    </div>
  );
};

export const CategoryBarChart: React.FC<{
  categories: CategorySalesItem[];
}> = ({ categories }) => {
  if (!categories || categories.length === 0) {
    return (
      <div className="flex items-center justify-center h-56 text-sm text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg">
        No product category records found.
      </div>
    );
  }

  const maxSales = Math.max(...categories.map((c) => c.total_sales), 1);
  const palette = ['#3B82F6', '#0EA5E9', '#6366F1', '#14B8A6', '#F59E0B'];

  return (
    <div className="space-y-4">
      {categories.map((cat, idx) => {
        const widthPct = Math.max(4, (cat.total_sales / maxSales) * 100);
        const color = palette[idx % palette.length];
        return (
          <div key={cat.category} className="space-y-1.5">
            <div className="flex items-baseline justify-between text-sm">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-900 dark:text-slate-100">{cat.category}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  · {cat.transaction_count.toLocaleString('en-IN')} txns · {cat.total_quantity.toLocaleString('en-IN')} units
                </span>
              </div>
              <div className="font-mono tabular-nums text-sm font-semibold text-slate-900 dark:text-slate-100">
                {formatCurrencyINR(cat.total_sales)}{' '}
                <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                  ({cat.revenue_share_pct}%)
                </span>
              </div>
            </div>
            <div className="w-full h-3 bg-slate-100 dark:bg-slate-800 rounded overflow-hidden">
              <div
                className="h-full rounded transition-all duration-200"
                style={{ width: `${widthPct}%`, backgroundColor: color }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              <span>Avg Order Value: {formatCurrencyINR(cat.avg_transaction_value)}</span>
              <span>Avg Unit Price: {formatCurrencyINR(cat.avg_unit_price)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const ForecastConfidenceChart: React.FC<{
  forecast: ForecastResponse;
}> = ({ forecast }) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const series = forecast.series || [];

  if (!forecast.available || series.length === 0) {
    return (
      <div className="p-6 text-sm text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-lg">
        {forecast.reason || 'Insufficient historical periods to render forecast chart.'}
      </div>
    );
  }

  const width = 780;
  const height = 290;
  const padLeft = 70;
  const padRight = 26;
  const padTop = 24;
  const padBottom = 40;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const allVals: number[] = [];
  for (const pt of series) {
    if (pt.actual_sales !== null) allVals.push(pt.actual_sales);
    allVals.push(pt.fitted_sales);
    if (pt.upper_bound !== null) allVals.push(pt.upper_bound);
    if (pt.lower_bound !== null) allVals.push(pt.lower_bound);
  }
  const maxVal = Math.max(...allVals, 1) * 1.1;
  const minVal = 0;

  const getX = (i: number) =>
    series.length === 1 ? padLeft + plotW / 2 : padLeft + (i / (series.length - 1)) * plotW;
  const getY = (v: number) => padTop + plotH - ((v - minVal) / (maxVal - minVal || 1)) * plotH;

  const actualPts = series
    .map((pt, i) => (pt.actual_sales !== null ? `${getX(i)},${getY(pt.actual_sales)}` : null))
    .filter(Boolean)
    .join(' ');

  const fittedPts = series.map((pt, i) => `${getX(i)},${getY(pt.fitted_sales)}`).join(' ');

  const futureIndices = series
    .map((pt, i) => (pt.forecast_sales !== null ? i : -1))
    .filter((i) => i !== -1);
  const forecastPts = futureIndices
    .map((i) => `${getX(i)},${getY(series[i].forecast_sales!)}`)
    .join(' ');

  const ribbonIndices = series
    .map((pt, i) => (pt.lower_bound !== null && pt.upper_bound !== null ? i : -1))
    .filter((i) => i !== -1);

  const ribbonPolygon =
    ribbonIndices.length > 1
      ? [
          ...ribbonIndices.map((i) => `${getX(i)},${getY(series[i].upper_bound!)}`),
          ...[...ribbonIndices].reverse().map((i) => `${getX(i)},${getY(series[i].lower_bound!)}`),
        ].join(' ')
      : '';

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(minVal + t * (maxVal - minVal)));

  const lastHistIdx = series.findIndex((s) => s.split === 'future') - 1;
  const splitX = lastHistIdx >= 0 ? getX(lastHistIdx) : null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600 dark:text-slate-400">
        <div className="flex items-center gap-5">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-0.5 bg-blue-500" /> Historical Actuals
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-0.5 bg-slate-400 border-b border-dashed border-slate-500" /> OLS Regression Fit
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-0.5 bg-emerald-500" /> Projected Forecast (with 95% CI)
          </span>
        </div>
        <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
          Train: {forecast.metrics.train_periods} periods · Holdout Test: {forecast.metrics.test_periods} periods · Horizon: +{forecast.horizon}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto overflow-visible select-none"
        onMouseLeave={() => setHoverIdx(null)}
      >
        {yTicks.map((tick, idx) => {
          const y = getY(tick);
          return (
            <g key={idx}>
              <line
                x1={padLeft}
                y1={y}
                x2={width - padRight}
                y2={y}
                className="stroke-slate-200 dark:stroke-slate-800"
                strokeDasharray={idx === 0 ? undefined : '3 3'}
              />
              <text
                x={padLeft - 10}
                y={y + 4}
                textAnchor="end"
                className="fill-slate-500 dark:fill-slate-400 text-[11px] font-mono tabular-nums"
              >
                ₹{tick >= 1000 ? `${(tick / 1000).toFixed(0)}k` : tick}
              </text>
            </g>
          );
        })}

        {splitX !== null && (
          <g>
            <line
              x1={splitX}
              y1={padTop}
              x2={splitX}
              y2={padTop + plotH}
              stroke="#64748B"
              strokeWidth="1.2"
              strokeDasharray="4 4"
            />
            <text
              x={splitX + 6}
              y={padTop + 12}
              className="fill-emerald-600 dark:fill-emerald-400 text-[10px] font-semibold"
            >
              Forecast Horizon →
            </text>
          </g>
        )}

        {ribbonPolygon && (
          <polygon points={ribbonPolygon} fill="#10B981" fillOpacity="0.16" />
        )}

        <polyline
          fill="none"
          stroke="#94A3B8"
          strokeWidth="1.6"
          strokeDasharray="4 4"
          points={fittedPts}
        />

        <polyline
          fill="none"
          stroke="#3B82F6"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={actualPts}
        />

        {forecastPts && (
          <polyline
            fill="none"
            stroke="#10B981"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={forecastPts}
          />
        )}

        {series.map((pt, i) => {
          const cx = getX(i);
          const val = pt.actual_sales !== null ? pt.actual_sales : pt.forecast_sales!;
          const cy = getY(val);
          const isFuture = pt.split === 'future';
          const showLabel =
            series.length <= 16 || i === 0 || i === series.length - 1 || i % Math.ceil(series.length / 8) === 0;

          return (
            <g key={pt.period}>
              {showLabel && (
                <text
                  x={cx}
                  y={height - 10}
                  textAnchor="middle"
                  className="fill-slate-500 dark:fill-slate-400 text-[10px] font-mono tabular-nums"
                >
                  {pt.period}
                </text>
              )}
              <circle
                cx={cx}
                cy={cy}
                r={hoverIdx === i ? 5.5 : 3.5}
                fill={isFuture ? '#10B981' : '#3B82F6'}
                stroke="#0F172A"
                strokeWidth="1.5"
                className="cursor-pointer"
                onMouseEnter={() => setHoverIdx(i)}
              />
            </g>
          );
        })}
      </svg>

      {hoverIdx !== null && series[hoverIdx] && (
        <div className="flex flex-wrap items-center justify-between gap-4 px-3.5 py-2 bg-slate-900 dark:bg-slate-800 text-white text-xs rounded-lg font-mono tabular-nums border border-slate-700">
          <span>
            Period: {series[hoverIdx].period} ({series[hoverIdx].split.toUpperCase()})
          </span>
          {series[hoverIdx].actual_sales !== null && (
            <span>Actual: {formatCurrencyINR(series[hoverIdx].actual_sales!)}</span>
          )}
          <span>Model Fit/Forecast: {formatCurrencyINR(series[hoverIdx].fitted_sales)}</span>
          {series[hoverIdx].lower_bound !== null && series[hoverIdx].upper_bound !== null && (
            <span>
              95% Interval: [{formatCurrencyINR(series[hoverIdx].lower_bound!)} –{' '}
              {formatCurrencyINR(series[hoverIdx].upper_bound!)}]
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export const AnomalyScatterPlot: React.FC<{
  points: {
    transaction_id: string;
    product_category: string;
    quantity: number;
    price_per_unit: number;
    total_amount: number;
    anomaly_score: number;
    is_anomaly: boolean;
  }[];
  thresholdScore: number;
  onSelectTx?: (txId: string) => void;
}> = ({ points, thresholdScore, onSelectTx }) => {
  const [hovered, setHovered] = useState<(typeof points)[0] | null>(null);

  if (!points || points.length === 0) {
    return null;
  }

  const width = 760;
  const height = 240;
  const padLeft = 64;
  const padRight = 24;
  const padTop = 20;
  const padBottom = 36;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const maxAmt = Math.max(...points.map((p) => p.total_amount), 100) * 1.05;
  const scores = points.map((p) => p.anomaly_score);
  const minScore = Math.min(...scores, 0.35) * 0.95;
  const maxScore = Math.max(...scores, 0.75) * 1.03;

  const getX = (amt: number) => padLeft + (amt / maxAmt) * plotW;
  const getY = (score: number) =>
    padTop + plotH - ((score - minScore) / (maxScore - minScore || 1)) * plotH;

  const thresholdY = getY(thresholdScore);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between text-xs text-slate-600 dark:text-slate-400">
        <div className="flex items-center gap-5">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-500" /> Flagged Anomaly (Score ≥ {thresholdScore})
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-slate-400" /> Normal Transaction
          </span>
        </div>
        <span className="text-slate-500 dark:text-slate-400">
          X-Axis: Order Total Amount (₹) · Y-Axis: Isolation Forest Score s(x, n)
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto overflow-visible select-none border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50/40 dark:bg-slate-900/50"
        onMouseLeave={() => setHovered(null)}
      >
        <line
          x1={padLeft}
          y1={thresholdY}
          x2={width - padRight}
          y2={thresholdY}
          stroke="#F59E0B"
          strokeWidth="1.4"
          strokeDasharray="4 4"
        />
        <text
          x={width - padRight - 4}
          y={thresholdY - 5}
          textAnchor="end"
          className="fill-amber-600 dark:fill-amber-400 text-[10px] font-mono tabular-nums"
        >
          Cutoff s = {thresholdScore}
        </text>

        <line
          x1={padLeft}
          y1={padTop + plotH}
          x2={width - padRight}
          y2={padTop + plotH}
          className="stroke-slate-300 dark:stroke-slate-700"
        />
        <line
          x1={padLeft}
          y1={padTop}
          x2={padLeft}
          y2={padTop + plotH}
          className="stroke-slate-300 dark:stroke-slate-700"
        />

        {[0, 0.25, 0.5, 0.75, 1].map((t, i) => {
          const amt = Math.round(t * maxAmt);
          const x = getX(amt);
          return (
            <text
              key={i}
              x={x}
              y={height - 10}
              textAnchor="middle"
              className="fill-slate-500 dark:fill-slate-400 text-[10px] font-mono tabular-nums"
            >
              ₹{amt.toLocaleString('en-IN')}
            </text>
          );
        })}

        {points.map((pt, idx) => {
          const cx = getX(pt.total_amount);
          const cy = getY(pt.anomaly_score);
          return (
            <circle
              key={`${pt.transaction_id}-${idx}`}
              cx={cx}
              cy={cy}
              r={pt.is_anomaly ? 5 : 3}
              fill={pt.is_anomaly ? '#F59E0B' : '#64748B'}
              fillOpacity={pt.is_anomaly ? 0.95 : 0.6}
              stroke={pt.is_anomaly ? '#78350F' : 'none'}
              strokeWidth={pt.is_anomaly ? 1 : 0}
              className="cursor-pointer transition-transform duration-150 hover:scale-125"
              onMouseEnter={() => setHovered(pt)}
              onClick={() => onSelectTx && onSelectTx(pt.transaction_id)}
            />
          );
        })}
      </svg>

      {hovered && (
        <div className="flex flex-wrap items-center justify-between gap-4 px-3.5 py-2 bg-slate-900 dark:bg-slate-800 text-white text-xs rounded-lg font-mono tabular-nums border border-slate-700">
          <span>Txn: {hovered.transaction_id}</span>
          <span>Category: {hovered.product_category}</span>
          <span>
            Order: {hovered.quantity} × {formatCurrencyINR(hovered.price_per_unit)} ={' '}
            {formatCurrencyINR(hovered.total_amount)}
          </span>
          <span>Score: {hovered.anomaly_score}</span>
          <span>Status: {hovered.is_anomaly ? 'Flagged Unusual' : 'Normal'}</span>
        </div>
      )}
    </div>
  );
};
