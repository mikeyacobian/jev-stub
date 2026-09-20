# Jev stub

## How Mike runs this

Five commands. No keys needed until you try a live call.

```bash
git clone https://github.com/mikeyacobian/jev-stub.git && cd jev-stub
npm i
cp .env.example .env
npm run jev:dry
node src/run.mjs --provider=mock
```

Dry-run prints the payload and notes; it does not call the network. `--provider=mock` invents plausible answer shapes so you can see the table offline. **Mock is not Jev.**

For a live call, put real values in `.env` (do not invent them) and run `npm run jev`.

| env | what |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | your Cloudflare account id |
| `CLOUDFLARE_API_TOKEN` | a token that can run Workers AI |

Optional: `--limit N` and `--file path` (`data/samples.txt` by default; `data/sample-notes.json` also works).

## What this is

Jev is TypeSafe’s structured decision model — not a chatbot. You send a piece of text (the **state**) plus typed questions. It returns calibrated answers your code can branch on.

This repo is **one small Node script**. It reads a few fake support notes and asks two questions:

- **choice `topic`:** `billing` | `bug` | `account` | `other` (plus probabilities)
- **noul `escalate`:** should a human take this? (a yes/no probability from 0 to 1)

Catalog name on Cloudflare Workers AI: **`typesafe/jev`**. If the response includes `model` or `version` (for example `jev-1.13.0`), the script prints it so you know which build answered.

## What the table means

Each note prints **topic + probs**, **escalate noul**, **confidence**, and one action:

| action | when |
| --- | --- |
| `auto` | confidence ≥ 0.8 **and** escalate is clearly decided (noul ≥ 0.8 or ≤ 0.2) |
| `abstain` | confidence < 0.5 |
| `look` | everything else |

## If live is blocked

If auth fails or `typesafe/jev` is waitlisted, the script **stops**. It will not fake a live success.

Fallbacks while you wait (not this stub, not Jev):

- **SemIf** (formerly OpenJev) — typed decisions in the browser: https://openjev.com
- **Kev** — small local Jev-like model: https://huggingface.co/jaredpalmer/kev-0.6b
