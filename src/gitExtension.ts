// Import the git.d.ts file
import * as vscode from "vscode";
import { API as GitAPI, GitExtension, APIState } from './@types/git'; 

let _gitExtension : GitExtension | undefined; 
let _gitApi:GitAPI | undefined = undefined;

export function getGitApi() : GitAPI | undefined { 
    if (!_gitExtension) {
        _gitExtension=vscode.extensions.getExtension<GitExtension>('vscode.git')?.exports;
        _gitApi = _gitExtension?.getAPI(1);
    }
    return  _gitApi;
}
