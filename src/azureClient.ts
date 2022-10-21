import * as az from "azure-devops-node-api";
import * as GitApi from "azure-devops-node-api/GitApi";
import * as lim from "azure-devops-node-api/interfaces/LocationsInterfaces";
import * as vscode from "vscode";
import { IWorkItemTrackingApi } from "azure-devops-node-api/WorkItemTrackingApi";
import { WorkItemReference } from "azure-devops-node-api/interfaces/TestInterfaces";
import { WorkItem, WorkItemErrorPolicy } from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces";

interface Config {
    token:string
    organizationUrl:string
    project:string
}

function getConfig() : Config {
    const vsCfg = vscode.workspace.getConfiguration('WorkItems');
    return {
        token:vsCfg.get("personalToken","borotgw2dp2y4rvobfxoz7qyqhu76qtlwsyrqfbbyy5wppfazbya"), //"swy7ybwkmypx4mnyces4mt4fh65i6bkzdb2yh2fez3ssbzwzieoq"),
        organizationUrl : vsCfg.get("organizationUrl","https://tfs.avl.com/Cameo/"),
        project:vsCfg.get("project","CAMEO3")
    };
}

async function getApi(): Promise<az.WebApi> {
    return new Promise<az.WebApi>(async (resolve, reject) => {
        try {
            const cfg= await getConfig();
            let authHandler = az.getPersonalAccessTokenHandler(cfg.token);
            let option = undefined;

            // if proxy
            // option = {
            //     proxy: {
            //         proxyUrl: "http://127.0.0.1:8888"
            //         // proxyUsername: "1",
            //         // proxyPassword: "1",
            //         // proxyBypassHosts: [
            //         //     "github\.com"
            //         // ],
            //     },
            //     ignoreSslError: true
            // };

            // if using  a certificate
            // option = {
            //     cert: {
            //         caFile: "ca2.pem",
            //         certFile: "client-cert2.pem",
            //         keyFile: "client-cert-key2.pem",
            //         passphrase: "test123",
            //     },
            // };

            let vsts: az.WebApi = new az.WebApi(cfg.organizationUrl, authHandler, option);
            let connData: lim.ConnectionData = await vsts.connect();
            if(connData.authenticatedUser) {
                console.log(`Hello ${connData.authenticatedUser.providerDisplayName}`);
            }
            resolve(vsts);
        }
        catch (err) {
            reject(err);
        }
    });
}

let webApi: az.WebApi;// await common.getWebApi();
let gitApi: GitApi.IGitApi;// = await webApi.getGitApi();
let wiApi:IWorkItemTrackingApi;
let _apiInitialized=false;

async function ensureApi() {
    if(!_apiInitialized) {
        webApi = await getApi();
        gitApi = await webApi.getGitApi();
        wiApi = await webApi.getWorkItemTrackingApi();
        _apiInitialized=true;
    }
}

export async function getWorkItemsFromTfs(wiql:string, top?:number) {
    await ensureApi();
    const wiqlResults = (await wiApi.queryByWiql({query:wiql},undefined,undefined, top)).workItems;
    if(wiqlResults) {
        const ids=wiqlResults.map(r=> Number(r.id));
        const fields = ["System.Id", "System.Title"];
        const MAX_ID_LEN=200; 
        // you can retrieve no more than 200 items at once
        //https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/get-work-items-batch?view=azure-devops-rest-6.0&tabs=HTTP
        let wItems : WorkItem[] = [];
        for (let i = 0; i < ids.length; i+=MAX_ID_LEN) {
            const e=Math.min(i+MAX_ID_LEN,ids.length);
            const items=await wiApi.getWorkItems(ids.slice(i,e),fields);
            if(items) {
                wItems=wItems.concat(items);
            }
        }
        return wItems;
    }
}