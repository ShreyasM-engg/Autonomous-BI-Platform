# Autonomous Business Intelligence (ABI) Platform

An end-to-end, full-stack **Autonomous Business Intelligence (ABI)** web application built with **React 19, TypeScript, Tailwind CSS, Express, and SQLite (`better-sqlite3`)**. The platform transforms raw CSV datasets into validated relational tables, executive KPIs, statistical anomalies, revenue forecasts, plain-English SQL answers, and downloadable PDF business reports — operating **100% locally with zero paid API keys required**.

---

## Key Features

### 1. Strict Session Authentication & Input Validation
- **Protected Workspace & API**: Every workspace view and `/api/*` data endpoint requires a valid `Bearer` session token stored in SQLite (`user_sessions` joined with `users`). Unauthenticated requests receive `401 Unauthorized`.
- **Sign In & Sign Up Validation**:
  - **Full Name**: Minimum 2 characters, must contain alphabetic characters.
  - **Email Address**: Normalized and validated against RFC-compliant email syntax (`/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/`).
  - **Password Strength**: Minimum 8 characters, requiring at least one uppercase letter, one lowercase letter, and one number.
  - **Cryptographic Storage**: Passwords are salted and hashed using Node's native `crypto.scryptSync` before persistence in `abi_platform.sqlite`.

### 2. Universal CSV Ingestion & Non-Destructive Hygiene Engine
- **3-Pass Automatic Schema Inference (`server/dataCleaner.ts`)**:
  - **Pass 1 (Header Alias Matching)**: Recognizes standard retail, e-commerce, financial, SaaS, and operational column names (`date`, `timestamp`, `category`, `department`, `region`, `quantity`, `units`, `price`, `total`, `revenue`, `sales`, `amount`, etc.).
  - **Pass 2 (Substring Keyword Matching)**: Matches composite headers such as `Order_Date_UTC`, `Product_Department`, or `Gross_Sales_Amount`.
  - **Pass 3 (Data-Type Heuristics)**: Inspects sample rows to automatically detect date columns, categorical grouping dimensions, and numeric metric columns even when headers are unfamiliar.
- **Automated Data Cleaning**:
  - Normalizes dates (`YYYY-MM-DD`, `DD/MM/YYYY`, `YYYY/MM/DD`, `Month DD, YYYY`, or 4-digit years) to ISO-8601.
  - Deduplicates repeated transaction IDs to prevent double-counting revenue.
  - Reconciles `Total Amount = Quantity × Price per Unit` and imputes missing categories or demographic fields with full row-level audit logs.

### 3. Executive Dashboard & Deep-Dive Analytics
- **Executive KPIs**: Total Sales Revenue (`₹`), Total Quantity Sold, Total Transactions, Unique Customers, and Average Transaction Value.
- **Interactive Filtering**: Global filter bar for Category, Date Range (`From` / `To`), and aggregation interval (`Daily`, `Weekly`, `Monthly`).
- **Demographic & Category Breakdowns**: Revenue share by category, age-group distribution, gender split, and monthly progression charts powered by Recharts.

### 4. Statistical Anomaly Detection
- **Rolling Z-Score & IQR Guardrails**: Evaluates daily revenue series against a 14-day rolling mean and standard deviation (`|Z| >= 2.0`) alongside Interquartile Range (IQR) fences.
- **Root-Cause Diagnostics**: Automatically attributes revenue spikes and drops to the primary driving product category and transaction volume shift on that date.

### 5. Multi-Horizon Time-Series Forecasting with Step-by-Step Explanations
- **Holt-Winters Additive Trend + Day-of-Week Seasonality**: Generates 7-day, 14-day, 30-day, 60-day, and 90-day projections with 95% confidence bands (`±1.96 × RMSE × √(1 + h/N)`).
- **Holdout Backtesting**: Evaluates last-14-day holdout accuracy using **MAPE (%)**, **RMSE (₹)**, and **MAE (₹)**.
- **Plain-English Forecast Guide**: Translates forecast trajectory, seasonal peaks/dips, confidence bands, and error metrics into clear business recommendations.

### 6. Zero-Key Natural Language to SQL (NL-to-SQL) Assistant
- **Local Ollama Integration (`llama3.2:3b` / `qwen2.5-coder`)**: Connects to `http://127.0.0.1:11434` when available, with an automatic deterministic SQL compiler fallback so queries always succeed offline.
- **Read-Only SQLite Sandbox**: Enforces strict `SELECT`-only guardrails against the active `transactions` table and returns the exact SQL query, result table, and narrative synthesis.

### 7. Automated Executive PDF Report Generator
- Compiles a multi-section executive briefing (Dataset Hygiene Summary, KPIs, Category Breakdown, Anomalies, Forecast Outlook, and Strategic Recommendations) and exports a formatted PDF document via `jsPDF`.

---

## Tech Stack

| Layer | Technology |
| :--- | :--- |
| **Frontend** | React 19, TypeScript, Vite, Tailwind CSS 4, Recharts, Lucide React, jsPDF |
| **Backend** | Node.js, Express, TypeScript (`tsx`) |
| **Database** | SQLite (`better-sqlite3`) with WAL mode (`abi_platform.sqlite`) |
| **Analytics Engine** | Custom TypeScript statistical modules (Holt-Winters, Rolling Z-Score, IQR, Holdout Backtesting) |
| **Local AI (Optional)** | Ollama (`http://127.0.0.1:11434`) + Built-in Deterministic NL-to-SQL Fallback |

---

## Project Structure

```text
├── server.ts                  # Express API server, auth middleware, and Vite middleware integration
├── server/
│   ├── auth.ts                # Scrypt password hashing, input validation, and session token management
│   ├── dataCleaner.ts         # Universal 3-pass CSV schema inference and row-level hygiene engine
│   ├── database.ts            # SQLite schema initialization, KPI queries, and dataset storage
│   ├── analyticsEngine.ts     # Holt-Winters forecasting, Z-Score/IQR anomaly detection, & recommendations
│   └── nlQueryEngine.ts       # Local Ollama NL-to-SQL generator, deterministic fallback, & SQL sandbox
├── src/
│   ├── App.tsx                # Authenticated ABI workspace, dashboards, charts, and interactive modules
│   ├── services/api.ts        # Typed API client with automatic Bearer token injection
│   └── index.css              # Tailwind CSS configuration and typography rules
└── package.json               # Scripts and dependencies
```

---

## Getting Started

### Prerequisites
- **Node.js** v18+ and **npm**
- *(Optional)* **Ollama** running locally (`ollama serve` and `ollama pull llama3.2:3b`) for local LLM SQL synthesis. The platform automatically uses its deterministic SQL compiler when Ollama is offline.

### Installation & Local Development

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Start the full-stack development server** (runs Express + Vite on port `3000`):
   ```bash
   npm run dev
   ```

3. **Open the application**:
   Navigate to `http://localhost:3000` in your browser, create an account on the **Sign Up** tab (or sign in with an existing account), and upload any CSV dataset to begin analysis.

### Production Build & Type Check

```bash
# Run TypeScript compiler verification
npm run lint

# Build production frontend bundle
npm run build

# Start production server
npm start
```
