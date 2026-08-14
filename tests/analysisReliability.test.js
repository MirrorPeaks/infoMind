const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildExtractiveFallbackAnalysis,
    isUsableAnalysisResult,
    parseJsonObject,
    shouldAutoRecoverAnalysis,
} = require('../server/services/analyzer');

test('parseJsonObject accepts fenced JSON with surrounding text', () => {
    const parsed = parseJsonObject('结果如下：\n```json\n{"title":"测试","mind_map":{"nodes":[]}}\n```');

    assert.equal(parsed.ok, true);
    assert.equal(parsed.value.title, '测试');
});

test('parseJsonObject locally repairs truncated model JSON', () => {
    const parsed = parseJsonObject('{"title":"测试","mind_map":{"nodes":[{"label":"观点","children":[]}');

    assert.equal(parsed.ok, true);
    assert.equal(parsed.value.mind_map.nodes[0].label, '观点');
});

test('extractive fallback always provides a renderable mind map from sufficient content', () => {
    const text = [
        '创业公司需要先定义目标，再围绕目标设计组织结构。',
        '招聘的关键不是扩大数量，而是识别真正适合当前阶段的人。',
        '组织沟通需要明确决策依据，减少信息在层级之间的损耗。',
        '创始人必须持续校准战略、人才与执行节奏之间的关系。',
    ].join('\n').repeat(8);
    const result = buildExtractiveFallbackAnalysis({ title: '组织建设', summary: '' }, text, '模型响应异常');

    assert.equal(result.title, '组织建设');
    assert.ok(result.mind_map.nodes.length > 0);
    assert.ok(result.mind_map.nodes.some(node => node.children.length > 0));
    assert.match(result.limitations.join(' '), /模型响应异常/);
});

test('semantic validation rejects a title-only mind map when real content was supplied', () => {
    assert.equal(isUsableAnalysisResult({
        thesis: '因正文解析失败，只能基于标题与元信息整理。',
        content_coverage: '未获得正文',
        mind_map: { nodes: [{ label: '嘉宾背景', children: [{ label: '标题信息' }] }] },
    }), false);
});

test('semantic validation accepts a substantive mind map', () => {
    assert.equal(isUsableAnalysisResult({
        thesis: '组织设计应让战略目标、人才密度与协作机制彼此匹配。',
        content_coverage: '基于完整转写稿',
        mind_map: {
            nodes: [
                { label: '组织目标', children: [{ label: '明确决策依据' }, { label: '降低沟通损耗' }] },
                { label: '人才判断', children: [{ label: '优先人才密度' }, { label: '重视背景调查' }] },
            ],
        },
    }), true);
});

test('legacy structured-output failures are automatically recoverable', () => {
    assert.equal(shouldAutoRecoverAnalysis({
        status: 'failed',
        error: '模型返回的解读格式不完整，已尝试自动修复但仍失败。请重试生成。',
    }), true);
    assert.equal(shouldAutoRecoverAnalysis({ status: 'failed', error: 'HTTP 401 Unauthorized' }), false);
    assert.equal(shouldAutoRecoverAnalysis({ status: 'done', error: null }), false);
});
