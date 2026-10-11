# Autonomous Business Intelligence Platform — Complete College Project Documentation

## 1. Abstract
Small and medium-sized retail enterprises generate substantial transactional data daily yet struggle to extract actionable insights because traditional Business Intelligence (BI) suites require SQL proficiency, manual dashboard configuration, and data science expertise. The **Autonomous Business Intelligence Platform** solves this challenge by providing an end-to-end, AI-driven web platform where a non-technical user simply uploads a retail sales CSV file (`dataset/retail_sales.csv`). The system autonomously validates and cleans the dataset, persists records in SQLite with dataset-version isolation, computes real-time executive KPIs, visualizes chronological trends and category performance, forecasts future revenue via chronologically split Ordinary Least Squares (OLS) Linear Regression, isolates statistically unusual transactions via an unsupervised Isolation Forest ensemble, answers natural-language questions grounded strictly in verified SQL aggregations (supporting local Ollama `llama3.2:3b` and a zero-cost deterministic engine), and compiles downloadable multi-page executive PDF business reports.

---

## 2. Problem Statement & Objectives
### Problem Statement
Traditional BI platforms (Tableau, Power BI, Looker) assume clean schemas and require manual chart authoring. Small retail businesses face:
1. Unclean spreadsheets containing duplicate transaction IDs, missing fields, or arithmetic discrepancies (`Quantity × Price per Unit ≠ Total Amount`).
2. Inability to forecast future cash flows or spot unusual bulk/outlier transactions without hiring a data analyst.
3. Risk of numerical hallucinations when pasting raw spreadsheets into general-purpose chatbots.

### Core Objectives
1. **Automated Data Hygiene**: Validate CSV headers, normalize date and currency formats, repair formula discrepancies non-destructively, and report accepted, cleaned, and rejected rows.
2. **Versioned SQLite Storage**: Store cleaned transactions using parameterized queries without mixing new uploads with historical datasets.
3. **Interactive Executive BI**: Compute live KPIs (Total Sales: `₹4,56,000`, Total Quantity: `2,514`, Total Transactions: `1,000`, Average Transaction Value: `₹456` on the reference dataset) with dynamic slicing by Product Category and Date Range.
4. **Chronological Machine Learning Forecasting**: Aggregate transactions by day, week, or month; split chronologically (80% training, 20% holdout evaluation); fit OLS Linear Regression with cyclical features; report MAE, RMSE, and $R^2$; and project configurable future horizons with 95% confidence intervals.
5. **Unsupervised Anomaly Detection**: Train a 100-tree Isolation Forest (`contamination = 0.04` default) on transaction features to surface unusual records with human-readable statistical explanations.
6. **Grounded Natural-Language Analytics ("Ask Your Data")**: Combine deterministic read-only SQL execution plans with local Ollama (`llama3.2:3b`) or free-tier cloud inference so the system never invents numbers.
7. **Executive PDF Report Generation**: Dynamically compile KPIs, category breakdowns, forecast tables, flagged anomalies, and methodology disclaimers into a downloadable PDF.

---

## 3. System Architecture & Technology Stack
```
+-------------------------------------------------------------------------+
|                    React Web Platform (Frontend SPA)                    |
|  Dashboard | Upload CSV | Sales Analysis | Forecast & Anomalies | Ask   |
+------------------------------------+------------------------------------+
                                     | REST JSON & Multipart API (/api/*)
+------------------------------------v------------------------------------+
|                  Modular Application Backend Server                     |
|  - DataCleaner: Header alias mapping, date/numeric coercion, audit log  |
|  - ML Engine: OLS Linear Regression (80/20 split) + Isolation Forest    |
|  - AI Engine: Read-Only SQL Planner + Ollama (llama3.2:3b) / Free LLM   |
|  - PDF Service: Dynamic multi-page Executive PDF Report compiler        |
+------------------------------------+------------------------------------+
                                     | Parameterized SQL (?)
+------------------------------------v------------------------------------+
|                 SQLite Relational Database (WAL Mode)                   |
|  Tables: datasets (version metadata) | sales_transactions (clean rows)  |
+-------------------------------------------------------------------------+
```

---

## 4. Database Schema
### Table 1: `datasets`
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `INTEGER PRIMARY KEY` | Unique dataset upload identifier |
| `filename` | `TEXT NOT NULL` | Uploaded CSV file name |
| `uploaded_at` | `TEXT NOT NULL` | ISO-8601 UTC timestamp |
| `total_rows_read` | `INTEGER NOT NULL` | Raw data rows read from CSV |
| `rows_accepted` | `INTEGER NOT NULL` | Valid rows stored in `sales_transactions` |
| `rows_cleaned` | `INTEGER NOT NULL` | Rows repaired (e.g., formula or median age imputation) |
| `rows_rejected` | `INTEGER NOT NULL` | Rows skipped (duplicate IDs, unparseable dates, non-positive qty) |
| `is_active` | `INTEGER NOT NULL` | `1` for currently selected dataset, `0` for archived uploads |

### Table 2: `sales_transactions`
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `INTEGER PRIMARY KEY` | Internal row primary key |
| `dataset_id` | `INTEGER NOT NULL` | Foreign key referencing `datasets(id)` |
| `transaction_id` | `TEXT NOT NULL` | Retail Transaction ID (e.g., `TXN-0001`) |
| `date` | `TEXT NOT NULL` | Normalized ISO date (`YYYY-MM-DD`) |
| `customer_id` | `TEXT NOT NULL` | Customer identifier (`CUST-001`) |
| `gender` | `TEXT NOT NULL` | Standardized Customer Gender (`Female`, `Male`, `Unspecified`) |
| `age` | `INTEGER NOT NULL` | Validated Customer Age (`12–105`, median `35` imputed if missing) |
| `product_category` | `TEXT NOT NULL` | Department (`Electronics`, `Clothing`, `Beauty`, etc.) |
| `quantity` | `INTEGER NOT NULL` | Positive integer units purchased |
| `price_per_unit` | `REAL NOT NULL` | Positive unit price in ₹ |
| `total_amount` | `REAL NOT NULL` | Verified `quantity × price_per_unit` in ₹ |

---

## 5. Machine Learning Methodology & Limitations

### 5.1 Sales Forecasting (OLS Linear Regression)
1. **Temporal Aggregation**: Transactions are grouped chronologically by `daily`, `weekly`, or `monthly` period.
2. **Feature Construction**: Linear time index $t \in \{0, 1, \dots, N-1\}$ and Fourier seasonal harmonics $\sin(2\pi t / P), \cos(2\pi t / P)$ when $N \ge 10$.
3. **Chronological Validation**: First 80% of periods train the model; final 20% evaluate out-of-sample **MAE** and **RMSE**.
4. **Limitations**: Baseline Linear Regression assumes trend continuity and cannot anticipate stockouts, competitor pricing changes, or macroeconomic shocks.

### 5.2 Anomaly Detection (Isolation Forest)
1. **Feature Vector**: `[total_amount, quantity, price_per_unit, category_amount_zscore, category_price_zscore]`.
2. **Ensemble Construction**: $T = 100$ randomized Isolation Trees (`iTree`) with sub-sampling size $\psi = \min(256, N)$.
3. **Scoring**: Anomaly score $s(x, \psi) = 2^{-E(h(x)) / c(\psi)}$. Top `contamination` fraction (default 4%) are flagged for review.
4. **Interpretation Disclaimer**: Flagged records represent unusual statistical behavior (such as bulk B2B orders or flagship items), not proof of fraud.

---

## 6. Deployment Guide (Vercel + Render + Local Ollama)
1. **Local Development**:
   - Start Ollama (optional): `ollama serve` and `ollama pull llama3.2:3b`.
   - Start Full-Stack Web Server: `npm run dev` (runs on `http://localhost:3000`).
2. **Production Deployment**:
   - Configure `VITE_API_BASE_URL` on Vercel if hosting frontend separately, or deploy the unified full-stack Node/FastAPI service on Render/Cloud Run with persistent disk mounted at `/data`.
   - Never expose local `localhost:11434` directly to the public internet without authentication; use the built-in server-side deterministic SQL grounding engine + optional server-side free cloud LLM key in production.
