import * as vscode from 'vscode';
import {getWorkItemsFromTfs} from './azureClient';
import { WorkItem } from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces";
import { GitCommit } from "azure-devops-node-api/interfaces/GitInterfaces";
import * as model from "./model";
import { Commit } from './@types/git';

async function getWorkItemData(filterText?:string) : Promise<WorkItemData[]> {
    const state = model.getState();
    await state.refresh(filterText);
    return state.workItems.map(wi=>new WorkItemData(wi,1));
}


export class WorkItemProvider implements vscode.TreeDataProvider<WorkItemData> {
    private _onDidChangeTreeData = new vscode.EventEmitter<WorkItemData | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<WorkItemData | undefined | null | void> = this._onDidChangeTreeData.event;
    private _filter:string="";
    //private _statusBarItem:vscode.StatusBarItem=undefined; 

    getTreeItem(element: WorkItemData): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element;
    }
    getChildren(element?: WorkItemData | undefined): vscode.ProviderResult<WorkItemData[]> {
        if(!element) {
            return getWorkItemData(this._filter);
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

    async setFilter()  {
        const prompt:string = 'work item id or a word to search for ';
        const result = await vscode.window.showInputBox({
            value:this._filter,
            prompt
        });
        if(result) {
            this._filter=result;
            this.refresh();
        }
    }

    async showSettings() {
        await vscode.commands.executeCommand("workbench.action.openSettings","workItems");
    }

    mentionWorkItem(item:any) : void {
        const wid=(item.data as model.WorkItemModel).id();
        if(wid) {
            model.mentionWorkItem(wid);
        }
    }

    async checkInWorkItem(item:any) {
        const wim=(item.data as model.WorkItemModel);
        return await vscode.window.withProgress({
                location:vscode.ProgressLocation.Notification,
                cancellable : false,
                title:"checkin in "+wim.title
            },
            async (progress)=>{
                return model.checkInWorkItem(wim, (message:string)=>{progress.report({message});});
            }
        );
        //model.checkInWorkItem(wim);
    }

    registerAll(context: vscode.ExtensionContext) {
        context.subscriptions.push(vscode.window.registerTreeDataProvider("workItems",this));
        context.subscriptions.push(vscode.commands.registerCommand("workItems.refreshEntry",this.refresh,this));
        context.subscriptions.push(vscode.commands.registerCommand("workItems.filterEntry",this.setFilter,this));
        context.subscriptions.push(vscode.commands.registerCommand("workItems.showSettings",this.showSettings, this));
        context.subscriptions.push(vscode.commands.registerCommand("workItems.mentionWorkItem",this.mentionWorkItem,this));
        context.subscriptions.push(vscode.commands.registerCommand("workItems.checkInWorkItem",this.checkInWorkItem, this));
        //subscribe(this._statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right));
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

