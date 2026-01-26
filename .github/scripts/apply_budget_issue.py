import os
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"

def read_json(path: Path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))

def write_json(path: Path, obj):
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

def extract_payload(issue_title: str, issue_body: str):
    if not issue_title.lower().startswith("budget-commit"):
        if "BUDGET_COMMIT_PAYLOAD_V1" not in (issue_body or ""):
            return None

    body = issue_body or ""
    m = re.search(r"```json\s*(\{.*?\})\s*```", body, re.DOTALL)
    if not m:
        return None

    payload = json.loads(m.group(1))
    if payload.get("marker") != "BUDGET_COMMIT_PAYLOAD_V1":
        return None
    if int(payload.get("version", 0)) != 1:
        return None

    return payload

def dedupe_by_key(items, key_fn):
    out = []
    seen = set()
    for x in items:
        k = key_fn(x)
        if k is None:
            continue
        if k in seen:
            continue
        seen.add(k)
        out.append(x)
    return out

def main():
    issue_title = os.environ.get("ISSUE_TITLE", "")
    issue_body = os.environ.get("ISSUE_BODY", "")

    payload = extract_payload(issue_title, issue_body)
    if payload is None:
        print("No valid payload found; exiting.")
        return

    tx_path = DATA / "transactions.json"
    wed_path = DATA / "wedding.json"

    tx = read_json(tx_path, [])
    wed = read_json(wed_path, {"bankBalanceUpdates": [], "weddingExpenses": []})

    new_tx = payload.get("transactions", []) or []
    new_wed = payload.get("wedding", {}) or {}
    new_bal = new_wed.get("bankBalanceUpdates", []) or []
    new_exp = new_wed.get("weddingExpenses", []) or []

    tx = dedupe_by_key(tx + new_tx, lambda x: x.get("id"))
    tx.sort(key=lambda x: (x.get("date", ""), str(x.get("id", ""))))

    wed_bal = dedupe_by_key((wed.get("bankBalanceUpdates") or []) + new_bal, lambda x: x.get("id"))
    wed_bal.sort(key=lambda x: (x.get("date", ""), str(x.get("id", ""))))

    wed_exp = dedupe_by_key((wed.get("weddingExpenses") or []) + new_exp, lambda x: x.get("id"))
    wed_exp.sort(key=lambda x: (x.get("date", ""), str(x.get("id", ""))))

    wed["bankBalanceUpdates"] = wed_bal
    wed["weddingExpenses"] = wed_exp

    write_json(tx_path, tx)
    write_json(wed_path, wed)

    print("Applied payload (transactions + wedding).")

if __name__ == "__main__":
    main()
