import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import List, Optional
import threading

import yaml
from collections import deque
import queue
import time
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db import BoltzPrediction, SessionLocal, init_db

CIF_STORAGE_DIR = Path(__file__).resolve().parent / "boltz_cache" / "cifs"
CIF_STORAGE_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Local Boltz Dimer Service")

boltz_gpu_lock = threading.Lock()

def build_boltz_env() -> dict[str, str]:
    env = os.environ.copy()
    env["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"
    env.setdefault("OMP_NUM_THREADS", "4")
    env.setdefault("MKL_NUM_THREADS", "4")
    env.setdefault("VECLIB_MAXIMUM_THREADS", "4")
    env.setdefault("OPENBLAS_NUM_THREADS", "4")
    env.setdefault("TOKENIZERS_PARALLELISM", "false")
    return env

def run_boltz_streaming(
    cmd: list[str],
    env: dict[str, str],
    dimer_key: str,
    heartbeat_interval: float = 30.0,
) -> str:
    """Run Boltz, stream console output live, and log periodic heartbeats while active."""
    tail_lines: deque[str] = deque(maxlen=60)
    line_queue: queue.Queue[str | None] = queue.Queue()
    start_time = time.monotonic()

    print(f"[Boltz:{dimer_key}] Starting: {' '.join(cmd)}", flush=True)

    with subprocess.Popen(
        cmd,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    ) as proc:
        assert proc.stdout is not None

        def _reader() -> None:
            try:
                for raw_line in proc.stdout:
                    cleaned = raw_line.replace("\r", "\n")
                    for part in cleaned.splitlines():
                        line = part.strip()
                        if line:
                            line_queue.put(line)
            finally:
                line_queue.put(None)

        reader_thread = threading.Thread(target=_reader, daemon=True)
        reader_thread.start()

        last_heartbeat = time.monotonic()
        reader_done = False

        while not reader_done:
            try:
                item = line_queue.get(timeout=1.0)
                if item is None:
                    reader_done = True
                else:
                    tail_lines.append(item)
                    print(f"[Boltz:{dimer_key}] {item}", flush=True)
            except queue.Empty:
                now = time.monotonic()
                if now - last_heartbeat >= heartbeat_interval and proc.poll() is None:
                    elapsed = int(now - start_time)
                    print(
                        f"[Boltz:{dimer_key}] Still running (elapsed: {elapsed}s)...",
                        flush=True,
                    )
                    last_heartbeat = now

        return_code = proc.wait()
        reader_thread.join(timeout=2.0)

    if return_code != 0:
        raise RuntimeError(
            f"Boltz prediction failed (exit {return_code}): " + "\n".join(tail_lines)
        )

    return "\n".join(tail_lines)

# Allow Vite dev server during local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    init_db()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class ChainInput(BaseModel):
    id: str
    uniprot_id: str
    sequence: str


class CrosslinkInput(BaseModel):
    protein1: Optional[str] = None
    protein2: Optional[str] = None
    pos1: Optional[int] = None
    pos2: Optional[int] = None


class DimerPredictionRequest(BaseModel):
    mode: str  # "homodimer" | "heterodimer"
    chains: List[ChainInput]
    crosslink: Optional[CrosslinkInput] = None
    use_msa_server: bool = True
    force: bool = False


def compute_dimer_key(mode: str, chains: List[ChainInput]) -> tuple[str, str, str, str]:
    """
    Build a deterministic canonical key so homodimers and heterodimers map
    consistently to cached structures in MariaDB.
    """
    c1 = chains[0]
    c2 = chains[1]
    seq1 = "".join((c1.sequence or "").split()).upper()
    seq2 = "".join((c2.sequence or "").split()).upper()

    if mode == "homodimer":
        p1, p2 = c1.uniprot_id, c1.uniprot_id
        seq_sig = f"homo:{seq1}"
    else:
        pairs = sorted(
            [(c1.uniprot_id, seq1), (c2.uniprot_id, seq2)],
            key=lambda item: (item[0], item[1]),
        )
        p1, p2 = pairs[0][0], pairs[1][0]
        seq_sig = f"hetero:{pairs[0][0]}:{pairs[0][1]}|{pairs[1][0]}:{pairs[1][1]}"

    seq_hash = hashlib.sha256(seq_sig.encode("utf-8")).hexdigest()[:16]
    dimer_key = f"{mode}:{p1}_{p2}:{seq_hash}"
    return dimer_key, p1, p2, seq_hash


def extract_confidence(prediction_dir: Path) -> dict:
    """Read Boltz confidence JSON (e.g., confidence_*_model_0.json) if present."""
    conf_files = sorted(prediction_dir.glob("confidence_*.json"))
    if not conf_files:
        return {}
    data = json.loads(conf_files[0].read_text(encoding="utf-8"))
    return {
        "iptm": data.get("iptm"),
        "ptm": data.get("ptm"),
        "complex_plddt": data.get("complex_plddt"),
        "confidence_score": data.get("confidence_score"),
    }


def build_response_payload(row: BoltzPrediction, cif_text: str) -> dict:
    return {
        "dimer_key": row.dimer_key,
        "mode": row.mode,
        "cif": cif_text,
        "cif_path": row.cif_path,
        "confidence": {
            "iptm": row.iptm,
            "ptm": row.ptm,
            "complex_plddt": row.complex_plddt,
            "confidence_score": row.confidence_score,
        },
    }


def build_boltz_yaml(req: DimerPredictionRequest) -> dict:
    """
    Build a Boltz YAML spec without `msa` fields so `--use_msa_server`
    automatically generates MSAs via the MMseqs2 server.
    """
    cleaned_chains = []
    for chain in req.chains:
        seq = "".join((chain.sequence or "").split()).upper()
        if not seq:
            raise ValueError(f"Empty sequence for chain {chain.id}")
        cleaned_chains.append((chain.id, seq))

    if len(cleaned_chains) < 2:
        raise ValueError("At least two chains are required for dimer prediction.")

    # For a homodimer with identical sequences, grouping IDs shares the alignment cleanly
    if req.mode == "homodimer" and cleaned_chains[0][1] == cleaned_chains[1][1]:
        chain_ids = [cid for cid, _ in cleaned_chains[:2]]
        return {
            "version": 1,
            "sequences": [
                {
                    "protein": {
                        "id": chain_ids,
                        "sequence": cleaned_chains[0][1],
                    }
                }
            ],
        }

    # For heterodimers (or differing sequences), emit each chain separately
    return {
        "version": 1,
        "sequences": [
            {
                "protein": {
                    "id": cid,
                    "sequence": seq,
                }
            }
            for cid, seq in cleaned_chains
        ],
    }


def find_predicted_cif(out_dir: Path, stem_name: str) -> Path:
    """Locate the generated .cif structure file inside Boltz's output directory."""
    prediction_dir = out_dir / f"boltz_results_{stem_name}" / "predictions" / stem_name
    if prediction_dir.exists():
        cif_files = sorted(prediction_dir.glob("*.cif"))
        if cif_files:
            return cif_files[0]

    # Fallback search in case Boltz nests output slightly differently
    all_cifs = sorted(out_dir.rglob("*.cif"))
    if all_cifs:
        return all_cifs[0]

    raise FileNotFoundError("Boltz completed without producing a .cif output file.")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/boltz/prediction")
def get_cached_prediction(
    dimer_key: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
):
    row = db.query(BoltzPrediction).filter(BoltzPrediction.dimer_key == dimer_key).first()
    if not row or row.status != "completed" or not row.cif_path:
        return {"found": False, "status": row.status if row else "missing"}

    cif_file = Path(row.cif_path)
    if not cif_file.exists():
        return {"found": False, "status": "missing_file"}

    return {
        "found": True,
        "status": row.status,
        **build_response_payload(row, cif_file.read_text(encoding="utf-8")),
    }


@app.post("/api/boltz/predict")
def predict_dimer(req: DimerPredictionRequest, db: Session = Depends(get_db)):
    if len(req.chains) < 2:
        raise HTTPException(status_code=400, detail="At least two chains are required for dimer prediction.")

    try:
        yaml_payload = build_boltz_yaml(req)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    dimer_key, p1, p2, seq_hash = compute_dimer_key(req.mode, req.chains)

    row = db.query(BoltzPrediction).filter(BoltzPrediction.dimer_key == dimer_key).first()
    if row and not req.force and row.status == "completed" and row.cif_path:
        cif_file = Path(row.cif_path)
        if cif_file.exists():
            return {
                "cached": True,
                **build_response_payload(row, cif_file.read_text(encoding="utf-8")),
            }

    if not row:
        row = BoltzPrediction(
            dimer_key=dimer_key,
            mode=req.mode,
            protein1=p1,
            protein2=p2,
            seq_hash=seq_hash,
            status="running",
            error_message=None,
        )
        db.add(row)
    else:
        row.status = "running"
        row.error_message = None
    db.commit()
    db.refresh(row)

    stem_name = "dimer_input"

    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            input_yaml_path = tmp_path / f"{stem_name}.yaml"
            out_dir = tmp_path / "output"
            out_dir.mkdir(parents=True, exist_ok=True)

            with open(input_yaml_path, "w", encoding="utf-8") as f:
                yaml.safe_dump(yaml_payload, f, sort_keys=False)

            cmd = [
                "boltz",
                "predict",
                str(input_yaml_path),
                "--out_dir",
                str(out_dir),
                "--output_format",
                "mmcif",
                "--accelerator",
                "gpu",
                "--override",
            ]
            if req.use_msa_server:
                cmd.append("--use_msa_server")

            try:
                with boltz_gpu_lock:
                    run_boltz_streaming(cmd, build_boltz_env(), dimer_key)
            except FileNotFoundError:
                raise RuntimeError(
                    "`boltz` CLI was not found in PATH. Ensure Boltz is installed in the server environment."
                )
            except FileNotFoundError:
                raise RuntimeError(
                    "`boltz` CLI was not found in PATH. Ensure Boltz is installed in the server environment."
                )

            src_cif = find_predicted_cif(out_dir, stem_name)
            dest_cif = CIF_STORAGE_DIR / f"{dimer_key.replace(':', '_')}.cif"
            shutil.copy2(src_cif, dest_cif)

            conf = extract_confidence(src_cif.parent)
            row.status = "completed"
            row.cif_path = str(dest_cif)
            row.iptm = conf.get("iptm")
            row.ptm = conf.get("ptm")
            row.complex_plddt = conf.get("complex_plddt")
            row.confidence_score = conf.get("confidence_score")
            row.error_message = None
            db.commit()
            db.refresh(row)

            return {
                "cached": False,
                **build_response_payload(row, dest_cif.read_text(encoding="utf-8")),
            }

    except Exception as exc:
        row.status = "failed"
        row.error_message = str(exc)[:1000]
        db.commit()
        raise HTTPException(status_code=500, detail=str(exc))