import unittest
from unittest.mock import patch, MagicMock
from src.llm_client import (
    ResilientGeminiClient,
    extract_json_block,
    QuotaExhaustedError,
    MODEL_PRIMARY,
    MODEL_FALLBACK
)

class TestLLMClient(unittest.TestCase):
    def test_extract_json_block_standard_markdown(self):
        text = '这是一些前言废话\n```json\n{"status": "ok", "count": 1}\n```\n一些收尾'
        data = extract_json_block(text)
        self.assertEqual(data.get("status"), "ok")
        self.assertEqual(data.get("count"), 1)

    def test_extract_json_block_raw_braces(self):
        text = '口水分析结论：\n{"sector_weather": [{"sector": "黑色系", "bias": "BEARISH"}]}'
        data = extract_json_block(text)
        self.assertIn("sector_weather", data)
        self.assertEqual(data["sector_weather"][0]["sector"], "黑色系")

    def test_model_whitelist_enforcement(self):
        client = ResilientGeminiClient(api_key="fake-key")
        # 合法模型
        self.assertEqual(client.validate_model(MODEL_PRIMARY), MODEL_PRIMARY)
        self.assertEqual(client.validate_model(MODEL_FALLBACK), MODEL_FALLBACK)
        # 禁止使用普通 Flash 20 RPD 陷阱模型
        with self.assertRaises(ValueError):
            client.validate_model("gemini-2.5-flash")
        with self.assertRaises(ValueError):
            client.validate_model("gemini-3-flash")

    def test_generate_with_mock_response(self):
        client = ResilientGeminiClient(api_key=None)
        mock_payload = {
            "sector_weather": [{"sector": "能化系", "bias": "BULLISH", "narrative": "原油走强"}],
            "checkpoint_reviews": [],
            "new_ideas": [{"symbol": "FU2611", "direction": "LONG", "thesis": "裂解利润修复"}]
        }
        res = client.generate_daily_analysis("test prompt", mock_response=mock_payload)
        self.assertEqual(res["sector_weather"][0]["sector"], "能化系")
        self.assertEqual(res["new_ideas"][0]["symbol"], "FU2611")

    @patch("urllib.request.urlopen")
    def test_fallback_on_429_quota_exhausted(self, mock_urlopen):
        import urllib.error
        client = ResilientGeminiClient(api_key="fake-key")

        # 模拟 3.5 报 429 quota 耗尽
        err_429 = urllib.error.HTTPError(
            url="https://api.google.com",
            code=429,
            msg="Too Many Requests",
            hdrs={},
            fp=MagicMock(read=lambda: b'{"error": {"message": "Resource has been exhausted (e.g. check quota)."}}')
        )
        # 备选 3.1 成功
        mock_resp_success = MagicMock()
        mock_resp_success.__enter__.return_value.read.return_value = b'{"candidates": [{"content": {"parts": [{"text": "{\\"sector_weather\\": []}"}]}}]}'
        mock_urlopen.side_effect = [err_429, mock_resp_success]

        res = client.generate_daily_analysis("test prompt")
        self.assertIn("sector_weather", res)

    @patch("time.sleep")
    @patch("urllib.request.urlopen")
    def test_503_retry_and_eventual_success(self, mock_urlopen, mock_sleep):
        import urllib.error
        client = ResilientGeminiClient(api_key="fake-key")

        err_503 = urllib.error.HTTPError(
            url="https://api.google.com",
            code=503,
            msg="Service Unavailable",
            hdrs={},
            fp=MagicMock(read=lambda: b'{"error": {"message": "Model overloaded"}}')
        )
        mock_resp_success = MagicMock()
        mock_resp_success.__enter__.return_value.read.return_value = b'{"candidates": [{"content": {"parts": [{"text": "{\\"sector_weather\\": [], \\\"new_ideas\\\": []}"}]}}]}'
        # 前两次 503，第三次成功
        mock_urlopen.side_effect = [err_503, err_503, mock_resp_success]

        res = client.generate_daily_analysis("test prompt", max_duration_sec=60.0)
        self.assertIn("sector_weather", res)
        self.assertEqual(mock_sleep.call_count, 2)

if __name__ == "__main__":
    unittest.main()
