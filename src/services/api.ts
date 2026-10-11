export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

export interface FilterQuery {
  category?: string;
  startDate?: string;
  endDate?: string;
  gender?: string;
  search?: string;
}

export interface AuthUser {
  id: number;
  full_name: string;
  email: string;
  role: string;
  created_at: string;
}

export interface DatasetMeta {
  id: number;
  filename: string;
  uploaded_at: string;
  total_rows_read: number;
  rows_accepted: number;
  rows_cleaned: number;
  rows_rejected: number;
  duplicates_removed: number;
  formula_corrections: number;
  missing_imputed: number;
  min_date: string;
  max_date: string;
  issues?: {
    rowNumber: number;
    transactionId: string;
    action: 'cleaned' | 'rejected';
    field: string;
    reason: string;
    originalValue?: string;
    correctedValue?: string;
  }[];
  is_active: boolean;
}

export interface RetailTransaction {
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

export interface DashboardKpis {
  dataset_id: number;
  filename: string;
  total_sales: number;
  total_quantity: number;
  total_transactions: number;
  avg_transaction_value: number;
  min_transaction_value: number;
  max_transaction_value: number;
  unique_customers: number;
  active_categories: number;
  top_category: string;
  top_category_sales: number;
  date_range: {
    start: string;
    end: string;
  };
}

export interface SalesTrendPoint {
  period: string;
  period_start_date: string;
  total_sales: number;
  total_quantity: number;
  transaction_count: number;
  avg_order_value: number;
}

export interface CategorySalesItem {
  category: string;
  total_sales: number;
  total_quantity: number;
  transaction_count: number;
  avg_transaction_value: number;
  avg_unit_price: number;
  revenue_share_pct: number;
}

export interface ForecastResponse {
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
  series: {
    period: string;
    actual_sales: number | null;
    fitted_sales: number;
    forecast_sales: number | null;
    lower_bound: number | null;
    upper_bound: number | null;
    split: 'train' | 'test' | 'future';
  }[];
  methodology: string;
  limitations: string[];
}

export interface AnomalyRecord extends RetailTransaction {
  anomaly_score: number;
  decision_score: number;
  avg_path_length: number;
  severity: 'High Deviation' | 'Moderate Deviation';
  reasons: string[];
  explanation: string;
}

export interface AnomalyResponse {
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

export interface AiBackendStatus {
  ollama_url: string;
  ollama_model: string;
  ollama_available: boolean;
  ollama_models_installed: string[];
  gemini_fallback_available: boolean;
  deterministic_engine_active: boolean;
  active_mode: 'ollama_local' | 'gemini_free_cloud' | 'deterministic_grounded_engine';
  status_message: string;
}

export interface AiQueryResult {
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

export interface BusinessInsightCard {
  id: string;
  category: 'Revenue Leader' | 'Temporal Trend' | 'Anomaly Alert' | 'Growth Opportunity' | 'Forecast Outlook';
  title: string;
  finding: string;
  evidence: string;
  recommendation: string;
  uncertainty_note: string;
}

function buildQueryString(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '' && v !== 'All') {
      sp.set(k, String(v));
    }
  }
  const str = sp.toString();
  return str ? `?${str}` : '';
}

function getStoredAuthToken(): string {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('abi_auth_token') || '';
  }
  return '';
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getStoredAuthToken();
  const headers = new Headers(init?.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed with HTTP ${response.status}`);
  }
  return data as T;
}

export const biApi = {
  registerUser: (payload: {
    full_name: string;
    email: string;
    password: string;
    role?: string;
  }) =>
    requestJson<{
      authenticated: boolean;
      message: string;
      user: AuthUser;
      token: string;
    }>('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  loginUser: (payload: { email: string; password: string }) =>
    requestJson<{
      authenticated: boolean;
      message: string;
      user: AuthUser;
      token: string;
    }>('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  getCurrentUser: (token: string) =>
    requestJson<{
      authenticated: boolean;
      user: AuthUser | null;
    }>('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    }),

  logoutUser: (token: string) =>
    requestJson<{
      logged_out: boolean;
      message: string;
    }>('/api/auth/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ token }),
    }),

  getHealth: () =>
    requestJson<{
      status: string;
      service: string;
      timestamp: string;
      database_connected: boolean;
      active_dataset: string | null;
      active_rows: number;
      ai_backend: AiBackendStatus;
    }>('/api/health'),

  getDataStatus: () =>
    requestJson<{
      has_dataset: boolean;
      active_dataset: DatasetMeta | null;
      datasets: DatasetMeta[];
    }>('/api/data/status'),

  getDataPreview: (limit = 25, offset = 0, filters: FilterQuery = {}) =>
    requestJson<{
      total: number;
      rows: RetailTransaction[];
      categories: string[];
    }>(`/api/data/preview${buildQueryString({ limit, offset, ...filters })}`),

  uploadCsvFile: async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      throw new Error('Please select a valid .csv file.');
    }
    if (file.size > 15 * 1024 * 1024) {
      throw new Error('File exceeds maximum allowed size of 15 MB.');
    }
    const formData = new FormData();
    formData.append('file', file);
    return requestJson<{
      valid: boolean;
      message: string;
      dataset: DatasetMeta;
      cleaning_summary: {
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
      };
      kpis: DashboardKpis;
      preview: RetailTransaction[];
    }>('/api/upload', {
      method: 'POST',
      body: formData,
    });
  },

  uploadPastedCsv: (csvContent: string, filename = 'pasted_spreadsheet.csv') =>
    requestJson<{
      valid: boolean;
      message: string;
      dataset: DatasetMeta;
      cleaning_summary: {
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
      };
      kpis: DashboardKpis;
      preview: RetailTransaction[];
    }>('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csvContent, filename }),
    }),

  addManualTransaction: (tx: {
    transaction_id?: string;
    date: string;
    customer_id?: string;
    gender?: string;
    age?: number;
    product_category: string;
    quantity: number;
    price_per_unit: number;
  }) =>
    requestJson<{
      valid: boolean;
      message: string;
      dataset: DatasetMeta;
    }>('/api/transactions/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tx),
    }),

  loadPresetDataset: (preset: 'clean' | 'dirty') =>
    requestJson<{
      valid: boolean;
      message: string;
      dataset: DatasetMeta;
      cleaning_summary: {
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
      };
    }>('/api/datasets/load-preset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset }),
    }),

  activateDataset: (datasetId: number) =>
    requestJson<{ active_dataset: DatasetMeta }>(`/api/datasets/activate/${datasetId}`, {
      method: 'POST',
    }),

  clearDatasets: () =>
    requestJson<{ cleared: boolean; message: string }>('/api/datasets/clear', {
      method: 'POST',
    }),

  deleteDataset: (datasetId: number) =>
    requestJson<{
      deleted: boolean;
      active_dataset: DatasetMeta | null;
      datasets: DatasetMeta[];
    }>(`/api/datasets/${datasetId}`, {
      method: 'DELETE',
    }),

  getDashboardKpis: (filters: FilterQuery = {}) =>
    requestJson<DashboardKpis>(`/api/dashboard/kpis${buildQueryString({ ...filters })}`),

  getSalesTrend: (interval: 'daily' | 'weekly' | 'monthly' = 'monthly', filters: FilterQuery = {}) =>
    requestJson<{ interval: string; series: SalesTrendPoint[] }>(
      `/api/dashboard/sales-trend${buildQueryString({ interval, ...filters })}`
    ),

  getCategorySales: (filters: FilterQuery = {}) =>
    requestJson<{ categories: CategorySalesItem[] }>(
      `/api/dashboard/category-sales${buildQueryString({ ...filters })}`
    ),

  getSalesAnalysis: (interval: 'daily' | 'weekly' | 'monthly' = 'monthly', filters: FilterQuery = {}) =>
    requestJson<{
      kpis: DashboardKpis;
      interval: string;
      trend: SalesTrendPoint[];
      categories: CategorySalesItem[];
      breakdowns: {
        by_gender: {
          gender: string;
          total_sales: number;
          total_quantity: number;
          transaction_count: number;
          avg_order_value: number;
        }[];
        by_age_group: {
          age_group: string;
          total_sales: number;
          total_quantity: number;
          transaction_count: number;
          avg_order_value: number;
        }[];
        by_day_of_week: {
          day_name: string;
          total_sales: number;
          transaction_count: number;
          avg_order_value: number;
        }[];
        category_monthly: {
          month: string;
          category: string;
          total_sales: number;
        }[];
      };
    }>(`/api/sales-analysis${buildQueryString({ interval, ...filters })}`),

  getForecast: (
    interval: 'daily' | 'weekly' | 'monthly' = 'monthly',
    horizon = 6,
    filters: FilterQuery = {}
  ) =>
    requestJson<ForecastResponse>(
      `/api/forecast${buildQueryString({ interval, horizon, ...filters })}`
    ),

  getAnomalies: (contamination = 0.04, filters: FilterQuery = {}) =>
    requestJson<AnomalyResponse>(
      `/api/anomalies${buildQueryString({ contamination, ...filters })}`
    ),

  getAiStatus: () => requestJson<AiBackendStatus>('/api/ai/status'),

  askDataQuestion: (question: string, filters: FilterQuery = {}) =>
    requestJson<AiQueryResult>('/api/ai/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, filters }),
    }),

  getAiInsights: (filters: FilterQuery = {}) =>
    requestJson<{
      generated_at: string;
      engine_used: string;
      insights: BusinessInsightCard[];
    }>(`/api/ai/insights${buildQueryString({ ...filters })}`),

  downloadPdfReport: async (config: {
    title?: string;
    prepared_for?: string;
    include_forecast?: boolean;
    include_anomalies?: boolean;
    include_insights?: boolean;
    forecast_horizon?: number;
    anomaly_contamination?: number;
    filters?: FilterQuery;
  }) => {
    const token = getStoredAuthToken();
    const response = await fetch(`${API_BASE_URL}/api/reports/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(config),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to generate PDF report.');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Autonomous_BI_Report_${new Date().toISOString().slice(0, 10)}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};
