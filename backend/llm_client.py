"""
llm_client.py — Unified LLM integration with fallback across providers.

Order of priority:
1. Google Gemini (gemini-1.5-flash) via GEMINI_API_KEY
2. Groq Llama 3 (llama-3.3-70b-versatile) via GROQ_API_KEY
3. Anthropic Claude (claude-sonnet-4-6) via ANTHROPIC_API_KEY
4. None (triggers graceful fallback to deterministic explanation template)
"""

import os
import json
import urllib.request
import urllib.error
import logging
logger = logging.getLogger("riskyn.llm")

def call_llm(system_prompt: str, user_prompt: str, max_tokens: int = 200, timeout: int = 8) -> str | None:
    # 1. Google Gemini
    gemini_key = os.environ.get("GEMINI_API_KEY")
    if gemini_key:
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={gemini_key}"
            payload = {
                "contents": [{"parts": [{"text": f"{system_prompt}\n\nFacts:\n{user_prompt}"}]}],
                "generationConfig": {
                    "maxOutputTokens": max_tokens,
                    "temperature": 0.2
                }
            }
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode(),
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read())
                text = data["candidates"][0]["content"]["parts"][0]["text"].strip()
                if text:
                    return text
        except Exception as e:
            logger.warning("Gemini API call failed: %s", e)

    # 2. Groq Llama 3
    groq_key = os.environ.get("GROQ_API_KEY")
    if groq_key:
        try:
            url = "https://api.groq.com/openai/v1/chat/completions"
            payload = {
                "model": "llama-3.3-70b-versatile",
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                "max_tokens": max_tokens,
                "temperature": 0.2
            }
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode(),
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {groq_key}"
                }
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read())
                text = data["choices"][0]["message"]["content"].strip()
                if text:
                    return text
        except Exception as e:
            logger.warning("Groq API call failed: %s", e)

    # 3. Anthropic Claude
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
    if anthropic_key:
        try:
            payload = {
                "model": "claude-sonnet-4-6",
                "max_tokens": max_tokens,
                "system": system_prompt,
                "messages": [{"role": "user", "content": user_prompt}],
            }
            req = urllib.request.Request(
                "https://api.anthropic.com/v1/messages",
                data=json.dumps(payload).encode(),
                headers={
                    "Content-Type": "application/json",
                    "x-api-key": anthropic_key,
                    "anthropic-version": "2023-06-01",
                },
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read())
                parts = [b["text"] for b in data.get("content", []) if b.get("type") == "text"]
                text = "".join(parts).strip()
                if text:
                    return text
        except Exception as e:
            logger.warning("Anthropic API call failed: %s", e)

    return None


def get_llm_status() -> dict:
    """Returns visibility status for the active AI provider or deterministic fallback."""
    if os.environ.get("GEMINI_API_KEY"):
        return {"status": "LIVE (Gemini)", "active": True, "provider": "Gemini"}
    elif os.environ.get("GROQ_API_KEY"):
        return {"status": "LIVE (Groq)", "active": True, "provider": "Groq"}
    elif os.environ.get("ANTHROPIC_API_KEY"):
        return {"status": "LIVE (Anthropic)", "active": True, "provider": "Anthropic"}
    return {"status": "TEMPLATE FALLBACK (no provider configured)", "active": False, "provider": "None"}

