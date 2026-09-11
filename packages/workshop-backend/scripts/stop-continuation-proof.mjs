// Review reproducer /tmp/mv-beta-stop-review-suspended.mjs, promoted to a safety assertion.
// --parent must FAIL (actual counterexample), current source must PASS. No provider/native claim.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {stripTypeScriptTypes} from 'node:module';
import {createHash, randomUUID} from 'node:crypto';
const source = process.argv.includes('--parent')
  ? execFileSync('git', ['show', '0845aeb:packages/workshop-backend/src/overseer.ts'], {encoding:'utf8', cwd:new URL('../../../', import.meta.url)})
  : fs.readFileSync(new URL('../src/overseer.ts', import.meta.url),'utf8');
const evidence=[];
function slice(a,b) {const x=source.indexOf(a), y=source.indexOf(b,x);assert(x>=0&&y>x);assert.equal(source.indexOf(a,x+1),-1); const text=source.slice(x,y);evidence.push({line:source.slice(0,x).split('\n').length,sha256:createHash('sha256').update(text).digest('hex')});return text;}
const stop=slice('  #ownsExecution(chatId:', '\n  // Describe a workpiece');
const start=slice('  startAgent(chatId: number,','\n  #runAgentTurn(chatId: number,');
const resume=slice('  async #resumeSuspendedAgent(chatId: number','\n  async acceptConnectionRequest(');
const ownership=source.includes('  canContinueAgent(chatId:')
  ? slice('  canContinueAgent(chatId:', '\n  // Start an agent turn') : '';
const register=slice('  #registerRunningAgent(chatId: number) {','\n  // Tear down all bookkeeping');
const unregister=slice('  #unregisterRunningAgent(chatId: number) {','\n  #updateExternalMessageResponseDeliveryAlarm()');
const generated=`class OverseerImpl {
#liveChats=new Map(); #runningAgents=new Set(); #allAgentsIdleWaiters=[]; #specialistChildren=new Map(); static #AGENT_KEEPALIVE_ALARM_MS=60000;
turns=[]; ctx={storage:{setAlarm(){},async sync(){}}};
constructor(storage){this.storage=storage;}
#getLiveChat(id){if(!this.#liveChats.has(id)) this.#liveChats.set(id,{cancelController:new AbortController(),pendingAgentCallbacks:[],activeAgentCallbacks:new Map()});return this.#liveChats.get(id);}
getChatAgentContext(){return {};}
waitForChatMessagePreparation(){}
getChatTimestamp(){return 123;}
#deliverWaitingExternalMessageResponse(){}
#updateExternalMessageResponseDeliveryAlarm(){}
#runAgentTurn(chatId,model,initiator,callback,live){this.turns.push({chatId,executionId:live.executionId,aborted:live.cancelController.signal.aborted});return Promise.resolve();}
${stop}${register}${unregister}${start}${ownership}
}
class Session {
#clientUser;
constructor(impl,user){this.impl=impl;this.#clientUser=user;}
resume(id){return this.#resumeSuspendedAgent(id, 'stopped-old');}
${resume}
}
globalThis.fixture={Impl:OverseerImpl,Session};`;
const sandbox={AbortController,crypto:{randomUUID},retryOnDoReset:fn=>fn(),keyString:String};vm.createContext(sandbox);
vm.runInContext(stripTypeScriptTypes(generated,{mode:'transform'}),sandbox);
function table(key,rows){const map=new Map(rows.map(r=>[r[key],structuredClone(r)]));return {get:id=>structuredClone(map.get(id)),put:r=>map.set(r[key],structuredClone(r)),delete:id=>map.delete(id),list:()=>[...map.values()].map(r=>structuredClone(r))};}
const results=[];
for(const mode of ['approval after Stop ACK','Stop during approval model await']){
 const storage={agentContinuations:table('chatId',[{chatId:7,id:'stopped-old'}]),activeAgents:table('chatId',[{chatId:7,executionId:'stopped-old'}]),chatMeta:table('id',[{id:7,...(mode==='approval after Stop ACK'?{activeAgent:{id:'model'}}:{})}]),chats:table('sequence',[{sequence:1,author:{type:'agent',id:'model'}}])};
 const impl=new sandbox.fixture.Impl(storage);let release;const modelReady=new Promise(r=>release=r);let entered;const lookup=new Promise(r=>entered=r);
 const user={id:{toString:()=> 'fixture-user'},getChatContext(){entered();return modelReady;}};
 const session=new sandbox.fixture.Session(impl,user);
 let pending;
 if(mode==='approval after Stop ACK'){await impl.cancelAgent(7);pending=session.resume(7);} else {pending=session.resume(7);await lookup;await impl.cancelAgent(7);}
 assert.equal(storage.activeAgents.get(7).stopRequested,true);
 release({aiModel:{profile:{id:'model'}},profile:{id:'fixture-user'}});await pending;
 assert.equal(impl.turns.length,0, `${mode}: automatic continuation must not enter a fresh turn`);
 assert.equal(storage.activeAgents.get(7).executionId,'stopped-old');
 assert.equal(storage.activeAgents.get(7).stopRequested,true);
 results.push({mode,stubTurnEntries:impl.turns.length,stopFenceOverwritten:false});
}
console.log(JSON.stringify({kind:'verbatim Stop/start/suspended-resume bodies; synthetic storage, model lookup, turn entry; no native or provider acceptance',sourceSha256:createHash('sha256').update(source).digest('hex'),results,evidence},null,2));
