"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {extractDeviceDetails}=require("../modules/genieacs/device-details");
const {createGenieAcsClient}=require("../modules/genieacs/client");

test("extracts safe WAN WLAN and LAN parameters while hiding credentials",()=>{
 const device={
  _id:"device-001",
  _lastInform:"2026-11-20T10:00:00.000Z",
  _deviceId:{_SerialNumber:"SN-001",_Manufacturer:"Vendor",_ProductClass:"ONT"},
  InternetGatewayDevice:{
   WANDevice:{"1":{WANConnectionDevice:{"1":{WANPPPConnection:{"1":{
    ExternalIPAddress:{_value:"203.0.113.10",_type:"xsd:string",_timestamp:"2026-11-20T10:00:00Z"},
    Username:{_value:"pppoe-secret-user"},
    Password:{_value:"pppoe-secret-password"}
   }}}}}},
   LANDevice:{"1":{WLANConfiguration:{"1":{
    SSID:{_value:"FIFA-WIFI"},
    Channel:{_value:6},
    PreSharedKey:{_value:"wifi-secret"}
   }},Hosts:{Host:{"1":{IPAddress:{_value:"192.168.1.20"}}}}}}
  }
 };
 const details=extractDeviceDetails(device);
 assert.equal(details.serialNumber,"SN-001");
 assert.ok(details.groups.wan.some(x=>x.path.includes("ExternalIPAddress")&&x.value==="203.0.113.10"));
 assert.ok(details.groups.wlan.some(x=>x.path.includes("SSID")&&x.value==="FIFA-WIFI"));
 assert.ok(details.groups.lan.some(x=>x.path.includes("IPAddress")&&x.value==="192.168.1.20"));
 const serialized=JSON.stringify(details);
 assert.doesNotMatch(serialized,/pppoe-secret|wifi-secret|PreSharedKey|Password|Username/);
 assert.ok(details.total>=4);
});

test("device parameter extraction rejects malformed data",()=>{
 assert.throws(()=>extractDeviceDetails(null),/tidak valid/);
 assert.throws(()=>extractDeviceDetails([]),/tidak valid/);
});

test("NBI full device data lookup uses exact device ID and does not request write methods",async()=>{
 let captured;
 const client=createGenieAcsClient({
  env:{GENIEACS_NBI_URL:"http://127.0.0.1:7557",GENIEACS_NBI_TIMEOUT_MS:"8000"},
  fetch:async(url,options)=>{
   captured={url:new URL(String(url)),options};
   return {ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify([{_id:"device-001",InternetGatewayDevice:{}}])};
  }
 });
 const data=await client.getDeviceData("device-001");
 assert.equal(data._id,"device-001");
 assert.deepEqual(JSON.parse(captured.url.searchParams.get("query")),{_id:"device-001"});
 assert.equal(captured.options.method,"GET");
 assert.equal(captured.options.redirect,"error");
});
