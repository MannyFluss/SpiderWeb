import {createHermesChat} from './hermes-chat.js';
export function createHermesReader({button,request,storage=localStorage,scope}){
 const dialog=document.createElement('dialog');dialog.setAttribute('aria-label','Hermes reader');dialog.style.cssText='box-sizing:border-box;width:min(760px,100vw);height:min(850px,95dvh);padding:16px;overflow:hidden';
 const close=document.createElement('button');close.type='button';close.textContent='Close Hermes';const body=document.createElement('div');body.style.cssText='height:calc(100% - 45px);display:flex;flex-direction:column;min-height:0';dialog.append(close,body);document.body.append(dialog);let chat;
 close.onclick=()=>dialog.close();dialog.addEventListener('close',()=>{chat?.destroy();chat=null;body.replaceChildren();});
 button.onclick=()=>{if(dialog.open)return;const key='spider.hermes.reader.v1:'+scope();let data={};try{data=JSON.parse(storage.getItem(key)||'{}');}catch{}
 const write=(path,value)=>{let target=data;for(const k of path.slice(0,-1))target=target[k]??={};target[path.at(-1)]=value;try{storage.setItem(key,JSON.stringify(data));}catch{throw Error('Browser cannot retain your Hermes draft.');}};
 dialog.showModal();chat=createHermesChat(body,{space:'shared',read:()=>data,write,request:(_service,args)=>{const actions={'chat-status':'status','chat-history':'history','chat-send':'terminal-input'};return request({...args,action:actions[args.action]}).then(result=>args.action==='chat-status'?{...result,work:(result.work||[]).map(w=>({...w,id:typeof w.id==='string'&&!w.id.startsWith('chat:')?'chat:frontend:'+w.id:w.id}))}:result);}});};
}
