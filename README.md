# NL2SQL Token & Infrastructure Cost Calculator

A modern, interactive calculator for modeling token throughput, API consumption, and infrastructure costs for NL2SQL (Natural Language to SQL) architectures.

🔗 **Live Deployment**: [https://nl2sql-token-calculator.vercel.app](https://nl2sql-token-calculator.vercel.app)

---

## Supported Providers & Cost Models

### 1. Google Gemini (API)
- Model Presets:
  - Gemini 1.5 Flash ($0.075 / $0.30 per 1M tokens)
  - Gemini 2.0 Flash ($0.10 / $0.40 per 1M tokens)
  - Gemini 1.5 Pro ($1.25 / $5.00 per 1M tokens)
- Formula: `((Monthly Input Tokens * InputRate) + (Monthly Output Tokens * OutputRate)) / 1M * (1 + Buffer%)`

### 2. Anthropic Claude Direct (API)
- Model Presets:
  - Claude 3.5 Sonnet ($3.00 / $15.00 per 1M tokens)
  - Claude 3.5 Haiku ($0.80 / $4.00 per 1M tokens)
  - Claude 3 Opus ($15.00 / $75.00 per 1M tokens)
- Formula: `((Monthly Input Tokens * InputRate) + (Monthly Output Tokens * OutputRate)) / 1M * (1 + Buffer%)`

### 3. Amazon Bedrock (API)
- Model Presets:
  - Claude 3.5 Sonnet on Bedrock ($3.00 / $15.00 per 1M tokens)
  - Claude 3 Haiku on Bedrock ($0.25 / $1.25 per 1M tokens)
  - Amazon Titan Text Express ($0.20 / $0.60 per 1M tokens)
  - Meta Llama 3.3 70B on Bedrock ($0.72 / $0.72 per 1M tokens)
- Formula: `((Monthly Input Tokens * InputRate) + (Monthly Output Tokens * OutputRate)) / 1M * (1 + Buffer%)`

### 4. Self-Hosted GPU Infrastructure (vLLM / Ollama / TGI)
- Hardware Presets:
  - RunPod / Lambda 1x RTX 4090 24GB ($0.74/hr)
  - AWS EC2 g5.xlarge (1x A10G 24GB) ($1.01/hr)
  - AWS EC2 g5.2xlarge (1x A10G 24GB) ($1.21/hr)
  - AWS EC2 g5.12xlarge (4x A10G 96GB) ($5.67/hr)
  - AWS EC2 g6e.2xlarge (1x L40S 48GB) ($1.85/hr)
- Formula: `(Instance Count * Hourly Rate * Active Hours/Month) * (1 + Storage & Ops Overhead%)`
- Computes **Effective Cost / 1M tokens** dynamically for direct apple-to-apple comparison against APIs.

---

## Token Operation Breakdown (Per Query Defaults)
- **Read / SELECT**: 850 input tokens, 150 output tokens
- **Update CRUD**: 3,000 input tokens, 200 output tokens
- **Create CRUD**: 4,400 input tokens, 300 output tokens
- **Delete queries**: 2,000 input tokens, 200 output tokens

---

## Local Development
Open `index.html` in any modern web browser or serve locally:
```bash
npx serve .
```
