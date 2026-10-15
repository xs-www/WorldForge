// 自由创作 Agent 的多轮工具调用。
// runAgentLoop 是纯编排：模型调用与工具执行都由调用方注入，便于用脚本化假模型测试。
const DEFAULT_MAX_ROUNDS = 6;
const DEFAULT_MAX_TOOL_CALLS = 12;

function parseArguments(raw) {
  if (raw && typeof raw === 'object') return { value: raw };
  const source = String(raw ?? '').trim();
  if (!source) return { value: {} };
  try {
    const value = JSON.parse(source);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: '工具参数必须是 JSON 对象' };
    return { value };
  } catch {
    return { error: '工具参数不是合法 JSON' };
  }
}

function normalizeCalls(value) {
  return (Array.isArray(value) ? value : []).map((call, index) => ({
    id: String(call?.id || `call_${index + 1}`),
    name: String(call?.name || ''),
    arguments: call?.arguments
  })).filter(call => call.name);
}

export async function runAgentLoop(options = {}) {
  const {
    messages = [],
    tools = [],
    callModel,
    runTool,
    maxRounds = DEFAULT_MAX_ROUNDS,
    maxToolCalls = DEFAULT_MAX_TOOL_CALLS,
    onTrace = () => {}
  } = options;
  if (typeof callModel !== 'function') throw new Error('runAgentLoop 需要一个 callModel');
  if (typeof runTool !== 'function') throw new Error('runAgentLoop 需要一个 runTool');

  const transcript = (Array.isArray(messages) ? messages : []).map(item => ({ ...item }));
  const trace = [];
  let round = 0;
  let stopped = 'answer';

  while (round < maxRounds) {
    round += 1;
    const budgetLeft = trace.length < maxToolCalls;
    const response = await callModel({ messages: transcript, tools: budgetLeft ? tools : [] });
    const text = String(response?.text || '').trim();
    const calls = normalizeCalls(response?.toolCalls);
    if (!calls.length) return finish(text, trace.length >= maxToolCalls ? 'tool_budget' : 'answer');
    if (!budgetLeft) return finish(text, 'tool_budget');

    transcript.push({ role: 'assistant', content: text, toolCalls: calls });
    for (const call of calls) {
      const parsed = parseArguments(call.arguments);
      const outcome = parsed.error
        ? { ok: false, summary: parsed.error, content: JSON.stringify({ error: parsed.error }) }
        : runTool(call.name, parsed.value);
      const record = { round, name: call.name, ok: outcome.ok !== false, summary: String(outcome.summary || '') };
      trace.push(record);
      onTrace(record);
      transcript.push({ role: 'tool', toolCallId: call.id, name: call.name, content: String(outcome.content ?? '') });
    }
    if (trace.length >= maxToolCalls) stopped = 'tool_budget';
  }

  // 轮次用尽但模型仍在请求工具：强制它基于已有资料作答，不再提供工具。
  const forced = await callModel({
    messages: [...transcript, { role: 'user', content: '已达到本次检索上限。请只依据上面已经取得的资料直接给出最终回答，不要再请求工具；资料不足的部分明确说明。' }],
    tools: []
  });
  if (stopped !== 'tool_budget') stopped = 'round_limit';
  return finish(String(forced?.text || '').trim(), stopped);

  function finish(reply, reason) {
    return { reply, trace, rounds: round, toolCalls: trace.length, stopped: reason };
  }
}

function postJson(fetchImpl, url, key, body, timeout) {
  return fetchImpl(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout)
  }).then(async response => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error?.message || `模型服务返回 ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return data;
  });
}

export function toolsForChat(tools) {
  return (Array.isArray(tools) ? tools : []).map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } }));
}

export function toolsForResponses(tools) {
  return (Array.isArray(tools) ? tools : []).map(tool => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters }));
}

function wireArguments(value) {
  return typeof value === 'string' ? value : JSON.stringify(value ?? {});
}

export function buildChatMessages(system, messages) {
  const out = [{ role: 'system', content: String(system || '') }];
  (Array.isArray(messages) ? messages : []).forEach(item => {
    if (item?.role === 'assistant') {
      const calls = Array.isArray(item.toolCalls) ? item.toolCalls : [];
      out.push({
        role: 'assistant',
        content: String(item.content || ''),
        ...(calls.length ? { tool_calls: calls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: wireArguments(call.arguments) } })) } : {})
      });
      return;
    }
    if (item?.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: String(item.toolCallId || ''), content: String(item.content || '') });
      return;
    }
    out.push({ role: 'user', content: String(item?.content || '') });
  });
  return out;
}

export function buildResponsesInput(messages) {
  const out = [];
  (Array.isArray(messages) ? messages : []).forEach(item => {
    if (item?.role === 'assistant') {
      const text = String(item.content || '');
      if (text) out.push({ role: 'assistant', content: [{ type: 'output_text', text }] });
      (Array.isArray(item.toolCalls) ? item.toolCalls : []).forEach(call => out.push({ type: 'function_call', call_id: call.id, name: call.name, arguments: wireArguments(call.arguments) }));
      return;
    }
    if (item?.role === 'tool') {
      out.push({ type: 'function_call_output', call_id: String(item.toolCallId || ''), output: String(item.content || '') });
      return;
    }
    out.push({ role: 'user', content: [{ type: 'input_text', text: String(item?.content || '') }] });
  });
  return out;
}

export function parseChatText(data) {
  return String(data?.choices?.[0]?.message?.content || '');
}

export function parseChatToolCalls(data) {
  const calls = data?.choices?.[0]?.message?.tool_calls;
  return (Array.isArray(calls) ? calls : []).map(call => ({ id: String(call?.id || ''), name: String(call?.function?.name || ''), arguments: call?.function?.arguments }));
}

export function parseResponsesText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text;
  return (Array.isArray(data?.output) ? data.output : [])
    .flatMap(item => (Array.isArray(item?.content) ? item.content : []))
    .filter(part => part?.type === 'output_text')
    .map(part => part.text || '')
    .join('\n');
}

export function parseResponsesToolCalls(data) {
  return (Array.isArray(data?.output) ? data.output : [])
    .filter(item => item?.type === 'function_call')
    .map(item => ({ id: String(item.call_id || item.id || ''), name: String(item.name || ''), arguments: item.arguments }));
}

// 把两种 API 风格统一成一个 callModel({messages, tools}) 接口。
export function createToolCaller({ config, system, fetchImpl = fetch, timeout = 90000 }) {
  if (!config?.key) throw new Error('createToolCaller 需要已配置的模型密钥');
  const style = config.style === 'chat' ? 'chat' : 'responses';
  const baseUrl = String(config.baseUrl || '').replace(/\/$/, '');
  return async function callModel({ messages = [], tools = [] }) {
    const useTools = Array.isArray(tools) && tools.length > 0;
    if (style === 'chat') {
      const body = { model: config.model, messages: buildChatMessages(system, messages), ...(useTools ? { tools: toolsForChat(tools), tool_choice: 'auto' } : {}) };
      const data = await postJson(fetchImpl, `${baseUrl}/chat/completions`, config.key, body, timeout);
      return { text: parseChatText(data), toolCalls: parseChatToolCalls(data) };
    }
    const body = { model: config.model, instructions: String(system || ''), input: buildResponsesInput(messages), ...(useTools ? { tools: toolsForResponses(tools), tool_choice: 'auto' } : {}) };
    const data = await postJson(fetchImpl, `${baseUrl}/responses`, config.key, body, timeout);
    return { text: parseResponsesText(data), toolCalls: parseResponsesToolCalls(data) };
  };
}
