const CONFIG = {
  tenancy: "ocid1.tenancy.oc1..aaaaaaaazyu5j7lgqitg44n4cbakqkee3i3ons5dueznfzkcwl7cq6tojfoa",
  user: "ocid1.user.oc1..aaaaaaaap4grec5k4lphrspjkixnwnlsin6h5ky4iqpgblva2rvu4ixjtduq",
  fingerprint: "d7:20:8d:01:67:a0:fb:12:0a:b3:65:fe:3d:1b:50:ce",
  region: "ap-singapore-1",
  adName: "lnKN:AP-SINGAPORE-1-AD-1",
  subnetId: "ocid1.subnet.oc1.ap-singapore-1.aaaaaaaapm5di7xc4xlnqaipv5fdh32adcq4yq3z3y3p3bhl3wdrtj3qomka",
  imageId: "ocid1.image.oc1.ap-singapore-1.aaaaaaaa4rgzowsv4u6hk6ugkk2be7ztbowlxwnonuvsxq4d73yjy4fc22ka",
  sshKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIR7sVKOeXX/3WrVjtVnidD7GYu8WGYErKK3UbwB5PYQ bfi-classroom-oracle"
};

const TELEGRAM = {
  botToken: "8860622210:AAHAyEaZXkCoglQEy-WIGz1Q5xJ97OE2Wzk",
  chatId: "5873814680"
};

function getDhakaTime(dateObj = new Date()) {
  const dhakaTime = new Date(dateObj.getTime() + (6 * 60 * 60 * 1000));
  const hours = dhakaTime.getUTCHours();
  const minutes = dhakaTime.getUTCMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHours = (hours % 12 || 12).toString().padStart(2, '0');
  return `${displayHours}:${minutes} ${ampm}`;
}

function getNextDhakaTime(minutesToAdd = 30) {
  const nextDate = new Date(Date.now() + (minutesToAdd * 60 * 1000));
  return getDhakaTime(nextDate);
}

async function sendTelegram(text) {
  if (!TELEGRAM.botToken || !TELEGRAM.chatId) return false;
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM.botToken}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM.chatId,
        text: text,
        parse_mode: "HTML"
      })
    });
    const data = await res.json();
    if (!data.ok) {
      console.error("Telegram API Error:", data);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Failed to send Telegram message:", err);
    return false;
  }
}

const PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCd3sN1ZpbpUUN6
mwE6pxgapCE5OJ9hyvQ7KnlwKwLrfihPyc8cmiLz/fD7ctiA5p8GoADQJvKCEZST
L/Ji2KWeG0le76rHJyKBavUW6ptXBWTKPilNR8erM9lfEy8/w4n6eHcWx8OtR7yp
kd8ZZIJz8embQiHgwjCD22qlfTG69w9+cs7gnK6xAX8US70Rh+K8Iefhhk8tXRZW
Bb8QB1kZc4AhiN/nZVgc4FybFRHqh7omilJA0r5Z7s24vRFriG6fFg+CZ3mamc1m
egHw38qngoZRww/WqgKmo+qCddCshIICPnthYtu5IRFKtbkI2EmmJvsYHIm3CUzy
yNUUCw7rAgMBAAECggEAHqlLzArzR3htgywExpf6cf4rp7nsFqm82prqwBLSe9ti
R/DZpWP4YuwQuD17eDmSbE56KfNOiV2Rvi6DRJhwPi9thh9FS2254WndFSjWp8WX
6EG/cs98o68ryi/nLtqy+y8Xbhi5U/fJWCPJMVzYi11SMkHbY5RDqPBeG6sflACm
7RujHORpsV0Fc5gL3sHL+RASKoLxehBUHaiitLe+O9U3ulqgMClTC1d8tMZ2miV6
Q0Lj1quWfjGYiHh7cD5ykx7X0dlCyKn1j1dzwuffXY1oBhPA+xEzV7gvLkZ6vGuq
Lp4fGvmU6b3FddLxfvv+j2Eg5Sv5p2fZpkYxUH8FrQKBgQDLCYyUOdYcLTXEXjfs
bfdbSLLfnBiVs7hrPdWOz0OGJ9Vri2JKGwGzxEqKCL6DUO5I+kjDUZehxZy4P+q9
gTu/t54jqk2MgtcvEGI8ILbkwHRBTS69IGMW7VqOSyCxEGL19FzKHO4b4MWQW3Hd
tVBMyPacpM+7G0MuvCws/6XklQKBgQDHDQmz7aasJHgTZPG5rLE1ANAE/cGNkdzH
NjiRaJvIAt/3nP3qyZLAQjWqGa5E+f8KmuvT1AARjVmUyrVtnUBeON1hEz1xHy/V
h1FNUBd5rfYc9uhPo3AsS8teUZYBdBRNERVbSQH7BOw1OtbSPzzwCO3z1Cx634Wy
cul0KnjFfwKBgHj/Z9et3/tKthAgVhOANTkhSfgYfk44nF7MqshAnG0GsBk3J4wi
LBGFmSZJr79yK48yGMrNhR/TNGJZNPtaWNEYDBYVF8H092gEy4YpuNT6HE4OQRxU
gLjZGm5SN1lN+qu4xNNuCjhy60nsNR97Pi+EU/NmBKXsyUzAt1LZx3NBAoGATPBp
M7dEmX1vPG/kT5TE2mv5/DPpwMMEx6vZqbr5nBIgaCGytDI+Gzp8a8eJaPgI8Rx4
02Q6so4kdjL0de42lzT7vS4mrbcUUkD/2BaBPHNVklSN71qJXVXewhJfHSi1QCS+
UI6jyVdZxil8J8Bx2YZaE8mLd+M2Voe8XT6deBkCgYEAn7YE6/jCQ/+rmmwgerZt
aJCCt2HST7n5D+F3bejdMO66QlfAb2VGe8LhIvTvRg7Ka2jRMZ6Kxhn22sTBpjX4
ROMora7Ho9Ec2760UNW8f65ekAHOZq/iHY9CvVV1RkeOvlsOeQr+4GTvaL+u8b45
Im3uEN9nw3janah0DwiXBSw=
-----END PRIVATE KEY-----`;

function pemToArrayBuffer(pem) {
  const b64Lines = pem.replace(/-----[^\n]+-----/g, "").replace(/\s+/g, "");
  const byteStr = atob(b64Lines);
  const bytes = new Uint8Array(byteStr.length);
  for (let i = 0; i < byteStr.length; i++) {
    bytes[i] = byteStr.charCodeAt(i);
  }
  return bytes.buffer;
}

async function getCryptoKey() {
  const binaryDer = pemToArrayBuffer(PRIVATE_KEY_PEM);
  return await crypto.subtle.importKey(
    "pkcs8",
    binaryDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function signRequest(method, path, bodyString, key) {
  const host = `iaas.${CONFIG.region}.oraclecloud.com`;
  const date = new Date().toUTCString();

  const encoder = new TextEncoder();
  const bodyBytes = encoder.encode(bodyString);
  const hashBuffer = await crypto.subtle.digest("SHA-256", bodyBytes);
  const bodySha256 = arrayBufferToBase64(hashBuffer);

  const signingString = [
    `date: ${date}`,
    `(request-target): ${method.toLowerCase()} ${path}`,
    `host: ${host}`,
    `content-length: ${bodyBytes.length}`,
    `content-type: application/json`,
    `x-content-sha256: ${bodySha256}`
  ].join("\n");

  const sigBuffer = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    encoder.encode(signingString)
  );
  const signature = arrayBufferToBase64(sigBuffer);

  const authHeader = `Signature version="1",keyId="${CONFIG.tenancy}/${CONFIG.user}/${CONFIG.fingerprint}",algorithm="rsa-sha256",headers="date (request-target) host content-length content-type x-content-sha256",signature="${signature}"`;

  return {
    url: `https://${host}${path}`,
    headers: {
      "date": date,
      "host": host,
      "content-type": "application/json",
      "content-length": bodyBytes.length.toString(),
      "x-content-sha256": bodySha256,
      "authorization": authHeader
    },
    body: bodyString
  };
}

async function attemptClaim(ocpus, memoryInGBs, key) {
  const payload = {
    availabilityDomain: CONFIG.adName,
    compartmentId: CONFIG.tenancy,
    displayName: "bfi-classroom-server",
    shape: "VM.Standard.A1.Flex",
    shapeConfig: {
      ocpus: ocpus,
      memoryInGBs: memoryInGBs
    },
    sourceDetails: {
      sourceType: "image",
      imageId: CONFIG.imageId,
      bootVolumeSizeInGBs: 100
    },
    createVnicDetails: {
      subnetId: CONFIG.subnetId,
      assignPublicIp: true,
      displayName: "bfi-classroom-server-vnic"
    },
    metadata: {
      ssh_authorized_keys: CONFIG.sshKey
    }
  };

  const reqData = await signRequest("POST", "/20160918/instances", JSON.stringify(payload), key);
  const res = await fetch(reqData.url, {
    method: "POST",
    headers: {
      ...reqData.headers,
      "user-agent": "Oracle-NodeSDK/2.79.0 (Windows 10; AMD64)"
    },
    body: reqData.body
  });

  const resText = await res.text();
  return { status: res.status, text: resText, ocpus, memoryInGBs };
}

async function runCheck(env, isCron = false) {
  // Anti-fingerprinting random jitter (1-9 seconds) on cron runs
  if (isCron) {
    const jitterMs = Math.floor(Math.random() * 8000) + 1000;
    await new Promise(r => setTimeout(r, jitterMs));
  }

  const kv = env ? env.ORACLE_STATE : null;

  // 1. Circuit Breaker: Check if Bot was stopped by error, conflict, or manual trigger
  if (kv) {
    const botStatus = await kv.get("bot_status");
    if (botStatus && botStatus.startsWith("STOPPED")) {
      console.log(`[Circuit Breaker] Bot is in stopped state: ${botStatus}`);
      return {
        success: false,
        stopped: true,
        status: 200,
        message: `Circuit Breaker: Bot is currently ${botStatus}. Protection active.`
      };
    }

    // 2. Rate-limit Cooldown Protection
    const cooldownUntil = await kv.get("cooldown_until");
    if (cooldownUntil && Date.now() < parseInt(cooldownUntil, 10)) {
      const remainingMins = Math.ceil((parseInt(cooldownUntil, 10) - Date.now()) / 60000);
      console.log(`[Rate Limit Defense] Cooldown active. Resuming in ${remainingMins} min.`);
      return {
        success: false,
        cooldown: true,
        status: 429,
        message: `Rate Limit Defense Active. Sleeping for ${remainingMins} more minutes.`
      };
    }
  }

  const key = await getCryptoKey();
  
  // Update total attempt counter in KV
  let totalAttempts = 0;
  if (kv) {
    const rawAttempts = await kv.get("attempts_count");
    totalAttempts = (rawAttempts ? parseInt(rawAttempts, 10) : 0) + 1;
    await kv.put("attempts_count", totalAttempts.toString());
  }

  // Alternate target every run cleanly: odd = 12 GB, even = 6 GB
  const target = totalAttempts % 2 === 1 
    ? { ocpus: 2, memory: 12, label: "12 GB RAM / 2 OCPU" }
    : { ocpus: 1, memory: 6, label: "6 GB RAM / 1 OCPU" };

  console.log(`[Cloudflare Worker] Triggered check for: ${target.label} (100 GB SSD) - Attempt #${totalAttempts}`);
  const result = await attemptClaim(target.ocpus, target.memory, key);

  let parsedError = null;
  try {
    parsedError = JSON.parse(result.text);
  } catch (e) {
    parsedError = { message: result.text };
  }

  // CASE 1: SUCCESS (HTTP 200 / 201) -> Permanent Auto-Shutdown & Instant Alert
  if (result.status === 200 || result.status === 201) {
    console.log(`🎉 [SUCCESS!] Instance launched successfully:`, result.text);
    if (kv) {
      await kv.put("bot_status", "STOPPED_SUCCESS");
      await kv.put("created_instance_details", result.text);
    }
    const successMsg = `🎉🎉🎉 <b>BFI CLASSROOM: SERVER CLAIMED!</b>\n\n` +
      `<b>Shape:</b> VM.Standard.A1.Flex (ARM)\n` +
      `<b>Config:</b> ${target.label}\n` +
      `<b>Storage:</b> 100 GB NVMe SSD\n` +
      `<b>Status:</b> Instance successfully launched in Singapore!\n\n` +
      `🛑 <b>অটো-প্রটেকশন:</b> ডুপ্লিকেট সার্ভার তৈরি হওয়া ঠেকাতে বট স্বয়ংক্রিয়ভাবে বন্ধ করা হয়েছে। এখন ক্লাসরুম ডেপ্লয়মেন্টের কাজ শুরু করা যাবে!`;
    await sendTelegram(successMsg);
    return { success: true, message: "Instance launched!", details: result.text };
  }

  // CASE 2: CONFLICT (HTTP 409) -> Instance already exists!
  if (result.status === 409) {
    if (kv) await kv.put("bot_status", "STOPPED_CONFLICT");
    const conflictMsg = `⚠️ <b>[সার্ভার কনফ্লিক্ট নোটিশ]</b>\n\n` +
      `ওরাকল HTTP 409 (Conflict) রিটার্ন করেছে। এর মানে 'bfi-classroom-server' নামে ইতিমধ্যে একটি সার্ভার তৈরি আছে বা হচ্ছে।\n\n` +
      `🛑 বাড়তি চার্জ বা জটিলতা এড়াতে বট স্বয়ংক্রিয়ভাবে বন্ধ করা হলো।`;
    await sendTelegram(conflictMsg);
    return { success: false, status: result.status, message: result.text, target: target.label };
  }

  // CASE 3: AUTHENTICATION / PERMISSION ERROR (HTTP 401 / 403) -> Emergency Safety Shutdown
  if (result.status === 401 || result.status === 403) {
    if (kv) await kv.put("bot_status", "STOPPED_AUTH_ERROR");
    const authMsg = `🚨 <b>[জরুরি ওরাকল সিকিউরিটি অ্যালার্ট]</b>\n\n` +
      `ওরাকল API থেকে HTTP ${result.status} (Authentication/Authorization Failed) এসেছে।\n\n` +
      `🛑 <b>অ্যাকাউন্টের সুরক্ষার্থে বটটি সাথে সাথে স্থায়ীভাবে বন্ধ করা হয়েছে।</b> ওরাকল কনসোল বা API Key চেক করুন।`;
    await sendTelegram(authMsg);
    return { success: false, status: result.status, message: result.text, target: target.label };
  }

  // Save latest attempt result to KV for the web dashboard (Read-Only)
  if (kv) {
    await kv.put("last_result", JSON.stringify({
      status: result.status,
      message: result.text,
      target: target.label,
      updated_at: new Date().toUTCString()
    }));
  }

  // CASE 4: RATE LIMIT (HTTP 429 Too Many Requests) -> 5-Minute Quiet Backoff
  if (result.status === 429) {
    const cooldownPeriod = Date.now() + (5 * 60 * 1000); // 5 minutes quiet cooldown
    if (kv) await kv.put("cooldown_until", cooldownPeriod.toString());
    console.log(`[OCI Rate Limit] Cooldown set for 5 minutes.`);
    
    // Only send to Telegram at most once every 30 minutes to prevent notification flooding
    const last429Alert = kv ? await kv.get("last_429_alert_time") : null;
    if (!last429Alert || Date.now() - parseInt(last429Alert, 10) > 30 * 60 * 1000) {
      if (kv) await kv.put("last_429_alert_time", Date.now().toString());
      const rateLimitMsg = `⚠️ <b>[OCI RATE LIMIT - অটো-কুলডাউন সক্রিয়]</b>\n\n` +
        `ওরাকল সাময়িক রেট লিমিট দিয়েছে (HTTP 429)।\n` +
        `🛡️ অ্যাকাউন্ট সুরক্ষিত রাখতে বটটি <b>৫ মিনিটের জন্য শান্ত থাকবে</b>। ৫ মিনিট পর কোনো বিরক্তিকর মেসেজ ছাড়াই স্বয়ংক্রিয়ভাবে পুনরায় চেষ্টা শুরু করবে।`;
      await sendTelegram(rateLimitMsg);
    }
    return { success: false, status: result.status, message: result.text, target: target.label };
  }

  // CASE 5: LIMIT EXCEEDED / QUOTA REACHED
  if (parsedError && parsedError.code === "LimitExceeded") {
    if (kv) await kv.put("bot_status", "STOPPED_LIMIT_ERROR");
    const limitMsg = `⚠️ <b>[কোটা লিমিট সতর্কবার্তা]</b>\n\n` +
      `আপনার ওরাকল অ্যাকাউন্টের লিমিট শেষ (LimitExceeded)।\n` +
      `🛑 বটটি স্বয়ংক্রিয়ভাবে বন্ধ করা হলো।`;
    await sendTelegram(limitMsg);
    return { success: false, status: result.status, message: result.text, target: target.label };
  }

  // CASE 5.5: DATACENTER MAINTENANCE / NETWORK OUTAGE (HTTP 502, 503, 504)
  if (result.status === 502 || result.status === 503 || result.status === 504) {
    const maintenanceCooldown = Date.now() + (5 * 60 * 1000); // 5 minutes pause
    if (kv) await kv.put("cooldown_until", maintenanceCooldown.toString());
    console.log(`[Datacenter Maintenance] Status ${result.status}. Cooling down 5 minutes.`);
    return { success: false, status: result.status, message: `Oracle Datacenter Maintenance (${result.status})` };
  }

  // CASE 6: OUT OF HOST CAPACITY (Normal Queue Waiting)
  // Ensure the 30-minute interval NEVER misses by comparing timestamps in KV
  const now = new Date();
  const minute = now.getMinutes();
  let shouldSendReport = false;
  if (kv) {
    const lastReportRaw = await kv.get("last_report_time");
    const lastReportTime = lastReportRaw ? parseInt(lastReportRaw, 10) : 0;
    // If 28+ minutes elapsed since last report, send now
    if (isCron && (Date.now() - lastReportTime >= 28 * 60 * 1000)) {
      shouldSendReport = true;
    }
  } else if (isCron && (minute === 0 || minute === 30)) {
    shouldSendReport = true;
  }

  if (shouldSendReport) {
    const timeStr = getDhakaTime();
    const nextReportStr = getNextDhakaTime(30);
    const summaryMsg = `📊 <b>BFI Monitor: ৩০ মিনিটের স্ট্যাটাস রিপোর্ট</b>\n\n` +
      `• <b>স্ট্যাটাস:</b> 🟢 ২৪/৭ মনিটরিং সচল (মোট ট্রাই: ${totalAttempts > 0 ? totalAttempts + ' বার' : 'চলছে'})\n` +
      `• <b>সর্বশেষ টেস্টেড:</b> ${target.label} (১০০ GB NVMe SSD)\n` +
      `• <b>ওরাকল রেসপন্স:</b> <code>Out of host capacity</code>\n` +
      `• <b>বর্তমান সময়:</b> ${timeStr} (বাংলাদেশ সময়)\n` +
      `• <b>পরবর্তী রিপোর্ট:</b> 🕒 <b>${nextReportStr}</b>\n\n` +
      `<i>💡 বট প্রতি ৩ মিনিটে সিঙ্গাপুরে ট্রাই করছে (রেট-লিমিট মুক্ত ও নিরাপদ গতিতে)। ক্যাপাসিটি খালি পাওয়া মাত্রই সার্ভার লঞ্চ হবে।</i>`;
    const sent = await sendTelegram(summaryMsg);
    if (sent && kv) {
      await kv.put("last_report_time", Date.now().toString());
    }
  }

  return { success: false, status: result.status, message: result.text, target: target.label, attempts: totalAttempts };
}

export default {
  // Cron Trigger handler (Every 3 minutes 24/7)
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCheck(env, true));
  },

  // HTTP Web handler (100% READ-ONLY: NEVER executes POST requests on page view!)
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const kv = env ? env.ORACLE_STATE : null;

    if (url.pathname === "/send-report") {
      const timeStr = getDhakaTime();
      const nextReportStr = getNextDhakaTime(30);
      const attempts = kv ? (await kv.get("attempts_count")) || "0" : "0";
      const summaryMsg = `📊 <b>BFI Monitor: ৩০ মিনিটের স্ট্যাটাস রিপোর্ট</b>\n\n` +
        `• <b>স্ট্যাটাস:</b> 🟢 ২৪/৭ মনিটরিং সচল (মোট ট্রাই: ${attempts} বার)\n` +
        `• <b>ওরাকল রেসপন্স:</b> <code>Out of host capacity</code> (সিঙ্গাপুর)\n` +
        `• <b>বর্তমান সময়:</b> ${timeStr} (বাংলাদেশ সময়)\n` +
        `• <b>পরবর্তী রিপোর্ট:</b> 🕒 <b>${nextReportStr}</b>\n\n` +
        `<i>💡 বট প্রতি ৩ মিনিটে নিয়মিত চেষ্টা চালিয়ে যাচ্ছে।</i>`;
      const sent = await sendTelegram(summaryMsg);
      if (sent && kv) {
        await kv.put("last_report_time", Date.now().toString());
      }
      return new Response(sent ? "Report dispatched to Telegram successfully!" : "Failed to dispatch.", { status: 200 });
    }

    if (url.pathname === "/stop") {
      if (kv) await kv.put("bot_status", "STOPPED_MANUAL");
      return new Response("Bot manually stopped.", { status: 200 });
    }
    if (url.pathname === "/resume") {
      if (kv) {
        await kv.delete("bot_status");
        await kv.delete("cooldown_until");
      }
      return new Response("Bot resumed.", { status: 200 });
    }

    const botStatus = kv ? (await kv.get("bot_status")) || "ACTIVE" : "ACTIVE";
    const attempts = kv ? (await kv.get("attempts_count")) || "0" : "0";
    const lastResultRaw = kv ? await kv.get("last_result") : null;
    const lastResult = lastResultRaw ? JSON.parse(lastResultRaw) : { target: "Ampere ARM (Rotating)", message: "Waiting for scheduled run..." };

    const cooldownUntil = kv ? await kv.get("cooldown_until") : null;
    const isCoolingDown = cooldownUntil && Date.now() < parseInt(cooldownUntil, 10);
    const remainingMins = isCoolingDown ? Math.ceil((parseInt(cooldownUntil, 10) - Date.now()) / 60000) : 0;

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>BFI Classroom — Oracle Cloud Claimer</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; max-width: 600px; margin: 0 auto; line-height: 1.6; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 1.5rem; margin-top: 1.5rem; }
    .badge { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 999px; font-size: 0.85rem; font-weight: 600; }
    .badge-active { background: #065f46; color: #6ee7b7; }
    .badge-waiting { background: #92400e; color: #fde68a; }
    .badge-cooldown { background: #475569; color: #cbd5e1; }
    .badge-stopped { background: #7f1d1d; color: #fca5a5; }
    pre { background: #090d16; padding: 1rem; border-radius: 8px; overflow-x: auto; font-size: 0.85rem; color: #38bdf8; }
  </style>
</head>
<body>
  <h1>🚀 BFI Classroom</h1>
  <p>Oracle Cloud 24/7 Instance Claimer (Cloudflare Worker)</p>
  <div class="card">
    <p><strong>Bot Engine:</strong> <span class="badge ${isCoolingDown ? 'badge-cooldown' : (botStatus === 'ACTIVE' ? 'badge-waiting' : (botStatus === 'STOPPED_SUCCESS' ? 'badge-active' : 'badge-stopped'))}">${isCoolingDown ? `COOLDOWN (${remainingMins}m)` : botStatus}</span></p>
    <p><strong>Total Background Attempts:</strong> ${attempts}</p>
    <p><strong>Target Tested:</strong> ${lastResult.target || 'Ampere ARM'}</p>
    <p><strong>Storage:</strong> 100 GB NVMe SSD</p>
    <p><strong>Schedule:</strong> Running automatically every 3 minutes</p>
    <p><strong>Telegram Alerts:</strong> Connected (@bficloudmonitorbot)</p>
    <p><strong>Next Telegram Report:</strong> ${getNextDhakaTime(30)} (Bangladesh Time)</p>
    <p><strong>Latest Response from Oracle:</strong></p>
    <pre>${isCoolingDown ? `Rate Limit Defense Active. Sleeping quietly for ${remainingMins} more minutes.` : (lastResult.message || 'Waiting for next scheduled run...')}</pre>
    <p style="font-size: 0.85rem; opacity: 0.7;">Refreshed at: ${new Date().toUTCString()}</p>
  </div>
</body>
</html>`;
    return new Response(html, { headers: { "content-type": "text/html;charset=UTF-8" } });
  }
};
