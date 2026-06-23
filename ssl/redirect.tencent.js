#!/usr/bin/env bun

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { teo } from "tencentcloud-sdk-nodejs-teo";
import { SecretId, SecretKey } from "../conf/TENCENT.js";

const CUSTOM = "custom",
  CLIENT_CLASS = teo.v20220901.Client,
  client = new CLIENT_CLASS({
    credential: { secretId: SecretId, secretKey: SecretKey },
    region: "ap-guangzhou",
  }),
  argv = await yargs(hideBin(process.argv))
    .command("$0 <domain> <redirect_url>", "在腾讯云 EdgeOne 中配置重定向", (y) => {
      y.positional("domain", {
        type: "string",
        describe: "域名（例如 *.webc.site 或 webc.site）",
      }).positional("redirect_url", {
        type: "string",
        describe: "目标 URL（例如 https://math.webc.site）",
      });
    })
    .help()
    .parse(),
  { domain, redirect_url } = argv,
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
  upsertRule = async (client, zone_id, rule_name, rule_item) => {
    console.log(`正在检查规则 "${rule_name}" 是否存在...`);
    const { Rules = [] } = await client.DescribeL7AccRules({ ZoneId: zone_id }),
      rule = Rules.find((r) => r.RuleName === rule_name);

    if (rule) {
      console.log(`规则已存在。正在更新规则 (ID: ${rule.RuleId})...`);
      await client.ModifyL7AccRule({
        ZoneId: zone_id,
        Rule: { RuleId: rule.RuleId, ...rule_item },
      });
    } else {
      console.log("规则不存在。正在创建规则...");
      await client.CreateL7AccRules({
        ZoneId: zone_id,
        Rules: [rule_item],
      });
    }
  };

const zone = await getZone(client, domain),
  url = new URL(redirect_url),
  action = {
    Name: "AccessURLRedirect",
    AccessURLRedirectParameters: {
      StatusCode: 302,
      Protocol: url.protocol.slice(0, -1),
      HostName: { Action: CUSTOM, Value: url.hostname },
      URLPath:
        url.pathname && url.pathname !== "/"
          ? { Action: CUSTOM, Value: url.pathname }
          : { Action: "follow" },
      QueryString: { Action: "full" },
    },
  },
  rule_name = `redirect-${domain}`,
  rule_item = {
    RuleName: rule_name,
    Status: "enable",
    Branches: [
      {
        Condition: `\${http.request.host} in ['${domain}']`,
        Actions: [action],
      },
    ],
  };

await upsertRule(client, zone.ZoneId, rule_name, rule_item);
console.log("规则配置成功！");
