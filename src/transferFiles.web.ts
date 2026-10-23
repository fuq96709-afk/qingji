import { MAX_FILE_BYTES } from './transfer';
export function pickImportFile():Promise<{name:string;text:string}|null>{
  return new Promise((resolve,reject)=>{
    const input=document.createElement('input');input.type='file';input.accept='.csv,.tsv,.txt,.json';input.style.display='none';document.body.appendChild(input);
    input.addEventListener('cancel',()=>{input.remove();resolve(null);},{once:true});
    input.addEventListener('change',()=>{
      const file=input.files?.[0];input.remove();
      if(!file){resolve(null);return;}
      if(file.size>MAX_FILE_BYTES){reject(new Error('请选择 5 MB 以内的文件'));return;}
      void file.text().then(text=>resolve({name:file.name,text}),reject);
    },{once:true});
    input.click();
  });
}
export async function saveTransferFile(name:string,text:string,mime:string){
  const url=URL.createObjectURL(new Blob([text],{type:mime+';charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
