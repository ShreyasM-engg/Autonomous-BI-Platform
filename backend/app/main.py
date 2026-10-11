"""
Autonomous Business Intelligence Platform — FastAPI Reference Backend (backend/app/main.py)
Compatible with Python 3.10+, FastAPI, pandas, scikit-learn, SQLite3, Ollama (llama3.2:3b), and ReportLab.
"""
import io
import json
import math
import os
import sqlite3
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

app = FastAPI(
    title="Autonomous Business Intelligence Platform API",
    version="1.0.0",
    description="Enterprise AI & ML backend for retail sales validation, KPIs, forecasting, anomaly detection, and grounded NL querying.",
)

allowed_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health_check() -> Dict[str, Any]:
    return {
        "status": "healthy",
        "service": "Autonomous Business Intelligence FastAPI Backend",
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }
