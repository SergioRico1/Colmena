"""Windows CurrentUser DPAPI vault. Secrets only cross private stdin/stdout pipes.

Never accepts credentials in command arguments or emits exception details.
"""
import ctypes,json,os,re,sys,tempfile
from pathlib import Path
from ctypes import wintypes
LIMIT=128_000
class Blob(ctypes.Structure):
 _fields_=[('size',wintypes.DWORD),('data',ctypes.POINTER(ctypes.c_ubyte))]
def crypt(data,entropy,decrypt=False):
 if os.name!='nt':raise RuntimeError('Windows required')
 library=ctypes.WinDLL('crypt32',use_last_error=True);kernel=ctypes.WinDLL('kernel32',use_last_error=True)
 buffers=[]
 def blob(value):
  memory=ctypes.create_string_buffer(value,len(value));buffers.append(memory)
  return Blob(len(value),ctypes.cast(memory,ctypes.POINTER(ctypes.c_ubyte)))
 source=blob(data);binding=blob(entropy);output=Blob()
 kernel.LocalFree.argtypes=[ctypes.c_void_p];kernel.LocalFree.restype=ctypes.c_void_p
 try:
  if decrypt:
   fn=library.CryptUnprotectData;fn.argtypes=[ctypes.POINTER(Blob),ctypes.c_void_p,ctypes.POINTER(Blob),ctypes.c_void_p,ctypes.c_void_p,wintypes.DWORD,ctypes.POINTER(Blob)]
   valid=fn(ctypes.byref(source),None,ctypes.byref(binding),None,None,1,ctypes.byref(output))
  else:
   fn=library.CryptProtectData;fn.argtypes=[ctypes.POINTER(Blob),wintypes.LPCWSTR,ctypes.POINTER(Blob),ctypes.c_void_p,ctypes.c_void_p,wintypes.DWORD,ctypes.POINTER(Blob)]
   valid=fn(ctypes.byref(source),'Colmena ChatGPT',ctypes.byref(binding),None,None,1,ctypes.byref(output))
  if not valid:raise RuntimeError('DPAPI operation failed')
  return ctypes.string_at(output.data,output.size)
 finally:
  if output.data:ctypes.memset(output.data,0,output.size);kernel.LocalFree(output.data)
  for memory in buffers:ctypes.memset(memory,0,len(memory))
def operate(directory,request):
 profile=request.get('profile') or 'default'
 if not isinstance(profile,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',profile):raise ValueError('Profile')
 folder=Path(directory).resolve()/'credentials';file=folder/(profile+'.dpapi')
 if request.get('action')=='delete':file.unlink(missing_ok=True);return {'deleted':True}
 binding=request.get('binding')
 if not isinstance(binding,dict) or binding.get('profile')!=profile or any(not isinstance(binding.get(k),str) or not binding[k] for k in ('hostId','clientId','subject')):raise ValueError('Binding')
 entropy=json.dumps(binding,sort_keys=True,separators=(',',':')).encode()
 if request.get('action')=='load':
  if not file.exists():return {'credentials':None}
  if file.stat().st_size>LIMIT*2:raise ValueError('Size')
  plain=crypt(file.read_bytes(),entropy,True)
  if len(plain)>LIMIT:raise ValueError('Size')
  envelope=json.loads(plain)
  if envelope.get('binding')!=binding:raise ValueError('Identity')
  return {'credentials':envelope['credentials']}
 if request.get('action')!='save':raise ValueError('Action')
 plain=json.dumps({'version':1,'binding':binding,'credentials':request['credentials']},separators=(',',':')).encode()
 if len(plain)>LIMIT:raise ValueError('Size')
 protected=crypt(plain,entropy);folder.mkdir(parents=True,exist_ok=True)
 fd,temp=tempfile.mkstemp(prefix=profile+'-',suffix='.tmp',dir=folder)
 try:
  with os.fdopen(fd,'wb') as stream:stream.write(protected);stream.flush();os.fsync(stream.fileno())
  os.replace(temp,file)
 finally:Path(temp).unlink(missing_ok=True)
 return {'saved':True}
def main():
 try:
  raw=sys.stdin.buffer.read(LIMIT+1)
  if len(raw)>LIMIT or len(sys.argv)!=2:raise ValueError('Size')
  result=operate(sys.argv[1],json.loads(raw));sys.stdout.write(json.dumps(result,separators=(',',':')))
 except Exception:sys.stderr.write('No se pudo acceder al almacén cifrado de Colmena.');return 1
 return 0
if __name__=='__main__':sys.exit(main())
