#!/usr/bin/env node

import { stdin, stdout } from "node:process";

function readStdin() {
    return new Promise((resolve) => {
        let data = "";
        stdin.setEncoding("utf8");
        stdin.on("data", (chunk) => {
            data += chunk;
        });
        stdin.on("end", () => resolve(data));
    });
}

function normalizeInput(rawInput) {
    if (typeof rawInput !== "string") return "";
    // PowerShell can emit UTF-16 style stdin with null bytes.
    return rawInput.replace(/\u0000/g, "").replace(/^\uFEFF/, "").trim();
}

function getCommandText(payload) {
    if (!payload || typeof payload !== "object") return "";

    const candidates = [
        payload?.toolInput?.command,
        payload?.tool_input?.command,
        payload?.arguments?.command,
        payload?.params?.command,
        payload?.command
    ];

    for (const value of candidates) {
        if (typeof value === "string" && value.trim()) {
            return value.trim();
        }
    }

    return "";
}

function decisionOutput(decision, reason) {
    return {
        hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: decision,
            permissionDecisionReason: reason
        }
    };
}

const denyPatterns = [
    /\bgit\s+reset\s+--hard\b/i,
    /\bgit\s+checkout\s+--\b/i,
    /\brm\s+-rf\s+\//i,
    /\bdel\s+\/f\s+\/s\s+\/q\b/i,
    /\bformat\s+[a-z]:/i
];

const askPatterns = [
    /\bgit\s+push\b/i,
    /\b(npm|pnpm|yarn)\s+publish\b/i,
    /\bdocker\s+system\s+prune\b/i,
    /\bdocker\s+volume\s+prune\b/i,
    /\bdrop\s+database\b/i
];

(async () => {
    const rawInput = await readStdin();
    const normalizedInput = normalizeInput(rawInput);

    if (!normalizedInput) {
        stdout.write(JSON.stringify(decisionOutput("allow", "No hook input payload.")));
        return;
    }

    let payload;
    try {
        payload = JSON.parse(normalizedInput);
    } catch {
        stdout.write(JSON.stringify(decisionOutput("allow", "Input payload is not valid JSON.")));
        return;
    }

    const commandText = getCommandText(payload);

    if (!commandText) {
        stdout.write(JSON.stringify(decisionOutput("allow", "No shell command detected for this tool call.")));
        return;
    }

    for (const pattern of denyPatterns) {
        if (pattern.test(commandText)) {
            stdout.write(
                JSON.stringify(
                    decisionOutput(
                        "deny",
                        `Blocked potentially destructive command: ${commandText}`
                    )
                )
            );
            return;
        }
    }

    for (const pattern of askPatterns) {
        if (pattern.test(commandText)) {
            stdout.write(
                JSON.stringify(
                    decisionOutput(
                        "ask",
                        `Require explicit confirmation for risky command: ${commandText}`
                    )
                )
            );
            return;
        }
    }

    stdout.write(JSON.stringify(decisionOutput("allow", "Command passed safety policy.")));
})();
