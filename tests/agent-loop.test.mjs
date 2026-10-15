import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChatMessages, buildResponsesInput, createToolCaller, parseChatText, parseChatToolCalls, parseResponsesText, parseResponsesToolCalls, runAgentLoop, toolsForChat, toolsForResponses } from '../ai-agent.mjs';
import { FREE_AGENT_TOOLS, prepareLibrary, runToolCall } from '../ai-tools.mjs';

const library=prepareLibrary([
  {id:'FAC-W01-001',type:'faction',name:'工业联盟',status:'canon',worldId:'W01',summary:'工业城市联合',details:'以蕴魔矿贸易为核心'},
  {id:'MAG-W01-001',type:'magic',name:'火系术式',status:'proposed',worldId:'W01',summary:'基础派系',details:'以太亲和引导热能'}
]);

// 用脚本化的假模型驱动循环：每一步给出预设响应。
function scriptedModel(steps){
  const calls=[];
  const callModel=async request=>{
    calls.push({messageCount:request.messages.length,toolCount:Array.isArray(request.tools)?request.tools.length:0,lastRole:request.messages.at(-1)?.role});
    const step=steps.shift();
    if(!step)throw new Error('假模型没有更多脚本步骤');
    return typeof step==='function'?step(request):step;
  };
  return {callModel,calls};
}
const toolRunner=(name,args)=>runToolCall(name,args,library);

test('an agent that needs no tools answers in one round',async()=>{
  const {callModel,calls}=scriptedModel([{text:'直接回答',toolCalls:[]}]);
  const result=await runAgentLoop({messages:[{role:'user',content:'你好'}],tools:FREE_AGENT_TOOLS,callModel,runTool:toolRunner});
  assert.equal(result.reply,'直接回答');
  assert.equal(result.rounds,1);
  assert.equal(result.toolCalls,0);
  assert.equal(result.stopped,'answer');
  assert.deepEqual(result.trace,[]);
  assert.equal(calls[0].toolCount,FREE_AGENT_TOOLS.length);
});

test('the agent can look an entry up and then answer in a later round',async()=>{
  const {callModel,calls}=scriptedModel([
    {text:'',toolCalls:[{id:'c1',name:'search_lore',arguments:JSON.stringify({query:'工业'})}]},
    request=>{
      const toolTurn=request.messages.find(item=>item.role==='tool');
      assert.match(toolTurn.content,/FAC-W01-001/);
      assert.equal(toolTurn.toolCallId,'c1');
      return {text:'',toolCalls:[{id:'c2',name:'get_lore_entry',arguments:JSON.stringify({ids:['FAC-W01-001']})}]};
    },
    request=>{
      const last=request.messages.at(-1);
      assert.match(last.content,/蕴魔矿贸易/);
      return {text:'工业联盟以蕴魔矿贸易为核心。',toolCalls:[]};
    }
  ]);
  const result=await runAgentLoop({messages:[{role:'user',content:'工业联盟是什么'}],tools:FREE_AGENT_TOOLS,callModel,runTool:toolRunner});
  assert.equal(result.rounds,3);
  assert.equal(result.reply,'工业联盟以蕴魔矿贸易为核心。');
  assert.deepEqual(result.trace.map(item=>item.name),['search_lore','get_lore_entry']);
  assert.deepEqual(result.trace.map(item=>item.ok),[true,true]);
  assert.equal(calls[1].toolCount,FREE_AGENT_TOOLS.length);
});

test('trace reports each call with a human-readable summary',async()=>{
  const seen=[];
  const {callModel}=scriptedModel([
    {text:'',toolCalls:[{id:'c1',name:'list_lore',arguments:'{}'}]},
    {text:'好了',toolCalls:[]}
  ]);
  const result=await runAgentLoop({messages:[],tools:FREE_AGENT_TOOLS,callModel,runTool:toolRunner,onTrace:record=>seen.push(record)});
  assert.equal(seen.length,1);
  assert.equal(seen[0].name,'list_lore');
  assert.match(result.trace[0].summary,/列出 2 \/ 2 条/);
});

test('malformed tool arguments are fed back to the model instead of throwing',async()=>{
  const {callModel}=scriptedModel([
    {text:'',toolCalls:[{id:'c1',name:'search_lore',arguments:'{不是 JSON'}]},
    request=>{
      assert.match(request.messages.at(-1).content,/不是合法 JSON/);
      return {text:'我改用合规参数。',toolCalls:[]};
    }
  ]);
  const result=await runAgentLoop({messages:[],tools:FREE_AGENT_TOOLS,callModel,runTool:toolRunner});
  assert.equal(result.trace[0].ok,false);
  assert.equal(result.reply,'我改用合规参数。');
});

test('an unknown tool is reported back without ending the run',async()=>{
  const {callModel}=scriptedModel([
    {text:'',toolCalls:[{id:'c1',name:'read_env_file',arguments:'{}'}]},
    request=>{
      assert.match(request.messages.at(-1).content,/未知工具/);
      return {text:'我只有只读资料工具。',toolCalls:[]};
    }
  ]);
  const result=await runAgentLoop({messages:[],tools:FREE_AGENT_TOOLS,callModel,runTool:toolRunner});
  assert.equal(result.trace[0].ok,false);
  assert.match(result.trace[0].summary,/未知工具/);
});

test('the tool budget stops further lookups and reports it',async()=>{
  // 预算用尽后模型不再拿到工具，真实模型此时会直接作答。
  const steps=[
    {text:'',toolCalls:[{id:'c0',name:'list_lore',arguments:'{}'}]},
    {text:'',toolCalls:[{id:'c1',name:'list_lore',arguments:'{}'}]},
    {text:'已达到检索上限，仅依据现有资料作答。',toolCalls:[]}
  ];
  const {callModel,calls}=scriptedModel(steps);
  const result=await runAgentLoop({messages:[],tools:FREE_AGENT_TOOLS,callModel,runTool:toolRunner,maxToolCalls:2});
  assert.equal(result.toolCalls,2);
  assert.equal(result.stopped,'tool_budget');
  assert.equal(calls.at(-1).toolCount,0);
  assert.match(result.reply,/检索上限/);
});

test('a model that keeps asking for tools without any is stopped at the budget',async()=>{
  const steps=[
    {text:'',toolCalls:[{id:'c0',name:'list_lore',arguments:'{}'}]},
    {text:'',toolCalls:[{id:'c1',name:'list_lore',arguments:'{}'}]},
    {text:'',toolCalls:[{id:'c2',name:'list_lore',arguments:'{}'}]}
  ];
  const {callModel}=scriptedModel(steps);
  const result=await runAgentLoop({messages:[],tools:FREE_AGENT_TOOLS,callModel,runTool:toolRunner,maxToolCalls:2});
  assert.equal(result.stopped,'tool_budget');
  assert.equal(result.toolCalls,2);
  assert.equal(result.reply,'');
});

test('the round limit forces a final answer without tools',async()=>{
  // 只有 2 轮工具预算，第 3 次调用是被强制收尾的那一次。
  const steps=[
    {text:'',toolCalls:[{id:'c0',name:'list_lore',arguments:'{}'}]},
    {text:'',toolCalls:[{id:'c1',name:'list_lore',arguments:'{}'}]},
    {text:'基于已有资料的结论。',toolCalls:[]}
  ];
  const {callModel,calls}=scriptedModel(steps);
  const result=await runAgentLoop({messages:[],tools:FREE_AGENT_TOOLS,callModel,runTool:toolRunner,maxRounds:2});
  assert.equal(result.rounds,2);
  assert.equal(result.stopped,'round_limit');
  assert.equal(result.reply,'基于已有资料的结论。');
  assert.equal(calls.at(-1).toolCount,0);
  assert.equal(calls.at(-1).lastRole,'user');
});

test('the loop refuses to run without injected collaborators',async()=>{
  await assert.rejects(()=>runAgentLoop({messages:[],tools:[]}),/callModel/);
  await assert.rejects(()=>runAgentLoop({messages:[],tools:[],callModel:async()=>({})}),/runTool/);
});

test('chat-style wire format carries tool calls and tool results',()=>{
  const messages=[
    {role:'user',content:'问题'},
    {role:'assistant',content:'',toolCalls:[{id:'c1',name:'search_lore',arguments:{query:'工业'}}]},
    {role:'tool',toolCallId:'c1',name:'search_lore',content:'{"total":1}'}
  ];
  const wire=buildChatMessages('系统',messages);
  assert.equal(wire[0].role,'system');
  assert.equal(wire[2].tool_calls[0].function.name,'search_lore');
  assert.equal(wire[2].tool_calls[0].function.arguments,'{"query":"工业"}');
  assert.deepEqual(wire[3],{role:'tool',tool_call_id:'c1',content:'{"total":1}'});
  assert.equal(toolsForChat(FREE_AGENT_TOOLS)[0].function.name,'search_lore');
});

test('responses-style wire format carries function calls and outputs',()=>{
  const wire=buildResponsesInput([
    {role:'user',content:'问题'},
    {role:'assistant',content:'想想',toolCalls:[{id:'c1',name:'get_lore_entry',arguments:'{"ids":["X"]}'}]},
    {role:'tool',toolCallId:'c1',content:'{"entries":[]}'}
  ]);
  assert.deepEqual(wire[0],{role:'user',content:[{type:'input_text',text:'问题'}]});
  assert.deepEqual(wire[1],{role:'assistant',content:[{type:'output_text',text:'想想'}]});
  assert.equal(wire[2].type,'function_call');
  assert.equal(wire[2].call_id,'c1');
  assert.deepEqual(wire[3],{type:'function_call_output',call_id:'c1',output:'{"entries":[]}'});
  assert.equal(toolsForResponses(FREE_AGENT_TOOLS)[0].type,'function');
});

test('both provider response shapes are parsed',()=>{
  assert.equal(parseChatText({choices:[{message:{content:'你好'}}]}),'你好');
  assert.deepEqual(parseChatToolCalls({choices:[{message:{tool_calls:[{id:'c1',function:{name:'list_lore',arguments:'{}'}}]}}]}),[{id:'c1',name:'list_lore',arguments:'{}'}]);
  assert.equal(parseResponsesText({output_text:'直接文本'}),'直接文本');
  assert.equal(parseResponsesText({output:[{content:[{type:'output_text',text:'甲'},{type:'output_text',text:'乙'}]}]}),'甲\n乙');
  assert.deepEqual(parseResponsesToolCalls({output:[{type:'function_call',call_id:'c9',name:'search_lore',arguments:'{"query":"a"}'},{type:'message'}]}),[{id:'c9',name:'search_lore',arguments:'{"query":"a"}'}]);
});

test('createToolCaller posts a tools-enabled body and parses calls for each style',async()=>{
  const seen=[];
  const fakeFetch=async(url,init)=>{seen.push({url,body:JSON.parse(init.body)});return{ok:true,json:async()=>({choices:[{message:{content:'',tool_calls:[{id:'c1',function:{name:'list_lore',arguments:'{}'}}]}}]})}};
  const callModel=createToolCaller({config:{key:'k',model:'m',baseUrl:'https://example.test/v1',style:'chat'},system:'系统提示',fetchImpl:fakeFetch});
  const result=await callModel({messages:[{role:'user',content:'列一下'}],tools:FREE_AGENT_TOOLS});
  assert.equal(seen[0].url,'https://example.test/v1/chat/completions');
  assert.equal(seen[0].body.tools[0].function.name,'search_lore');
  assert.equal(seen[0].body.tool_choice,'auto');
  assert.equal(seen[0].body.messages[0].content,'系统提示');
  assert.deepEqual(result.toolCalls,[{id:'c1',name:'list_lore',arguments:'{}'}]);

  const responsesSeen=[];
  const responsesFetch=async(url,init)=>{responsesSeen.push({url,body:JSON.parse(init.body)});return{ok:true,json:async()=>({output:[{type:'function_call',call_id:'r1',name:'search_lore',arguments:'{"query":"x"}'}]})}};
  const responsesCall=createToolCaller({config:{key:'k',model:'m',baseUrl:'https://example.test/v1',style:'responses'},system:'系统提示',fetchImpl:responsesFetch});
  const responsesResult=await responsesCall({messages:[{role:'user',content:'查'}],tools:FREE_AGENT_TOOLS});
  assert.equal(responsesSeen[0].url,'https://example.test/v1/responses');
  assert.equal(responsesSeen[0].body.instructions,'系统提示');
  assert.equal(responsesSeen[0].body.tools[0].type,'function');
  assert.deepEqual(responsesResult.toolCalls,[{id:'r1',name:'search_lore',arguments:'{"query":"x"}'}]);
});

test('createToolCaller omits tools when the loop asks for a tool-less round',async()=>{
  let body=null;
  const fakeFetch=async(url,init)=>{body=JSON.parse(init.body);return{ok:true,json:async()=>({output_text:'收尾'})}};
  const callModel=createToolCaller({config:{key:'k',model:'m',baseUrl:'https://example.test/v1',style:'responses'},system:'s',fetchImpl:fakeFetch});
  const result=await callModel({messages:[{role:'user',content:'x'}],tools:[]});
  assert.equal('tools' in body,false);
  assert.equal(result.text,'收尾');
  assert.throws(()=>createToolCaller({config:{baseUrl:'x',model:'m'}}),/密钥/);
});

test('images returned by a tool are attached as a following user message',async()=>{
  const requests=[];
  const callModel=async request=>{
    requests.push(request.messages.map(item=>({role:item.role,images:(item.images||[]).length})));
    if(requests.length===1)return{text:'',toolCalls:[{id:'c1',name:'get_art_asset',arguments:'{"ids":["ART-1"]}'}]};
    return{text:'画面里是一座锅炉。',toolCalls:[]};
  };
  const runTool=()=>({ok:true,summary:'附上 1 张原画',content:'{"attached":[{"id":"ART-1"}]}',images:['data:image/jpeg;base64,AAAA']});
  const result=await runAgentLoop({messages:[{role:'user',content:'这张图画了什么'}],tools:FREE_AGENT_TOOLS,callModel,runTool});
  assert.equal(result.vision,'ok');
  assert.equal(result.images,1);
  assert.equal(result.trace[0].images,1);
  // 工具消息本身不带图，附图必须出现在紧随其后的用户消息上
  assert.equal(requests[1].some(item=>item.role==='user'&&item.images===1),true);
  assert.equal(requests[1].some(item=>item.role==='tool'&&item.images>0),false);
  assert.equal(result.reply,'画面里是一座锅炉。');
});

test('attached images are capped per round',async()=>{
  const requests=[];
  const callModel=async request=>{
    requests.push(request.messages.map(item=>({role:item.role,images:(item.images||[]).length})));
    if(requests.length===1)return{text:'',toolCalls:[{id:'c1',name:'get_art_asset',arguments:'{"ids":["ART-1"]}'}]};
    return{text:'看完了。',toolCalls:[]};
  };
  const runTool=()=>({ok:true,summary:'附上 6 张原画',content:'{}',images:Array.from({length:6},(_,index)=>`data:image/jpeg;base64,AAAA${index}`)});
  const result=await runAgentLoop({messages:[],tools:FREE_AGENT_TOOLS,callModel,runTool});
  assert.equal(result.images,4);
  assert.equal(result.trace[0].images,4);
  assert.equal(requests[1].find(item=>item.role==='user'&&item.images>0).images,4);
});

test('a model that rejects images degrades once and still answers',async()=>{
  const seen=[];
  let calls=0;
  const callModel=async request=>{
    calls+=1;
    const hasImages=request.messages.some(item=>(item.images||[]).length);
    seen.push(hasImages);
    if(calls===1)return{text:'',toolCalls:[{id:'c1',name:'get_art_asset',arguments:'{"ids":["ART-1"]}'}]};
    if(hasImages){const error=new Error('images unsupported');error.status=400;throw error}
    return{text:'我看不到图片，只能依据文字作答。',toolCalls:[]};
  };
  const runTool=()=>({ok:true,summary:'附上 1 张原画',content:'{}',images:['data:image/jpeg;base64,AAAA']});
  const result=await runAgentLoop({messages:[],tools:FREE_AGENT_TOOLS,callModel,runTool});
  assert.equal(result.vision,'unavailable');
  assert.equal(result.stopped,'answer');
  assert.match(result.reply,/看不到图片/);
  assert.deepEqual(seen,[false,true,false]);
  // 降级后不再把图片留在会话里
  assert.equal(result.trace[0].images,1);
});

test('an unrelated provider error is not swallowed by the image fallback',async()=>{
  let calls=0;
  const callModel=async ()=>{calls+=1;const error=new Error('rate limited');error.status=429;throw error};
  await assert.rejects(()=>runAgentLoop({messages:[],tools:FREE_AGENT_TOOLS,callModel,runTool:()=>({ok:true,content:'{}'})}),error=>error.status===429);
  assert.equal(calls,1);
});

test('both wire formats carry images on user messages',()=>{
  const messages=[{role:'user',content:'看图',images:['data:image/jpeg;base64,AAAA']}];
  const chat=buildChatMessages('系统',messages);
  assert.equal(chat[1].content[0].type,'text');
  assert.equal(chat[1].content[1].type,'image_url');
  assert.equal(chat[1].content[1].image_url.url,'data:image/jpeg;base64,AAAA');
  const responses=buildResponsesInput(messages);
  assert.equal(responses[0].content[0].type,'input_text');
  assert.equal(responses[0].content[1].type,'input_image');
  assert.equal(responses[0].content[1].image_url,'data:image/jpeg;base64,AAAA');
  // 没有图片时保持纯文本形态，避免空 content 数组
  assert.equal(typeof buildResponsesInput([{role:'user',content:'纯文本'}])[0].content[0],'object');
  assert.equal(buildResponsesInput([{role:'user',content:'纯文本'}])[0].content.length,1);
});

test('provider errors keep their HTTP status so the caller can degrade',async()=>{
  const failing=async()=>({ok:false,status:400,json:async()=>({error:{message:'tools unsupported'}})});
  const callModel=createToolCaller({config:{key:'k',model:'m',baseUrl:'https://example.test/v1',style:'chat'},system:'s',fetchImpl:failing});
  await assert.rejects(()=>callModel({messages:[],tools:FREE_AGENT_TOOLS}),error=>error.status===400&&/tools unsupported/.test(error.message));
});
