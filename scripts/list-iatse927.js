#!/usr/bin/env node
import dotenv from "dotenv";
import { loadAllMessages } from "../get-schedule/iatse927-message-store.js";

dotenv.config();

function printUsage() {
  console.log(`Usage: npm run list:iatse927 -- [options]

Options:
  --limit N     Show only the last N messages (chronological)
  --help, -h    Show this help
`);
}

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{ limit: number | null }} */
  const opts = { limit: null };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else if (arg === "--limit") {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n < 1) throw new Error("--limit requires a positive number");
      opts.limit = Math.floor(n);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const messages = await loadAllMessages();

  if (messages.length === 0) {
    console.log("No messages in Firestore (iatse927_messages).");
    return;
  }

  const slice =
    opts.limit != null ? messages.slice(-opts.limit) : messages;
  const offset = messages.length - slice.length;

  console.log(
    `📱 iatse927_messages: ${messages.length} total (sorted by receivedAt ascending)`
  );
  if (opts.limit != null) {
    console.log(`   Showing last ${slice.length} message(s)\n`);
  } else {
    console.log("");
  }

  slice.forEach((msg, i) => {
    const index = offset + i + 1;
    const when = msg.receivedAt?.toISOString() ?? "(no receivedAt)";
    console.log(`${index}. [${when}]`);
    console.log(msg.text.trim());
    console.log("");
  });
}

main().catch((err) => {
  console.error("❌ List failed:", err.message || err);
  process.exit(1);
});
