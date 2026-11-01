import json
import urllib.request
import urllib.error
import ssl
from typing import Dict, Any, Optional

def sync_to_cloudflare(
    worker_url: str,
    payload: Dict[str, Any],
    token: Optional[str] = None,
    timeout: int = 15
) -> bool:
    """
    将日度投研结果同步回传至 Cloudflare Worker KV
    """
    if not worker_url:
        return False

    url = f"{worker_url.rstrip('/')}/api/ideas/sync"
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    headers = {
        "Content-Type": "application/json; charset=utf-8"
    }
    if token:
        headers["x-snap-token"] = token

    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    ctx = ssl.create_default_context()

    try:
        with urllib.request.urlopen(req, context=ctx, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return bool(data.get("ok"))
    except Exception as e:
        print(f"[Sync Warning] 无法同步到 Cloudflare ({url}): {e}")
        return False
