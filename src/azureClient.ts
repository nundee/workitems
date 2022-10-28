import * as az from "azure-devops-node-api";
import * as GitApi from "azure-devops-node-api/GitApi";
import * as lim from "azure-devops-node-api/interfaces/LocationsInterfaces";
import * as vscode from "vscode";
import { IWorkItemTrackingApi } from "azure-devops-node-api/WorkItemTrackingApi";
import { WorkItem} from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces";
import { GitPullRequest, GitVersionDescriptor, GitVersionType } from "azure-devops-node-api/interfaces/GitInterfaces";

interface Config {
    token:string
    organizationUrl:string
    project:string
}

function getConfig() : Config {
    const vsCfg = vscode.workspace.getConfiguration();
    return {
        organizationUrl : vsCfg.get("workItems.organizationUrl","https://tfs.avl.com/Cameo/"),
        project:vsCfg.get("workItems.project","CAMEO3"),
        token:vsCfg.get("workItems.personalAccessToken","")
    };
}

async function getApi() { 
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
            return vsts;
        }
        catch (err) {
            console.error(err);
            return null;
        }
    
    }

let webApi: az.WebApi | null = null;
let gitApi: GitApi.IGitApi;
let witApi:IWorkItemTrackingApi;

async function ensureApi() {
    if(!webApi) {
        webApi = await getApi();
        if(webApi) {
            gitApi = await webApi.getGitApi();
            witApi = await webApi.getWorkItemTrackingApi();
        }
    }
}

export async function getWorkItemsFromTfs(wiql:string, top?:number) {
    await ensureApi();
    const wiqlResults = (await witApi.queryByWiql({query:wiql},undefined,undefined, top)).workItems;
    if(wiqlResults) {
        const ids=wiqlResults.map(r=> Number(r.id));
        const fields = ["System.Id", "System.Title"];
        const MAX_ID_LEN=200; 
        // you can fetch no more than 200 items at once
        //https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/get-work-items-batch?view=azure-devops-rest-6.0&tabs=HTTP
        let wItems : WorkItem[] = [];
        for (let i = 0; i < ids.length; i+=MAX_ID_LEN) {
            const e=Math.min(i+MAX_ID_LEN,ids.length);
            const items=await witApi.getWorkItems(ids.slice(i,e),fields);
            if(items) {
                wItems=wItems.concat(items);
            }
        }
        return wItems;
    }
}

export async function findRepositoryByUrl(url:string) {
    await ensureApi();
    const allRepos= await gitApi.getRepositories();
    return allRepos.find(r=>r.remoteUrl===url);
}

export async function getCommitsFromTfs(repoId:string, branch:string) {
    await ensureApi();
    const searchCriteria = {
        itemVersion : {
            version : branch,
            versionType : GitVersionType.Branch
        }
    };
    const commits=await gitApi.getCommits(repoId,searchCriteria, getConfig().project);
    return commits;
}

export async function createPullReq(repoId:string, fromBranch:string, toBranch:string, options:any) {
    const refs = await gitApi.getRefs(repoId);
    const fromName=refs.find(r=>r.name ? r.name.indexOf(fromBranch)>=0 : false);
    const toName=refs.find(r=>r.name ? r.name.indexOf(toBranch)>=0 : false);
    const pullReq = {
        sourceRefName:fromName,
        targetRefName:toName,
        title : options.title ?? 'no title',
        workItemRefs : options.workItemRefs ??  [],
        completionOptions : {
            deleteSourceBranch:true
        }
    } as GitPullRequest;
    const resp = await gitApi.createPullRequest(pullReq,repoId);
    return resp;
}