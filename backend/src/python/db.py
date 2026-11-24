import os
from datetime import datetime
from pathlib import Path
from urllib.parse import quote_plus
from sqlalchemy import (
    Column,
    DateTime,
    Float,
    Integer,
    String,
    Text,
    UniqueConstraint,
    create_engine,
)
from sqlalchemy.orm import declarative_base, sessionmaker

def _load_backend_env():
    # Walk up from backend/src/python/db.py to find backend/.env
    for parent in Path(__file__).resolve().parents:
        env_file = parent / ".env"
        if env_file.is_file() and parent.name == "backend":
            for line in env_file.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, val = line.split("=", 1)
                key = key.strip()
                val = val.strip().strip('"').strip("'")
                os.environ.setdefault(key, val)
            break


_load_backend_env()


def _build_database_url() -> str:
    explicit_url = os.getenv("BOLTZ_DB_URL")
    if explicit_url:
        return explicit_url

    user = quote_plus(os.getenv("DB_USER", "root"))
    password = quote_plus(os.getenv("DB_PASSWORD", "secret"))
    host = os.getenv("DB_HOST", "127.0.0.1")
    port = os.getenv("DB_PORT", "3306")
    db_name = os.getenv("DB_NAME", "interactomes")
    return f"mysql+pymysql://{user}:{password}@{host}:{port}/{db_name}"


DATABASE_URL = _build_database_url()

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_recycle=3600,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class BoltzPrediction(Base):
    __tablename__ = "boltz_predictions"
    __table_args__ = (
        UniqueConstraint("dimer_key", name="uq_boltz_predictions_dimer_key"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    dimer_key = Column(String(128), nullable=False, index=True)
    mode = Column(String(32), nullable=False)  # "homodimer" | "heterodimer"
    protein1 = Column(String(64), nullable=False)
    protein2 = Column(String(64), nullable=False)
    seq_hash = Column(String(64), nullable=False)

    status = Column(String(24), nullable=False, default="pending")  # pending | running | completed | failed
    cif_path = Column(String(512), nullable=True)

    iptm = Column(Float, nullable=True)
    ptm = Column(Float, nullable=True)
    complex_plddt = Column(Float, nullable=True)  # 0-1 scale from Boltz confidence JSON
    confidence_score = Column(Float, nullable=True)

    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


def init_db():
    Base.metadata.create_all(bind=engine)