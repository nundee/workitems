import * as nodeApi from "azure-devops-node-api";
import * as GitApi from "azure-devops-node-api/GitApi";
import * as GitInterfaces from "azure-devops-node-api/interfaces/GitInterfaces";
import * as vm from "azure-devops-node-api";
import * as lim from "azure-devops-node-api/interfaces/LocationsInterfaces";
import * as vscode from "vscode";
import { IWorkItemTrackingApi } from "azure-devops-node-api/WorkItemTrackingApi";

interface Config {
    token:string
    organizationUrl:string
    project:string
}

function getConfig() : Config {
    const vsCfg = vscode.workspace.getConfiguration('devops');
    return {
        token:vsCfg.get("personalToken","swy7ybwkmypx4mnyces4mt4fh65i6bkzdb2yh2fez3ssbzwzieoq"),
        organizationUrl : vsCfg.get("organizationUrl","https://tfs.avl.com/Cameo/"),
        project:vsCfg.get("project","CAMEO3")
    };
}

async function getApi(): Promise<vm.WebApi> {
    return new Promise<vm.WebApi>(async (resolve, reject) => {
        try {
            const cfg= await getConfig();
            let authHandler = vm.getPersonalAccessTokenHandler(cfg.token);
            let option = undefined;

            // The following sample is for testing proxy
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

            // The following sample is for testing cert
            // option = {
            //     cert: {
            //         caFile: "E:\\certutil\\doctest\\ca2.pem",
            //         certFile: "E:\\certutil\\doctest\\client-cert2.pem",
            //         keyFile: "E:\\certutil\\doctest\\client-cert-key2.pem",
            //         passphrase: "test123",
            //     },
            // };

            let vsts: vm.WebApi = new vm.WebApi(cfg.organizationUrl, authHandler, option);
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

let webApi: vm.WebApi;// await common.getWebApi();
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
        //ids=[r.id for r in wiql_results]
        const ids=wiqlResults.filter(r=>r.id != undefined).map(r=>r.id?.valueOf()) as number[];
        return await wiApi.getWorkItems(ids);
    }
}