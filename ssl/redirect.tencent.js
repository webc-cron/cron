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
    .command("$0 <domain> [redirect_url]", "在腾讯云 EdgeOne 中配置重定向", (y) => {
      y.positional("domain", {
        type: "string",
        describe: "域名（例如 www.webc.site、*.webc.site 或 webc.site）",
      }).positional("redirect_url", {
        type: "string",
        describe: "目标 URL（www / * 默认重定向到根域名 https://webc.site）",
      });
    })
    .option("code", {
      alias: "c",
      type: "number",
      choices: [301, 302, 307],
      describe: "重定向状态码 (www 默认为 301 永久重定向，* 及其他默认为 302 临时重定向)",
    })
    .help()
    .parse(),
  { domain: inputDomain, redirect_url: inputUrl, code } = argv,
  getZone = async (client, domain) => {
    console.log(`正在获取域名 ${domain} 的 ZoneId...`);
    const { Zones = [] } = await client.DescribeZones({ Limit: 100 }),
      zone = Zones.find(
        (z) =>
          domain === z.ZoneName ||
          domain.endsWith("." + z.ZoneName) ||
          domain === "www" ||
          domain === "*",
      );
    if (!zone) {
      throw new Error(`未找到域名匹配 of EdgeOne 站点：${domain}`);
    }
    console.log(`找到 ZoneId: ${zone.ZoneId} (站点名称: ${zone.ZoneName})`);
    return zone;
  },
  reorderRules = async (client, zone_id) => {
    const { Rules = [] } = await client.DescribeL7AccRules({
      ZoneId: zone_id,
      Limit: 1000,
    });
    if (Rules.length <= 1) return;
    const sortedRules = [...Rules].sort((a, b) => {
      const aWild =
        a.RuleName?.includes("*") || a.Branches?.some((br) => br.Condition?.includes("*"));
      const bWild =
        b.RuleName?.includes("*") || b.Branches?.some((br) => br.Condition?.includes("*"));
      if (aWild && !bWild) return 1;
      if (!aWild && bWild) return -1;
      return 0;
    });
    const currentIds = Rules.map((r) => r.RuleId).join(",");
    const sortedIds = sortedRules.map((r) => r.RuleId).join(",");
    if (currentIds !== sortedIds) {
      console.log("正在优化规则优先级 (确保具体域名优先于泛域名通配符)...");
      await client.ModifyL7AccRulePriority({
        ZoneId: zone_id,
        RuleIds: sortedRules.map((r) => r.RuleId),
      });
    }
  },
  ensureAccelerationDomain = async (client, zone_id, domain) => {
    if (domain.startsWith("*")) return;
    const { AccelerationDomains = [] } = await client.DescribeAccelerationDomains({
      ZoneId: zone_id,
    });
    const exists = AccelerationDomains.find((d) => d.DomainName === domain);
    if (exists) return;

    console.log(`自动检测到 ${domain} 尚未配置加速域名，正在自动创建并修复...`);
    const template =
      AccelerationDomains.find((d) => d.DomainName.startsWith("*")) || AccelerationDomains[0];

    if (!template) return;

    const originInfo = {
      OriginType: template.OriginDetail?.OriginType || "COS",
      Origin: template.OriginDetail?.Origin || "",
      PrivateAccess: template.OriginDetail?.PrivateAccess || "off",
    };

    await client.CreateAccelerationDomain({
      ZoneId: zone_id,
      DomainName: domain,
      OriginInfo: originInfo,
      OriginProtocol: template.OriginProtocol || "FOLLOW",
      HttpOriginPort: template.HttpOriginPort || 80,
      HttpsOriginPort: template.HttpsOriginPort || 443,
      IPv6Status: template.IPv6Status || "on",
    });

    const certId = template.Certificate?.List?.[0]?.CertId;
    if (certId) {
      await client.ModifyHostsCertificate({
        ZoneId: zone_id,
        Hosts: [domain],
        Mode: "sslcert",
        ServerCertInfo: [{ CertId: certId }],
      });
      console.log(`自动修复：已为 ${domain} 创建加速域名并绑定证书 (CertId: ${certId})。`);
    } else {
      console.log(`自动修复：已为 ${domain} 创建加速域名。`);
    }
  },
  purgeCache = async (client, zone_id, domain) => {
    try {
      const cleanDomain = domain.replace(/^\*\./, "");
      const targets = [`http://${cleanDomain}/`, `https://${cleanDomain}/`];
      const { JobId } = await client.CreatePurgeTask({
        ZoneId: zone_id,
        Type: "purge_url",
        Targets: targets,
      });
      console.log(`自动清理：已提交 ${cleanDomain} 的边缘缓存清理任务 (JobId: ${JobId})。`);
    } catch (e) {
      console.log(`缓存清理提示: ${e.message}`);
    }
  },
  upsertRule = async (client, zone_id, domain, rule_name, rule_item, statusCode) => {
    const redirectType =
      statusCode === 301
        ? "永久重定向 (301)"
        : statusCode === 307
          ? "临时重定向 (307)"
          : "临时重定向 (302)";
    console.log(`正在检查域名 "${domain}" 的规则...`);
    const { Rules = [] } = await client.DescribeL7AccRules({
        ZoneId: zone_id,
        Limit: 1000,
      }),
      matchedRules = Rules.filter(
        (r) =>
          r.RuleName === rule_name ||
          r.Branches?.some((b) => b.Condition?.includes(`['${domain}']`)),
      );

    if (matchedRules.length > 0) {
      const [primaryRule, ...extraRules] = matchedRules;
      console.log(`找到已存在规则 (ID: ${primaryRule.RuleId})，正在更新为${redirectType}...`);
      await client.ModifyL7AccRule({
        ZoneId: zone_id,
        Rule: { RuleId: primaryRule.RuleId, ...rule_item },
      });

      if (extraRules.length > 0) {
        const extraIds = extraRules.map((r) => r.RuleId);
        console.log(`清理重复/历史老规则 (IDs: ${extraIds.join(", ")})...`);
        await client.DeleteL7AccRules({
          ZoneId: zone_id,
          RuleIds: extraIds,
        });
      }
    } else {
      console.log(`规则不存在，正在创建${redirectType}规则...`);
      await client.CreateL7AccRules({
        ZoneId: zone_id,
        Rules: [rule_item],
      });
    }
    await ensureAccelerationDomain(client, zone_id, domain);
    await reorderRules(client, zone_id);
    await purgeCache(client, zone_id, domain);
  };

const zone = await getZone(client, inputDomain),
  domain =
    inputDomain === "www"
      ? `www.${zone.ZoneName}`
      : inputDomain === "*"
        ? `*.${zone.ZoneName}`
        : inputDomain;

let targetUrl = inputUrl;
if (!targetUrl) {
  if (domain.startsWith("www.") || domain.startsWith("*.")) {
    targetUrl = `https://${zone.ZoneName}`;
  } else {
    throw new Error(
      `域名 ${domain} 重定向需要指定目标 URL，例如：./redirect.tencent.js ${domain} https://math.${zone.ZoneName}`,
    );
  }
}
if (!targetUrl.includes("://")) {
  targetUrl = `https://${targetUrl}`;
}

const url = new URL(targetUrl),
  isPermanent = domain.startsWith("www."),
  statusCode = code || (isPermanent ? 301 : 302),
  action = {
    Name: "AccessURLRedirect",
    AccessURLRedirectParameters: {
      StatusCode: statusCode,
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

await upsertRule(client, zone.ZoneId, domain, rule_name, rule_item, statusCode);
console.log("规则配置成功！");
