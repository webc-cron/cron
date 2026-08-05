#!/usr/bin/env bun

import Hw from "@3-/hwdns";
import HW from "../conf/HW.js";

export default Object.fromEntries(
  Object.entries(HW).map(([k, v]) => [k, Hw(...v)])
);
