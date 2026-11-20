"use strict";

const META_KEYS=new Set(["_value","_type","_timestamp","_writable","_object","_notification","_instance","_path","_fault","_error","_deviceId","_lastInform","_id"]);
const SECRET_PATH=/(password|passphrase|secret|token|private.?key|psk|pre.?shared|credential|username|user.?name|community|string.?key)/i;
const MAX_ROWS=1200;
const MAX_DEPTH=20;

function safeValue(value) {
 if(value===null||value===undefined)return "";
 if(typeof value==="string")return value.slice(0,300);
 if(typeof value==="number"||typeof value==="boolean")return String(value);
 try{return JSON.stringify(value).slice(0,300);}catch{return "[nilai tidak dapat ditampilkan]";}
}
function classify(path) {
 const value=path.join(".").toLowerCase();
 if(/wan|ppp|ipconnection|wand evice|wanconnection|dsl|gpon|epon/.test(value))return "wan";
 if(/wlan|wifi|wireless|ssid/.test(value))return "wlan";
 if(/lan|ethernet|host|dhcp|bridge/.test(value))return "lan";
 return "other";
}
function extractDeviceDetails(device) {
 if(!device||typeof device!=="object"||Array.isArray(device))throw new TypeError("Data perangkat GenieACS tidak valid.");
 const groups={wan:[],wlan:[],lan:[],other:[]};
 let visited=0;
 function walk(node,path,depth) {
  if(depth>MAX_DEPTH||visited>=MAX_ROWS)return;
  if(Array.isArray(node)){node.slice(0,256).forEach((value,index)=>walk(value,path.concat(String(index)),depth+1));return;}
  if(node&&typeof node==="object") {
   if(Object.prototype.hasOwnProperty.call(node,"_value")) {
    visited++;
    const parameterPath=path.join(".");
    if(parameterPath&&!SECRET_PATH.test(parameterPath)) {
     const group=classify(path);
     groups[group].push({path:parameterPath,value:safeValue(node._value),type:safeValue(node._type),timestamp:safeValue(node._timestamp),writable:node._writable===true});
    }
   }
   for(const [key,value] of Object.entries(node)) {
    if(META_KEYS.has(key)||key.startsWith("__"))continue;
    if(SECRET_PATH.test(path.concat(key).join(".")))continue;
    walk(value,path.concat(key),depth+1);
   }
   return;
  }
  if(path.length) {
   visited++;
   const parameterPath=path.join(".");
   if(!SECRET_PATH.test(parameterPath))groups[classify(path)].push({path:parameterPath,value:safeValue(node),type:typeof node,timestamp:"",writable:false});
  }
 }
 for(const [key,value] of Object.entries(device)) {
  if(META_KEYS.has(key)||key.startsWith("_"))continue;
  walk(value,[key],0);
 }
 for(const key of Object.keys(groups))groups[key].sort((a,b)=>a.path.localeCompare(b.path));
 const deviceId=device._deviceId||{};
 return {
  id:typeof device._id==="string"?device._id:"",
  serialNumber:safeValue(deviceId._SerialNumber),
  manufacturer:safeValue(deviceId._Manufacturer),
  oui:safeValue(deviceId._OUI),
  productClass:safeValue(deviceId._ProductClass),
  lastInform:safeValue(device._lastInform),
  groups,
  total:Object.values(groups).reduce((sum,items)=>sum+items.length,0)
 };
}
module.exports={extractDeviceDetails,classify};
