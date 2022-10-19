import { WorkItem } from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';
import * as vscode from 'vscode';
import {getWorkItemsFromTfs} from './azureClient';

async function getWorkItemData(query:string, top?:number) {
    const wItems = await getWorkItemsFromTfs(query,top);
    if (!wItems) {return [];}
    return (wItems as WorkItem[]).map(wi=>new WorkItemData(wi,0));
}

export class WorkItemProvider implements vscode.TreeDataProvider<WorkItemData> {
    onDidChangeTreeData?: vscode.Event<void | WorkItemData | WorkItemData[] | null | undefined> | undefined;
    getTreeItem(element: WorkItemData): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element;
    }
    getChildren(element?: WorkItemData | undefined): vscode.ProviderResult<WorkItemData[]> {
        if(element) {
            return Promise.resolve([]);
        }
        return getWorkItemData("SELECT [System.Id], [System.ChangedDate] FROM WorkItems ORDER BY [System.ChangedDate] DESC",100);
    }
    // getParent?(element: WorkItemData): vscode.ProviderResult<WorkItemData> {
    //     throw new Error('Method not implemented.');
    // }
    // resolveTreeItem?(item: vscode.TreeItem, element: WorkItemData, token: vscode.CancellationToken): vscode.ProviderResult<vscode.TreeItem> {
    //     throw new Error('Method not implemented.');
    // }

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