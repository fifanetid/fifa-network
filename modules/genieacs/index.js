"use strict";
const {db}=require("../../database/db");
const {decryptSecret}=require("../security/secrets");
const {createGenieAcsClient,getConfig,GenieAcsError}=require("./client");

function getTenantGenieAcsConfig(tenantId=1) {
 const tenant=Number(tenantId);
 if(!Number.isSafeInteger(tenant)||tenant<1) throw new Error("Tenant GenieACS tidak valid.");
 const row=db.prepare("SELECT endpoint_url,username,secret_encrypted,config_json,is_enabled FROM tenant_integrations WHERE tenant_id=? AND integration_type='genieacs' AND display_name='primary'").get(tenant);
 if(!row) {
  if(tenant!==1) return null;
  return getConfig();
 }
 if(!row.endpoint_url) throw new Error("Endpoint GenieACS tenant belum diatur.");
 let extra={};
 try { extra=JSON.parse(row.config_json||"{}"); } catch { throw new Error("Konfigurasi GenieACS tersimpan tidak valid."); }
 const password=row.secret_encrypted?decryptSecret(row.secret_encrypted):"";
 return getConfig({
  GENIEACS_NBI_URL:row.endpoint_url,
  GENIEACS_USERNAME:row.username||"",
  GENIEACS_PASSWORD:password,
  GENIEACS_NBI_TIMEOUT_MS:String(extra.timeoutMs||8000)
 });
}
function getGenieAcsClient(tenantId=1,options={}) {
 const tenant=Number(tenantId);
 const row=db.prepare("SELECT is_enabled FROM tenant_integrations WHERE tenant_id=? AND integration_type='genieacs' AND display_name='primary'").get(tenant);
 if(row&&!row.is_enabled) throw new Error("Integrasi GenieACS untuk tenant ini dinonaktifkan.");
 const config=getTenantGenieAcsConfig(tenant);
 if(!config) throw new Error("Integrasi GenieACS untuk tenant ini belum dikonfigurasi.");
 return createGenieAcsClient({config,fetch:options.fetch});
}
function genieAcsConfigurationStatus(tenantId=1) {
 const tenant=Number(tenantId);
 try {
  const row=db.prepare("SELECT endpoint_url,username,secret_encrypted,config_json,is_enabled FROM tenant_integrations WHERE tenant_id=? AND integration_type='genieacs' AND display_name='primary'").get(tenant);
  if(row) {
   const config=getTenantGenieAcsConfig(tenant);
   return {configured:true,enabled:Boolean(row.is_enabled),endpoint:config.baseUrl,username:row.username||"",authenticationConfigured:Boolean(config.username&&config.password),timeoutMs:config.timeoutMs,source:"tenant"};
  }
  if(tenant!==1) return {configured:false,enabled:false,endpoint:null,username:"",authenticationConfigured:false,timeoutMs:null,source:"none"};
  const config=getConfig();
  return {configured:true,enabled:true,endpoint:config.baseUrl,username:config.username,authenticationConfigured:Boolean(config.username&&config.password),timeoutMs:config.timeoutMs,source:"environment"};
 } catch(error) {
  return {configured:false,enabled:false,endpoint:null,username:"",authenticationConfigured:false,timeoutMs:null,source:"invalid",error:error.message};
 }
}
module.exports={getGenieAcsClient,genieAcsConfigurationStatus,getTenantGenieAcsConfig,GenieAcsError};
