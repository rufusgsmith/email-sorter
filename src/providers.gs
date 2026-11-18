/**
 * AI providers. Each one turns (system prompt, user message, JSON schema) into an
 * HTTP request, and pulls the answer text and token counts out of the response.
 *
 * To add a provider: add an entry below with the same three fields, then set
 * CONFIG.provider to its name and add its key to Script Properties.
 */
const PROVIDERS = {
  anthropic: {
    keyName: 'ANTHROPIC_API_KEY',
    request: (model, system, user, schema, key) => ({
      url: 'https://api.anthropic.com/v1/messages',
      headers: { 'x-api-key': key, 'anthropic-version': '2026-10-21' },
      body: {
        model,
        max_tokens: 1024, // room for a little thinking plus the short JSON answer
        system,
        messages: [{ role: 'user', content: user }],
        output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      },
    }),
    parse: (res) => {
      if (res.stop_reason !== 'end_turn') throw new Error('Anthropic stopped early: ' + res.stop_reason);
      return {
        text: res.content.filter((b) => b.type === 'text').map((b) => b.text).join(''),
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
      };
    },
  },

  openai: {
    keyName: 'OPENAI_API_KEY',
    request: (model, system, user, schema, key) => ({
      url: 'https://api.openai.com/v1/chat/completions',
      headers: { Authorization: 'Bearer ' + key },
      body: {
        model,
        reasoning_effort: 'low',
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        response_format: { type: 'json_schema', json_schema: { name: 'classification', strict: true, schema } },
      },
    }),
    parse: (res) => {
      const choice = res.choices[0];
      if (choice.finish_reason !== 'stop') throw new Error('OpenAI stopped early: ' + choice.finish_reason);
      return {
        text: choice.message.content,
        inputTokens: res.usage.prompt_tokens,
        outputTokens: res.usage.completion_tokens, // includes reasoning tokens
      };
    },
  },

  gemini: {
    keyName: 'GEMINI_API_KEY',
    request: (model, system, user, schema, key) => ({
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      headers: { 'x-goog-api-key': key },
      body: {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseJsonSchema: schema,
          thinkingConfig: { thinkingLevel: 'LOW' },
        },
      },
    }),
    parse: (res) => {
      const candidate = (res.candidates || [])[0];
      if (!candidate || candidate.finishReason !== 'STOP') {
        throw new Error('Gemini stopped early: ' + (candidate ? candidate.finishReason : 'no answer'));
      }
      const usage = res.usageMetadata;
      return {
        text: candidate.content.parts.map((p) => p.text || '').join(''),
        inputTokens: usage.promptTokenCount,
        outputTokens: (usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0), // thinking is billed as output
      };
    },
  },
};

/** Sends one request to the configured provider. Throws on any HTTP or provider error. */
function callLlm(system, user, schema) {
  const provider = PROVIDERS[CONFIG.provider];
  const req = provider.request(CONFIG.model, system, user, schema, getApiKey());
  const resp = UrlFetchApp.fetch(req.url, {
    method: 'post',
    contentType: 'application/json',
    headers: req.headers,
    payload: JSON.stringify(req.body),
    muteHttpExceptions: true,
  });
  const code = resp.getResponseCode();
  if (code !== 200) throw new Error(`${CONFIG.provider} HTTP ${code}: ${resp.getContentText().slice(0, 300)}`);
  return provider.parse(JSON.parse(resp.getContentText()));
}

/** Reads the provider's API key from Script Properties; keys never live in code. */
function getApiKey() {
  const name = PROVIDERS[CONFIG.provider].keyName;
  const key = PropertiesService.getScriptProperties().getProperty(name);
  if (!key) throw new Error(`Missing API key: add ${name} in Project Settings → Script Properties.`);
  return key;
}

/** Estimated USD cost for a token count, using CONFIG.pricePerMillion. */
function estimateCost(inputTokens, outputTokens) {
  return (inputTokens * CONFIG.pricePerMillion.input + outputTokens * CONFIG.pricePerMillion.output) / 1e6;
}
