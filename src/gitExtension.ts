// Import the git.d.ts file
import * as vscode from "vscode";
import { API as GitAPI, GitExtension, APIState } from './@types/git'; 

const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git')?.exports;
export function getGitApi()  { 
    return gitExtension?.getAPI(1);
}

//const rootPath = vscode.workspace.rootPath;
