import os
import sys
import re
import json
import time
import ssl
import random
import urllib.request
import urllib.error
from typing import Dict, Any, Optional

MODEL_PRIMARY = "gemini-3.5-flash-lite"
MODEL_FALLBACK = "gemini-3.1-flash-lite"
ALLOWED_MODELS = {MODEL_PRIMARY, MODEL_FALLBACK}

class QuotaExhaustedError(Exception):
    """当模型单日配额枯竭或收到 HTML 400 时抛出"""
    pass

class LLMCallError(Exception):
    """模型调用一般性异常"""
    pass

def extract_json_block(text: str) -> Dict[str, Any]:
    """
    鲁棒的 JSON 块提取器：
    1. 优先匹配 markdown 代码块 ```json ... ```
    2. 若无或解析失败，利用括号切片逆向寻找最外层平衡的 { ... }
    """
    if not text:
        raise ValueError("输入文本为空")

    # 1. 尝试正则匹配 Markdown 语法块
    m = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text, re.IGNORECASE)
    if m:
        try:
            return json.loads(m.group(1).strip())
        except Exception:
            pass

    # 2. 括号游标截取：寻找第一个 '{' 与最后一个 '}'
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(text[start:end + 1])
        except Exception as e:
            raise ValueError(f"无法解析截取的 JSON 块: {e}")

    raise ValueError(f"未在文本中发现有效的 JSON 结构: {text[:200]}")

def find_local_api_key() -> Optional[str]:
    """自动检索本地可能存在的 .env.local 凭据文件"""
    possible_paths = [
        os.path.join(os.path.dirname(__file__), "..", "..", "infra", "cloud", "google-cloud", ".env.local"),
        os.path.join("D:\\agRepos\\0000\\infra\\cloud\\google-cloud\\.env.local"),
        ".env.local"
    ]
    for p in possible_paths:
        if os.path.exists(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line.startswith("GEMINI_API_KEY=") or line.startswith("GOOGLE_API_KEY="):
                            val = line.split("=", 1)[1].strip().strip('"').strip("'")
                            if val:
                                return val
            except Exception:
                pass
    return None

class ResilientGeminiClient:
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = (
            api_key
            or os.environ.get("GEMINI_API_KEY")
            or os.environ.get("GOOGLE_API_KEY")
            or find_local_api_key()
        )

    def validate_model(self, model: str) -> str:
        """模型白名单强制校验，杜绝误用 20 RPD 的普通 Flash"""
        if model not in ALLOWED_MODELS:
            raise ValueError(
                f"模型 [{model}] 不在安全白名单中！为防止触碰 20 RPD 陷阱，仅允许使用: {ALLOWED_MODELS}"
            )
        return model

    def _call_single_model(self, model: str, prompt: str, timeout: int = 25) -> Dict[str, Any]:
        """单次调用指定模型，内置 10s/20s/30s 诚实耐受重试，拒绝伪造假数据"""
        self.validate_model(model)
        if not self.api_key:
            raise ValueError("未配置 GEMINI_API_KEY，且未在 infra/cloud/google-cloud/.env.local 找到有效凭证！")

        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={self.api_key}"
        payload = {
            "contents": [{
                "parts": [{"text": prompt}]
            }],
            "generationConfig": {
                "temperature": 0.2,
                "maxOutputTokens": 2048
            }
        }
        body_bytes = json.dumps(payload, ensure_ascii=False).encode("utf-8")

        max_retries = 4
        for attempt in range(max_retries):
            req = urllib.request.Request(
                url,
                data=body_bytes,
                headers={"Content-Type": "application/json; charset=utf-8"},
                method="POST"
            )
            ctx = ssl.create_default_context()
            try:
                with urllib.request.urlopen(req, context=ctx, timeout=timeout) as resp:
                    resp_text = resp.read().decode("utf-8")
                    data = json.loads(resp_text)
                    candidates = data.get("candidates", [])
                    if candidates:
                        parts = candidates[0].get("content", {}).get("parts", [])
                        if parts and "text" in parts[0]:
                            return extract_json_block(parts[0]["text"])
                    raise LLMCallError(f"模型未返回有效候选内容: {resp_text[:200]}")

            except urllib.error.HTTPError as e:
                error_body = ""
                try:
                    error_body = e.fp.read().decode("utf-8") if e.fp else ""
                except Exception:
                    pass

                # 503: 服务超载，诚实递增等待 (10s -> 20s -> 30s)
                if e.code == 503:
                    if attempt < max_retries - 1:
                        sleep_time = (attempt + 1) * 10.0 + random.uniform(1.0, 3.0)
                        print(f"[503 超载等待] 模型 {model} 正在排队，等待 {sleep_time:.1f} 秒后发起第 {attempt + 2} 次重试...", file=sys.stderr)
                        time.sleep(sleep_time)
                        continue
                    raise LLMCallError(f"模型 {model} 连续 503 超载且重试耗尽，拒绝假兜底: {error_body}")

                # 429 或 400 配额耗尽
                if e.code == 429 or "quota" in error_body.lower() or "<html>" in error_body.lower():
                    raise QuotaExhaustedError(f"模型 {model} 配额已枯竭 (code {e.code}): {error_body}")

                raise LLMCallError(f"HTTP 错误 {e.code}: {error_body}")

            except (urllib.error.URLError, TimeoutError) as e:
                if attempt < max_retries - 1:
                    sleep_time = (attempt + 1) * 10.0
                    print(f"[网络等待] 模型 {model} 握手超时，等待 {sleep_time:.1f} 秒后重试...", file=sys.stderr)
                    time.sleep(sleep_time)
                    continue
                raise LLMCallError(f"网络异常 ({model}) 重试耗尽: {e}")

        raise LLMCallError(f"模型 {model} 重试全部失败")

        raise LLMCallError(f"模型 {model} 重试全部失败")

    def generate_daily_analysis(
        self,
        prompt: str,
        mock_response: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        日度投研主入口：
        - 优先支持传入 mock_response (L0 离线沙盒，0 API 消耗)
        - 生产运行走 3.5 Flash Lite -> 故障自动平滑转移至 3.1 Flash Lite
        """
        if mock_response is not None:
            return mock_response

        # 1. 尝试主力 3.5 Flash Lite
        try:
            return self._call_single_model(MODEL_PRIMARY, prompt)
        except QuotaExhaustedError:
            pass  # 主力配额耗尽，转入备用

        # 2. 降级备用 3.1 Flash Lite
        return self._call_single_model(MODEL_FALLBACK, prompt)
