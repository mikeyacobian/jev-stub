#!/usr/bin/env node
/**
 * Tiny typesafe/jev stub. One state (a support note) → two questions:
 *   choice topic: billing | bug | account | other
 *   noul escalate: should a human take this?
 * Native fetch only. No extra deps.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODEL = "typesafe/jev";
const RUN_URL = (accountId) =>
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run`;

const AUTO_CONF = 0.8;
const ABSTAIN_CONF = 0.5;
const NOUL_YES = 0.8;
const NOUL_NO = 0.2;

const QUESTIONS = {
  topic: {
    type: "choice",
    instructions: "What is this support note about?",
    criteria: {
      billing: "Charges, invoices, refunds, payments, or subscriptions",
      bug: "Product bugs, crashes, outages, or broken features",
      account: "Login, password, profile, or security issues",
      other: "Anything that is not billing, a bug, or an account issue",
    },
  },
  escalate: {
    type: "noul",
    instructions: "Should a human take this?",
    criteria: {
      true: "A person should handle this now",
      false: "This can stay on an automated path",
    },
  },
};

const FALLBACK_NOTE = `This is not a live Jev success.
While you wait: SemIf (https://openjev.com) runs typed decisions locally in the browser.
Kev is a small local Jev-like model: https://huggingface.co/jaredpalmer/kev-0.6b`;

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(join(ROOT, ".env"));
loadEnvFile(join(process.cwd(), ".env"));

function parseArgs(argv) {
  const args = { dryRun: false, provider: "cloudflare", limit: null, file: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--provider" || a.startsWith("--provider=")) {
      const v = a.includes("=") ? a.split("=").slice(1).join("=") : argv[++i];
      if (!v) fail("Missing value for --provider (use mock).");
      args.provider = v;
    } else if (a === "--limit" || a.startsWith("--limit=")) {
      const v = a.includes("=") ? a.split("=").slice(1).join("=") : argv[++i];
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) fail("`--limit` needs a non-negative integer.");
      args.limit = n;
    } else if (a === "--file" || a.startsWith("--file=")) {
      const v = a.includes("=") ? a.split("=").slice(1).join("=") : argv[++i];
      if (!v) fail("Missing value for --file.");
      args.file = v;
    } else {
      fail(`Unknown flag: ${a}\n${usage()}`);
    }
  }
  if (args.provider !== "cloudflare" && args.provider !== "mock") {
    fail(`Unknown --provider=${args.provider}. Use mock (or omit for Cloudflare).`);
  }
  return args;
}

function usage() {
  return `Usage: node src/run.mjs [--dry-run] [--provider=mock] [--limit N] [--file path]

  --dry-run         Print the payload. No network, no secrets needed.
  --provider=mock   Invent plausible answer shapes. Offline demo, not Jev.
  --limit N         Only the first N notes.
  --file path       samples.txt (one note per line) or sample-notes.json.
`;
}

function fail(message, extra) {
  console.error(message);
  if (extra) console.error(extra);
  process.exit(1);
}

function defaultSamplePath() {
  const candidates = [
    join(ROOT, "data", "samples.txt"),
    join(ROOT, "samples.txt"),
    join(ROOT, "data", "sample-notes.json"),
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[0];
}

function loadNotes(file) {
  const path = resolve(file);
  if (!existsSync(path)) fail(`No sample file at ${path}`);
  const raw = readFileSync(path, "utf8");
  if (path.endsWith(".json")) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) fail("JSON samples must be an array of { id, text }.");
    return parsed.map((row, i) => {
      const text = typeof row === "string" ? row : row.text;
      if (!text || typeof text !== "string") fail(`JSON row ${i} is missing text.`);
      return { id: String(row.id ?? i + 1), text: text.trim() };
    });
  }
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((text, i) => ({ id: String(i + 1), text }));
}

function decideAction(conf, noul) {
  if (!Number.isFinite(conf) || conf < ABSTAIN_CONF) return "abstain";
  const decided = Number.isFinite(noul) && (noul >= NOUL_YES || noul <= NOUL_NO);
  if (conf >= AUTO_CONF && decided) return "auto";
  return "look";
}

function fmt(n) {
  return Number.isFinite(n) ? n.toFixed(2) : "  ? ";
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

function printTable(rows) {
  const header =
    pad("#", 4) +
    pad("topic", 10) +
    pad("bill", 7) +
    pad("bug", 7) +
    pad("acct", 7) +
    pad("oth", 7) +
    pad("noul", 7) +
    pad("conf", 7) +
    pad("action", 9) +
    "text";
  console.log(header);
  console.log("-".repeat(Math.min(header.length + 24, 108)));
  for (const r of rows) {
    const t = r.text.length > 48 ? `${r.text.slice(0, 45)}...` : r.text;
    console.log(
      pad(r.id, 4) +
        pad(r.topic, 10) +
        pad(fmt(r.probs.billing), 7) +
        pad(fmt(r.probs.bug), 7) +
        pad(fmt(r.probs.account), 7) +
        pad(fmt(r.probs.other), 7) +
        pad(fmt(r.noul), 7) +
        pad(fmt(r.conf), 7) +
        pad(r.action, 9) +
        t,
    );
  }
}

function pickTopic(probs) {
  let best = "other";
  let bestP = -1;
  for (const [k, v] of Object.entries(probs)) {
    if (v > bestP) {
      best = k;
      bestP = v;
    }
  }
  return best;
}

function mockAnswers(text) {
  const t = text.toLowerCase();
  let probs = { billing: 0.12, bug: 0.14, account: 0.16, other: 0.58 };
  if (/charg|invoice|refund|bill|payment|subscript/.test(t)) {
    probs = { billing: 0.86, bug: 0.04, account: 0.06, other: 0.04 };
  } else if (/crash|bug|error|down|outage|broken/.test(t)) {
    probs = { billing: 0.03, bug: 0.88, account: 0.05, other: 0.04 };
  } else if (/log ?in|password|reset|account/.test(t)) {
    probs = { billing: 0.04, bug: 0.08, account: 0.82, other: 0.06 };
  } else if (/export|csv|how do i/.test(t)) {
    probs = { billing: 0.08, bug: 0.10, account: 0.12, other: 0.70 };
  }
  const choice = pickTopic(probs);
  let noul = 0.22;
  if (/yelling|down|twice|never arrived|can't|cannot/.test(t)) noul = 0.84;
  if (/export|csv|how do i/.test(t)) noul = 0.18;
  if (/crashes/.test(t)) noul = 0.46;
  const confidence = probs[choice];
  return {
    model: "mock",
    answers: {
      topic: { type: "choice", choice, confidence, probabilities: probs },
      escalate: { type: "noul", noul },
    },
  };
}

function unwrapResult(body) {
  if (body && typeof body === "object" && body.result && typeof body.result === "object") {
    return body.result;
  }
  return body;
}

function parseAnswers(result) {
  const answers = result?.answers ?? {};
  const topic = answers.topic ?? {};
  const escalate = answers.escalate ?? {};
  const probs = {
    billing: Number(topic.probabilities?.billing),
    bug: Number(topic.probabilities?.bug),
    account: Number(topic.probabilities?.account),
    other: Number(topic.probabilities?.other),
  };
  const conf = Number.isFinite(Number(topic.confidence))
    ? Number(topic.confidence)
    : Math.max(
        ...["billing", "bug", "account", "other"].map((k) =>
          Number.isFinite(probs[k]) ? probs[k] : 0,
        ),
      );
  const noul = Number(escalate.noul);
  const choice =
    typeof topic.choice === "string" && topic.choice
      ? topic.choice
      : pickTopic(
          Object.fromEntries(
            Object.entries(probs).map(([k, v]) => [k, Number.isFinite(v) ? v : -1]),
          ),
        );
  return { topic: choice, probs, noul, conf, action: decideAction(conf, noul) };
}

function isAccessFailure(status, body) {
  if (status === 401 || status === 403) return true;
  const blob = JSON.stringify(body ?? {}).toLowerCase();
  return /waitlist|unauthorized|forbidden|not.?allowed|access denied|blocked|do not have access|model .*not (found|available|enabled)/.test(
    blob,
  );
}

async function callJev(accountId, token, state) {
  const url = RUN_URL(accountId);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      input: { state, questions: QUESTIONS },
    }),
  });
  const rawText = await res.text();
  let body = rawText;
  try {
    body = rawText ? JSON.parse(rawText) : {};
  } catch {
    body = { raw: rawText };
  }
  return { status: res.status, ok: res.ok, body };
}

function printAccessStop(status, body) {
  console.error("STOP: live typesafe/jev call did not succeed (auth, waitlist, or model blocked).");
  console.error(`HTTP ${status}`);
  if (body?.errors) console.error(JSON.stringify(body.errors, null, 2));
  else if (body) console.error(typeof body === "string" ? body : JSON.stringify(body, null, 2));
  console.error(FALLBACK_NOTE);
}

function versionOf(result) {
  const bits = [];
  if (result?.model) bits.push(`model=${result.model}`);
  if (result?.version) bits.push(`version=${result.version}`);
  return bits.length ? bits.join(" ") : null;
}

function printHelp() {
  console.log(`Jev stub — classify short support notes with ${MODEL}.
`);
  console.log(usage());
  console.log(`Questions: choice topic (billing|bug|account|other), noul escalate.
Action: auto if conf>=${AUTO_CONF} and escalate noul>=${NOUL_YES} or <=${NOUL_NO};
        abstain if conf<${ABSTAIN_CONF}; else look.
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const file = args.file ?? defaultSamplePath();
  let notes = loadNotes(file);
  if (args.limit != null) notes = notes.slice(0, args.limit);

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() || "";
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim() || "";
  const mode = args.dryRun ? "dry-run" : args.provider === "mock" ? "mock" : "live";

  console.log(`model catalog: ${MODEL}`);
  console.log(`mode: ${mode}   notes: ${notes.length} from ${file}`);
  console.log(
    `action: auto if conf>=${AUTO_CONF} and noul>=${NOUL_YES} or <=${NOUL_NO}; abstain if conf<${ABSTAIN_CONF}; else look`,
  );
  console.log("");

  if (mode === "dry-run") {
    console.log("Would POST");
    console.log(`  ${RUN_URL(accountId || "$CLOUDFLARE_ACCOUNT_ID")}`);
    console.log("  Authorization: Bearer $CLOUDFLARE_API_TOKEN");
    console.log(
      JSON.stringify({ model: MODEL, input: { state: "<note text>", questions: QUESTIONS } }, null, 2),
    );
    console.log("");
    console.log("Notes (no request sent, no answers invented):");
    for (const n of notes) console.log(`  ${n.id}. ${n.text}`);
    console.log("");
    console.log("Next: node src/run.mjs --provider=mock   (offline shapes)");
    console.log("      npm run jev                         (live, needs keys)");
    return;
  }

  if (mode === "live") {
    if (!accountId || !token) {
      fail(
        "STOP: missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN.",
        "Copy .env.example to .env and fill them in. Or run without keys:\n  npm run jev:dry\n  node src/run.mjs --provider=mock",
      );
    }
  }

  const rows = [];
  let printedVersion = false;

  for (const note of notes) {
    let result;
    if (mode === "mock") {
      result = mockAnswers(note.text);
    } else {
      let call;
      try {
        call = await callJev(accountId, token, note.text);
      } catch (err) {
        fail(`STOP: network error calling typesafe/jev.\n${err?.message || err}`, FALLBACK_NOTE);
      }
      if (!call.ok || call.body?.success === false) {
        if (isAccessFailure(call.status, call.body)) {
          printAccessStop(call.status, call.body);
          process.exit(1);
        }
        fail(
          `STOP: live typesafe/jev call failed (HTTP ${call.status}). Not treating this as success.`,
          typeof call.body === "string" ? call.body : JSON.stringify(call.body, null, 2),
        );
      }
      result = unwrapResult(call.body);
    }

    if (!printedVersion) {
      const v = versionOf(result);
      if (v) console.log(`response ${v}`);
      else if (mode === "live") console.log("response: no model/version field present");
      if (mode === "mock") console.log("MOCK — invented shapes, not a live Jev call");
      console.log("");
      printedVersion = true;
    }

    if (mode === "live" && !result?.answers) {
      fail(
        "STOP: live response had no answers object. Not inventing results.",
        JSON.stringify(result, null, 2),
      );
    }

    const parsed = parseAnswers(result);
    rows.push({ id: note.id, text: note.text, ...parsed });
  }

  printTable(rows);
}

main().catch((err) => fail(err?.stack || String(err)));
