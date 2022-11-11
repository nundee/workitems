import * as vscode from 'vscode';
import * as az from './azureClient';
import { WorkItem } from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces";
import { Commit, Repository, GitErrorCodes} from './@types/git';
import { getGitApi } from "./gitExtension";
import { PullRequestStatus } from 'azure-devops-node-api/interfaces/GitInterfaces';
import * as logger from "./logger";
import { poll } from './utils'

export function isNullOrEmpty(a:any[]):boolean {
    return !a || a.length ===0;
}

function extractWorkItemIdFromComment(comment?:string) {
    if (comment) {
        const rxRes = /#(\d+)(\s+|$)/g.exec(comment);
        if(rxRes) {
            return Number(rxRes[1].toString());
        }
    }
    return -1;
}


function formatDateTime(dt:Date) {
    const twoDigits = (x:Number) => x > 9 ? x.toString() : '0'+x.toString();
    return `${twoDigits(dt.getDate())}.${twoDigits(dt.getMonth()+1)}.${dt.getFullYear()}-\
${twoDigits(dt.getHours())}.${twoDigits(dt.getMinutes())}.${twoDigits(dt.getSeconds())}`;
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
    get title() {
        return this.field("System.Title").toString();
    }
    workItemRef() {
        return {
            id  : this.workItem.id,
            url : this.workItem.url
        };
    }
};

export class State {
    workItems:WorkItemModel[]=[];
    commits:Commit[]=[];
    private _repoRoot:string|undefined = undefined;
    private _checkChangesPending=false;
    private _subscriptions: {dispose() : any}[] = [];
    private _timer : NodeJS.Timer | undefined = undefined;
    private _onDidChangeData = new vscode.EventEmitter<WorkItemModel[]>();
    readonly onDidChangeData = this._onDidChangeData.event;

    private static _getCurrRepo() {
        const gitApi = getGitApi();
        const repos= gitApi!.repositories;
        if(!isNullOrEmpty(repos)) {
            return repos[0];
        }
    }

    private onRepoChanged(repo:Repository | undefined) {
        this.disposeSubscriptions();
        if(repo) {
            this._repoRoot=repo.rootUri.path;
            this._subscriptions.push(repo.state.onDidChange((e)=>this.onDidChange()));
        } else {
            this._repoRoot=undefined;
        }
    }

    disposeSubscriptions() {
        this._subscriptions.forEach(d=>d.dispose());
    }
    dispose() {
        this.disposeSubscriptions();
    }


    getCurrentRepo() {
        const repo=State._getCurrRepo();
        if(repo) {
            if(repo.rootUri.path!==this._repoRoot) {
                this.onRepoChanged(repo);
            }
        } else {
            logger.info("no current repository");
            if(this._repoRoot) {
                this.onRepoChanged(undefined);
            }
        }
        return repo;
    }
    
    currentBranch() : string {
        const repo=this.getCurrentRepo();
        const bName=repo?.state.HEAD?.name;
        return bName ?? "";
    }
    
    getDevBranch() : string {
        const vsCfg = vscode.workspace.getConfiguration();
        return vsCfg.get("workItems.developmentBranch","development");
    }

    async remoteRepoId() {
        const repo = this.getCurrentRepo();
        if(repo) {
            const remoteUrl=repo.state.remotes[0].fetchUrl;
            if(remoteUrl) {
                return (await az.findRepositoryByUrl(remoteUrl))?.id;
            }
        }
    }
    

    findCommitsMentionedIn(wiId:number) {
        return this.commits.filter(commit=>extractWorkItemIdFromComment(commit.message) === wiId);
    }

    workItemBranchId(currBranchName?:string) {
        if(!currBranchName) {
            currBranchName=this.currentBranch();
        }
        const res = /work_item\/(\d+)$/g.exec(currBranchName);
        return res ? Number(res[1]) : -1;
    }

    async refresh(filterText?:string) {
        let currentBranchName = this.currentBranch();
        if(currentBranchName.length<1) {
            await poll(60000,500, () => {
                currentBranchName = this.currentBranch();
                return currentBranchName.length>0;
            });
        }
        const vsCfg = vscode.workspace.getConfiguration();
        const cfgField:string = vsCfg.get("workItems.searchLast","changed");
        let col = "[System.ChangedDate]";
        if (cfgField==="created") {
            col = "[System.CreatedDate]";
        }
        const count:number = vsCfg.get<number>("workItems.count",10);
        let whereClause:string='';
        const brWid = this.workItemBranchId(currentBranchName);
        const wiId = brWid > 0 ? brWid : Number(filterText);
        if (isNaN(wiId) || wiId===0) {
            whereClause = filterText
                ? `[System.Title] contains '${filterText}'` 
                : `${col} >= @Today-${count} ORDER BY ${col} DESC`
                ;
        } else {
            whereClause = `[System.Id] = ${wiId}`;
        }
        const query = `SELECT [System.Id], ${col} FROM WorkItems WHERE ${whereClause}`;
        //const query = `SELECT [System.Id], ${col} FROM WorkItems WHERE [System.Title] contains words 'Integreater'`;
        logger.info("fetching work items ...");
        logger.info(query);
        const wItems = await az.getWorkItemsFromTfs(query);
        if (!wItems) {return [];}
        this.workItems = (wItems as WorkItem[]).map(wi=>new WorkItemModel(wi));
        await this.refreshCommits();
    }

    async refreshCommits() {
        const repoId = await this.remoteRepoId();
        if(repoId) {
            let branchName=this.currentBranch();
            if (branchName) {
                const allCommits = await this.getCurrentRepo()?.log({maxEntries:1000});
                let remoteBranchRef = await az.getBranchRef(repoId,branchName);
                if(!remoteBranchRef) {
                    branchName = this.getDevBranch();
                    remoteBranchRef = await az.getBranchRef(repoId,branchName);
                }
                if(remoteBranchRef) {
                    const azCommits = await az.getCommitsFromTfs(repoId, branchName);
                    const uniqueIds = new Set(azCommits.map(c=>String(c.commitId)));
                    this.commits = allCommits ? allCommits.filter(c=>!uniqueIds.has(c.hash)) : [];
                } else {
                    this.commits = allCommits ?? [];
                }
                const allMentionedIds=new Set(this.commits.map(c=>extractWorkItemIdFromComment(c.message)));
                this.workItems.forEach(wi => {
                    if(allMentionedIds.has(wi.id() ?? -1)) {
                        wi.mentionedIn=this.findCommitsMentionedIn(wi.id() ?? -1);
                    } else {
                        wi.mentionedIn=[];
                    }
                });
            }
        }
    }


    static makeBranchName(wi:WorkItemModel) {
        return `work_item/${wi.id()}`;
    }

    async checkoutWorkItemBranch(wi:WorkItemModel) {
        const bName=State.makeBranchName(wi);
        if(this.currentBranch()!==bName) {
            let repo=this.getCurrentRepo() as Repository;
            let branchExists=false;
            try {
                await repo.getBranch(bName);
                branchExists=true;
            } catch (err : any) {}
            if(!branchExists) {
                await repo.createBranch(bName,true,this.getDevBranch());
            } else {
                await repo.checkout(bName);
            }
            return true;
        } else {
            return false;
        }
    }

    async checkChanges() {
        if(this._checkChangesPending) {
            await this.refreshCommits();
            const affectedWItems = this.workItems.filter(wi=>!isNullOrEmpty(wi.mentionedIn));
            if(!isNullOrEmpty(affectedWItems)) {
                this._onDidChangeData.fire(affectedWItems);
            }
            this._checkChangesPending=false;
        }
    }

    onDidChange() {
        logger.info("onDidChange");
        if(!this._checkChangesPending) {
            this._checkChangesPending=true;
            setTimeout(()=>this.checkChanges(),2000);
        }
    }

    async checkInWorkItem(wi:WorkItemModel, report?: (msg:string) => void) {
        const repo=this.getCurrentRepo();
        if(!repo) {
            return new Error("no repository");
        }

        const reportProgress = report 
        ? ((x:string)=> { report(x); logger.info(x);})
        : ((x:string)=>logger.info(x))
        ;
        reportProgress("pull from origin");
        await repo.pull();
        await this.refreshCommits();
        const wiId = wi.id() ?? 0;
        let commits = this.findCommitsMentionedIn(wiId);
        if(isNullOrEmpty(commits))
        {
            vscode.window.showInformationMessage("Nothing to check in");
            return;
        }
        commits = commits.sort((c1,c2)=>(c1.commitDate?.getTime() ?? 0) - (c2.commitDate?.getTime() ?? 0));

        const currBranchName=this.currentBranch();
        // . create temporary branch from the current branch
        const tmpBranchName = `tmp/_tmp_${currBranchName}_${wiId}_${formatDateTime(new Date())}`;
        let localBranchCreated=false;
        let remoteBranchCreated=false;
        const remoteName=repo.state.remotes[0].name;
        const remoteUrl=repo.state.remotes[0].fetchUrl;
        if(!(remoteName && remoteUrl)) {
            return new Error("cannot identify remote");
        }
        reportProgress("finding remote "+remoteUrl);
        const repoId = (await az.findRepositoryByUrl(remoteUrl))?.id;
        if(!repoId) {
            return new Error("cannot find remote repository " + remoteName);
        }
        try {
            // create a temporary branch
            reportProgress("create temp branch: "+tmpBranchName);
            const newBranch = await az.createBranch(repoId,currBranchName,tmpBranchName);
            if(!newBranch) {
                throw new Error("Could not create temp branch on remote");
            }
            remoteBranchCreated=true;

            // . pull
            reportProgress("fetch from origin");
            await repo.fetch();
            //await repo.createBranch(tmpBranchName,false);

            // cherry pick to temp branch
            await repo.checkout(tmpBranchName);
            localBranchCreated = true;

            const repoImpl = (repo as any).repository;
            for (const commit of commits) {
                await repoImpl.cherryPick(commit.hash);
            }

            // . publish the temp branch
            reportProgress("publish temp branch: "+tmpBranchName);
            await repo.push(remoteName,tmpBranchName);

            await repo.checkout(currBranchName);
            // . create pull request
            reportProgress("create pull request");
            //const commits = this.findCommitsMentionedIn(wiId);
            const response=await az.createPullReq(repoId,tmpBranchName,currBranchName,
                commits.map(c=>c.hash),
                {
                    title:`Check in request for ${wi.title}`,
                    workItemRefs:[wi.workItemRef()]
                }
            );
            if(typeof response === 'string') {
                throw new Error(response);
            }
            if(response.status === PullRequestStatus.Active && response.pullRequestId) {
                this._timer=setInterval(()=>this.checkPRStatus(Number(response.pullRequestId)),1000);
            }
    
            return response;
        }
        catch(err:any) {
            if(remoteBranchCreated) {
                //await az.deleteBranch(repoId,tmpBranchName);
                const brName = await az.getBranchRef(repoId,tmpBranchName);
                if(brName) {
                    reportProgress("delete remote temp branch "+tmpBranchName);
                    //await repo.push(remoteName,':'+brName?.name,false,0);
                    await repo.push(remoteName,':'+tmpBranchName,false,0);
                }            
            }
            return new Error(err);
        }
        finally {
            if(this.currentBranch()!==currBranchName)
            {
                await repo.checkout(currBranchName);
            }
            // delete temp branch
            if(localBranchCreated) {
                reportProgress("delete temp branch: "+tmpBranchName);
                await repo.deleteBranch(tmpBranchName,true);
            }
        }
    }
    
    async checkPRStatus(pullReqId:number) {
        const status = await az.getPullReqStatus(pullReqId);
        if(status) {
            if(status===PullRequestStatus.Active) {
                return;
            }
            clearInterval(this._timer);
            if(status===PullRequestStatus.Completed) {
                vscode.window.showInformationMessage(`Pull request ${pullReqId} completed. Updating repository ...`);
                const repo=this.getCurrentRepo();
                await repo?.fetch({prune:true});
                //await repo?.pull();
                vscode.window.showInformationMessage('done');
            }
        } else {
            clearInterval(this._timer);
        }
    }
}

let _state : State | undefined = undefined;

export function getState() {
    if(!_state) {
        _state=new State();
    }
    return _state;
}



export function mentionWorkItem(wiId:number) {
    let repo=getState().getCurrentRepo();
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
