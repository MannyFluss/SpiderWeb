// Safe Markdown subset: source HTML is never interpreted.
export function renderMarkdown(root,value){
 const doc=root.ownerDocument;root.replaceChildren();root.style.cssText+=';white-space:normal;overflow-wrap:anywhere;line-height:1.55';
 const make=(tag,text)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
 function inline(parent,text){
  const tokens=/(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^\s)]+\))/g;let last=0;
  for(const m of text.matchAll(tokens)){parent.append(doc.createTextNode(text.slice(last,m.index)));const s=m[0];
   if(s.startsWith('`'))parent.append(make('code',s.slice(1,-1)));
   else if(s.startsWith('**'))parent.append(make('strong',s.slice(2,-2)));
   else{const parts=/^\[([^\]]+)\]\((.+)\)$/.exec(s);let url;try{url=new URL(parts[2]);}catch{}
    if(url&&['https:','http:','mailto:'].includes(url.protocol)){const a=make('a',parts[1]);a.href=url.href;a.rel='noopener noreferrer';a.target='_blank';parent.append(a);}else parent.append(doc.createTextNode(s));}
   last=m.index+s.length;
  }parent.append(doc.createTextNode(text.slice(last)));
 }
 let fence=false,code=[],list=null,paragraph=[];
 function flush(){if(paragraph.length){const p=make('p');inline(p,paragraph.join('\n'));p.style.whiteSpace='pre-wrap';root.append(p);paragraph=[];}list=null;}
 function codeBlock(){const pre=make('pre'),c=make('code',code.join('\n'));pre.style.cssText='overflow:auto;max-width:100%;padding:12px;background:rgba(127,127,127,.12);border-radius:8px';pre.append(c);root.append(pre);code=[];}
 for(const line of String(value??'').split(/\r?\n/)){
  if(/^\s*```/.test(line)){flush();if(fence)codeBlock();fence=!fence;continue;}
  if(fence){code.push(line);continue;}
  if(!line.trim()){flush();continue;}
  const heading=/^(#{1,6})\s+(.+)$/.exec(line),item=/^\s*(?:([-*+])|\d+[.)])\s+(.+)$/.exec(line);
  if(heading){flush();const h=make('h'+heading[1].length);inline(h,heading[2]);root.append(h);}
  else if(item){if(paragraph.length)flush();const tag=item[1]?'ul':'ol';if(!list||list.tagName.toLowerCase()!==tag){list=make(tag);root.append(list);}const li=make('li');inline(li,item[2]);list.append(li);}
  else if(/^>\s?/.test(line)){flush();const q=make('blockquote');inline(q,line.replace(/^>\s?/,''));root.append(q);}
  else{list=null;paragraph.push(line);}
 }if(fence)codeBlock();flush();return root;
}
