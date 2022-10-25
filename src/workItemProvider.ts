import * as vscode from 'vscode';
import {getWorkItemsFromTfs} from './azureClient';
import { WorkItem } from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces";
import { GitCommit } from "azure-devops-node-api/interfaces/GitInterfaces";
import { WorkItemModel } from "./model";

import { getGitApi } from "./gitExtension";

function currentRepo() {
    return getGitApi()?.repositories[0];
}


async function getWorkItemData() {
    //const gitApi = getGitApi();
    //console.log("repo: "+gitApi?.repositories[0].inputBox.value);
    const vsCfg = vscode.workspace.getConfiguration();
    const cfgField:string = vsCfg.get("workItems.searchLast","changed");
    let col = "[System.ChangedDate]";
    if (cfgField==="created") {
        col = "[System.CreatedDate]";
    }
    const count:number = vsCfg.get<number>("workItems.count",10);
    const query = `SELECT [System.Id], ${col} FROM WorkItems WHERE ${col} >= @Today-${count} ORDER BY ${col} DESC`;
    console.log("fetching work items ...");
    console.log(query);
    const wItems = await getWorkItemsFromTfs(query);
    if (!wItems) {return [];}
    return (wItems as WorkItem[]).map(wi=>new WorkItemData(new WorkItemModel(wi),0));
}


function mentionWorkItem(wiId:number) {
    let repo=currentRepo();
    if(repo) {
        let comment=repo.inputBox.value;
        const mentionText = `#${wiId}`;
        const rxRes = /#(\d+)(\s+|$)/g.exec(comment);
        if(rxRes) {
            if(Number(rxRes[1].toString()) === wiId) {
                return;
            }
            comment=comment.replace(rxRes[0].toString().trimEnd(),mentionText);
        } else {
            comment=comment + " Fix " + mentionText;
        }
        repo.inputBox.value = comment;
    }
}
export class WorkItemProvider implements vscode.TreeDataProvider<WorkItemData> {
    private _onDidChangeTreeData = new vscode.EventEmitter<WorkItemData | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<WorkItemData | undefined | null | void> = this._onDidChangeTreeData.event;

    getTreeItem(element: WorkItemData): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element;
    }
    getChildren(element?: WorkItemData | undefined): vscode.ProviderResult<WorkItemData[]> {
        if(!element) {
            return getWorkItemData();
        }
        if(element.isWorkItem())
        {
            const wim = element.data as WorkItemModel;
            if(wim.mentionedIn && wim.mentionedIn.length>0) {
                return Promise.resolve(
                    wim.mentionedIn.map(g=>new WorkItemData(g,0))
                );
            }
        }
        return Promise.resolve([]);
    }
    // getParent?(element: WorkItemData): vscode.ProviderResult<WorkItemData> {
    //     throw new Error('Method not implemented.');
    // }
    // resolveTreeItem?(item: vscode.TreeItem, element: WorkItemData, token: vscode.CancellationToken): vscode.ProviderResult<vscode.TreeItem> {
    //     throw new Error('Method not implemented.');
    // }
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    showSettings():void {
        vscode.commands.executeCommand("workbench.action.openSettings","workItems");
    }

    mentionWorkItem(item:any) : void {
        const wid=(item.data as WorkItemModel).id();
        if(wid) {
            mentionWorkItem(wid);
        }
    }
}

export class WorkItemData extends vscode.TreeItem {
    constructor(
        public readonly data : WorkItemModel | GitCommit,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    )
    {
        super("", collapsibleState);
        const isC = "commitId" in data;
        const id = isC ? (data as GitCommit).commitId : (data as WorkItemModel).id()?.toString();
        const title = isC ?  (data as GitCommit).comment : (data as WorkItemModel).field("System.Title").toString();
        this.id=id;
        this.data=data;
        this.label=`${id?.toString()} - ${title}`;
        this.contextValue = isC ? "commit" : 'workItem';
    }

    isWorkItem() {
        return this.contextValue==="workItem";
    }
}
