import * as vscode from 'vscode';
import {getWorkItemsFromTfs} from './azureClient';
import { WorkItem } from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces";
import { GitCommit } from "azure-devops-node-api/interfaces/GitInterfaces";
import * as model from "./model";
import { Commit } from './@types/git';


async function getWorkItemData() : Promise<WorkItemData[]> {
    const state = await model.getState();
    return state.workItems.map(wi=>new WorkItemData(wi,1));
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
            const wim = element.data as model.WorkItemModel;
            const wid = wim.id();
            if(wid) {
                return (async () => {
                    if(model.isNullOrEmpty(wim.mentionedIn)) {
                        wim.mentionedIn = await model.findCommitsMentionedIn(wid);
                    }
                    if(!model.isNullOrEmpty(wim.mentionedIn)) {
                        return wim.mentionedIn.map(g=>new WorkItemData(g,0));
                    } else {
                        return [];
                    }
                })();
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
        model.invalidateState();
        this._onDidChangeTreeData.fire();
    }

    showSettings():void {
        vscode.commands.executeCommand("workbench.action.openSettings","workItems");
    }

    mentionWorkItem(item:any) : void {
        const wid=(item.data as model.WorkItemModel).id();
        if(wid) {
            model.mentionWorkItem(wid);
        }
    }
}

export class WorkItemData extends vscode.TreeItem {
    constructor(
        public readonly data : model.WorkItemModel | Commit,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    )
    {
        super("", collapsibleState);
        const isC = "hash" in data;
        const id = isC ? (data as Commit).hash : (data as model.WorkItemModel).id()?.toString();
        const title = isC ?  (data as Commit).message : (data as model.WorkItemModel).field("System.Title").toString();
        this.id=id;
        this.data=data;
        this.label = isC ? `${id?.slice(0,5)}... - ${title}` : `${id} - ${title}`;
        this.contextValue = isC ? "commit" : 'workItem';
    }

    isWorkItem() {
        return this.contextValue==="workItem";
    }
}
