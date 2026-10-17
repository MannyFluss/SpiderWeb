export function downloadSpec(args){
  const blob=args?.blob,filename=args?.filename;
  if(!(blob instanceof Blob)||blob.size<1||blob.size>12*1024*1024)throw Error('Export must be a file of up to 12 MiB.');
  if(typeof filename!=='string'||!/^sketch(?:-[a-z0-9-]+)?\.(js|html|gif)$/.test(filename))throw Error('Invalid export filename.');
  const extension=filename.split('.').at(-1),types={js:'text/javascript',html:'text/html',gif:'image/gif'};
  if(blob.type!==types[extension])throw Error('Export file type does not match its extension.');
  return{blob,filename};
}
export function p5ReferenceUrl(value){
  const url=new URL(value);
  if(url.origin!=='https://p5js.org'||url.username||url.password||!['/reference/','/tutorials/','/examples/'].some(prefix=>url.pathname.startsWith(prefix)))throw Error('Choose a p5.js reference, tutorial, or example.');
  return url.href;
}
