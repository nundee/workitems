// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { getGitApiAsync } from "./gitExtension";
import { WorkItemProvider } from './workItemProvider';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {

    console.info('Congratulations, your extension "workitems" is now active!');
    const gitApi  = await getGitApiAsync();
    if(gitApi) {
        const repos=gitApi.repositories;
        if(!repos || repos.length<1) {
            console.info("No repos yet. Register to onDidOpenRepository event");
            const openRepoDisposable = gitApi.onDidOpenRepository(async e => {
                await e.status();
                (new WorkItemProvider()).registerAll(context);
                openRepoDisposable.dispose();
            });
            context.subscriptions.push(openRepoDisposable);
        } else {
            (new WorkItemProvider()).registerAll(context);
        }
    }
}

// This method is called when your extension is deactivated
export function deactivate() {
    console.info('your extension "workitems" is now inactive!');
}
