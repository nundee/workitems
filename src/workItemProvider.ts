import * as vscode from 'vscode';
import * as model from "./model";
import { Commit } from './@types/git';
import { GitPullRequest, PullRequestStatus } from 'azure-devops-node-api/interfaces/GitInterfaces';

export class WorkItemProvider implements vscode.TreeDataProvider<WorkItemData> {
    private _onDidChangeTreeData = new vscode.EventEmitter<WorkItemData | WorkItemData[] | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<WorkItemData | WorkItemData[] | undefined | null | void> = this._onDidChangeTreeData.event;
    private _filter: string = "";
    private _items = new Map<number, WorkItemData>();
    //private _statusBarItem:vscode.StatusBarItem=undefined; 

    getTreeItem(element: WorkItemData): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element;
    }
    getChildren(element?: WorkItemData | undefined): vscode.ProviderResult<WorkItemData[]> {
        if (!element) {
            return this.getWorkItemData(true);
        }
        if (element.isWorkItem()) {
            const wim = element.data as model.WorkItemModel;
            const wid = wim.id();
            if (wid) {
                return (async () => {
                    if (!model.isNullOrEmpty(wim.mentionedIn)) {
                        return wim.mentionedIn.map(g => new WorkItemData(g));
                    } else {
                        return [];
                    }
                })();
            }
        }
        return Promise.resolve([]);
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    async setFilter() {
        const prompt: string = 'work item id or a word to search for ';
        const result = await vscode.window.showInputBox({
            value: this._filter,
            prompt
        });
        if (result && result !== this._filter) {
            this._filter = result;
            this.refresh();
        }
    }

    async getWorkItemData(forceRefresh: boolean): Promise<WorkItemData[]> {
        const state = model.getState();
        if (forceRefresh || model.isNullOrEmpty(state.workItems)) {
            await state.refresh(this._filter);
        }
        this._items = new Map<number, WorkItemData>(state.workItems.map(wi => [Number(wi.id()), new WorkItemData(wi)]));
        return Array.from(this._items.values());
    }


    async showSettings() {
        await vscode.commands.executeCommand("workbench.action.openSettings", "workItems");
    }

    mentionWorkItem(item: any): void {
        const wid = (item.data as model.WorkItemModel).id();
        if (wid) {
            model.mentionWorkItem(wid);
        }
    }

    async checkInWorkItem(item: any) {
        const wim = (item.data as model.WorkItemModel);
        const pullReq = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                cancellable: false,
                title: "checkin in " + wim.title
            },
            async (progress) => {
                const req = await model.getState().checkInWorkItem(wim, (message: string) => { progress.report({ message }); });
                if (req) {
                    if (typeof req === 'string') {
                        vscode.window.showErrorMessage(req);
                    } else {
                        return req as GitPullRequest;
                    }
                }
            }
        );
        if (pullReq) {
            const dlgRes = await vscode.window.showInformationMessage(
                `The pull request ${pullReq.pullRequestId} was created with status "${PullRequestStatus[pullReq.status ?? 0]}"`,
                { modal: false },
                "Show in browser"
            );
            if (dlgRes) {
                const url=`${(pullReq as any).repository.remoteUrl}/pullrequest/${pullReq.pullRequestId}`;
                await vscode.commands.executeCommand('vscode.open', url);
            }
        }
    }

    registerAll(context: vscode.ExtensionContext) {
        context.subscriptions.push(vscode.window.registerTreeDataProvider("workItems", this));
        context.subscriptions.push(vscode.commands.registerCommand("workItems.refreshEntry", this.refresh, this));
        context.subscriptions.push(vscode.commands.registerCommand("workItems.filterEntry", this.setFilter, this));
        context.subscriptions.push(vscode.commands.registerCommand("workItems.showSettings", this.showSettings, this));
        context.subscriptions.push(vscode.commands.registerCommand("workItems.mentionWorkItem", this.mentionWorkItem, this));
        context.subscriptions.push(vscode.commands.registerCommand("workItems.checkInWorkItem", this.checkInWorkItem, this));

        context.subscriptions.push(model.getState());
        //subscribe(this._statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right));
        context.subscriptions.push(model.getState().onDidChangeData((wims) => {
            let changedItems: WorkItemData[] = [];
            wims.forEach(wim => {
                let item = this._items.get(wim.id() ?? -1);
                if (item) {
                    item.data = wim;
                    item.collapsibleState = model.isNullOrEmpty(wim.mentionedIn) ? 0 : 1;
                    changedItems.push(item);
                }
            });
            if (!model.isNullOrEmpty(changedItems)) {
                this._onDidChangeTreeData.fire(changedItems);
            }
        }));
    }
}

export class WorkItemData extends vscode.TreeItem {
    constructor(
        public data: model.WorkItemModel | Commit
    ) {
        super("");
        const isC = "hash" in data;
        const id = isC ? (data as Commit).hash : (data as model.WorkItemModel).id()?.toString();
        const title = isC ? (data as Commit).message : (data as model.WorkItemModel).field("System.Title").toString();
        this.id = id;
        this.data = data;
        this.label = isC ? `${id?.slice(0, 5)}... - ${title}` : `${id} - ${title}`;
        if (!isC && !model.isNullOrEmpty((data as model.WorkItemModel).mentionedIn)) {
            this.collapsibleState = 1;
        }
        this.contextValue = isC ? "commit" : 'workItem';
    }

    isWorkItem() {
        return this.contextValue === "workItem";
    }
}

