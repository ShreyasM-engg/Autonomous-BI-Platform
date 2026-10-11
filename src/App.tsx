import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  LayoutDashboard,
  MessageSquare,
  Moon,
  RefreshCw,
  Search,
  Send,
  Settings,
  Sun,
  Trash2,
  TrendingUp,
  Upload,
} from 'lucide-react';
import {
  AiBackendStatus,
  AiQueryResult,
  AnomalyResponse,
  biApi,
  BusinessInsightCard,
  CategorySalesItem,
  DashboardKpis,
  DatasetMeta,
  ForecastResponse,
  RetailTransaction,
  SalesTrendPoint,
} from './services/api.ts';
import {
  AnomalyScatterPlot,
  CategoryBarChart,
  ForecastConfidenceChart,
  formatCurrencyINR,
  SalesTrendLineChart,
} from './components/Charts.tsx';
import { VivaDocsPanel } from './components/VivaDocsPanel.tsx';

type NavPage =
  | 'dashboard'
  | 'upload'
  | 'analysis'
  | 'ml'
  | 'ask'
  | 'reports'
  | 'settings';

const SUGGESTED_QUESTIONS = [
  'What are the total sales?',
  'Which product category generates the most revenue?',
  'What is the monthly sales trend?',
  'Which transactions appear unusual?',
  'What are the forecasted sales for the next month?',
  'What actions could improve sales based on this dataset?',
  'How do sales break down by customer age and gender?',
];

export default function App() {
  // Theme state (Light / Dark mode) persisted in localStorage
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('abi_theme');
      if (saved === 'dark' || saved === 'light') return saved;
    }
    return 'dark';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('abi_theme', theme);
  }, [theme]);

  const [activePage, setActivePage] = useState<NavPage>('dashboard');

  // Global dataset & filter state
  const [datasetMeta, setDatasetMeta] = useState<DatasetMeta | null>(null);
  const [datasetHistory, setDatasetHistory] = useState<DatasetMeta[]>([]);
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [trendInterval, setTrendInterval] = useState<'daily' | 'weekly' | 'monthly'>('monthly');

  // Dashboard & Analysis state
  const [kpis, setKpis] = useState<DashboardKpis | null>(null);
  const [salesTrend, setSalesTrend] = useState<SalesTrendPoint[]>([]);
  const [categorySales, setCategorySales] = useState<CategorySalesItem[]>([]);
  const [breakdowns, setBreakdowns] = useState<{
    by_gender: { gender: string; total_sales: number; total_quantity: number; transaction_count: number; avg_order_value: number }[];
    by_age_group: { age_group: string; total_sales: number; total_quantity: number; transaction_count: number; avg_order_value: number }[];
    by_day_of_week: { day_name: string; total_sales: number; transaction_count: number; avg_order_value: number }[];
    category_monthly: { month: string; category: string; total_sales: number }[];
  } | null>(null);
  const [insights, setInsights] = useState<BusinessInsightCard[]>([]);
  const [previewRows, setPreviewRows] = useState<RetailTransaction[]>([]);
  const [previewTotal, setPreviewTotal] = useState<number>(0);

  // ML Forecast & Anomaly state
  const [forecastInterval, setForecastInterval] = useState<'daily' | 'weekly' | 'monthly'>('monthly');
  const [forecastHorizon, setForecastHorizon] = useState<number>(6);
  const [forecastData, setForecastData] = useState<ForecastResponse | null>(null);
  const [contamination, setContamination] = useState<number>(0.04);
  const [anomalyData, setAnomalyData] = useState<AnomalyResponse | null>(null);
  const [anomalySearch, setAnomalySearch] = useState<string>('');

  // Upload page state
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadBanner, setUploadBanner] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [lastCleaningSummary, setLastCleaningSummary] = useState<{
    filename: string;
    total_rows_read: number;
    rows_accepted: number;
    rows_cleaned: number;
    rows_rejected: number;
    duplicates_removed: number;
    formula_corrections: number;
    missing_values_imputed: number;
    detected_columns: Record<string, string>;
    issues: NonNullable<DatasetMeta['issues']>;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Ask Your Data state (no pre-seeded dummy questions)
  const [questionInput, setQuestionInput] = useState<string>('');
  const [askingAi, setAskingAi] = useState<boolean>(false);
  const [qaHistory, setQaHistory] = useState<AiQueryResult[]>([]);
  const [aiStatus, setAiStatus] = useState<AiBackendStatus | null>(null);

  // Reports state
  const [reportTitle, setReportTitle] = useState<string>(
    'Autonomous Business Intelligence — Executive Retail Performance Report'
  );
  const [reportPreparedFor, setReportPreparedFor] = useState<string>(
    'Executive Management & Analytics Review'
  );
  const [includeForecast, setIncludeForecast] = useState<boolean>(true);
  const [includeAnomalies, setIncludeAnomalies] = useState<boolean>(true);
  const [includeInsights, setIncludeInsights] = useState<boolean>(true);
  const [generatingPdf, setGeneratingPdf] = useState<boolean>(false);
  const [pdfMessage, setPdfMessage] = useState<string | null>(null);

  // Loading & Error states
  const [loadingCore, setLoadingCore] = useState<boolean>(true);
  const [coreError, setCoreError] = useState<string | null>(null);

  const currentFilters = useCallback(
    () => ({
      category: selectedCategory !== 'All' ? selectedCategory : undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    }),
    [selectedCategory, startDate, endDate]
  );

  const loadAllPlatformData = useCallback(async () => {
    setLoadingCore(true);
    setCoreError(null);
    try {
      const filters = currentFilters();
      const [statusRes, aiStatusRes] = await Promise.all([
        biApi.getDataStatus(),
        biApi.getAiStatus(),
      ]);

      setDatasetMeta(statusRes.active_dataset);
      setDatasetHistory(statusRes.datasets || []);
      setAiStatus(aiStatusRes);

      if (!statusRes.active_dataset) {
        setKpis(null);
        setSalesTrend([]);
        setCategorySales([]);
        setBreakdowns(null);
        setInsights([]);
        setPreviewRows([]);
        setPreviewTotal(0);
        setAvailableCategories([]);
        setForecastData(null);
        setAnomalyData(null);
        return;
      }

      const [previewRes, analysisRes, insightsRes] = await Promise.all([
        biApi.getDataPreview(20, 0, filters),
        biApi.getSalesAnalysis(trendInterval, filters),
        biApi.getAiInsights(filters),
      ]);

      setPreviewRows(previewRes.rows || []);
      setPreviewTotal(previewRes.total || 0);
      if (previewRes.categories && previewRes.categories.length > 0) {
        setAvailableCategories(previewRes.categories);
      }

      setKpis(analysisRes.kpis);
      setSalesTrend(analysisRes.trend || []);
      setCategorySales(analysisRes.categories || []);
      setBreakdowns(analysisRes.breakdowns || null);
      setInsights(insightsRes.insights || []);
    } catch (err) {
      setCoreError(err instanceof Error ? err.message : 'Unable to connect to backend API.');
    } finally {
      setLoadingCore(false);
    }
  }, [currentFilters, trendInterval]);

  const loadMlModels = useCallback(async () => {
    if (!datasetMeta) {
      setForecastData(null);
      setAnomalyData(null);
      return;
    }
    try {
      const filters = currentFilters();
      const [fcRes, anomRes] = await Promise.all([
        biApi.getForecast(forecastInterval, forecastHorizon, filters),
        biApi.getAnomalies(contamination, filters),
      ]);
      setForecastData(fcRes);
      setAnomalyData(anomRes);
    } catch (err) {
      console.error('ML load error:', err);
    }
  }, [datasetMeta, currentFilters, forecastInterval, forecastHorizon, contamination]);

  useEffect(() => {
    loadAllPlatformData();
  }, [loadAllPlatformData]);

  useEffect(() => {
    loadMlModels();
  }, [loadMlModels]);

  const handleFileUpload = async (file: File) => {
    setUploading(true);
    setUploadBanner(null);
    try {
      const res = await biApi.uploadCsvFile(file);
      setLastCleaningSummary(res.cleaning_summary);
      setUploadBanner({
        type: 'success',
        message: res.message,
      });
      setSelectedCategory('All');
      setStartDate('');
      setEndDate('');
      setQaHistory([]);
      await loadAllPlatformData();
    } catch (err) {
      setUploadBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'CSV upload failed.',
      });
    } finally {
      setUploading(false);
    }
  };

  const handleClearWorkspace = async () => {
    try {
      await biApi.clearDatasets();
      setLastCleaningSummary(null);
      setUploadBanner(null);
      setQaHistory([]);
      setSelectedCategory('All');
      setStartDate('');
      setEndDate('');
      await loadAllPlatformData();
    } catch (err) {
      console.error('Failed to clear datasets:', err);
    }
  };

  const handleAskQuestion = async (qText?: string) => {
    const q = (qText ?? questionInput).trim();
    if (!q || askingAi) return;
    setAskingAi(true);
    try {
      const res = await biApi.askDataQuestion(q, currentFilters());
      setQaHistory((prev) => [res, ...prev]);
      if (!qText) setQuestionInput('');
    } catch (err) {
      console.error(err);
    } finally {
      setAskingAi(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!datasetMeta) {
      setActivePage('upload');
      return;
    }
    setGeneratingPdf(true);
    setPdfMessage(null);
    try {
      await biApi.downloadPdfReport({
        title: reportTitle,
        prepared_for: reportPreparedFor,
        include_forecast: includeForecast,
        include_anomalies: includeAnomalies,
        include_insights: includeInsights,
        forecast_horizon: forecastHorizon,
        anomaly_contamination: contamination,
        filters: currentFilters(),
      });
      setPdfMessage('Executive PDF Business Report generated and downloaded.');
    } catch (err) {
      setPdfMessage(err instanceof Error ? err.message : 'Failed to generate PDF report.');
    } finally {
      setGeneratingPdf(false);
    }
  };

  const resetFilters = () => {
    setSelectedCategory('All');
    setStartDate('');
    setEndDate('');
  };

  const navTabs: { id: NavPage; label: string; icon: React.ReactNode }[] = [
    { id: 'dashboard', label: 'Overview & KPIs', icon: <LayoutDashboard className="w-3.5 h-3.5" /> },
    { id: 'upload', label: 'Upload CSV Dataset', icon: <Upload className="w-3.5 h-3.5" /> },
    { id: 'analysis', label: 'Sales Analysis', icon: <BarChart3 className="w-3.5 h-3.5" /> },
    { id: 'ml', label: 'Forecast & Anomalies', icon: <TrendingUp className="w-3.5 h-3.5" /> },
    { id: 'ask', label: 'Ask Your Data', icon: <MessageSquare className="w-3.5 h-3.5" /> },
    { id: 'reports', label: 'PDF Reports', icon: <FileText className="w-3.5 h-3.5" /> },
    { id: 'settings', label: 'Settings & Docs', icon: <Settings className="w-3.5 h-3.5" /> },
  ];

  const filteredAnomalies = (anomalyData?.anomalies || []).filter((a) => {
    if (!anomalySearch.trim()) return true;
    const s = anomalySearch.toLowerCase();
    return (
      a.transaction_id.toLowerCase().includes(s) ||
      a.product_category.toLowerCase().includes(s) ||
      a.customer_id.toLowerCase().includes(s) ||
      a.explanation.toLowerCase().includes(s)
    );
  });

  // Reusable Empty Dataset Callout for Analytical Views
  const renderEmptyDatasetPrompt = (sectionTitle: string) => (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center max-w-2xl mx-auto my-8 space-y-5">
      <div className="w-12 h-12 rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto">
        <FileSpreadsheet className="w-6 h-6" />
      </div>
      <div className="space-y-2">
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
          Upload a Retail CSV Dataset to Unlock {sectionTitle}
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
          This platform operates strictly on your uploaded CSV records without pre-loaded dummy data. Upload your retail sales CSV file to run live SQLite KPI calculations, OLS forecasting, Isolation Forest anomaly detection, and grounded natural-language queries.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
        <button
          onClick={() => setActivePage('upload')}
          className="px-5 py-2.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors cursor-pointer"
        >
          Go to CSV Uploader
        </button>
        <a
          href="/api/datasets/sample-download?type=clean"
          download="retail_sales.csv"
          className="px-4 py-2.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center gap-1.5"
        >
          <Download className="w-3.5 h-3.5" /> Download Reference CSV File
        </a>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] dark:bg-[#0B0F19] text-[#0F172A] dark:text-[#F8FAFC] transition-colors duration-150">
      {/* ====================================================================
          STRICT 3-ZONE TOP WEBSITE NAVIGATION BAR
      ==================================================================== */}
      <header className="sticky top-0 z-30 bg-white/95 dark:bg-[#0B0F19]/95 backdrop-blur border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-[1440px] mx-auto flex items-center justify-between gap-8 px-6 py-4">
          {/* Zone 1: Single text element wordmark */}
          <a
            href="#overview"
            onClick={(e) => {
              e.preventDefault();
              setActivePage('dashboard');
            }}
            className="text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0 font-display"
          >
            Autonomous BI
          </a>

          {/* Zone 2: 5 concise single-line text navigation links */}
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600 dark:text-slate-300">
            <a
              href="#overview"
              onClick={(e) => {
                e.preventDefault();
                setActivePage('dashboard');
              }}
              className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 ${
                activePage === 'dashboard'
                  ? 'text-blue-600 dark:text-blue-400 underline underline-offset-8 decoration-2'
                  : ''
              }`}
            >
              Overview
            </a>
            <a
              href="#analysis"
              onClick={(e) => {
                e.preventDefault();
                setActivePage('analysis');
              }}
              className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 ${
                activePage === 'analysis'
                  ? 'text-blue-600 dark:text-blue-400 underline underline-offset-8 decoration-2'
                  : ''
              }`}
            >
              Analytics
            </a>
            <a
              href="#forecasting"
              onClick={(e) => {
                e.preventDefault();
                setActivePage('ml');
              }}
              className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 ${
                activePage === 'ml'
                  ? 'text-blue-600 dark:text-blue-400 underline underline-offset-8 decoration-2'
                  : ''
              }`}
            >
              Forecasting
            </a>
            <a
              href="#ask-data"
              onClick={(e) => {
                e.preventDefault();
                setActivePage('ask');
              }}
              className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 ${
                activePage === 'ask'
                  ? 'text-blue-600 dark:text-blue-400 underline underline-offset-8 decoration-2'
                  : ''
              }`}
            >
              Ask Data
            </a>
            <a
              href="#documentation"
              onClick={(e) => {
                e.preventDefault();
                setActivePage('settings');
              }}
              className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 ${
                activePage === 'settings'
                  ? 'text-blue-600 dark:text-blue-400 underline underline-offset-8 decoration-2'
                  : ''
              }`}
            >
              Documentation
            </a>
          </nav>

          {/* Zone 3: 1 primary action */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => setActivePage('upload')}
              className="px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Upload CSV Dataset
            </button>
          </div>
        </div>
      </header>

      {/* ====================================================================
          SECONDARY WEBSITE WORKSPACE TOOLBAR (Navigation Tabs, Filters, Theme)
      ==================================================================== */}
      <div className="bg-white dark:bg-slate-900/90 border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-[1440px] mx-auto px-6 py-2.5 flex flex-wrap items-center justify-between gap-4">
          {/* Interactive Module Switcher */}
          <div className="flex items-center gap-1 overflow-x-auto py-0.5">
            {navTabs.map((item) => {
              const active = activePage === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActivePage(item.id)}
                  className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-slate-900 dark:bg-blue-600 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          {/* Right Toolbar Controls: Active Dataset Status + Theme Switcher */}
          <div className="flex flex-wrap items-center gap-4 ml-auto">
            {datasetMeta ? (
              <div className="flex items-center gap-2.5 text-xs text-slate-600 dark:text-slate-400">
                <span>
                  Dataset:{' '}
                  <strong className="font-mono text-slate-900 dark:text-slate-100">
                    {datasetMeta.filename}
                  </strong>{' '}
                  ({datasetMeta.rows_accepted.toLocaleString('en-IN')} rows)
                </span>
                <button
                  onClick={handleClearWorkspace}
                  title="Remove active dataset from workspace"
                  className="text-red-600 dark:text-red-400 hover:underline flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Trash2 className="w-3 h-3" /> Clear Data
                </button>
              </div>
            ) : (
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Workspace Status: No dataset loaded
              </span>
            )}

            {/* Dark / Light Mode Segmented Switcher */}
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
              <button
                onClick={() => setTheme('light')}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  theme === 'light'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Sun className="w-3.5 h-3.5" /> Light
              </button>
              <button
                onClick={() => setTheme('dark')}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  theme === 'dark'
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Moon className="w-3.5 h-3.5" /> Dark
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Global Filter Bar when a dataset is loaded */}
      {datasetMeta && (
        <div className="bg-slate-50 dark:bg-slate-900/40 border-b border-slate-200 dark:border-slate-800/80">
          <div className="max-w-[1440px] mx-auto px-6 py-2.5 flex flex-wrap items-center justify-between gap-4 text-xs">
            <div className="flex flex-wrap items-center gap-4">
              <span className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" /> Global Data Filters:
              </span>

              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 dark:text-slate-400">Category:</span>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="px-2.5 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-slate-800 dark:text-slate-100 focus:outline-none focus:border-blue-500"
                >
                  <option value="All">All Categories</option>
                  {availableCategories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 dark:text-slate-400">From:</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="px-2 py-1 font-mono bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-slate-800 dark:text-slate-100 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 dark:text-slate-400">To:</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="px-2 py-1 font-mono bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-slate-800 dark:text-slate-100 focus:outline-none focus:border-blue-500"
                />
              </div>

              {(selectedCategory !== 'All' || startDate || endDate) && (
                <button
                  onClick={resetFilters}
                  className="text-blue-600 dark:text-blue-400 hover:underline font-medium cursor-pointer"
                >
                  Reset Filters
                </button>
              )}
            </div>

            <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
              <span>
                Period: <span className="font-mono">{kpis?.date_range.start}</span> to{' '}
                <span className="font-mono">{kpis?.date_range.end}</span>
              </span>
              <span aria-hidden="true">·</span>
              <button
                onClick={handleDownloadPdf}
                disabled={generatingPdf}
                className="text-blue-600 dark:text-blue-400 hover:underline font-medium cursor-pointer"
              >
                {generatingPdf ? 'Compiling PDF...' : 'Export PDF Report'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          MAIN WEBSITE CONTENT CONTAINER
      ==================================================================== */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-6 py-8 lg:py-10 space-y-10">
        {coreError && (
          <div className="p-4 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-lg flex items-center justify-between text-sm text-red-800 dark:text-red-200">
            <span>{coreError}</span>
            <button
              onClick={loadAllPlatformData}
              className="px-3 py-1 text-xs font-medium bg-white dark:bg-slate-800 border border-red-300 dark:border-red-700 rounded-md cursor-pointer"
            >
              Retry Connection
            </button>
          </div>
        )}

        {/* ================================================================
            VIEW 1: EXECUTIVE WEBSITE HERO & DASHBOARD OVERVIEW
        ================================================================ */}
        {activePage === 'dashboard' && (
          <div className="space-y-10">
            {!datasetMeta ? (
              /* Clean Professional Website Landing Hero when no CSV is loaded yet */
              <div className="space-y-12">
                <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch pt-2">
                  <div className="lg:col-span-7 flex flex-col justify-center space-y-6">
                    <div className="text-xs font-medium text-blue-600 dark:text-blue-400">
                      Enterprise Business Intelligence · Machine Learning · Local SQL Grounding
                    </div>
                    <h1
                      className="text-3xl sm:text-4xl lg:text-5xl font-bold text-slate-900 dark:text-white tracking-tight leading-[1.12]"
                      style={{ textWrap: 'balance' }}
                    >
                      Transform Raw Retail CSV Spreadsheets Into Verified Financial Intelligence.
                    </h1>
                    <p className="text-base text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl">
                      Upload your transaction dataset to autonomously validate and clean records, store normalized rows in SQLite, forecast revenue with chronologically validated Linear Regression, isolate unusual orders with Isolation Forest, and query your numbers in plain English—with zero cloud API keys required.
                    </p>
                    <div className="flex flex-wrap items-center gap-4 pt-1">
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                        className="px-6 py-3 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors cursor-pointer"
                      >
                        {uploading ? 'Validating CSV...' : 'Upload Retail Sales CSV'}
                      </button>
                      <a
                        href="/api/datasets/sample-download?type=clean"
                        download="retail_sales.csv"
                        className="px-5 py-3 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-2"
                      >
                        <Download className="w-4 h-4" /> Download Sample CSV to Test
                      </a>
                    </div>
                  </div>

                  {/* Direct Interactive CSV Upload Box in the Hero Right Column */}
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const file = e.dataTransfer.files?.[0];
                      if (file) handleFileUpload(file);
                    }}
                    className="lg:col-span-5 bg-white dark:bg-slate-900 border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-500 rounded-xl p-8 flex flex-col items-center justify-center text-center space-y-4 transition-colors"
                  >
                    <div className="w-14 h-14 rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                      <Upload className="w-6 h-6" />
                    </div>
                    <div className="space-y-1.5">
                      <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                        Drop your .csv file here to begin analysis
                      </h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed max-w-xs">
                        Supports Transaction ID, Date, Customer ID, Gender, Age, Product Category, Quantity, Price per Unit, and Total Amount.
                      </p>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,text/csv"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileUpload(file);
                        e.target.value = '';
                      }}
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                      className="px-4 py-2 text-xs font-medium text-slate-900 dark:text-white bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                    >
                      Browse Computer for CSV
                    </button>
                  </div>
                </section>

                {/* Editorial Numbered Platform Capabilities Section */}
                <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-200 dark:divide-slate-800">
                  <div className="p-6">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                      End-to-End Autonomous Intelligence Architecture
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      Every stage runs locally on your uploaded CSV dataset without hardcoded demonstration figures or external paid API keys.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-slate-200 dark:divide-slate-800">
                    <div className="p-6 space-y-2">
                      <div className="text-xs font-mono text-blue-600 dark:text-blue-400">01. Data Hygiene</div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        Schema Validation & Formula Repair
                      </h3>
                      <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                        Normalizes dates and currencies, removes duplicate transaction IDs, repairs Quantity × Unit Price mismatches, and logs every row action.
                      </p>
                    </div>
                    <div className="p-6 space-y-2">
                      <div className="text-xs font-mono text-blue-600 dark:text-blue-400">02. Predictive ML</div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        Chronological OLS Sales Forecasting
                      </h3>
                      <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                        Splits aggregated time series chronologically (80% train / 20% holdout test), evaluates MAE & RMSE, and projects future revenue with 95% confidence intervals.
                      </p>
                    </div>
                    <div className="p-6 space-y-2">
                      <div className="text-xs font-mono text-blue-600 dark:text-blue-400">03. Outlier Isolation</div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        100-Tree Isolation Forest Ensemble
                      </h3>
                      <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                        Computes binary partition path lengths across order totals, quantities, and category z-scores to flag statistically unusual transactions.
                      </p>
                    </div>
                    <div className="p-6 space-y-2">
                      <div className="text-xs font-mono text-blue-600 dark:text-blue-400">04. Natural Language BI</div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        Zero-Key SQL Grounding & PDF Reports
                      </h3>
                      <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                        Answers plain-English questions using allowlisted read-only SQLite queries and local Ollama (Llama 3.2 3B), and compiles downloadable PDF reports.
                      </p>
                    </div>
                  </div>
                </section>
              </div>
            ) : (
              /* Populated Executive Dashboard when User Uploads a Real CSV Dataset */
              <div className="space-y-8">
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span>Executive Overview</span>
                      <span aria-hidden="true">·</span>
                      <span>Dataset: {datasetMeta.filename}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {kpis?.date_range.start} to {kpis?.date_range.end}
                      </span>
                    </div>
                    <h1 className="text-2xl lg:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
                      Executive Business Intelligence Dashboard
                    </h1>
                  </div>

                  {/* Interactive Category Filter Segmented Bar */}
                  <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                    {['All', ...availableCategories].map((cat) => (
                      <button
                        key={cat}
                        onClick={() => setSelectedCategory(cat)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          selectedCategory === cat
                            ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        {cat === 'All' ? 'All Categories' : cat}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 4 KPI Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-2">
                    <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      Total Sales Revenue
                    </div>
                    <div className="text-2xl lg:text-3xl font-bold text-slate-900 dark:text-white font-mono tabular-nums">
                      {loadingCore ? '...' : formatCurrencyINR(kpis?.total_sales || 0)}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <span>Top Category: {kpis?.top_category || 'N/A'}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {formatCurrencyINR(kpis?.top_category_sales || 0)}
                      </span>
                    </div>
                  </div>

                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-2">
                    <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      Total Quantity Sold
                    </div>
                    <div className="text-2xl lg:text-3xl font-bold text-slate-900 dark:text-white font-mono tabular-nums">
                      {loadingCore ? '...' : (kpis?.total_quantity || 0).toLocaleString('en-IN')}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                      Avg{' '}
                      {kpis && kpis.total_transactions > 0
                        ? (kpis.total_quantity / kpis.total_transactions).toFixed(2)
                        : '0.00'}{' '}
                      units per transaction
                    </div>
                  </div>

                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-2">
                    <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      Total Transactions
                    </div>
                    <div className="text-2xl lg:text-3xl font-bold text-slate-900 dark:text-white font-mono tabular-nums">
                      {loadingCore ? '...' : (kpis?.total_transactions || 0).toLocaleString('en-IN')}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                      {(kpis?.unique_customers || 0).toLocaleString('en-IN')} unique customer IDs
                    </div>
                  </div>

                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-2">
                    <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      Average Transaction Value
                    </div>
                    <div className="text-2xl lg:text-3xl font-bold text-slate-900 dark:text-white font-mono tabular-nums">
                      {loadingCore ? '...' : formatCurrencyINR(kpis?.avg_transaction_value || 0)}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                      Range: {formatCurrencyINR(kpis?.min_transaction_value || 0)} –{' '}
                      {formatCurrencyINR(kpis?.max_transaction_value || 0)}
                    </div>
                  </div>
                </div>

                {/* Primary Charts Row */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
                  <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 flex flex-col justify-between space-y-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                          Sales Revenue Over Time
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Chronological revenue progression aggregated from validated SQLite transactions
                        </p>
                      </div>
                      <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                        {(['daily', 'weekly', 'monthly'] as const).map((intv) => (
                          <button
                            key={intv}
                            onClick={() => setTrendInterval(intv)}
                            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors capitalize whitespace-nowrap shrink-0 cursor-pointer ${
                              trendInterval === intv
                                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                            }`}
                          >
                            {intv}
                          </button>
                        ))}
                      </div>
                    </div>

                    <SalesTrendLineChart data={salesTrend} />
                  </div>

                  <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 flex flex-col justify-between space-y-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                          Sales by Product Category
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Revenue share, unit volume, and average order value by department
                        </p>
                      </div>
                      <button
                        onClick={() => setActivePage('analysis')}
                        className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Deep Analysis <ArrowUpRight className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <CategoryBarChart categories={categorySales} />
                  </div>
                </div>

                {/* Automated Grounded Insights */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-200 dark:divide-slate-800">
                  <div className="p-6 flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                        Autonomous Business Insights & Recommendations
                      </h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Deterministic evidence-backed findings synthesized from KPI, OLS Forecast, and Isolation Forest pipelines
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setActivePage('ml')}
                        className="px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Inspect Forecast & Anomalies
                      </button>
                      <button
                        onClick={() => setActivePage('ask')}
                        className="px-3.5 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Ask Natural-Language Question
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-slate-200 dark:divide-slate-800">
                    {insights.slice(0, 3).map((ins) => (
                      <div key={ins.id} className="p-6 space-y-2.5">
                        <div className="text-xs font-medium text-blue-600 dark:text-blue-400">
                          {ins.category}
                        </div>
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                          {ins.title}
                        </h3>
                        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                          {ins.finding}
                        </p>
                        <div className="pt-2 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300">
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            Recommendation:{' '}
                          </span>
                          {ins.recommendation}
                        </div>
                        <div className="text-[11px] text-slate-400 dark:text-slate-500">
                          Note: {ins.uncertainty_note}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================================================================
            VIEW 2: UPLOAD DATASET & DATA HYGIENE PIPELINE
        ================================================================ */}
        {activePage === 'upload' && (
          <div className="space-y-8">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div className="space-y-1">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Data Ingestion · Schema Validation · Automated Cleaning · SQLite Storage
                </div>
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                  Upload & Validate Retail Sales CSV Dataset
                </h1>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <a
                  href="/api/datasets/sample-download?type=clean"
                  download="retail_sales.csv"
                  className="px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <Download className="w-3.5 h-3.5" /> Download Sample CSV File (retail_sales.csv)
                </a>
                {datasetMeta && (
                  <button
                    onClick={handleClearWorkspace}
                    className="px-3.5 py-2 text-xs font-medium text-red-600 dark:text-red-400 bg-white dark:bg-slate-900 border border-red-200 dark:border-red-900/60 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Clear Active Dataset
                  </button>
                )}
              </div>
            </div>

            {uploadBanner && (
              <div
                className={`p-4 rounded-lg border text-sm flex items-center justify-between ${
                  uploadBanner.type === 'success'
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                    : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-900 dark:text-red-200'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  {uploadBanner.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
                  )}
                  <span>{uploadBanner.message}</span>
                </div>
                {uploadBanner.type === 'success' && (
                  <button
                    onClick={() => setActivePage('dashboard')}
                    className="px-3 py-1.5 text-xs font-medium bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md text-slate-800 dark:text-slate-100 hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Open Overview Dashboard
                  </button>
                )}
              </div>
            )}

            {/* Primary CSV Upload Dropzone */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                if (file) handleFileUpload(file);
              }}
              className="bg-white dark:bg-slate-900 border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-500 rounded-xl p-10 flex flex-col items-center justify-center text-center space-y-4 transition-colors"
            >
              <div className="w-12 h-12 rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                <FileSpreadsheet className="w-6 h-6" />
              </div>
              <div className="space-y-1 max-w-lg">
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Drag and drop your retail sales CSV file here
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Expected columns: Transaction ID, Date, Customer ID, Gender, Age, Product Category, Quantity, Price per Unit, Total Amount (supports common column name variations up to 15 MB).
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file);
                  e.target.value = '';
                }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="px-5 py-2.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors cursor-pointer disabled:opacity-50"
              >
                {uploading ? 'Validating & Cleaning CSV...' : 'Select CSV File from Computer'}
              </button>
            </div>

            {/* Validation & Cleaning Summary (Only shown when a real file has been uploaded) */}
            {datasetMeta && (
              <>
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-200 dark:divide-slate-800">
                  <div className="p-6 flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                        Validation & Hygiene Audit Summary — {datasetMeta.filename}
                      </h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Non-destructive data cleaning repairs recoverable inconsistencies and logs rejected records
                      </p>
                    </div>
                    <span className="text-xs font-mono text-emerald-700 dark:text-emerald-400">
                      Status: Ready for Analysis (Dataset ID #{datasetMeta.id})
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800">
                    <div className="p-4 space-y-1">
                      <div className="text-xs text-slate-500 dark:text-slate-400">Rows Read</div>
                      <div className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                        {datasetMeta.total_rows_read.toLocaleString('en-IN')}
                      </div>
                    </div>
                    <div className="p-4 space-y-1">
                      <div className="text-xs text-slate-500 dark:text-slate-400">Valid Accepted</div>
                      <div className="text-xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                        {datasetMeta.rows_accepted.toLocaleString('en-IN')}
                      </div>
                    </div>
                    <div className="p-4 space-y-1">
                      <div className="text-xs text-slate-500 dark:text-slate-400">Rows Cleaned</div>
                      <div className="text-xl font-bold font-mono tabular-nums text-blue-700 dark:text-blue-400">
                        {datasetMeta.rows_cleaned.toLocaleString('en-IN')}
                      </div>
                    </div>
                    <div className="p-4 space-y-1">
                      <div className="text-xs text-slate-500 dark:text-slate-400">Rows Rejected</div>
                      <div className="text-xl font-bold font-mono tabular-nums text-amber-700 dark:text-amber-400">
                        {datasetMeta.rows_rejected.toLocaleString('en-IN')}
                      </div>
                    </div>
                    <div className="p-4 space-y-1">
                      <div className="text-xs text-slate-500 dark:text-slate-400">Duplicates Skipped</div>
                      <div className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                        {datasetMeta.duplicates_removed}
                      </div>
                    </div>
                    <div className="p-4 space-y-1">
                      <div className="text-xs text-slate-500 dark:text-slate-400">Formula Fixes</div>
                      <div className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                        {datasetMeta.formula_corrections}
                      </div>
                    </div>
                  </div>

                  {((lastCleaningSummary?.issues && lastCleaningSummary.issues.length > 0) ||
                    (datasetMeta.issues && datasetMeta.issues.length > 0)) && (
                    <div className="p-6 space-y-3">
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        Row-Level Hygiene & Validation Log
                      </h3>
                      <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300">
                              <th className="py-2.5 px-3 font-semibold">Row #</th>
                              <th className="py-2.5 px-3 font-semibold">Transaction ID</th>
                              <th className="py-2.5 px-3 font-semibold">Action</th>
                              <th className="py-2.5 px-3 font-semibold">Field</th>
                              <th className="py-2.5 px-3 font-semibold">Diagnostic Reason</th>
                              <th className="py-2.5 px-3 font-semibold">Original → Corrected</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                            {(lastCleaningSummary?.issues || datasetMeta.issues || []).map((iss, idx) => (
                              <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                                <td className="py-2 px-3 font-mono tabular-nums">{iss.rowNumber}</td>
                                <td className="py-2 px-3 font-mono">{iss.transactionId}</td>
                                <td className="py-2 px-3 font-medium">
                                  <span
                                    className={
                                      iss.action === 'cleaned'
                                        ? 'text-blue-700 dark:text-blue-400'
                                        : 'text-red-700 dark:text-red-400'
                                    }
                                  >
                                    {iss.action === 'cleaned' ? 'Cleaned / Repaired' : 'Rejected'}
                                  </span>
                                </td>
                                <td className="py-2 px-3 font-medium text-slate-800 dark:text-slate-200">
                                  {iss.field}
                                </td>
                                <td className="py-2 px-3 text-slate-600 dark:text-slate-400">
                                  {iss.reason}
                                </td>
                                <td className="py-2 px-3 font-mono text-slate-700 dark:text-slate-300">
                                  {iss.originalValue || 'NULL'}
                                  {iss.correctedValue ? ` → ${iss.correctedValue}` : ''}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>

                {/* Data Preview Table */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-200 dark:divide-slate-800">
                  <div className="p-6 flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                        Cleaned SQLite Dataset Preview
                      </h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Showing first 20 records of {previewTotal.toLocaleString('en-IN')} validated transactions
                      </p>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300">
                          <th className="py-3 px-4 font-semibold">Transaction ID</th>
                          <th className="py-3 px-4 font-semibold">Date</th>
                          <th className="py-3 px-4 font-semibold">Customer ID</th>
                          <th className="py-3 px-4 font-semibold">Gender</th>
                          <th className="py-3 px-4 font-semibold text-right">Age</th>
                          <th className="py-3 px-4 font-semibold">Product Category</th>
                          <th className="py-3 px-4 font-semibold text-right">Quantity</th>
                          <th className="py-3 px-4 font-semibold text-right">Price per Unit</th>
                          <th className="py-3 px-4 font-semibold text-right">Total Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {previewRows.map((r) => (
                          <tr key={r.transaction_id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                            <td className="py-2.5 px-4 font-mono text-slate-900 dark:text-slate-100">
                              {r.transaction_id}
                            </td>
                            <td className="py-2.5 px-4 font-mono tabular-nums text-slate-600 dark:text-slate-400">
                              {r.date}
                            </td>
                            <td className="py-2.5 px-4 font-mono text-slate-600 dark:text-slate-400">
                              {r.customer_id}
                            </td>
                            <td className="py-2.5 px-4 text-slate-700 dark:text-slate-300">{r.gender}</td>
                            <td className="py-2.5 px-4 font-mono tabular-nums text-right text-slate-700 dark:text-slate-300">
                              {r.age}
                            </td>
                            <td className="py-2.5 px-4 font-medium text-slate-900 dark:text-slate-100">
                              {r.product_category}
                            </td>
                            <td className="py-2.5 px-4 font-mono tabular-nums text-right text-slate-700 dark:text-slate-300">
                              {r.quantity}
                            </td>
                            <td className="py-2.5 px-4 font-mono tabular-nums text-right text-slate-700 dark:text-slate-300">
                              {formatCurrencyINR(r.price_per_unit)}
                            </td>
                            <td className="py-2.5 px-4 font-mono tabular-nums text-right font-semibold text-slate-900 dark:text-white">
                              {formatCurrencyINR(r.total_amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ================================================================
            VIEW 3: SALES ANALYSIS
        ================================================================ */}
        {activePage === 'analysis' && (
          !datasetMeta ? (
            renderEmptyDatasetPrompt('Sales & Category Performance Analysis')
          ) : (
            <div className="space-y-8">
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Multi-Dimensional OLAP Slicing · Time Granularity · Demographic Cohorts
                  </div>
                  <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                    Deep-Dive Sales & Category Performance Analysis
                  </h1>
                </div>

                <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                  {(['daily', 'weekly', 'monthly'] as const).map((intv) => (
                    <button
                      key={intv}
                      onClick={() => setTrendInterval(intv)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize whitespace-nowrap shrink-0 cursor-pointer ${
                        trendInterval === intv
                          ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      {intv} Trend
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-200 dark:divide-slate-800">
                <div className="p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 capitalize">
                      {trendInterval} Revenue & Order Velocity Trajectory
                    </h2>
                    <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {salesTrend.length} {trendInterval} intervals analyzed
                    </span>
                  </div>
                  <SalesTrendLineChart data={salesTrend} height={280} />
                </div>

                {salesTrend.length >= 2 && (
                  <div className="p-5 bg-slate-50/70 dark:bg-slate-800/40 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                    <span className="font-semibold text-slate-900 dark:text-white">
                      Plain-Language Trend Interpretation:{' '}
                    </span>
                    Across {salesTrend.length} {trendInterval} periods, sales averaged{' '}
                    <strong className="font-mono">
                      {formatCurrencyINR(
                        (kpis?.total_sales || 0) / Math.max(1, salesTrend.length)
                      )}
                    </strong>{' '}
                    per period. The highest-performing period was{' '}
                    <strong className="font-mono">
                      {[...salesTrend].sort((a, b) => b.total_sales - a.total_sales)[0]?.period}
                    </strong>{' '}
                    (
                    <strong className="font-mono">
                      {formatCurrencyINR(
                        [...salesTrend].sort((a, b) => b.total_sales - a.total_sales)[0]?.total_sales || 0
                      )}
                    </strong>
                    ), while the lowest was{' '}
                    <strong className="font-mono">
                      {[...salesTrend].sort((a, b) => a.total_sales - b.total_sales)[0]?.period}
                    </strong>{' '}
                    (
                    <strong className="font-mono">
                      {formatCurrencyINR(
                        [...salesTrend].sort((a, b) => a.total_sales - b.total_sales)[0]?.total_sales || 0
                      )}
                    </strong>
                    ).
                  </div>
                )}
              </div>

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-200 dark:divide-slate-800">
                <div className="p-6">
                  <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    Category-Wise Revenue, Unit Volume & Pricing Comparison
                  </h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300">
                        <th className="py-3 px-4 font-semibold">Product Category</th>
                        <th className="py-3 px-4 font-semibold text-right">Total Revenue</th>
                        <th className="py-3 px-4 font-semibold text-right">Revenue Share</th>
                        <th className="py-3 px-4 font-semibold text-right">Units Sold</th>
                        <th className="py-3 px-4 font-semibold text-right">Transactions</th>
                        <th className="py-3 px-4 font-semibold text-right">Avg Order Value</th>
                        <th className="py-3 px-4 font-semibold text-right">Avg Unit Price</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {categorySales.map((c) => (
                        <tr key={c.category} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">
                            {c.category}
                          </td>
                          <td className="py-3 px-4 font-mono tabular-nums text-right font-semibold text-slate-900 dark:text-white">
                            {formatCurrencyINR(c.total_sales)}
                          </td>
                          <td className="py-3 px-4 font-mono tabular-nums text-right text-blue-600 dark:text-blue-400">
                            {c.revenue_share_pct}%
                          </td>
                          <td className="py-3 px-4 font-mono tabular-nums text-right text-slate-700 dark:text-slate-300">
                            {c.total_quantity.toLocaleString('en-IN')}
                          </td>
                          <td className="py-3 px-4 font-mono tabular-nums text-right text-slate-700 dark:text-slate-300">
                            {c.transaction_count.toLocaleString('en-IN')}
                          </td>
                          <td className="py-3 px-4 font-mono tabular-nums text-right text-slate-700 dark:text-slate-300">
                            {formatCurrencyINR(c.avg_transaction_value)}
                          </td>
                          <td className="py-3 px-4 font-mono tabular-nums text-right text-slate-700 dark:text-slate-300">
                            {formatCurrencyINR(c.avg_unit_price)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {breakdowns && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-4">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Sales by Customer Age Cohort
                    </h3>
                    <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                      {breakdowns.by_age_group.map((ag) => (
                        <div key={ag.age_group} className="py-2.5 flex items-center justify-between">
                          <div>
                            <div className="font-medium text-slate-900 dark:text-slate-100">
                              {ag.age_group}
                            </div>
                            <div className="text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                              {ag.transaction_count} orders · Avg {formatCurrencyINR(ag.avg_order_value)}
                            </div>
                          </div>
                          <div className="font-mono tabular-nums font-semibold text-slate-900 dark:text-white">
                            {formatCurrencyINR(ag.total_sales)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-4">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Sales by Customer Gender
                    </h3>
                    <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                      {breakdowns.by_gender.map((g) => (
                        <div key={g.gender} className="py-3 flex items-center justify-between">
                          <div>
                            <div className="font-medium text-slate-900 dark:text-slate-100">
                              {g.gender}
                            </div>
                            <div className="text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                              {g.transaction_count} orders · {g.total_quantity.toLocaleString('en-IN')} units
                            </div>
                          </div>
                          <div className="text-right font-mono tabular-nums">
                            <div className="font-semibold text-slate-900 dark:text-white">
                              {formatCurrencyINR(g.total_sales)}
                            </div>
                            <div className="text-slate-500 dark:text-slate-400">
                              Avg {formatCurrencyINR(g.avg_order_value)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-4">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Day-of-Week Revenue Distribution
                    </h3>
                    <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                      {breakdowns.by_day_of_week.map((d) => (
                        <div key={d.day_name} className="py-2 flex items-center justify-between">
                          <span className="font-medium text-slate-800 dark:text-slate-200">
                            {d.day_name}
                          </span>
                          <span className="font-mono tabular-nums text-slate-600 dark:text-slate-400">
                            {d.transaction_count} txns ·{' '}
                            <strong className="text-slate-900 dark:text-white">
                              {formatCurrencyINR(d.total_sales)}
                            </strong>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        )}

        {/* ================================================================
            VIEW 4: FORECAST & ANOMALIES (MACHINE LEARNING)
        ================================================================ */}
        {activePage === 'ml' && (
          !datasetMeta ? (
            renderEmptyDatasetPrompt('Machine Learning Sales Forecasting & Anomaly Detection')
          ) : (
            <div className="space-y-10">
              <div className="space-y-1">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Supervised & Unsupervised Machine Learning · Chronological Validation · Outlier Isolation
                </div>
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                  Sales Forecasting & Transaction Anomaly Detection
                </h1>
              </div>

              {/* SECTION A: SALES FORECASTING (OLS LINEAR REGRESSION) */}
              <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-200 dark:divide-slate-800">
                <div className="p-6 flex flex-wrap items-center justify-between gap-4">
                  <div className="space-y-1">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                      01. Sales Forecasting Pipeline (Linear Regression)
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {forecastData?.model_name || 'OLS Linear Regression'} · Chronological 80/20 Train/Test Evaluation
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="text-slate-500 dark:text-slate-400">Interval:</span>
                      <select
                        value={forecastInterval}
                        onChange={(e) =>
                          setForecastInterval(e.target.value as 'daily' | 'weekly' | 'monthly')
                        }
                        className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md font-medium text-slate-800 dark:text-slate-100"
                      >
                        <option value="monthly">Monthly</option>
                        <option value="weekly">Weekly</option>
                        <option value="daily">Daily</option>
                      </select>
                    </div>

                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="text-slate-500 dark:text-slate-400">Horizon:</span>
                      <select
                        value={forecastHorizon}
                        onChange={(e) => setForecastHorizon(Number(e.target.value))}
                        className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md font-mono text-slate-800 dark:text-slate-100"
                      >
                        {[3, 6, 9, 12].map((h) => (
                          <option key={h} value={h}>
                            +{h} {forecastInterval} periods
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {forecastData && (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800">
                      <div className="p-4 space-y-1">
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          Projected Horizon Total
                        </div>
                        <div className="text-lg font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                          {formatCurrencyINR(forecastData.metrics.projected_horizon_total)}
                        </div>
                      </div>
                      <div className="p-4 space-y-1">
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          Trend Slope / Period
                        </div>
                        <div className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                          {forecastData.metrics.slope_per_period >= 0 ? '+' : ''}
                          {formatCurrencyINR(forecastData.metrics.slope_per_period)}
                        </div>
                      </div>
                      <div className="p-4 space-y-1">
                        <div className="text-xs text-slate-500 dark:text-slate-400">Holdout MAE</div>
                        <div className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                          {forecastData.metrics.mae !== null
                            ? formatCurrencyINR(forecastData.metrics.mae)
                            : 'N/A'}
                        </div>
                      </div>
                      <div className="p-4 space-y-1">
                        <div className="text-xs text-slate-500 dark:text-slate-400">Holdout RMSE</div>
                        <div className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                          {forecastData.metrics.rmse !== null
                            ? formatCurrencyINR(forecastData.metrics.rmse)
                            : 'N/A'}
                        </div>
                      </div>
                      <div className="p-4 space-y-1">
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          Goodness of Fit (R²)
                        </div>
                        <div className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                          {forecastData.metrics.r2_score ?? 'N/A'}
                        </div>
                      </div>
                    </div>

                    <div className="p-6">
                      <ForecastConfidenceChart forecast={forecastData} />
                    </div>

                    <div className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
                      <div className="lg:col-span-7 space-y-3">
                        <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                          Projected Future Sales Schedule (Estimates with 95% Prediction Intervals)
                        </h3>
                        <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
                          <table className="w-full text-left border-collapse text-xs">
                            <thead>
                              <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300">
                                <th className="py-2.5 px-3 font-semibold">Future Period</th>
                                <th className="py-2.5 px-3 font-semibold text-right">Point Forecast</th>
                                <th className="py-2.5 px-3 font-semibold text-right">95% Lower Bound</th>
                                <th className="py-2.5 px-3 font-semibold text-right">95% Upper Bound</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono tabular-nums">
                              {forecastData.series
                                .filter((s) => s.split === 'future')
                                .map((pt) => (
                                  <tr key={pt.period} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                                    <td className="py-2 px-3 font-semibold text-slate-900 dark:text-slate-100">
                                      {pt.period}
                                    </td>
                                    <td className="py-2 px-3 text-right font-semibold text-emerald-600 dark:text-emerald-400">
                                      {formatCurrencyINR(pt.forecast_sales || 0)}
                                    </td>
                                    <td className="py-2 px-3 text-right text-slate-600 dark:text-slate-400">
                                      {formatCurrencyINR(pt.lower_bound || 0)}
                                    </td>
                                    <td className="py-2 px-3 text-right text-slate-600 dark:text-slate-400">
                                      {formatCurrencyINR(pt.upper_bound || 0)}
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      <div className="lg:col-span-5 space-y-3 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                        <h3 className="font-semibold text-slate-900 dark:text-slate-100">
                          Methodology & Baseline Model Limitations
                        </h3>
                        <p>{forecastData.methodology}</p>
                        <ul className="space-y-1.5 list-disc list-inside">
                          {forecastData.limitations.map((lim, i) => (
                            <li key={i}>{lim}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </>
                )}
              </section>

              {/* SECTION B: ISOLATION FOREST ANOMALY DETECTION */}
              <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-200 dark:divide-slate-800">
                <div className="p-6 flex flex-wrap items-center justify-between gap-4">
                  <div className="space-y-1">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                      02. Unusual Transaction Detection (Isolation Forest)
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Unsupervised ensemble of 100 Isolation Trees identifying unusual price, quantity, and total combinations
                    </p>
                  </div>

                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-slate-500 dark:text-slate-400">Contamination Sensitivity:</span>
                    <select
                      value={contamination}
                      onChange={(e) => setContamination(Number(e.target.value))}
                      className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md font-mono text-slate-800 dark:text-slate-100"
                    >
                      <option value={0.02}>2% (Strictest Outliers)</option>
                      <option value={0.04}>4% (Balanced Default)</option>
                      <option value={0.06}>6% (Broad Audit)</option>
                      <option value={0.1}>10% (Wide Screening)</option>
                    </select>
                  </div>
                </div>

                {anomalyData && (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800">
                      <div className="p-4 space-y-1">
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          Flagged Transactions
                        </div>
                        <div className="text-lg font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400">
                          {anomalyData.anomalies_detected} / {anomalyData.total_evaluated} (
                          {anomalyData.anomaly_rate_pct}%)
                        </div>
                      </div>
                      <div className="p-4 space-y-1">
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          Flagged Avg vs Normal Avg
                        </div>
                        <div className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                          {formatCurrencyINR(anomalyData.summary_stats.anomaly_avg_amount)} vs{' '}
                          {formatCurrencyINR(anomalyData.summary_stats.normal_avg_amount)}
                        </div>
                      </div>
                      <div className="p-4 space-y-1">
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          Highest Flagged Order
                        </div>
                        <div className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                          {formatCurrencyINR(anomalyData.summary_stats.max_anomaly_amount)}
                        </div>
                      </div>
                      <div className="p-4 space-y-1">
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          Primary Flagged Category
                        </div>
                        <div className="text-lg font-bold text-slate-900 dark:text-white">
                          {anomalyData.summary_stats.most_flagged_category}
                        </div>
                      </div>
                    </div>

                    <div className="p-6 space-y-4">
                      <AnomalyScatterPlot
                        points={anomalyData.scatter_sample}
                        thresholdScore={anomalyData.threshold_score}
                        onSelectTx={(txId) => setAnomalySearch(txId)}
                      />
                      <div className="p-3.5 bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-lg text-xs text-amber-900 dark:text-amber-200">
                        <strong>Important Interpretation Note: </strong>
                        {anomalyData.disclaimer}
                      </div>
                    </div>

                    <div className="p-6 space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          Flagged Unusual Transactions ({filteredAnomalies.length})
                        </h3>
                        <div className="relative w-64">
                          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                          <input
                            type="text"
                            value={anomalySearch}
                            onChange={(e) => setAnomalySearch(e.target.value)}
                            placeholder="Filter by Txn ID or Category..."
                            className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500"
                          />
                        </div>
                      </div>

                      <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300">
                              <th className="py-2.5 px-3 font-semibold">Txn ID</th>
                              <th className="py-2.5 px-3 font-semibold">Date</th>
                              <th className="py-2.5 px-3 font-semibold">Category</th>
                              <th className="py-2.5 px-3 font-semibold text-right">Qty</th>
                              <th className="py-2.5 px-3 font-semibold text-right">Unit Price</th>
                              <th className="py-2.5 px-3 font-semibold text-right">Total Amount</th>
                              <th className="py-2.5 px-3 font-semibold text-right">Anomaly Score</th>
                              <th className="py-2.5 px-3 font-semibold">Statistical Explanation</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                            {filteredAnomalies.slice(0, 30).map((a) => (
                              <tr key={a.transaction_id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                                <td className="py-2.5 px-3 font-mono font-semibold text-slate-900 dark:text-slate-100">
                                  {a.transaction_id}
                                </td>
                                <td className="py-2.5 px-3 font-mono tabular-nums text-slate-600 dark:text-slate-400">
                                  {a.date}
                                </td>
                                <td className="py-2.5 px-3 font-medium text-slate-900 dark:text-slate-100">
                                  {a.product_category}
                                </td>
                                <td className="py-2.5 px-3 font-mono tabular-nums text-right">
                                  {a.quantity}
                                </td>
                                <td className="py-2.5 px-3 font-mono tabular-nums text-right">
                                  {formatCurrencyINR(a.price_per_unit)}
                                </td>
                                <td className="py-2.5 px-3 font-mono tabular-nums text-right font-semibold text-amber-600 dark:text-amber-400">
                                  {formatCurrencyINR(a.total_amount)}
                                </td>
                                <td className="py-2.5 px-3 font-mono tabular-nums text-right text-slate-800 dark:text-slate-200">
                                  {a.anomaly_score}
                                </td>
                                <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400 max-w-md">
                                  {a.explanation}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                )}
              </section>
            </div>
          )
        )}

        {/* ================================================================
            VIEW 5: ASK YOUR DATA (NATURAL LANGUAGE BI — ZERO API KEY)
        ================================================================ */}
        {activePage === 'ask' && (
          !datasetMeta ? (
            renderEmptyDatasetPrompt('Natural-Language Data Querying ("Ask Your Data")')
          ) : (
            <div className="space-y-8">
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Read-Only Allowlisted SQL Grounding · Zero Hallucinated Numbers · Zero Cloud API Keys
                  </div>
                  <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                    Ask Your Data — Grounded Natural-Language Analytics
                  </h1>
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                  Engine: {aiStatus?.ollama_available ? `Ollama (${aiStatus.ollama_model})` : 'Deterministic SQL Grounding Engine (Zero API Key)'}
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-4">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleAskQuestion();
                  }}
                  className="flex flex-col sm:flex-row gap-3"
                >
                  <input
                    type="text"
                    value={questionInput}
                    onChange={(e) => setQuestionInput(e.target.value)}
                    placeholder="Ask a question about your uploaded dataset (e.g., total sales, top category, monthly trend, anomalies)..."
                    className="flex-1 px-4 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
                  />
                  <button
                    type="submit"
                    disabled={askingAi || !questionInput.trim()}
                    className="px-5 py-2.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" />
                    {askingAi ? 'Querying SQLite...' : 'Ask Question'}
                  </button>
                </form>

                <div className="space-y-2">
                  <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    Suggested analytical questions for {datasetMeta.filename}:
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {SUGGESTED_QUESTIONS.map((sq) => (
                      <button
                        key={sq}
                        onClick={() => handleAskQuestion(sq)}
                        disabled={askingAi}
                        className="px-3 py-1.5 text-xs text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md transition-colors cursor-pointer"
                      >
                        {sq}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {qaHistory.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg">
                  Select a suggested question above or type your own question to execute a verified read-only query against {datasetMeta.filename}.
                </div>
              ) : (
                <div className="space-y-6">
                  {qaHistory.map((item, idx) => (
                    <div
                      key={`${item.answered_at}-${idx}`}
                      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-200 dark:divide-slate-800"
                    >
                      <div className="p-5 flex flex-wrap items-center justify-between gap-2 bg-slate-50/60 dark:bg-slate-800/40">
                        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          Q: {item.question}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                          Intent: {item.intent} · {item.engine_used}
                        </div>
                      </div>

                      <div className="p-6 space-y-5">
                        <div className="text-sm text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-line">
                          {item.answer}
                        </div>

                        {item.key_metrics && item.key_metrics.length > 0 && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
                            {item.key_metrics.map((km, mIdx) => (
                              <div
                                key={mIdx}
                                className="p-3.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg space-y-1"
                              >
                                <div className="text-xs text-slate-500 dark:text-slate-400">
                                  {km.label}
                                </div>
                                <div className="text-sm font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                                  {km.value}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {item.recommendations && item.recommendations.length > 0 && (
                          <div className="space-y-1.5 pt-2">
                            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                              Data-Backed Business Recommendations:
                            </div>
                            <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-400 list-disc list-inside">
                              {item.recommendations.map((rec, rIdx) => (
                                <li key={rIdx}>{rec}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        <div className="pt-2">
                          <div className="text-[11px] font-mono bg-slate-900 dark:bg-slate-950 text-slate-200 px-3.5 py-2 rounded-md overflow-x-auto border border-slate-800">
                            Executed Read-Only Plan: {item.executed_plan}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        )}

        {/* ================================================================
            VIEW 6: EXECUTIVE PDF REPORTS
        ================================================================ */}
        {activePage === 'reports' && (
          !datasetMeta ? (
            renderEmptyDatasetPrompt('Executive PDF Report Generation')
          ) : (
            <div className="space-y-8">
              <div className="space-y-1">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Automated Executive Deliverable · Dynamic KPI & ML Synthesis · Multi-Page PDF
                </div>
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                  Generate & Download Executive PDF Business Report
                </h1>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-5 h-fit">
                  <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    Report Configuration
                  </h2>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Report Title
                    </label>
                    <input
                      type="text"
                      value={reportTitle}
                      onChange={(e) => setReportTitle(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Prepared For / Organization
                    </label>
                    <input
                      type="text"
                      value={reportPreparedFor}
                      onChange={(e) => setReportPreparedFor(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                    />
                  </div>

                  <div className="space-y-2 pt-2">
                    <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      Included Report Sections
                    </div>
                    <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeForecast}
                        onChange={(e) => setIncludeForecast(e.target.checked)}
                      />
                      <span>Include OLS Linear Regression Sales Forecast & Evaluation</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeAnomalies}
                        onChange={(e) => setIncludeAnomalies(e.target.checked)}
                      />
                      <span>Include Isolation Forest Anomaly Summary & Flagged Records</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeInsights}
                        onChange={(e) => setIncludeInsights(e.target.checked)}
                      />
                      <span>Include Grounded Business Recommendations & Methodology</span>
                    </label>
                  </div>

                  <button
                    onClick={handleDownloadPdf}
                    disabled={generatingPdf}
                    className="w-full py-2.5 px-4 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    <Download className="w-4 h-4" />
                    {generatingPdf ? 'Compiling PDF Document...' : 'Generate & Download PDF Report'}
                  </button>

                  {pdfMessage && (
                    <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-md text-xs text-emerald-900 dark:text-emerald-200">
                      {pdfMessage}
                    </div>
                  )}
                </div>

                <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-200 dark:divide-slate-800">
                  <div className="p-6 bg-slate-900 dark:bg-slate-950 text-white rounded-t-lg space-y-1">
                    <div className="text-xs text-slate-400">LIVE EXECUTIVE REPORT PREVIEW</div>
                    <h3 className="text-lg font-bold">{reportTitle}</h3>
                    <div className="text-xs text-slate-300 font-mono">
                      Dataset: {datasetMeta.filename} · Period: {kpis?.date_range.start} to{' '}
                      {kpis?.date_range.end}
                    </div>
                  </div>

                  <div className="p-6 space-y-6 text-xs">
                    <div className="space-y-2">
                      <h4 className="font-semibold text-slate-900 dark:text-slate-100">
                        1. Key Performance Indicators (Active Dataset)
                      </h4>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono tabular-nums">
                        <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded border border-slate-200 dark:border-slate-700">
                          <div className="text-slate-500 dark:text-slate-400">Total Sales</div>
                          <div className="text-sm font-bold text-slate-900 dark:text-white">
                            {formatCurrencyINR(kpis?.total_sales || 0)}
                          </div>
                        </div>
                        <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded border border-slate-200 dark:border-slate-700">
                          <div className="text-slate-500 dark:text-slate-400">Total Quantity</div>
                          <div className="text-sm font-bold text-slate-900 dark:text-white">
                            {(kpis?.total_quantity || 0).toLocaleString('en-IN')}
                          </div>
                        </div>
                        <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded border border-slate-200 dark:border-slate-700">
                          <div className="text-slate-500 dark:text-slate-400">Transactions</div>
                          <div className="text-sm font-bold text-slate-900 dark:text-white">
                            {(kpis?.total_transactions || 0).toLocaleString('en-IN')}
                          </div>
                        </div>
                        <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded border border-slate-200 dark:border-slate-700">
                          <div className="text-slate-500 dark:text-slate-400">Avg Order Value</div>
                          <div className="text-sm font-bold text-slate-900 dark:text-white">
                            {formatCurrencyINR(kpis?.avg_transaction_value || 0)}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <h4 className="font-semibold text-slate-900 dark:text-slate-100">
                        2. Category Performance Breakdown
                      </h4>
                      <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded">
                        {categorySales.map((c) => (
                          <div key={c.category} className="p-2.5 flex items-center justify-between">
                            <span className="font-medium text-slate-900 dark:text-slate-100">
                              {c.category}
                            </span>
                            <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                              {formatCurrencyINR(c.total_sales)} ({c.revenue_share_pct}%) ·{' '}
                              {c.total_quantity} units
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {includeForecast && forecastData?.available && (
                      <div className="space-y-1.5">
                        <h4 className="font-semibold text-slate-900 dark:text-slate-100">
                          3. Sales Forecast Summary (+{forecastData.horizon} {forecastData.interval} periods)
                        </h4>
                        <p className="text-slate-600 dark:text-slate-400 font-mono tabular-nums">
                          Projected Total: {formatCurrencyINR(forecastData.metrics.projected_horizon_total)} · Holdout MAE: {formatCurrencyINR(forecastData.metrics.mae || 0)} · RMSE: {formatCurrencyINR(forecastData.metrics.rmse || 0)}
                        </p>
                      </div>
                    )}

                    {includeAnomalies && anomalyData?.available && (
                      <div className="space-y-1.5">
                        <h4 className="font-semibold text-slate-900 dark:text-slate-100">
                          4. Isolation Forest Anomaly Summary
                        </h4>
                        <p className="text-slate-600 dark:text-slate-400 font-mono tabular-nums">
                          Flagged {anomalyData.anomalies_detected} of {anomalyData.total_evaluated} records ({anomalyData.anomaly_rate_pct}%) · Avg Flagged Order: {formatCurrencyINR(anomalyData.summary_stats.anomaly_avg_amount)}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        )}

        {/* ================================================================
            VIEW 7: SETTINGS, DATASET MANAGEMENT & COLLEGE VIVA DELIVERABLES
        ================================================================ */}
        {activePage === 'settings' && (
          <div className="space-y-8">
            <div className="space-y-1">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                System Configuration · Local AI Engine Status · Dataset Version History · B.Tech Viva Guide
              </div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                Platform Settings & Project Documentation
              </h1>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* AI Backend Status Card */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    Ollama Cloud AI & SQL Grounding Status (Zero Laptop GPU/RAM Load)
                  </h2>
                  <button
                    onClick={() => biApi.getAiStatus().then(setAiStatus)}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" /> Re-check
                  </button>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800">
                    <span className="text-slate-500 dark:text-slate-400">Ollama Cloud Endpoint</span>
                    <span className="font-mono text-slate-800 dark:text-slate-200">
                      {aiStatus?.ollama_url || 'https://ollama.com'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800">
                    <span className="text-slate-500 dark:text-slate-400">Target Cloud Model</span>
                    <span className="font-mono text-slate-800 dark:text-slate-200">
                      {aiStatus?.ollama_model || 'gpt-oss:120b'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800">
                    <span className="text-slate-500 dark:text-slate-400">Ollama Cloud Status</span>
                    <span className="font-mono text-slate-800 dark:text-slate-200">
                      {aiStatus?.ollama_available ? 'Connected (Cloud Online)' : 'Using Built-in SQL Grounding Engine'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-slate-500 dark:text-slate-400">Deterministic SQL Grounding</span>
                    <span className="font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                      Active
                    </span>
                  </div>
                </div>

                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  {aiStatus?.status_message}
                </p>
              </div>

              {/* Dataset Version Management */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    Uploaded SQLite Datasets ({datasetHistory.length})
                  </h2>
                  {datasetHistory.length > 0 && (
                    <button
                      onClick={handleClearWorkspace}
                      className="px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 rounded-md hover:bg-red-100 cursor-pointer"
                    >
                      Clear All Datasets
                    </button>
                  )}
                </div>

                {datasetHistory.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg">
                    No datasets currently stored in SQLite. Upload a CSV file on the Upload page to populate the database.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs max-h-52 overflow-y-auto">
                    {datasetHistory.map((d) => (
                      <div key={d.id} className="py-2.5 flex items-center justify-between gap-3">
                        <div>
                          <div className="font-medium text-slate-900 dark:text-slate-100">
                            #{d.id} · {d.filename}{' '}
                            {d.is_active && (
                              <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                                (Active)
                              </span>
                            )}
                          </div>
                          <div className="text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                            {d.rows_accepted} valid rows · {d.min_date} to {d.max_date}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {!d.is_active && (
                            <button
                              onClick={async () => {
                                await biApi.activateDataset(d.id);
                                await loadAllPlatformData();
                              }}
                              className="px-2.5 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60 rounded hover:bg-blue-100 cursor-pointer"
                            >
                              Activate
                            </button>
                          )}
                          <button
                            onClick={async () => {
                              await biApi.deleteDataset(d.id);
                              await loadAllPlatformData();
                            }}
                            className="px-2 py-1 text-xs text-red-600 dark:text-red-400 hover:underline cursor-pointer"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <VivaDocsPanel />
          </div>
        )}
      </main>

      {/* ====================================================================
          QUIET PROFESSIONAL WEBSITE FOOTER
      ==================================================================== */}
      <footer className="mt-auto border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B0F19]">
        <div className="max-w-[1440px] mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-3">
            <span className="font-bold text-slate-900 dark:text-white font-display">
              Autonomous BI
            </span>
            <span aria-hidden="true">·</span>
            <span>Enterprise Retail Analytics & Machine Learning Platform</span>
          </div>
          <div className="flex flex-wrap items-center gap-5">
            <button
              onClick={() => setActivePage('dashboard')}
              className="hover:text-slate-900 dark:hover:text-white cursor-pointer"
            >
              Overview
            </button>
            <button
              onClick={() => setActivePage('upload')}
              className="hover:text-slate-900 dark:hover:text-white cursor-pointer"
            >
              Upload CSV
            </button>
            <button
              onClick={() => setActivePage('ml')}
              className="hover:text-slate-900 dark:hover:text-white cursor-pointer"
            >
              ML Forecasting
            </button>
            <button
              onClick={() => setActivePage('settings')}
              className="hover:text-slate-900 dark:hover:text-white cursor-pointer"
            >
              Architecture & Viva Docs
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
