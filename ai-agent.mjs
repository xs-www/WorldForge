// 自由创作 Agent 的多轮工具调用。
// runAgentLoop 是纯编排：模型调用与工具执行都由调用方注入，便于用脚本化假模型测试。
const DEFAULT_MAX_ROUNDS = 6;
const DEFAULT_MAX_TOOL_CALLS = 12;
const AGENT_IMAGE_CAP = 4;

function countImages(messages) {
  return (Array.isArray(messages) ? messages : []).reduce((sum, item) => sum + (Array.isArray(item?.images) ? item.images.length : 0), 0);
}

// 模型接口不接受图片时，把已附图的消息改写成文字说明，而不是静默丢图。
function stripImages(messages) {
  messages.forEach(item => {
    if (!Array.isArray(item?.images) || !item.images.length) return;
    item.content = `${item.content}\n（已移除 ${item.images.length} 张图片：当前模型接口不接受图片输入，请仅依据文字资料作答，并说明你看不到画面。）`;
    delete item.images;
  });
}

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
  let vision = 'none';
  let imagesAttached = 0;

  // 工具消息不能携带图片，因此附图作为紧随其后的用户消息发出。
  // 模型接口拒绝图片时只降级一次，之后不再附图。
  async function ask(request) {
    const carrying = countImages(transcript);
    try {
      const response = await callModel(request);
      if (carrying) vision = 'ok';
      return response;
    } catch (error) {
      if (!carrying || vision === 'unavailable' || ![400, 404, 422].includes(error.status)) throw error;
      vision = 'unavailable';
      stripImages(transcript);
      return await callModel(request);
    }
  }

  while (round < maxRounds) {
    round += 1;
    const budgetLeft = trace.length < maxToolCalls;
    const response = await ask({ messages: transcript, tools: budgetLeft ? tools : [] });
    const text = String(response?.text || '').trim();
    const calls = normalizeCalls(response?.toolCalls);
    if (!calls.length) return finish(text, trace.length >= maxToolCalls ? 'tool_budget' : 'answer');
    if (!budgetLeft) return finish(text, 'tool_budget');

    transcript.push({ role: 'assistant', content: text, toolCalls: calls });
    const roundImages = [];
    const roundLabels = [];
    for (const call of calls) {
      const parsed = parseArguments(call.arguments);
      const outcome = parsed.error
        ? { ok: false, summary: parsed.error, content: JSON.stringify({ error: parsed.error }) }
        : await runSafely(call.name, parsed.value);
      const images = (Array.isArray(outcome?.images) ? outcome.images : []).filter(Boolean);
      const record = { round, name: call.name, ok: outcome.ok !== false, summary: String(outcome.summary || '') };
      if (images.length) record.images = Math.min(images.length, AGENT_IMAGE_CAP);
      trace.push(record);
      onTrace(record);
      transcript.push({ role: 'tool', toolCallId: call.id, name: call.name, content: String(outcome.content ?? '') });
      if (images.length) {
        roundImages.push(...images);
        roundLabels.push(`${call.name}（${Math.min(images.length, AGENT_IMAGE_CAP)} 张）`);
      }
    }
    if (roundImages.length) {
      const attached = roundImages.slice(0, AGENT_IMAGE_CAP);
      imagesAttached += attached.length;
      transcript.push({ role: 'user', content: `以上工具结果为 ${roundLabels.join('、')} 附上了实际画面。请直接依据画面回答；如果图片与文字描述不一致，以图片为准并说明差异。`, images: attached });
    }
    if (trace.length >= maxToolCalls) stopped = 'tool_budget';
  }

  // 轮次用尽但模型仍在请求工具：强制它基于已有资料作答，不再提供工具。
  const forced = await ask({
    messages: [...transcript, { role: 'user', content: '已达到本次检索上限。请只依据上面已经取得的资料直接给出最终回答，不要再请求工具；资料不足的部分明确说明。' }],
    tools: []
  });
  if (stopped !== 'tool_budget') stopped = 'round_limit';
  return finish(String(forced?.text || '').trim(), stopped);

  async function runSafely(name, args) {
    try {
      return await runTool(name, args);
    } catch (error) {
      return { ok: false, summary: `工具执行异常：${error.message}`, content: JSON.stringify({ error: String(error.message || '工具执行异常') }) };
    }
  }

  function finish(reply, reason) {
    return { reply, trace, rounds: round, toolCalls: trace.length, stopped: reason, vision, images: imagesAttached };
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
    const images = Array.isArray(item?.images) ? item.images : [];
    out.push(images.length
      ? { role: 'user', content: [{ type: 'text', text: String(item?.content || '') }, ...images.map(url => ({ type: 'image_url', image_url: { url, detail: 'auto' } }))] }
      : { role: 'user', content: String(item?.content || '') });
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
    const images = Array.isArray(item?.images) ? item.images : [];
    out.push({ role: 'user', content: [{ type: 'input_text', text: String(item?.content || '') }, ...images.map(url => ({ type: 'input_image', image_url: url, detail: 'auto' }))] });
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
