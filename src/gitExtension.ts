// Import the git.d.ts file
import * as vscode from "vscode";
import { API as GitAPI, GitExtension } from './@types/git'; 
import { poll } from './utils'

let _gitExtension : GitExtension | undefined; 
let _gitApi:GitAPI | undefined = undefined;


export async function getGitApiAsync(timeoutSeconds?:number) : Promise<GitAPI | undefined> {
    await poll((timeoutSeconds ?? 10)*1000, 500, ()=> {
        if (!_gitExtension) {
            const vsExt = vscode.extensions.getExtension<GitExtension>('vscode.git');
            if(vsExt && vsExt.isActive) {
                _gitExtension=vsExt.exports;
                if(_gitExtension) {
                    _gitApi = _gitExtension.getAPI(1);
                }
            } else {
                console.info("no git api yet");
            }
        }
        const res=(_gitApi !== undefined);
        if(res) {
            console.info("got git api");
        }
        return res;
    });
    return  _gitApi;
}

export function getGitApi() : GitAPI | undefined {
    return _gitApi;
}
