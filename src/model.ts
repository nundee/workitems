import { WorkItem } from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces";
import { GitCommit } from "azure-devops-node-api/interfaces/GitInterfaces";

export class WorkItemModel  {
    workItem:WorkItem;
    mentionedIn:GitCommit[]=[];
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
