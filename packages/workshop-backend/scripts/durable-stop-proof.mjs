// Mechanical regression for /tmp/mv-beta-stop-reopen-proof/repro.mjs's counterexample.
// Native SQLite acceptance is in __tests__/durable-stop.test.ts. This shell is NOT a DO.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';
const source = fs.readFileSync(new URL('../src/overseer.ts', import.meta.url), 'utf8');
const usage = fs.readFileSync(new URL('../src/deployment-usage.ts', import.meta.url), 'utf8');
const evidence = [];
function slice(start, end, name) {
  const a = source.indexOf(start); assert(a >= 0, name);
  assert.equal(source.indexOf(start, a + 1), -1, `unique ${name}`);
  const b = source.indexOf(end, a); assert(b > a, name);
  const text = source.slice(a, b);
  evidence.push({name, firstLine: source.slice(0, a).split('\n').length,
    sha256: createHash('sha256').update(text).digest('hex')});
  return text;
}
const cancel = slice('  #ownsExecution(chatId:', '\n  // Describe a workpiece', 'identity/Stop');
const stop = slice('  async stopAgent(chatId: number): Promise<void> {', '\n  async retryAgent(', 'Stop RPC');
const register = slice('  #registerRunningAgent(chatId: number) {', '\n  // Tear down all bookkeeping', 'register');
const unregister = slice('  #unregisterRunningAgent(chatId: number) {', '\n  #updateExternalMessageResponseDeliveryAlarm()', 'unregister');
const resume = slice('  async #resumeAgent(record: ActiveAgentRecord, liveChat: LiveChatContext) {', '\n  constructor(public ctx:', 'resume');
const recovery = slice('  #resumeInterruptedAgents(): void {', '\n  // Runs the git-storage migration', 'recovery');
const cleanup = slice('      const rootId = liveChat.specialistRootId;\n      const rootRecord', '\n    }\n  }\n\n  // Resolve a agent callback', 'whole finally');
const callbacks = slice('  async #startAgentForCallbacks(', '\n  getChatAgentContext(', 'callback admission');
const generated = `
${usage.replace(/^import .*;\n/gm, '').replace(/^export /gm, '')}
class OverseerImpl {
 static #AGENT_KEEPALIVE_ALARM_MS = 60000;
 #liveChats = new Map(); #runningAgents = new Set(); #allAgentsIdleWaiters = [];
 #specialistChildren = new Map();
 child(id, rootId, root) {this.#specialistChildren.set(id,{root});this.rootChatId=rootId;}
 getChatAgentContext() {return {specialist:{rootChatId:this.rootChatId}};}
 attempts = []; turns = []; finishes = []; notices = []; reconciles = 0;
 constructor(storage) {
  this.storage = storage; this.ctx = {storage:{setAlarm(){}, async sync(){}}}; this.env = {};
  this.logger = {error(){}};
  this.users = {idFromString: x=>x, get: id=>{this.attempts.push(id);return {getChatContext: async()=>({aiModel:{profile:{id:'fixture'}}})};}};
 }
 #getLiveChat(id) { if(!this.#liveChats.has(id)) this.#liveChats.set(id, {
  executionId:this.storage.activeAgents.get(id)?.executionId,
  cancelController:new AbortController(), activeAgentCallbacks:new Map(), pendingAgentCallbacks:[]
 }); return this.#liveChats.get(id); }
 live(id) {return this.#getLiveChat(id);}
 replaceLive(id, live) {this.#liveChats.set(id,live);}
 recover() { this.#resumeInterruptedAgents(); }
 callbacks(meta, live) {return this.#startAgentForCallbacks(meta, live);}
 waitForChatMessagePreparation() {}
 #runAgentTurn(chatId, model, initiator, callback, live) {this.turns.push({chatId, aborted:live.cancelController.signal.aborted}); return Promise.resolve();}
 #updateExternalMessageResponseDeliveryAlarm() {}
 #deliverWaitingExternalMessageResponse() {}
 #finishSpecialistRecord(record, status) {this.finishes.push({id:record.id,status});}
 postAgentErrorMessage(...args) {this.notices.push(args);}
 getChatTimestamp() {return 123;}
 async reconcilePendingGadgets() {this.reconciles++;}
 ${register}${unregister}${cancel}${resume}${recovery}${callbacks}
 async finalize(chatId, liveChat) {
  let accessWatch, usageAbort, byokOwnerStub;
 ${cleanup}
 }
}
class Session {constructor(impl){this.impl=impl;} ${stop}}
globalThis.fixture = {OverseerImpl, Session, UsageScope};
`;
let tick = 100000; let nextTimer = 0; let nextId = 0; const timers = new Map();
const sandbox = {AbortController, Symbol, RpcTarget:class {}, crypto:{randomUUID(){return `fixture-${++nextId}`;}},
 Date:class extends Date {static now(){return tick;}},
 setTimeout(fn, delay){const id=++nextTimer;timers.set(id,{fn,at:tick+delay});return id;},
 clearTimeout(id){timers.delete(id);},
 keyString: id=>String(id), refreshCachedBalance(){throw Error('unexpected billing');}};
vm.createContext(sandbox);
vm.runInContext(stripTypeScriptTypes(generated, {mode:'transform',disableExperimentalWarning:true}), sandbox);
const {OverseerImpl,Session,UsageScope} = sandbox.fixture;
const flush = async()=>{for(let i=0;i<30;i++) await Promise.resolve();};
const advance = async ms=>{tick+=ms;for(const [id,t] of timers) if(t.at<=tick){timers.delete(id);t.fn();}await flush();};
function table(key, rows=[]) {const data=new Map(rows.map(x=>[x[key],structuredClone(x)]));return {
 get:id=>data.has(id)?structuredClone(data.get(id)):undefined,
 put:x=>data.set(x[key],structuredClone(x)), delete:id=>data.delete(id), list:()=>[...data.values()].map(x=>structuredClone(x))};}
function store() {return {agentContinuations:table('chatId'),activeAgents:table('chatId',[{executionId:'old-execution',chatId:7,initiatorUserId:'synthetic-user',modelId:'fixture',initiator:{id:'fixture'},callbackInitiated:false}]),
 chatMeta:table('id',[{id:7,activeAgent:{id:'fixture'}}]), specialistRecords:{get(){},byRoot:{list:()=>[]}},chats:{list:()=>[]}};}
function reopen(storage) {const fresh=new OverseerImpl(storage);fresh.recover();return fresh;}
async function stalled() {
 const storage=store();const impl=new OverseerImpl(storage);const live=impl.live(7);
 let release;let finishCalls=0;
 const pending=new Promise(resolve=>{release=resolve;});
 live.usageScope=await UsageScope.open({getGrant:async()=>({allowed:true,runId:'synthetic-run',expiresAt:tick+900000}),
 finish(){finishCalls++;return pending;},[Symbol.dispose](){}});
 await new Session(impl).stopAgent(7);
 assert.equal(live.cancelController.signal.aborted,true);
 assert.equal(storage.activeAgents.get(7).stopRequested,true);
 let done=false;const cleanup=impl.finalize(7,live).then(()=>{done=true;});await flush();
 assert.equal(finishCalls,1);assert.equal(done,false);
 return {storage,impl,live,cleanup,release,done:()=>done};
}
const results=[];
{
 const f=await stalled();const disk=store();disk.activeAgents.put(f.storage.activeAgents.get(7));
 const fresh=reopen(disk);await flush();assert.equal(fresh.attempts.length,0);assert.equal(fresh.turns.length,0);
 f.release();await f.cleanup;assert.equal(f.storage.activeAgents.get(7).stopRequested,true);
 const after=reopen(f.storage);await flush();assert.equal(after.attempts.length,0);
 results.push('ACK + stalled finish + snapshot reopen: zero model lookups / stub turns; released cleanup: zero recovery');
}
{
 const f=await stalled();await advance(4999);assert.equal(f.done(),false);
 const disk=store();disk.activeAgents.put(f.storage.activeAgents.get(7));
 const fresh=reopen(disk);await flush();assert.equal(fresh.attempts.length,0);
 await advance(1);await f.cleanup;assert.equal(f.storage.activeAgents.get(7).stopRequested,true);
 results.push('actual UsageScope 5000ms finalization bound exercised with virtual clock');
}
{
 const storage=store();const impl=new OverseerImpl(storage);
 await new Session(impl).stopAgent(7);await new Session(impl).stopAgent(7);
 const fresh=reopen(storage);await flush();assert.equal(fresh.attempts.length,0);
 results.push('no live context + repeated Stop: zero recovery');
}
{
 const storage=store();const impl=new OverseerImpl(storage);let release;
 impl.users.get=()=>({getChatContext:()=>new Promise(r=>{release=r;})});
 impl.recover();await impl.cancelAgent(7);release({aiModel:{profile:{id:'fixture'}}});await flush();
 assert.equal(impl.turns.length,0);assert.equal(storage.activeAgents.get(7).stopRequested,true);
 results.push('Stop during recovery model await: zero stub turn entries');
}
{
 const f=await stalled();f.storage.activeAgents.put({chatId:7,executionId:'new-execution'});
 f.storage.chatMeta.put({id:7,activeAgent:{id:'new-run'}});
 const newLive={executionId:'new-execution'};f.impl.replaceLive(7,newLive);
 f.release();await f.cleanup;
 assert.equal(f.storage.activeAgents.get(7).executionId,'new-execution');
 assert.equal(f.storage.chatMeta.get(7).activeAgent.id,'new-run');assert.equal(f.impl.live(7),newLive);
 assert.equal(f.impl.reconciles,0);
 results.push('old finalizer cannot delete new row/meta/live or start reconciliation');
}
{
 const storage=store();const impl=new OverseerImpl(storage);const live=impl.live(7);live.specialistRootId='old-root';
 storage.activeAgents.put({chatId:7,executionId:'new-execution',specialistRootId:'new-root'});
 storage.specialistRecords.get=id=>({id,status:'running'});
 await impl.finalize(7,live);assert.equal(impl.finishes.length,1);assert.equal(impl.finishes[0].id,'old-root');
 results.push('old finally finishes captured old root, never new root');
}
{
 const storage=store();storage.activeAgents.delete(7);const impl=new OverseerImpl(storage);const live=impl.live(7);
 let release;let rejected=0;impl.users.get=()=>({getChatContext:()=>new Promise(r=>{release=r;})});
 live.pendingAgentCallbacks.push({initiatorUserId:'fixture',initiatorModelId:'fixture',reject(){rejected++;}});
 const pending=impl.callbacks({id:7},live);await impl.cancelAgent(7);
 release({aiModel:{profile:{id:'fixture'}}});await pending;
 assert(rejected>=1);assert.equal(impl.turns.length,0);
 results.push('Stop during callback model await: rejected, no continuation');
}
{
 const storage=store();const legacy=storage.activeAgents.get(7);delete legacy.executionId;storage.activeAgents.put(legacy);
 const impl=reopen(storage);await flush();
 assert(storage.activeAgents.get(7).executionId);assert.equal(impl.turns.length,1);
 await impl.cancelAgent(7);const fresh=reopen(storage);await flush();assert.equal(fresh.turns.length,0);
 results.push('legacy running row assigned stable identity before lookup; subsequent Stop fences recovery');
}
{
 const storage=store();storage.activeAgents.delete(7);const impl=new OverseerImpl(storage);const live=impl.live(7);
 let release;let rejected=0;impl.users.get=()=>({getChatContext:()=>new Promise(r=>{release=r;})});
 live.pendingAgentCallbacks.push({initiatorUserId:'fixture',initiatorModelId:'fixture',reject(){rejected++;}});
 const pending=impl.callbacks({id:7},live);
 const newLive={executionId:'new-execution'};impl.replaceLive(7,newLive);
 release({aiModel:{profile:{id:'fixture'}}});await pending;
 assert.equal(rejected,1);assert.equal(impl.turns.length,0);assert.equal(impl.live(7),newLive);
 results.push('old callback model continuation cannot enter a newer live context');
}
{
 const storage=store();const impl=new OverseerImpl(storage);const root=impl.live(7);
 impl.child(8,7,root);await impl.cancelAgent(8);
 assert.equal(storage.activeAgents.get(7).stopRequested,true);assert(root.cancelController.signal.aborted);
 const newer={executionId:'new-execution',cancelController:new AbortController()};
 storage.activeAgents.put({chatId:7,executionId:'new-execution'});impl.replaceLive(7,newer);
 await impl.cancelAgent(8);assert.equal(storage.activeAgents.get(7).stopRequested,undefined);
 assert.equal(newer.cancelController.signal.aborted,false);
 results.push('live specialist Stop fences captured coordinator; old child cannot stop newer coordinator');
}
console.log(JSON.stringify({kind:'mechanically extracted production bodies + synthetic infrastructure; NOT native paid-dispatch proof',
 sourceSha256:createHash('sha256').update(source).digest('hex'),results,extractions:evidence},null,2));
