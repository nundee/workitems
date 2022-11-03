import * as vscode from 'vscode';
import * as az from './azureClient';
import { WorkItem } from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces";
import { Commit} from './@types/git';
import { getGitApi } from "./gitExtension";
import { PullRequestStatus } from 'azure-devops-node-api/interfaces/GitInterfaces';

export function isNullOrEmpty(a:any[]):boolean {
    return !a || a.length ===0;
}

function currentRepo() {
    return getGitApi()?.repositories[0];
}

function currentBranch() : string {
    const repo=currentRepo();
    const bName=repo?.state.HEAD?.name;// .refs[0].name;
    return bName ?? "";
}

async function remoteRepoId() {
    const repo = currentRepo();
    if(repo) {
        const remoteUrl=repo.state.remotes[0].fetchUrl;
        if(remoteUrl) {
            return (await az.findRepositoryByUrl(remoteUrl))?.id;
        }
    }
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
    private lastHeadCommit:string | undefined = undefined;
    private refreshCommitsPending=false;
    private subscriptions: {dispose() : any}[] = [];
    private _timer : NodeJS.Timer | undefined = undefined;
    private _onDidChangeData = new vscode.EventEmitter<WorkItemModel[]>();
    readonly onDidChangeData = this._onDidChangeData.event;

    constructor() {
        const repo=currentRepo();
        if(repo) {
            this.lastHeadCommit = repo.state.HEAD?.commit;
            this.subscriptions.push(repo.state.onDidChange((e)=>this.checkRepoChange()));
        }
    }

    dispose() {
        this.subscriptions.forEach(d=>d.dispose());
    }

    findCommitsMentionedIn(wiId:number) {
        return this.commits.filter(commit=>extractWorkItemIdFromComment(commit.message) === wiId);
    }

    async refresh(filterText?:string) {
        const vsCfg = vscode.workspace.getConfiguration();
        const cfgField:string = vsCfg.get("workItems.searchLast","changed");
        let col = "[System.ChangedDate]";
        if (cfgField==="created") {
            col = "[System.CreatedDate]";
        }
        const count:number = vsCfg.get<number>("workItems.count",10);
        let whereClause:string='';
        const wiId=Number(filterText);
        if (isNaN(wiId) || wiId===0) {
            whereClause = filterText
                ? `[System.Title] contains '${filterText}'` 
                : `${col} >= @Today-${count} ORDER BY ${col} DESC`
                ;
        } else {
            whereClause = `[System.Id] = ${filterText}`;
        }
        const query = `SELECT [System.Id], ${col} FROM WorkItems WHERE ${whereClause}`;
        //const query = `SELECT [System.Id], ${col} FROM WorkItems WHERE [System.Title] contains words 'Integreater'`;
        console.log("fetching work items ...");
        console.log(query);
        const wItems = await az.getWorkItemsFromTfs(query);
        if (!wItems) {return [];}
        this.workItems = (wItems as WorkItem[]).map(wi=>new WorkItemModel(wi));
        await this.refreshCommits();
    }

    async refreshCommits() {
        const repoId = await remoteRepoId();
        if(repoId) {
            const branchName=currentBranch();
            if (branchName) {
                const azCommits = await az.getCommitsFromTfs(repoId, branchName);
                const uniqueIds = new Set(azCommits.map(c=>String(c.commitId)));
                const allCommits = await currentRepo()?.log({maxEntries:1000});
                this.commits = allCommits ? allCommits.filter(c=>!uniqueIds.has(c.hash)) : [];
                const allMentionedIds=new Set(this.commits.map(c=>extractWorkItemIdFromComment(c.message)));
                this.workItems.forEach(wi => {
                    if(allMentionedIds.has(wi.id() ?? -1)) {
                        wi.mentionedIn=this.findCommitsMentionedIn(wi.id() ?? -1);
                    } else {
                        wi.mentionedIn=[];
                    }
                });
                this.refreshCommitsPending=false;
            }
        }
    }

    async onRepoChanged() {
        if(this.refreshCommitsPending) {
            await this.refreshCommits();
            const affectedWItems = this.workItems.filter(wi=>!isNullOrEmpty(wi.mentionedIn));
            if(!isNullOrEmpty(affectedWItems)) {
                this._onDidChangeData.fire(affectedWItems);
            }
        }
    }

    checkRepoChange() {
        const repo=currentRepo();
        const headCommit=repo?.state.HEAD?.commit;
        if(repo && headCommit) {
            if(headCommit !== this.lastHeadCommit) {
                this.lastHeadCommit = headCommit;
                if(!this.refreshCommitsPending) {
                    this.refreshCommitsPending=true;
                    setTimeout(()=>this.onRepoChanged(),2000);
                }
            }
        }
    }

    async checkInWorkItem(wi:WorkItemModel, report?: (msg:string) => void) {
        const repo=currentRepo();
        if(!repo) {
            return "no repository";
        }
    
        const reportProgress = report 
        ? ((x:string)=> { report(x); console.log(x);})
        : ((x:string)=>console.log(x))
        ;
    
        const currBranchName=currentBranch();
        // . create temporary branch from the current branch
        const wiId = wi.id() ?? 0;
        const tmpBranchName = `tmp/_tmp_${currBranchName}_${wiId}_${formatDateTime(new Date())}`;
        let localBranchCreated=false;
        let remoteBranchCreated=false;
        const remoteName=repo.state.remotes[0].name;
        const remoteUrl=repo.state.remotes[0].fetchUrl;
        if(!(remoteName && remoteUrl)) {
            return "cannot identify remote";
        }
        reportProgress("finding remote "+remoteUrl);
        const repoId = (await az.findRepositoryByUrl(remoteUrl))?.id;
        if(!repoId) {
            return "cannot find remote repository " + remoteName;
        }
        try {
            // . pull
            reportProgress("pull from origin");
            await repo.pull();
            await this.refreshCommits();
            // create a temporary branch
            reportProgress("create temp branch: "+tmpBranchName);
            await repo.createBranch(tmpBranchName,false);
            localBranchCreated=true;
            // . publish the temp branch
            reportProgress("publish temp branch: "+tmpBranchName);
            await repo.push(remoteName,tmpBranchName);
            remoteBranchCreated=true;
            // . create pull request
            reportProgress("create pull request");
            const commits = this.findCommitsMentionedIn(wiId);
            const response=await az.createPullReq(repoId,tmpBranchName,currBranchName,
                commits.map(c=>c.hash),
                {
                    title:`Check in request for ${wi.title}`,
                    workItemRefs:[wi.workItemRef()]
                }
            );
            if(typeof response === 'string') {
                throw response;
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
                    await repo.push(remoteName,':'+brName?.name,false,0);
                }            
            }
            return String(err);
        }
        finally {
            // delete temp branch
            if(localBranchCreated) {
                reportProgress("delete temp branch: "+tmpBranchName);
                await repo.deleteBranch(tmpBranchName,true);
            }
            //await repo.fetch({prune:true});
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
                const repo=currentRepo();
                await repo?.fetch({prune:true});
                await repo?.pull();
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


