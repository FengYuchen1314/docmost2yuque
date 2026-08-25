import { onBeforeUnmount, ref } from 'vue'
import * as Y from 'yjs'
import { post } from '../services/api'
import { createUuid } from '../utils/uuid'

const UPDATE=0,AWARENESS=1,SNAPSHOT=2,ACK=3,REMOTE=Symbol('remote')
const delays=[500,1000,2000,5000,10000]
interface Ticket{ticket:string;websocketPath:string;expiresAt:string}
export interface CollaboratorPresence{sessionId:string;userId:string;email:string;color:string;selection?:{start:number;end:number};sentAt:number;lastSeen:number}
export type CollaborationStatus='idle'|'connecting'|'syncing'|'connected'|'reconnecting'|'unavailable'

export function usePageCollaboration(){
  const body=ref('');const status=ref<CollaborationStatus>('idle');const error=ref('');const peers=ref<CollaboratorPresence[]>([]);const lastAcknowledgedSequence=ref<string|null>(null)
  let stopCurrent:()=>void=()=>{};let text:Y.Text|null=null;let initialized=false;let desired='';let editedBeforeInit=false;let sendPresence:(selection?:{start:number;end:number})=>void=()=>{}

  function connect(options:{pageId:string;initialBody:string;userId:string;email:string}){
    stopCurrent();body.value=options.initialBody;desired=options.initialBody;error.value='';status.value='connecting';initialized=false;editedBeforeInit=false
    let stopped=false,socket:WebSocket|null=null,reconnectTimer=0,heartbeatTimer=0,attempt=0,ready=false,sessionId:string=createUuid();let selection:{start:number;end:number}|undefined
    const pending:Uint8Array[]=[];const inFlight:Uint8Array[]=[];const peerMap=new Map<string,CollaboratorPresence>();const doc=new Y.Doc();text=doc.getText('content')
    const refreshPeers=()=>{const now=Date.now();for(const [id,peer]of peerMap)if(now-peer.lastSeen>45000)peerMap.delete(id);peers.value=[...peerMap.values()].sort((a,b)=>a.email.localeCompare(b.email))}
    const sendUpdate=(update:Uint8Array)=>{if(!socket||socket.readyState!==WebSocket.OPEN||!ready){pending.push(update);return}try{socket.send(frame(UPDATE,update).buffer);inFlight.push(update)}catch{pending.push(update)}}
    const flush=()=>{while(pending.length&&socket?.readyState===WebSocket.OPEN&&ready){const update=pending.shift();if(update)sendUpdate(update)}}
    sendPresence=(next=selection)=>{selection=next;if(!socket||socket.readyState!==WebSocket.OPEN||!ready)return;const payload={sessionId,userId:options.userId,email:options.email,color:presenceColor(options.userId),...(selection?{selection}:{}),sentAt:Date.now()};socket.send(frame(AWARENESS,new TextEncoder().encode(JSON.stringify(payload))).buffer)}
    const updateHandler=(update:Uint8Array,origin:unknown)=>{const next=text!.toString();if(initialized||origin!==REMOTE){desired=next;body.value=next}if(origin!==REMOTE)sendUpdate(update)}
    doc.on('update',updateHandler)
    const reconnect=()=>{if(stopped)return;ready=false;while(inFlight.length){const update=inFlight.pop();if(update)pending.unshift(update)};clearInterval(heartbeatTimer);status.value='reconnecting';reconnectTimer=window.setTimeout(open,delays[Math.min(attempt++,delays.length-1)])}
    const handleSnapshot=(payload:Uint8Array)=>{Y.applyUpdate(doc,payload,REMOTE);ready=true;if(!initialized){const empty=Y.encodeStateVector(doc).length===1;if(editedBeforeInit||(empty&&desired.length))replaceText(doc,text!,desired);else{desired=text!.toString();body.value=desired}initialized=true}flush();sendPresence();attempt=0;status.value='connected';heartbeatTimer=window.setInterval(()=>{sendPresence();refreshPeers()},15000)}
    async function open(){if(stopped)return;status.value=attempt?'reconnecting':'connecting';try{const issued=await post<Ticket>('/api/v1/collaboration/ticket',{pageId:options.pageId});if(stopped)return;sessionId=ticketSession(issued.ticket)??createUuid();const protocol=location.protocol==='https:'?'wss:':'ws:';const next=new WebSocket(`${protocol}//${location.host}${issued.websocketPath}?ticket=${encodeURIComponent(issued.ticket)}`);next.binaryType='arraybuffer';socket=next;ready=false;next.onopen=()=>{if(!stopped)status.value='syncing'};next.onmessage=event=>{if(stopped||!(event.data instanceof ArrayBuffer))return;const data=new Uint8Array(event.data);if(data.length<2)return;const kind=data[0],payload=data.subarray(1);try{if(kind===SNAPSHOT)handleSnapshot(payload);else if(kind===UPDATE)Y.applyUpdate(doc,payload,REMOTE);else if(kind===AWARENESS){const value=JSON.parse(new TextDecoder().decode(payload)) as Omit<CollaboratorPresence,'lastSeen'>;if(value.sessionId&&value.sessionId!==sessionId&&value.userId&&value.email){peerMap.set(value.sessionId,{...value,lastSeen:Date.now()});refreshPeers()}}else if(kind===ACK&&payload.length===8){inFlight.shift();lastAcknowledgedSequence.value=new DataView(payload.buffer,payload.byteOffset,8).getBigUint64(0).toString()}}catch{error.value='实时协作数据解析失败，正在重连';next.close()}};next.onerror=()=>next.close();next.onclose=reconnect}catch(value){error.value=value instanceof Error?value.message:'实时协作暂不可用';status.value='unavailable'}}
    void open()
    stopCurrent=()=>{stopped=true;clearTimeout(reconnectTimer);clearInterval(heartbeatTimer);if(socket){socket.onclose=null;socket.close()}doc.off('update',updateHandler);doc.destroy();text=null;initialized=false;sendPresence=()=>{};peers.value=[];status.value='idle'}
  }
  function setBody(value:string){desired=value;body.value=value;if(!text||!initialized){editedBeforeInit=true;return}replaceText(text.doc??null,text,value)}
  function broadcastSelection(start:number,end:number){sendPresence({start,end})}
  function disconnect(){stopCurrent()}
  onBeforeUnmount(disconnect)
  return{body,status,error,peers,lastAcknowledgedSequence,connect,disconnect,setBody,broadcastSelection}
}

export function replaceText(doc:Y.Doc|null,text:Y.Text,next:string){if(!doc||text.toString()===next)return;const current=text.toString();let prefix=0;while(prefix<Math.min(current.length,next.length)&&current[prefix]===next[prefix])prefix++;let suffix=0;while(suffix<current.length-prefix&&suffix<next.length-prefix&&current[current.length-suffix-1]===next[next.length-suffix-1])suffix++;doc.transact(()=>{const count=current.length-prefix-suffix;if(count>0)text.delete(prefix,count);const insertion=next.slice(prefix,next.length-suffix);if(insertion)text.insert(prefix,insertion)})}
export function frame(kind:number,payload:Uint8Array){const value=new Uint8Array(payload.length+1);value[0]=kind;value.set(payload,1);return value}
function ticketSession(ticket:string){try{const payload=ticket.split('.',1)[0];if(!payload)return null;const encoded=payload.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(payload.length/4)*4,'=');return(JSON.parse(atob(encoded)) as {session_id?:string}).session_id??null}catch{return null}}
function presenceColor(value:string){const colors=['#2563eb','#7c3aed','#0891b2','#ea580c','#16a34a','#db2777'];let hash=0;for(let i=0;i<value.length;i++)hash=((hash<<5)-hash+value.charCodeAt(i))|0;return colors[Math.abs(hash)%colors.length]!}
