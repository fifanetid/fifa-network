"use strict";
const {createGenieAcsClient,getConfig,GenieAcsError}=require("./client");
let singleton;
function getGenieAcsClient(){if(!singleton)singleton=createGenieAcsClient();return singleton;}
function genieAcsConfigurationStatus(){try{const c=getConfig();return {configured:true,endpoint:c.baseUrl,authenticationConfigured:Boolean(c.username&&c.password),timeoutMs:c.timeoutMs};}catch(e){return {configured:false,error:e.message};}}
module.exports={getGenieAcsClient,genieAcsConfigurationStatus,GenieAcsError};
