// Import the git.d.ts file
import * as vscode from "vscode";
import { API as GitAPI, GitExtension, APIState } from './@types/git'; 

const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git')?.exports;
let _gitApi:GitAPI | undefined = undefined;

export function getGitApi()  { 
    if (!_gitApi) {
        _gitApi = gitExtension?.getAPI(1);
    }
    return  _gitApi;
}

//const rootPath = vscode.workspace.rootPath;
