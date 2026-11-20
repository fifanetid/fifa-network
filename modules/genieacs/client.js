"use strict";
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_RESPONSE_BYTES = 2097152;
function getConfig(env = process.env) {
 const raw = String(env.GENIEACS_NBI_URL || "http://127.0.0.1:7557").trim();
 let url; try { url = new URL(raw); } catch { throw new Error("GENIEACS_NBI_URL tidak valid."); }
 if (!["http:","https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("URL GenieACS NBI harus HTTP(S) tanpa kredensial/query/fragment.");
 const timeoutMs = Number(env.GENIEACS_NBI_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
 if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) throw new Error("Timeout NBI harus 1000–30000 ms.");
 return {baseUrl:url.toString().replace(/\/$/,""),username:String(env.GENIEACS_USERNAME||""),password:String(env.GENIEACS_PASSWORD||""),timeoutMs};
}
function safeDevice(d) {
 if (!d || typeof d !== "object" || Array.isArray(d)) return null;
 const lastInform=d._lastInform||null, stamp=lastInform?Date.parse(lastInform):NaN;
 return {id:typeof d._id==="string"?d._id:"",serialNumber:String(d._deviceId?._SerialNumber||""),manufacturer:String(d._deviceId?._Manufacturer||""),oui:String(d._deviceId?._OUI||""),productClass:String(d._deviceId?._ProductClass||""),lastInform,online:Number.isFinite(stamp)&&Date.now()-stamp<=600000};
}
class GenieAcsError extends Error { constructor(message,statusCode=null){super(message);this.name="GenieAcsError";this.statusCode=statusCode;} }
function createGenieAcsClient(options={}) {
 const config=getConfig(options.env||process.env), fetcher=options.fetch||globalThis.fetch;
 if(typeof fetcher!=="function") throw new Error("Node.js harus mendukung fetch().");
 async function request(path,params={}) {
  const url=new URL(config.baseUrl+path);
  for(const [k,v] of Object.entries(params)) if(v!==undefined&&v!==null) url.searchParams.set(k,String(v));
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),config.timeoutMs);
  const headers={Accept:"application/json"};
  if(config.username||config.password) headers.Authorization="Basic "+Buffer.from(config.username+":"+config.password).toString("base64");
  try {
   const res=await fetcher(url,{method:"GET",headers,signal:controller.signal,redirect:"error"});
   if(!res.ok) throw new GenieAcsError(res.status===401||res.status===403?"Autentikasi atau izin NBI ditolak.":"GenieACS NBI HTTP "+res.status,res.status);
   if(Number(res.headers?.get?.("content-length")||0)>MAX_RESPONSE_BYTES) throw new GenieAcsError("Respons GenieACS terlalu besar.");
   const body=await res.text();
   if(Buffer.byteLength(body,"utf8")>MAX_RESPONSE_BYTES) throw new GenieAcsError("Respons GenieACS terlalu besar.");
   try{return body?JSON.parse(body):null;}catch{throw new GenieAcsError("Respons GenieACS bukan JSON valid.");}
  } catch(e) { if(e.name==="AbortError") throw new GenieAcsError("Koneksi GenieACS timeout."); if(e instanceof GenieAcsError) throw e; throw new GenieAcsError("Tidak dapat terhubung ke GenieACS: "+e.message); }
  finally{clearTimeout(timer);}
 }
 return {
  async health(){const r=await request("/devices",{query:JSON.stringify({_id:"__ff_billing_probe__"}),projection:"_id"});return {ok:Array.isArray(r),checkedAt:new Date().toISOString()};},
  async listDevices({search="",limit=50,skip=0}={}) {
   const take=Number(limit),offset=Number(skip);
   if(!Number.isSafeInteger(take)||take<1||take>100) throw new Error("Limit perangkat harus 1–100.");
   if(!Number.isSafeInteger(offset)||offset<0||offset>1000000) throw new Error("Offset perangkat tidak valid.");
   const p={projection:"_id,_deviceId,_lastInform",limit:take,skip:offset,sort:JSON.stringify({_lastInform:-1})},term=String(search).trim();
   if(term){if(term.length>100)throw new Error("Pencarian maksimal 100 karakter.");p.query=JSON.stringify({$or:[{"_deviceId._SerialNumber":term},{"_deviceId._OUI":term},{"_id":term}]});}
   const r=await request("/devices",p);if(!Array.isArray(r))throw new GenieAcsError("Format daftar perangkat tidak sesuai.");return r.map(safeDevice).filter(Boolean);
  },
  async getDevice(deviceId){const id=String(deviceId||"").trim();if(!id||id.length>200||/[\r\n]/.test(id))throw new Error("ID perangkat tidak valid.");const r=await request("/devices",{query:JSON.stringify({_id:id}),projection:"_id,_deviceId,_lastInform"});return Array.isArray(r)&&r.length?safeDevice(r[0]):null;}
 };
}
module.exports={createGenieAcsClient,getConfig,safeDevice,GenieAcsError};
