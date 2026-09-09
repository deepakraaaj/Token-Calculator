// Serverless proxy: fetches live pricing from provider sources server-side
// (avoids browser CORS blocks) and returns a consolidated JSON payload.
// Each source is fetched/parsed independently — one source failing never
// blocks the others. Anything that can't be confidently parsed is reported
// in `warnings` and simply omitted from the result, so the frontend leaves
// that value untouched rather than guessing.

export const config = { runtime: "edge" };

const TIMEOUT_MS = 8000;

async function fetchText(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; token-calculator-pricing-refresh/1.0)",
        Accept: "text/html,application/json",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

// ---------- AWS Bedrock (structured JSON feed — most reliable source) ----------
async function fetchBedrock(warnings) {
  const url =
    "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrock/current/us-east-1/index.json";
  let data;
  try {
    const text = await fetchText(url);
    data = JSON.parse(text);
  } catch (e) {
    warnings.push(`AWS Bedrock: fetch/parse failed (${e.message})`);
    return {};
  }

  const prods = data.products || {};
  const terms = (data.terms && data.terms.OnDemand) || {};

  // model -> { in, out } accumulator, matched by AWS's `model` attribute
  const wanted = {
    "Nova Micro": "bedrock-novamicro",
    "Nova Lite": "bedrock-novalite",
    "Nova Pro": "bedrock-novapro",
    "Nova Premier": "bedrock-novapremier",
    "Llama 3.3 70B": "bedrock-llama33",
    "Llama 4 Scout 17B": "bedrock-llama4scout",
    "Llama 4 Maverick 17B": "bedrock-llama4maverick",
    "Mistral Large 3": "bedrock-mistrallarge",
    "DeepSeek v3.2": "bedrock-deepseek",
    "Claude 3 Sonnet": "bedrock-sonnet",
    "Claude 3 Haiku": "bedrock-haiku",
  };

  const found = {}; // presetKey -> { in, out }
  const activeModels = new Set(); // which AWS `model` names are still in the feed

  for (const [sku, p] of Object.entries(prods)) {
    const a = p.attributes || {};
    if (a.regionCode !== "us-east-1") continue;
    const model = a.model || "";
    if (model) activeModels.add(model);
    const presetKey = wanted[model];
    if (!presetKey) continue;
    const itype = a.inferenceType;
    if (itype !== "Input tokens" && itype !== "Output tokens") continue;
    // skip batch/latency-optimized variants — keep standard on-demand only
    if (/batch|latency-optimized/i.test(a.usagetype || "")) continue;

    const term = terms[sku];
    if (!term) continue;
    for (const t of Object.values(term)) {
      for (const pd of Object.values(t.priceDimensions || {})) {
        // AWS's Bedrock feed prices per 1K tokens (see `description` / `unit`
        // fields on each priceDimension) — scale by 1000, not 1,000,000.
        const per1K = parseFloat(pd.pricePerUnit && pd.pricePerUnit.USD);
        if (!Number.isFinite(per1K)) continue;
        const per1M = Math.round(per1K * 1000 * 1e6) / 1e6;
        found[presetKey] = found[presetKey] || {};
        if (itype === "Input tokens") found[presetKey].in = per1M;
        else found[presetKey].out = per1M;
      }
    }
  }

  // Only keep presets where BOTH in and out were found — a Claude row with
  // only `in` (a known gap in this feed) is reported, not silently guessed.
  const result = {};
  for (const [presetKey, val] of Object.entries(found)) {
    if (Number.isFinite(val.in) && Number.isFinite(val.out)) {
      result[presetKey] = val;
    } else {
      warnings.push(
        `AWS Bedrock: ${presetKey} missing ${
          Number.isFinite(val.in) ? "output" : "input"
        } price in feed — left unchanged`
      );
    }
  }

  // Retirement check: flag presets whose AWS `model` name we track no longer
  // appears anywhere in the feed at all (as opposed to just missing a price
  // dimension, which is handled above).
  if (!activeModels.has("Titan Text Express")) {
    warnings.push(
      "AWS Bedrock: 'Titan Text Express' not found in current feed (likely retired)"
    );
  }
  if (!activeModels.has("DeepSeek v3.2") && !found["bedrock-deepseek"]) {
    warnings.push(
      "AWS Bedrock: 'DeepSeek v3.2' not found in current feed — DeepSeek preset may need remapping to whatever replaced it"
    );
  }

  return { result, activeModels: Array.from(activeModels) };
}

// ---------- RunPod (own pricing page — structured JSON-LD, not freeform HTML) ----------
async function fetchRunPod(warnings) {
  try {
    const html = await fetchText("https://www.runpod.io/pricing");
    // RunPod embeds a JSON-LD Product block per GPU
    // (id "#gpu-rtx-4090") with named Community/Secure Cloud offers —
    // far more reliable than regexing the rendered page (which is
    // client-side React and doesn't contain the pricing table as static HTML).
    const idx = html.indexOf("gpu-rtx-4090");
    if (idx === -1) throw new Error("RTX 4090 product block not found on page");
    const window_ = html.slice(idx, idx + 1500);
    const m = window_.match(
      /"name"\s*:\s*"Secure Cloud"\s*,\s*"price"\s*:\s*"(\d+(?:\.\d+)?)"/
    );
    if (!m) throw new Error("could not locate Secure Cloud offer price");
    const rate = parseFloat(m[1]);
    if (!Number.isFinite(rate) || rate <= 0 || rate > 10) {
      throw new Error(`parsed rate ${rate} out of sane bounds`);
    }
    return { runpod4090: { rate } };
  } catch (e) {
    warnings.push(`RunPod: could not parse pricing page (${e.message})`);
    return {};
  }
}

// ---------- Google Gemini & Anthropic Claude ----------
// Both pricing pages are client-side-rendered (React/Next.js): the dollar
// figures are not present in the static HTML RunPod-style JSON-LD gave us
// for GPUs, and testing a "nearest $ figures after the model name" regex
// against the live Gemini page produced confidently WRONG numbers (it
// picked up audio-tier prices adjacent to the text-tier ones instead of
// the real output price). Per the "leave untouched + flag" rule, a parser
// that silently returns plausible-looking wrong numbers is worse than no
// parser — so these two are intentionally not scraped. They're listed here
// as a manual-check reminder instead.
function manualCheckOnly(name, url, warnings) {
  warnings.push(
    `${name}: pricing page is JS-rendered — no reliable static parse available, verify manually at ${url}`
  );
  return {};
}

export default async function handler() {
  const warnings = [];

  const [bedrockOut, runpod] = await Promise.all([
    fetchBedrock(warnings),
    fetchRunPod(warnings),
  ]);
  manualCheckOnly("Gemini", "ai.google.dev/gemini-api/docs/pricing", warnings);
  manualCheckOnly("Claude", "claude.com/pricing", warnings);

  const payload = {
    fetchedAt: new Date().toISOString(),
    bedrock: bedrockOut.result || {},
    bedrockActiveModels: bedrockOut.activeModels || [],
    gpu: { ...runpod },
    warnings,
    // Marketplace GPU (Vast.ai, TensorDock) is deliberately NOT scraped —
    // per-host live pricing, no stable page pattern, would be a stale
    // snapshot the moment it's written. The UI keeps those manual.
    note:
      "Vast.ai / TensorDock are peer-to-peer marketplaces with no stable pricing endpoint — left out of automated refresh by design. Gemini and Claude pricing pages are JS-rendered and can't be reliably parsed server-side — check those manually against the links above.",
  };

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}
