import * as vscode from 'vscode';
import { WorkItem } from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces";
import { GitCommit } from "azure-devops-node-api/interfaces/GitInterfaces";
import { getGitApi } from "./gitExtension";
import * as az from './azureClient';
import { Commit } from './@types/git';

export function isNullOrEmpty(a:any[]):boolean {
    return !a || a.length ===0;
}

function currentRepo() {
    return getGitApi()?.repositories[0];
}

function currentBranch() {
    const repo=currentRepo();
    const bName=repo?.state.refs[0].name;
    //return getGitApi()?.repositories[0].getBranches();
    return bName;
}

export class WorkItemModel  {
    workItem:WorkItem;
    mentionedIn:Commit[]=[];
    constructor(wi:WorkItem) {
        this.workItem=wi;
    }

    id() {
        return this.workItem.id;
    }
    field(f:string) {
        return this.workItem.fields ? this.workItem.fields[f] : undefined;
    }
};

export class State {
    workItems:WorkItemModel[]=[];
    commits:Commit[]=[];

    async refresh() {
        const vsCfg = vscode.workspace.getConfiguration();
        const cfgField:string = vsCfg.get("workItems.searchLast","changed");
        let col = "[System.ChangedDate]";
        if (cfgField==="created") {
            col = "[System.CreatedDate]";
        }
        const count:number = vsCfg.get<number>("workItems.count",10);
        //const query = `SELECT [System.Id], ${col} FROM WorkItems WHERE ${col} >= @Today-${count} ORDER BY ${col} DESC`;
        const query = `SELECT [System.Id], ${col} FROM WorkItems WHERE [System.Title] contains words 'Integreater'`;
        console.log("fetching work items ...");
        console.log(query);
        const wItems = await az.getWorkItemsFromTfs(query);
        if (!wItems) {return [];}
        this.workItems = (wItems as WorkItem[]).map(wi=>new WorkItemModel(wi));
        const repo = currentRepo();
        if(repo) {
            const allCommits = await repo.log({maxEntries:1000});
            const url = await repo.getConfig("remote.origin.url");
            const repoId = (await az.findRepositoryByUrl(url))?.id;
            if(repoId) {
                const branchName=currentBranch();
                if (branchName) {
                    const azCommits = await az.getCommitsFromTfs(repoId, branchName);
                    const uniqueIds = new Set(azCommits.map(c=>String(c.commitId)));
                    this.commits = allCommits.filter(c=>!uniqueIds.has(c.hash));
                }
            }
        }
    }
}

let _state : State | undefined = undefined;

export async function getState() {
    if(!_state) {
        _state=new State();
        await _state.refresh();
    }
    return _state;
}
export function invalidateState() {
    _state=undefined;
}

const mentionRegEx = /#(\d+)(\s+|$)/g;
function extractWorkItemIdFromComment(comment?:string) {
    if (comment) {
        const rxRes = mentionRegEx.exec(comment);
        if(rxRes) {
            return Number(rxRes[1].toString());
        }
    }
    return -1;
}

export async function findCommitsMentionedIn(wiId:number) {
    const state=await getState();
    return state.commits.filter(commit=>extractWorkItemIdFromComment(commit.message) === wiId);
}

export function mentionWorkItem(wiId:number) {
    let repo=currentRepo();
    if(repo) {
        let comment=repo.inputBox.value;
        const mentionText = `#${wiId}`;
        const foundWId = extractWorkItemIdFromComment(comment);
        if(foundWId === wiId) {
            return;
        }
        if(foundWId>0) {
            comment=comment.replace(`#${foundWId}`,mentionText);
        } else {
            comment=comment + " Fix " + mentionText;
        }
        repo.inputBox.value = comment;
    }
}
