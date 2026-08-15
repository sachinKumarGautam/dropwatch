#!/usr/bin/env -S node --experimental-strip-types
/**
 * @dropwatch/worker CLI — the entrypoint run by GitHub Actions and locally.
 *
 *   worker check <productId>        check one tracked product
 *   worker check --url <url>        add (if new) and check a URL ad-hoc
 *   worker check-all                check every active product
 *   worker sweep [--product <id>]   competitor discovery
 *   worker digest                   send the 55–69 digest
 *   worker health                   DB ping (keepalive)
 *   worker add <url> [--target ₹] [--pincode P]
 *
 * Flags: --dry-run forces DRY_RUN=1 (fixtures + mocks, no keys).
 */
import "dotenv/config";
import {
  loadConfig,
  createDeps,
  checkProduct,
  checkAll,
  sweep,
  digest,
  health,
  addProduct,
  watchdog,
  sendOps,
} from "@dropwatch/core";

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}
function has(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}
const log = (o: unknown) => console.log(JSON.stringify(o));

async function main() {
  const rawArgs = process.argv.slice(2);
  // `pnpm run start -- check <id>` forwards the `--` separator as a literal arg.
  if (rawArgs[0] === "--") rawArgs.shift();
  const [command, ...args] = rawArgs;
  if (has(args, "dry-run")) process.env.DRY_RUN = "1";

  const cfg = loadConfig();
  const deps = createDeps(cfg);

  switch (command) {
    case "check": {
      const url = flag(args, "url");
      if (url) {
        const res = await addProduct(deps, url, {
          targetPrice: flag(args, "target") ? Number(flag(args, "target")) * 100 : null,
          pincode: flag(args, "pincode") ?? null,
        });
        log(res.check);
      } else {
        const id = args[0];
        if (!id) throw new Error("usage: worker check <productId> | --url <url>");
        log(await checkProduct(deps, id));
      }
      break;
    }
    case "check-all": {
      const summary = await checkAll(deps);
      for (const r of summary.results) log(r);
      log({ event: "check-all", checked: summary.checked, failed: summary.failed, alertsSent: summary.alertsSent });
      break;
    }
    case "sweep":
      log(await sweep(deps, flag(args, "product")));
      break;
    case "digest":
      log(await digest(deps));
      break;
    case "health":
      log(await health(deps));
      break;
    case "watchdog":
      log(await watchdog(deps));
      break;
    case "add": {
      const url = args[0];
      if (!url) throw new Error("usage: worker add <url> [--target ₹] [--pincode P]");
      const res = await addProduct(deps, url, {
        targetPrice: flag(args, "target") ? Number(flag(args, "target")) * 100 : null,
        pincode: flag(args, "pincode") ?? null,
      });
      log(res);
      break;
    }
    default:
      console.error(
        "commands: check <id|--url u> | check-all | sweep [--product id] | digest | watchdog | health | add <url>",
      );
      process.exit(2);
  }
}

main().catch(async (e) => {
  const msg = (e as Error).message;
  console.error("FATAL:", msg);
  // Hook 3: surface worker crashes to Slack ops. Best-effort.
  try {
    await sendOps(loadConfig(), `DropWatch worker FATAL (${process.argv[2] ?? "?"}): ${msg}`);
  } catch {
    /* config unavailable — console is enough */
  }
  process.exit(1);
});
