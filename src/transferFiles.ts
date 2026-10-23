import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { MAX_FILE_BYTES } from './transfer';
export async function pickImportFile(){
  const result=await DocumentPicker.getDocumentAsync({type:'*/*',copyToCacheDirectory:true,multiple:false});
  if(result.canceled)return null;
  const asset=result.assets[0],file=new File(asset.uri);
  if((asset.size||file.size)>MAX_FILE_BYTES)throw new Error('请选择 5 MB 以内的文件');
  return {name:asset.name,text:await file.text()};
}
export async function saveTransferFile(name:string,text:string,mime:string){
  if(!await Sharing.isAvailableAsync())throw new Error('此设备暂时无法打开文件保存菜单');
  const file=new File(Paths.cache,name);file.create({overwrite:true});file.write(text);
  await Sharing.shareAsync(file.uri,{mimeType:mime,UTI:mime==='application/json'?'public.json':'public.comma-separated-values-text',dialogTitle:'保存账单文件'});
}
