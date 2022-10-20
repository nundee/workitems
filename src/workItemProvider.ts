import { WorkItem } from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';
import * as vscode from 'vscode';
import {getWorkItemsFromTfs} from './azureClient';

async function getWorkItemData() {
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
    return (wItems as WorkItem[]).map(wi=>new WorkItemData(wi,0));
}

export class WorkItemProvider implements vscode.TreeDataProvider<WorkItemData> {
    private _onDidChangeTreeData = new vscode.EventEmitter<WorkItemData | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<WorkItemData | undefined | null | void> = this._onDidChangeTreeData.event;

    getTreeItem(element: WorkItemData): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element;
    }
    getChildren(element?: WorkItemData | undefined): vscode.ProviderResult<WorkItemData[]> {
        if(element) {
            return Promise.resolve([]);
        }
        return getWorkItemData();
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
}

export class WorkItemData extends vscode.TreeItem {
    constructor(
        public readonly wi:WorkItem,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    )
    {
        const title = wi.fields ? wi.fields["System.Title"].toString() : "";
        super(`${wi.id?.toString()} - ${title}`, collapsibleState);
    }
    contextValue = 'workItem';
}