const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildAnthropicRequestPayload,
    extractAnthropicText,
    expandOutputBudgetForRetry,
} = require('../server/services/llm');

test('extractAnthropicText skips thinking blocks and returns the final text block', () => {
    const result = extractAnthropicText([
        { type: 'thinking', thinking: 'internal reasoning' },
        { type: 'text', text: '{"ok":true}' },
    ]);

    assert.equal(result, '{"ok":true}');
});

test('extractAnthropicText joins multiple text blocks without losing content', () => {
    const result = extractAnthropicText([
        { type: 'text', text: '{"title":"A",' },
        { type: 'thinking', thinking: 'more reasoning' },
        { type: 'text', text: '"mind_map":{"nodes":[]}}' },
    ]);

    assert.equal(result, '{"title":"A",\n"mind_map":{"nodes":[]}}');
});

test('extractAnthropicText supports string content from compatible providers', () => {
    assert.equal(extractAnthropicText('plain response'), 'plain response');
});

test('thinking-only responses retry with a larger output budget', () => {
    const next = expandOutputBudgetForRetry(
        { maxTokens: 900, temperature: 0.2 },
        { code: 'LLM_EMPTY_RESPONSE' }
    );

    assert.equal(next.maxTokens, 1800);
    assert.equal(next.temperature, 0.2);
});

test('ordinary HTTP retries keep the configured output budget', () => {
    const next = expandOutputBudgetForRetry({ maxTokens: 900 }, { response: { status: 503 } });
    assert.equal(next.maxTokens, 900);
});

test('Kimi Anthropic requests can explicitly disable thinking for structured tasks', () => {
    const payload = buildAnthropicRequestPayload(
        [{ role: 'user', content: 'return json' }],
        { temperature: 0.2, maxTokens: 1200, thinking: false },
        'kimi-for-coding',
        'https://api.kimi.com/coding/v1'
    );

    assert.deepEqual(payload.thinking, { type: 'disabled' });
    assert.equal(payload.max_tokens, 1200);
});

test('non-Kimi Anthropic requests do not receive a vendor-specific thinking field', () => {
    const payload = buildAnthropicRequestPayload(
        [{ role: 'user', content: 'return json' }],
        { maxTokens: 1200, thinking: false },
        'claude-sonnet',
        'https://api.anthropic.com/v1'
    );

    assert.equal(payload.thinking, undefined);
});
