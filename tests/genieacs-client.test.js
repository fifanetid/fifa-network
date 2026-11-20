"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createGenieAcsClient,getConfig,safeDevice}=require("../modules/genieacs/client");
const env={GENIEACS_NBI_URL:"http://127.0.0.1:7557",GENIEACS_USERNAME:"billing",GENIEACS_PASSWORD:"secret",GENIEACS_NBI_TIMEOUT_MS:"1000"};
test("validates NBI URL and timeout",()=>{assert.equal(getConfig(env).baseUrl,"http://127.0.0.1:7557");assert.throws(()=>getConfig({...env,GENIEACS_NBI_URL:"file:///etc/passwd"}));assert.throws(()=>getConfig({...env,GENIEACS_NBI_URL:"http://u:p@localhost:7557"}));assert.throws(()=>getConfig({...env,GENIEACS_NBI_TIMEOUT_MS:"50"}));});
test("projects only non-sensitive identity fields",()=>{const r=safeDevice({_id:"abc",_deviceId:{_SerialNumber:"SN123",_Manufacturer:"Vendor"},InternetGatewayDevice:{WiFi:{KeyPassphrase:"secret"}}});assert.equal(r.id,"abc");assert.equal(r.serialNumber,"SN123");assert.equal("InternetGatewayDevice" in r,false);});
test("lists devices and sends Basic Auth",async()=>{let captured;const c=createGenieAcsClient({env,fetch:async(url,options)=>{captured={url:String(url),options};return {ok:true,status:200,headers:{get:()=>"2"},text:async()=>JSON.stringify([{_id:"device-1",_deviceId:{_SerialNumber:"SN1",_Manufacturer:"Vendor"}}])};}});const rows=await c.listDevices({search:"SN1",limit:10});assert.equal(rows.length,1);assert.match(captured.url,/projection=/);assert.equal(captured.options.headers.Authorization,"Basic "+Buffer.from("billing:secret").toString("base64"));});
test("handles NBI authentication errors",async()=>{const c=createGenieAcsClient({env,fetch:async()=>({ok:false,status:401,headers:{get:()=>"0"},text:async()=>""})});await assert.rejects(c.listDevices(),/Autentikasi atau izin NBI ditolak/);});
