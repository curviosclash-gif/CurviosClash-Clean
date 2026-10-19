import ts from 'typescript';

// ADR 0001 caps the IPC surface. Counting only literal ipcMain.handle('…') calls let channels slip
// past the ratchet through a helper (createInvokeBridge('x'), registerHandler(CHANNELS.x)) or a
// constant. This collector resolves file-local string constants and frozen channel tables, and
// counts each call of a helper whose channel parameter reaches ipcRenderer/ipcMain once.

const IPC_METHODS = new Map([
    ['ipcRenderer', new Set(['invoke', 'send', 'sendSync', 'on', 'once', 'removeListener', 'removeAllListeners'])],
    ['ipcMain', new Set(['handle', 'handleOnce', 'on', 'once', 'removeHandler', 'removeAllListeners'])],
]);

function unwrapFreeze(node) {
    if (node && ts.isCallExpression(node) && node.expression.getText() === 'Object.freeze') {
        return node.arguments[0];
    }
    return node;
}

function collectStringConstants(sourceFile) {
    const constants = new Map();
    const visit = (node) => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
            const initializer = unwrapFreeze(node.initializer);
            if (ts.isStringLiteralLike(initializer)) {
                constants.set(node.name.text, initializer.text);
            } else if (initializer && ts.isObjectLiteralExpression(initializer)) {
                for (const property of initializer.properties) {
                    if (ts.isPropertyAssignment(property) && ts.isStringLiteralLike(property.initializer)) {
                        constants.set(`${node.name.text}.${property.name.getText(sourceFile)}`, property.initializer.text);
                    }
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return constants;
}

function resolveIpcTarget(callee) {
    if (!ts.isPropertyAccessExpression(callee)) return null;
    const receiver = callee.expression;
    const receiverName = ts.isIdentifier(receiver)
        ? receiver.text
        : (ts.isPropertyAccessExpression(receiver) ? receiver.name.text : '');
    const methods = IPC_METHODS.get(receiverName);
    if (!methods || !methods.has(callee.name.text)) return null;
    return { bucket: receiverName, method: callee.name.text };
}

function findEnclosingParameterOwner(node, name) {
    for (let current = node.parent; current; current = current.parent) {
        if (!ts.isFunctionLike(current)) continue;
        const index = current.parameters.findIndex((parameter) => (
            ts.isIdentifier(parameter.name) && parameter.name.text === name
        ));
        if (index >= 0) return { fn: current, index };
    }
    return null;
}

function readFunctionName(fn) {
    if (fn.name && ts.isIdentifier(fn.name)) return fn.name.text;
    const parent = fn.parent;
    if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
    return '';
}

function resolveChannel(argument, constants) {
    if (!argument) return '<dynamic>';
    if (ts.isStringLiteralLike(argument)) return argument.text;
    const text = argument.getText();
    return constants.get(text) ?? `<dynamic:${text}>`;
}

function readLine(sourceFile, node) {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    const lineStart = sourceFile.getPositionOfLineAndCharacter(line, 0);
    const lineEnd = sourceFile.getLineEndOfPosition(lineStart);
    return { line: line + 1, snippet: sourceFile.text.slice(lineStart, lineEnd).trim() };
}

export function collectElectronIpcChannels(relativePath, text) {
    const sourceFile = ts.createSourceFile(relativePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const constants = collectStringConstants(sourceFile);
    const directCalls = [];
    const calls = [];
    const visit = (node) => {
        if (ts.isCallExpression(node)) {
            calls.push(node);
            const target = resolveIpcTarget(node.expression);
            if (target) directCalls.push({ node, ...target });
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    const entries = { ipcRenderer: [], ipcMain: [] };
    const push = (bucket, node, kind, channel) => {
        entries[bucket].push({ file: relativePath, ...readLine(sourceFile, node), kind, channel });
    };

    for (const { node, bucket, method } of directCalls) {
        const argument = node.arguments[0];
        // A helper parameter shadows a file-level constant of the same name.
        const owner = argument && ts.isIdentifier(argument)
            ? findEnclosingParameterOwner(node, argument.text)
            : null;
        const helperName = owner ? readFunctionName(owner.fn) : '';
        const helperCalls = helperName
            ? calls.filter((call) => ts.isIdentifier(call.expression) && call.expression.text === helperName)
            : [];
        if (helperCalls.length === 0) {
            push(bucket, node, `${bucket}.${method}`, resolveChannel(argument, constants));
            continue;
        }
        for (const call of helperCalls) {
            push(bucket, call, `${bucket}.${method} via ${helperName}`, resolveChannel(call.arguments[owner.index], constants));
        }
    }
    return entries;
}
