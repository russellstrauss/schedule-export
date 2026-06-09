#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { parseRcsThread, mergeAndSortMessages } from "../get-schedule/iatse927-thread-parser.js";
import { bulkAppendMessages, loadAllMessages } from "../get-schedule/iatse927-message-store.js";
import { syncIatse927FromMessages } from "../get-schedule/ingest-iatse927.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function printUsage() {
  console.log(`Usage: npm run bootstrap:iatse927 -- [options] [thread.txt ...]

Options:
  --dry-run     Parse and print message count; do not write to Firestore
  --no-sync     Import messages but skip calendar sync
  --dir PATH    Import all .txt files from a directory
  --ref DATE    Reference date for year inference (ISO, default: today)
`);
}

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{ dryRun: boolean; noSync: boolean; files: string[]; referenceDate: Date }} */
  const opts = {
    dryRun: false,
    noSync: false,
    files: [],
    referenceDate: new Date()
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--no-sync") opts.noSync = true;
    else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else if (arg === "--dir") {
      const dir = argv[++i];
      if (!dir) throw new Error("--dir requires a path");
      const names = fs.readdirSync(dir).filter((n) => n.endsWith(".txt"));
      opts.files.push(...names.map((n) => path.join(dir, n)));
    } else if (arg === "--ref") {
      const ref = argv[++i];
      if (!ref) throw new Error("--ref requires an ISO date");
      opts.referenceDate = new Date(ref);
    } else if (!arg.startsWith("-")) {
      opts.files.push(arg);
    }
  }

  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.files.length === 0) {
    printUsage();
    process.exit(1);
  }

  /** @type {ReturnType<typeof parseRcsThread>} */
  let allMessages = [];

  for (const file of opts.files) {
    const text = fs.readFileSync(file, "utf8");
    const sourceThread = path.basename(file, path.extname(file));
    const parsed = parseRcsThread(text, {
      referenceDate: opts.referenceDate,
      sourceThread
    });
    console.log(`📄 ${file}: ${parsed.length} message(s)`);
    allMessages = mergeAndSortMessages([...allMessages, ...parsed]);
  }

  console.log(`📱 Total: ${allMessages.length} message(s) after merge`);

  if (opts.dryRun) {
    for (const m of allMessages.slice(0, 5)) {
      console.log(`  [${m.receivedAt.toISOString()}] ${m.text.slice(0, 80)}…`);
    }
    if (allMessages.length > 5) console.log(`  … and ${allMessages.length - 5} more`);
    return;
  }

  const { inserted, skipped } = await bulkAppendMessages(allMessages);
  console.log(`💾 Firestore: inserted=${inserted}, skipped=${skipped}`);

  if (opts.noSync) return;

  if (!process.env.GEMINI_API_KEY?.trim()) {
    throw new Error("GEMINI_API_KEY is required for sync. Use --no-sync to import only.");
  }

  const stored = await loadAllMessages();
  await syncIatse927FromMessages(stored);
}

main().catch((err) => {
  console.error("❌ Bootstrap failed:", err.message || err);
  process.exit(1);
});
