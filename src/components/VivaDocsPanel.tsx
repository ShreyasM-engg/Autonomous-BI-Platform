import React, { useState } from 'react';

export const VivaDocsPanel: React.FC = () => {
  const [activeTab, setActiveTab] = useState<
    'audit' | 'architecture' | 'viva' | 'demo' | 'fastapi'
  >('audit');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-lg w-fit">
        {[
          { id: 'audit', label: '01. System Overview & Hygiene' },
          { id: 'architecture', label: '02. System Architecture & ML Math' },
          { id: 'viva', label: '03. B.Tech Viva Q&A (8 Questions)' },
          { id: 'demo', label: '04. Evaluation Demo Script' },
          { id: 'fastapi', label: '05. Python FastAPI & Pytest Reference' },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id as typeof activeTab)}
            className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === t.id
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'audit' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-200 dark:divide-slate-800">
          <div className="p-6 space-y-2">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Autonomous Business Intelligence Website — Architecture & Zero-Key Design
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              This platform operates with zero pre-loaded dummy records and zero cloud API keys. Every KPI, chart, forecast, anomaly score, natural-language answer, and PDF report is computed dynamically from your uploaded retail CSV file in SQLite.
            </p>
          </div>

          <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-2">
              <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                Real CSV Data Processing
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Upload any retail sales CSV file with standard columns:
              </p>
              <ul className="text-xs font-mono tabular-nums text-slate-800 dark:text-slate-200 space-y-1 pt-1">
                <li>· Transaction ID & Date</li>
                <li>· Customer ID, Gender & Age</li>
                <li>· Product Category</li>
                <li>· Quantity, Price per Unit & Total Amount</li>
              </ul>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-semibold text-blue-700 dark:text-blue-400">
                Zero Cloud API Keys Required
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Built for 100% free local operation without external paid API dependencies:
              </p>
              <ul className="text-xs text-slate-700 dark:text-slate-300 space-y-1 pt-1">
                <li>· Connects to local Ollama (<code className="font-mono">http://localhost:11434</code>, <code className="font-mono">llama3.2:3b</code>) when running on your machine.</li>
                <li>· Uses a Deterministic Read-Only SQL & Statistical Grounding Engine so numerical answers are 100% exact even offline.</li>
              </ul>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Security & Reliability Safeguards
              </div>
              <ul className="text-xs text-slate-700 dark:text-slate-300 space-y-1 pt-1">
                <li>· Parameterized SQLite queries (<code className="font-mono">?</code> bindings) preventing SQL injection.</li>
                <li>· 15 MB upload limit & schema/type validation.</li>
                <li>· Non-destructive cleaning log reporting accepted, cleaned, and rejected rows.</li>
                <li>· Dataset versioning (<code className="font-mono">is_active</code> flag) preventing cross-upload data mixing.</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'architecture' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-200 dark:divide-slate-800">
          <div className="p-6 space-y-3">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              System Architecture & Machine Learning Methodology
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              The platform follows a 4-layer decoupled architecture: (1) Ingestion & Hygiene Layer, (2) Relational Storage Layer (SQLite WAL), (3) Statistical & Machine Learning Layer (OLS Forecasting + Isolation Forest), and (4) Grounded Natural-Language & Executive PDF Reporting Layer.
            </p>
          </div>

          <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                01. Sales Forecasting — Chronological OLS Linear Regression
              </h4>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Transactions are first aggregated by the chosen time interval (<code className="font-mono">daily</code>, <code className="font-mono">weekly</code>, or <code className="font-mono">monthly</code>) to form a chronological series <code className="font-mono">{'{(t, y_t)}'}</code>.
              </p>
              <ul className="text-xs text-slate-700 dark:text-slate-300 space-y-1.5">
                <li>
                  <strong>Feature Matrix:</strong> Linear trend index <code className="font-mono">t</code> plus cyclical Fourier harmonics <code className="font-mono">sin(2πt/P), cos(2πt/P)</code> when <code className="font-mono">N ≥ 10</code>.
                </li>
                <li>
                  <strong>Chronological Split:</strong> First 80% of periods form the training set; final 20% form the out-of-sample holdout test set (never shuffled randomly, preventing look-ahead bias).
                </li>
                <li>
                  <strong>Evaluation Metrics:</strong> Holdout MAE, RMSE, MAPE, and coefficient of determination <code className="font-mono">R²</code>.
                </li>
              </ul>
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                02. Anomaly Detection — Unsupervised Isolation Forest
              </h4>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Constructs an ensemble of <code className="font-mono">T = 100</code> random binary Isolation Trees (<code className="font-mono">iTree</code>) with sub-sampling size <code className="font-mono">ψ = min(256, N)</code> over 5 features: <code className="font-mono">total_amount</code>, <code className="font-mono">quantity</code>, <code className="font-mono">price_per_unit</code>, <code className="font-mono">category_amount_zscore</code>, and <code className="font-mono">category_price_zscore</code>.
              </p>
              <ul className="text-xs text-slate-700 dark:text-slate-300 space-y-1.5">
                <li>
                  <strong>Path Length Principle:</strong> Anomalies lie in sparse regions of the feature space and are isolated near the root of random trees, yielding shorter average path lengths <code className="font-mono">E(h(x))</code>.
                </li>
                <li>
                  <strong>Anomaly Score Equation:</strong> <code className="font-mono">s(x, ψ) = 2^(-E(h(x)) / c(ψ))</code> where <code className="font-mono">c(ψ) = 2H(ψ-1) - 2(ψ-1)/ψ</code>. Scores approaching <code className="font-mono">1.0</code> indicate strong anomalies.
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'viva' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-200 dark:divide-slate-800">
          <div className="p-6">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              B.Tech CSE Viva Questions & Model Answers
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Prepared specifically for your Enterprise AI semester project evaluation.
            </p>
          </div>
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {[
              {
                q: '1. Why did you split the forecasting dataset chronologically (80/20) instead of using random train_test_split?',
                a: 'Time-series observations have temporal autocorrelation. A random split leaks future observations into the training set (look-ahead bias), artificially inflating accuracy. Chronological splitting trains strictly on past periods (first 80%) and evaluates on unseen future periods (final 20%).',
              },
              {
                q: '2. Why use Linear Regression as the baseline sales forecasting model, and what are its limitations?',
                a: 'Retail datasets uploaded by small businesses often span 12–36 monthly or weekly data points. Complex deep-learning models (like LSTMs or Transformers) overfit severely on small sample sizes. OLS Linear Regression with Fourier cyclical features is interpretable, fast, and provides closed-form confidence intervals. Its main limitation is that it cannot capture sudden nonlinear demand shocks or stockouts.',
              },
              {
                q: '3. How does Isolation Forest detect anomalous transactions without labeled fraud data?',
                a: 'Isolation Forest is an unsupervised ensemble algorithm. It recursively partitions transactions by randomly selecting a feature and a split value between its min and max. Outliers with extreme order totals or rare unit-price/quantity combinations are isolated in very few splits (short path length E(h(x))), whereas normal transactions require many splits.',
              },
              {
                q: '4. Does a high Isolation Forest anomaly score prove that a transaction is fraudulent or an error?',
                a: 'No. An anomaly score only measures statistical rarity relative to the dataset distribution. In retail data, a flagged transaction is often a legitimate high-value B2B bulk order or flagship Electronics purchase rather than fraud.',
              },
              {
                q: '5. How do you prevent the LLM (Llama 3.2 3B) from hallucinating sales numbers in "Ask Your Data"?',
                a: 'We use a Grounded Deterministic NL-to-SQL Architecture. The backend never asks the LLM to calculate sums or averages from raw text. Instead, parameterized SQLite queries and statistical services compute the exact KPIs, category totals, forecasts, and anomalies first, and the local model is restricted to explaining those pre-computed, verified figures.',
              },
              {
                q: '6. Why is it dangerous to execute raw SQL or Python code generated directly by an LLM, and how did you secure it?',
                a: 'Executing raw LLM-generated code exposes the server to SQL Injection, arbitrary table deletion (DROP TABLE), and Remote Code Execution (RCE). We use an allowlisted intent classifier and parameterized read-only SQL queries (? placeholders) so user prompts can never execute arbitrary code.',
              },
              {
                q: '7. How does the data-cleaning pipeline handle inconsistent rows like Quantity × Price ≠ Total Amount?',
                a: 'Rather than silently dropping the transaction or polluting KPI sums, the pipeline checks if Quantity and Unit Price are valid positive numbers, recalculates Total Amount = Quantity × Price per Unit, increments the formula_corrections counter, and logs the exact row number, old value, and corrected value in the audit log.',
              },
              {
                q: '8. How do you prevent a newly uploaded CSV from mixing with transactions from a previous upload?',
                a: 'Every upload creates a new record in the datasets metadata table with a unique dataset_id and sets is_active = 1 while marking prior datasets is_active = 0 inside an atomic SQLite transaction. All dashboard, ML, AI, and PDF queries filter strictly by dataset_id = active_dataset.id.',
              },
            ].map((item, idx) => (
              <div key={idx} className="p-5 space-y-1.5">
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{item.q}</div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'demo' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-4">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            5-Minute College Evaluation Demonstration Script
          </h3>
          <ol className="space-y-3 text-xs text-slate-700 dark:text-slate-300 list-decimal list-inside leading-relaxed">
            <li>
              <strong>Step 1 — Upload Real Retail Sales CSV (1 min):</strong> Start from the clean empty workspace and upload <code className="font-mono">dataset/retail_sales.csv</code> (or your own CSV file). Show the non-destructive validation and cleaning audit report.
            </li>
            <li>
              <strong>Step 2 — Executive Dashboard Verification (1 min):</strong> Open <em>Overview & KPIs</em>. Point out the 4 KPI cards calculated dynamically from SQLite (for <code className="font-mono">retail_sales.csv</code>: Total Sales <strong>₹4,56,000</strong>, Total Quantity <strong>2,514</strong>, Total Transactions <strong>1,000</strong>, and Average Transaction Value <strong>₹456</strong>). Filter by category to demonstrate live SQLite recalculation.
            </li>
            <li>
              <strong>Step 3 — ML Forecasting & Isolation Forest (1.5 min):</strong> Open <em>Forecasting & Anomalies</em>. Adjust the forecast horizon and explain the chronological 80/20 split, MAE, and RMSE. Scroll to the Isolation Forest scatter plot and table to inspect flagged unusual transactions.
            </li>
            <li>
              <strong>Step 4 — Grounded "Ask Your Data" & PDF Report (1.5 min):</strong> Open <em>Ask Your Data</em> and ask a natural-language question about revenue, trends, or anomalies. Highlight the verified SQL execution plan. Finally, open <em>Reports</em> and click <strong>Generate & Download PDF Report</strong>.
            </li>
          </ol>
        </div>
      )}

      {activeTab === 'fastapi' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-4">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Local Python FastAPI + Scikit-Learn + ReportLab Repository Files
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            All Python FastAPI modules (<code className="font-mono">backend/app/main.py</code>) and <code className="font-mono">docs/PROJECT_DOCUMENTATION.md</code> are included directly in this project workspace for your local <code className="font-mono">~/Projects/autonomous-business-intelligence-platform</code> repository.
          </p>
          <div className="bg-slate-900 dark:bg-slate-950 text-slate-100 p-4 rounded-lg font-mono text-xs overflow-x-auto space-y-1 border border-slate-800">
            <div className="text-slate-400"># Commands to run local Ollama and start the platform on your laptop:</div>
            <div>ollama serve</div>
            <div>ollama pull llama3.2:3b</div>
            <div>npm run dev</div>
          </div>
        </div>
      )}
    </div>
  );
};
