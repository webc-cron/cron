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
    .command("$0 [domain]", "关闭在腾讯云 EdgeOne 中的临时重定向并删除相应规则", (y) => {
      y.positional("domain", {
        type: "string",
        describe: "域名（例如 webc.site 或 *.webc.site，默认 webc.site）",
        default: "webc.site",
      });
    })
    .option("all", {
      alias: "a",
      type: "boolean",
      describe: "是否强制删除所有重定向规则（包括 301 永久重定向）",
    })
    .help()
    .parse(),
  { domain, all } = argv,
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
  isRedirectRule = (rule) =>
    rule.Branches?.some((b) => b.Actions?.some((a) => a.Name === "AccessURLRedirect")),
  isTemporaryRedirectRule = (rule) =>
    rule.Branches?.some((b) =>
      b.Actions?.some(
        (a) => a.Name === "AccessURLRedirect" && a.AccessURLRedirectParameters?.StatusCode !== 301,
      ),
    ),
  deleteRule = async (client, zone_id, domain, rule_name, all = false) => {
    console.log(`正在检查域名 "${domain}" 的重定向规则...`);
    const { Rules = [] } = await client.DescribeL7AccRules({
        ZoneId: zone_id,
        Limit: 1000,
      }),
      matchedRules = Rules.filter(
        (r) =>
          isRedirectRule(r) &&
          (r.RuleName === rule_name ||
            (domain === zone.ZoneName && r.RuleName === `redirect-*.${domain}`) ||
            r.Branches?.some(
              (b) =>
                b.Condition?.includes(`['${domain}']`) ||
                (domain === zone.ZoneName && b.Condition?.includes(`['*.${domain}']`)),
            )),
      ),
      toDeleteRules = all ? matchedRules : matchedRules.filter(isTemporaryRedirectRule),
      permanentRules = matchedRules.filter((r) => !isTemporaryRedirectRule(r));

    if (permanentRules.length > 0 && !all) {
      console.log(
        `保留永久重定向 (301) 规则 (${permanentRules.length} 条): ${permanentRules
          .map((r) => `${r.RuleName} (ID: ${r.RuleId})`)
          .join(", ")}`,
      );
    }

    if (toDeleteRules.length > 0) {
      const ruleIds = toDeleteRules.map((r) => r.RuleId);
      console.log(
        `找到 ${toDeleteRules.length} 条待删除的临时重定向规则 (IDs: ${ruleIds.join(", ")}）。正在删除...`,
      );
      await client.DeleteL7AccRules({
        ZoneId: zone_id,
        RuleIds: ruleIds,
      });
      console.log(`临时重定向规则已成功删除。`);
    } else {
      console.log(`未找到域名 "${domain}" 的临时重定向规则，无需删除。`);
    }
  };

const zone = await getZone(client, domain),
  rule_name = `redirect-${domain}`;

await deleteRule(client, zone.ZoneId, domain, rule_name, all);
console.log("操作完成！");
