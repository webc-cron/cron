#!/usr/bin/env bun

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import genAll from "./genAll.js";

if (import.meta.main) {
  const argv = yargs(hideBin(process.argv))
    .option("sync", {
      type: "boolean",
      description: "仅同步现有有效证书到服务器，不重新申请",
    })
    .help()
    .alias("h", "help").argv;

  await genAll(argv.sync);
  process.exit();
}
