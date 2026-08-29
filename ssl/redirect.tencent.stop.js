#!/usr/bin/env bun

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { teo } from "tencentcloud-sdk-nodejs-teo";
import { SecretId, SecretKey } from "../conf/TENCENT.js";

const CLIENT_CLASS = teo.v20220901.Client,
  client = new CLIENT_CLASS({
    credential: { secretId: SecretId, secretKey: SecretKey },
    region: "ap-guangzhou",
  }),
  argv = await yargs(hideBin(process.argv))
    .command("$0 <domain>", "关闭在腾讯云 EdgeOne 中的重定向并删除相应规则", (y) => {
      y.positional("domain", {
        type: "string",
        describe: "域名（例如 *.webc.site 或 webc.site）",
      });
    })
    .help()
    .parse(),
  { domain } = argv,
  getZone = async (client, domain) => {
    console.log(`正在获取域名 ${domain} 的 ZoneId...`);
    const { Zones = [] } = await client.DescribeZones({ Limit: 100 }),
      zone = Zones.find((z) => domain === z.ZoneName || domain.endsWith("." + z.ZoneName));
    if (!zone) {
      throw new Error(`未找到域名匹配 of EdgeOne 站点：${domain}`);
    }
    console.log(`找到 ZoneId: ${zone.ZoneId} (站点名称: ${zone.ZoneName})`);
    return zone;
  },
  deleteRule = async (client, zone_id, domain, rule_name) => {
    console.log(`正在检查域名 "${domain}" 的规则...`);
    const { Rules = [] } = await client.DescribeL7AccRules({
        ZoneId: zone_id,
        Limit: 1000,
      }),
      matchedRules = Rules.filter(
        (r) =>
          r.RuleName === rule_name || r.Branches?.some((b) => b.Condition?.includes(`'${domain}'`)),
      );

    if (matchedRules.length > 0) {
      const ruleIds = matchedRules.map((r) => r.RuleId);
      console.log(`找到 ${ruleIds.length} 条匹配规则 (IDs: ${ruleIds.join(", ")}）。正在删除...`);
      await client.DeleteL7AccRules({
        ZoneId: zone_id,
        RuleIds: ruleIds,
      });
      console.log(`规则已成功删除。`);
    } else {
      console.log(`未找到域名 "${domain}" 的重定向规则，无需删除。`);
    }
  };

const zone = await getZone(client, domain),
  rule_name = `redirect-${domain}`;

await deleteRule(client, zone.ZoneId, domain, rule_name);
console.log("操作完成！");
