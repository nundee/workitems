import * as vscode from 'vscode';

let _logger : vscode.OutputChannel | undefined = undefined;

function doLog(category:string, ...param:any[]) {
    if(!_logger) {
        _logger = vscode.window.createOutputChannel("WorkItems");
        _logger.show();
    }
    if(_logger) {
        _logger?.append(`[${category}] `);
        for (const p of param) {
            _logger?.append(p.toString());
        }
        _logger.appendLine("");
    }
}
export function info(...param:any[]) {
    doLog("info",...param);
}

export function error(...param:any[]) {
    doLog("error",...param);
}

export function dispose() {
    if(_logger) {
        _logger.dispose();
        _logger=undefined;
    }
}
