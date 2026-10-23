const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const brainDir = 'C:\\Users\\shahi\\.gemini\\antigravity\\brain\\22315a22-1ff8-42ae-a262-3d537beab1fd';
const originalLogoB64 = fs.readFileSync('public/bfi-logo.jpg').toString('base64');

// High-definition SVG noise filter
const noiseSvg = `data:image/svg+xml,%3Csvg viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.22'/%3E%3C/svg%3E`;

// Film strip SVG pattern
const filmStripSvg = `data:image/svg+xml,%3Csvg width='55' height='630' viewBox='0 0 55 630' xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='55' height='630' fill='none'/%3E%3Cpath d='M8 0h10v630H8zM37 0h10v630H37z' fill='%23ffffff' fill-opacity='0.04'/%3E${Array.from({length: 21}).map((_, i) => `%3Crect x='10' y='${i*30 + 6}' width='8' height='16' rx='3' fill='%23ffffff' fill-opacity='0.08'/%3E%3Crect x='39' y='${i*30 + 6}' width='8' height='16' rx='3' fill='%23ffffff' fill-opacity='0.08'/%3E`).join('')}%3C/svg%3E`;

// Aperture SVG
const apertureSvg = `data:image/svg+xml,%3Csvg width='700' height='700' viewBox='0 0 700 700' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='350' cy='350' r='320' fill='none' stroke='%2338bdf8' stroke-width='2' stroke-opacity='0.08' stroke-dasharray='12 16'/%3E%3Ccircle cx='350' cy='350' r='250' fill='none' stroke='%2338bdf8' stroke-width='1.5' stroke-opacity='0.06'/%3E%3Ccircle cx='350' cy='350' r='335' fill='none' stroke='%23ffffff' stroke-width='1' stroke-opacity='0.04'/%3E%3C/svg%3E`;

// ── VARIATION 1A: Electric Cyan Neon Glow (Super Vibrant & High-Contrast) ──
const html1A = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@800;900&family=Inter:wght@600;700;800&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1200px;
    height: 630px;
    overflow: hidden;
    background-color: #01040d;
    background-image: radial-gradient(ellipse at 50% 34%, #0e3d7a 0%, #051e40 44%, #020c1d 75%, #01040d 100%);
    font-family: 'Inter', sans-serif;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .noise {
    position: absolute; inset: 0;
    background-image: url("${noiseSvg}");
    background-size: 256px 256px;
    mix-blend-mode: overlay;
    opacity: 0.95;
    z-index: 1;
  }
  .film-left { position: absolute; left: 0; top: 0; bottom: 0; width: 55px; background-image: url("${filmStripSvg}"); z-index: 2; }
  .film-right { position: absolute; right: 0; top: 0; bottom: 0; width: 55px; background-image: url("${filmStripSvg}"); transform: scaleX(-1); z-index: 2; }
  .aperture { position: absolute; left: 50%; top: 40%; transform: translate(-50%, -50%); width: 700px; height: 700px; background-image: url("${apertureSvg}"); background-size: contain; z-index: 2; }

  .beam {
    position: absolute;
    width: 1000px; height: 320px;
    background: radial-gradient(ellipse, rgba(14, 165, 233, 0.35) 0%, rgba(37, 99, 235, 0.15) 50%, transparent 75%);
    filter: blur(50px);
    z-index: 2;
  }
  .content {
    position: relative; z-index: 10;
    display: flex; flex-direction: column; align-items: center; text-align: center;
    width: 100%;
    padding: 0 40px;
  }
  .badge {
    width: 300px;
    height: 300px;
    border-radius: 66px;
    background: linear-gradient(135deg, #0284c7 0%, #2563eb 50%, #4338ca 100%);
    display: flex; align-items: center; justify-content: center;
    padding: 16px;
    box-shadow: 
      0 35px 85px -10px rgba(37, 99, 235, 0.95),
      0 0 0 3px rgba(255, 255, 255, 0.4),
      inset 0 3px 0 rgba(255, 255, 255, 0.6);
    margin-bottom: 20px;
  }
  .badge img {
    width: 100%; height: 100%; object-fit: contain;
    mix-blend-mode: multiply; display: block;
  }
  .title {
    font-family: 'Outfit', sans-serif;
    font-size: 100px; font-weight: 900; letter-spacing: -2px;
    line-height: 1.0; color: #ffffff;
    display: flex; align-items: center; gap: 24px;
    margin-bottom: 12px;
    text-shadow: 0 6px 35px rgba(0,0,0,0.9);
  }
  /* Ultra-vibrant highlighted Classroom text */
  .title .highlight {
    color: #00f0ff;
    text-shadow: 
      0 0 25px rgba(0, 240, 255, 0.9),
      0 0 50px rgba(14, 165, 233, 0.5),
      0 4px 20px rgba(0, 0, 0, 0.9);
    position: relative;
  }
  .meta-row {
    display: flex;
    align-items: center;
    gap: 18px;
  }
  .subtitle {
    font-size: 32px; font-weight: 700; color: #e2e8f0;
    letter-spacing: 0.3px;
    text-shadow: 0 3px 14px rgba(0,0,0,0.85);
  }
  .pill {
    display: inline-flex; align-items: center; gap: 10px;
    background: rgba(15, 23, 42, 0.88);
    border: 1.5px solid rgba(56, 189, 248, 0.45);
    padding: 8px 24px; border-radius: 999px;
    font-size: 20px; font-weight: 700; color: #38bdf8;
    backdrop-filter: blur(14px);
    box-shadow: 0 8px 25px rgba(0,0,0,0.5);
  }
  .pill .dot { width: 10px; height: 10px; border-radius: 50%; background: #10b981; box-shadow: 0 0 12px #10b981; }
</style>
</head>
<body>
  <div class="noise"></div>
  <div class="film-left"></div>
  <div class="film-right"></div>
  <div class="aperture"></div>
  <div class="beam"></div>
  <div class="content">
    <div class="badge">
      <img src="data:image/jpeg;base64,${originalLogoB64}" alt="BFI Logo" />
    </div>
    <h1 class="title">BFI <span class="highlight">Classroom</span></h1>
    <div class="meta-row">
      <p class="subtitle">Bangladesh Film Institute</p>
      <div class="pill">
        <span class="dot"></span>
        <span>classroom.bfibd.org</span>
      </div>
    </div>
  </div>
</body>
</html>
`;

// ── VARIATION 1B: Luminous White & Cyan Two-Tone Crest (Ultra Clean & Crisp) ──
const html1B = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@800;900&family=Inter:wght@600;700;800&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1200px;
    height: 630px;
    overflow: hidden;
    background-color: #01040d;
    background-image: radial-gradient(ellipse at 50% 34%, #0e3d7a 0%, #051e40 44%, #020c1d 75%, #01040d 100%);
    font-family: 'Inter', sans-serif;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .noise {
    position: absolute; inset: 0;
    background-image: url("${noiseSvg}");
    background-size: 256px 256px;
    mix-blend-mode: overlay;
    opacity: 0.95;
    z-index: 1;
  }
  .film-left { position: absolute; left: 0; top: 0; bottom: 0; width: 55px; background-image: url("${filmStripSvg}"); z-index: 2; }
  .film-right { position: absolute; right: 0; top: 0; bottom: 0; width: 55px; background-image: url("${filmStripSvg}"); transform: scaleX(-1); z-index: 2; }
  .aperture { position: absolute; left: 50%; top: 40%; transform: translate(-50%, -50%); width: 700px; height: 700px; background-image: url("${apertureSvg}"); background-size: contain; z-index: 2; }

  .beam {
    position: absolute;
    width: 1000px; height: 320px;
    background: radial-gradient(ellipse, rgba(14, 165, 233, 0.4) 0%, rgba(37, 99, 235, 0.18) 50%, transparent 75%);
    filter: blur(50px);
    z-index: 2;
  }
  .content {
    position: relative; z-index: 10;
    display: flex; flex-direction: column; align-items: center; text-align: center;
    width: 100%;
    padding: 0 40px;
  }
  .badge {
    width: 300px;
    height: 300px;
    border-radius: 66px;
    background: linear-gradient(135deg, #0284c7 0%, #2563eb 50%, #4338ca 100%);
    display: flex; align-items: center; justify-content: center;
    padding: 16px;
    box-shadow: 
      0 35px 85px -10px rgba(37, 99, 235, 0.95),
      0 0 0 3px rgba(255, 255, 255, 0.4),
      inset 0 3px 0 rgba(255, 255, 255, 0.6);
    margin-bottom: 20px;
  }
  .badge img {
    width: 100%; height: 100%; object-fit: contain;
    mix-blend-mode: multiply; display: block;
  }
  .title {
    font-family: 'Outfit', sans-serif;
    font-size: 100px; font-weight: 900; letter-spacing: -2px;
    line-height: 1.0; color: #ffffff;
    display: flex; align-items: center; gap: 24px;
    margin-bottom: 12px;
    text-shadow: 0 6px 35px rgba(0,0,0,0.9);
  }
  /* Brilliant High-Voltage Cyan with crisp white top crest */
  .title .highlight {
    background: linear-gradient(180deg, #ffffff 0%, #67e8f9 35%, #00d2ff 75%, #0284c7 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    filter: drop-shadow(0 0 20px rgba(0, 210, 255, 0.75));
    padding-bottom: 4px;
  }
  .meta-row {
    display: flex;
    align-items: center;
    gap: 18px;
  }
  .subtitle {
    font-size: 32px; font-weight: 700; color: #e2e8f0;
    letter-spacing: 0.3px;
    text-shadow: 0 3px 14px rgba(0,0,0,0.85);
  }
  .pill {
    display: inline-flex; align-items: center; gap: 10px;
    background: rgba(15, 23, 42, 0.88);
    border: 1.5px solid rgba(56, 189, 248, 0.45);
    padding: 8px 24px; border-radius: 999px;
    font-size: 20px; font-weight: 700; color: #38bdf8;
    backdrop-filter: blur(14px);
    box-shadow: 0 8px 25px rgba(0,0,0,0.5);
  }
  .pill .dot { width: 10px; height: 10px; border-radius: 50%; background: #10b981; box-shadow: 0 0 12px #10b981; }
</style>
</head>
<body>
  <div class="noise"></div>
  <div class="film-left"></div>
  <div class="film-right"></div>
  <div class="aperture"></div>
  <div class="beam"></div>
  <div class="content">
    <div class="badge">
      <img src="data:image/jpeg;base64,${originalLogoB64}" alt="BFI Logo" />
    </div>
    <h1 class="title">BFI <span class="highlight">Classroom</span></h1>
    <div class="meta-row">
      <p class="subtitle">Bangladesh Film Institute</p>
      <div class="pill">
        <span class="dot"></span>
        <span>classroom.bfibd.org</span>
      </div>
    </div>
  </div>
</body>
</html>
`;

// ── VARIATION 1C: Illuminated Pill Capsule on Classroom (Distinctive & High Impact) ──
const html1C = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@800;900&family=Inter:wght@600;700;800&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1200px;
    height: 630px;
    overflow: hidden;
    background-color: #01040d;
    background-image: radial-gradient(ellipse at 50% 34%, #0e3d7a 0%, #051e40 44%, #020c1d 75%, #01040d 100%);
    font-family: 'Inter', sans-serif;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .noise {
    position: absolute; inset: 0;
    background-image: url("${noiseSvg}");
    background-size: 256px 256px;
    mix-blend-mode: overlay;
    opacity: 0.95;
    z-index: 1;
  }
  .film-left { position: absolute; left: 0; top: 0; bottom: 0; width: 55px; background-image: url("${filmStripSvg}"); z-index: 2; }
  .film-right { position: absolute; right: 0; top: 0; bottom: 0; width: 55px; background-image: url("${filmStripSvg}"); transform: scaleX(-1); z-index: 2; }
  .aperture { position: absolute; left: 50%; top: 40%; transform: translate(-50%, -50%); width: 700px; height: 700px; background-image: url("${apertureSvg}"); background-size: contain; z-index: 2; }

  .beam {
    position: absolute;
    width: 1000px; height: 320px;
    background: radial-gradient(ellipse, rgba(14, 165, 233, 0.35) 0%, rgba(37, 99, 235, 0.15) 50%, transparent 75%);
    filter: blur(50px);
    z-index: 2;
  }
  .content {
    position: relative; z-index: 10;
    display: flex; flex-direction: column; align-items: center; text-align: center;
    width: 100%;
    padding: 0 40px;
  }
  .badge {
    width: 300px;
    height: 300px;
    border-radius: 66px;
    background: linear-gradient(135deg, #0284c7 0%, #2563eb 50%, #4338ca 100%);
    display: flex; align-items: center; justify-content: center;
    padding: 16px;
    box-shadow: 
      0 35px 85px -10px rgba(37, 99, 235, 0.95),
      0 0 0 3px rgba(255, 255, 255, 0.4),
      inset 0 3px 0 rgba(255, 255, 255, 0.6);
    margin-bottom: 20px;
  }
  .badge img {
    width: 100%; height: 100%; object-fit: contain;
    mix-blend-mode: multiply; display: block;
  }
  .title {
    font-family: 'Outfit', sans-serif;
    font-size: 96px; font-weight: 900; letter-spacing: -1.8px;
    line-height: 1.0; color: #ffffff;
    display: flex; align-items: center; gap: 20px;
    margin-bottom: 14px;
    text-shadow: 0 6px 35px rgba(0,0,0,0.9);
  }
  /* Illuminated glowing capsule */
  .title .capsule {
    background: linear-gradient(135deg, rgba(2, 132, 199, 0.4) 0%, rgba(37, 99, 235, 0.6) 100%);
    border: 2px solid #38bdf8;
    color: #ffffff;
    padding: 6px 28px;
    border-radius: 28px;
    box-shadow: 
      0 0 30px rgba(56, 189, 248, 0.6),
      inset 0 1px 0 rgba(255, 255, 255, 0.6);
    text-shadow: 0 2px 10px rgba(0,0,0,0.8);
  }
  .meta-row {
    display: flex;
    align-items: center;
    gap: 18px;
  }
  .subtitle {
    font-size: 32px; font-weight: 700; color: #e2e8f0;
    letter-spacing: 0.3px;
    text-shadow: 0 3px 14px rgba(0,0,0,0.85);
  }
  .pill {
    display: inline-flex; align-items: center; gap: 10px;
    background: rgba(15, 23, 42, 0.88);
    border: 1.5px solid rgba(56, 189, 248, 0.45);
    padding: 8px 24px; border-radius: 999px;
    font-size: 20px; font-weight: 700; color: #38bdf8;
    backdrop-filter: blur(14px);
    box-shadow: 0 8px 25px rgba(0,0,0,0.5);
  }
  .pill .dot { width: 10px; height: 10px; border-radius: 50%; background: #10b981; box-shadow: 0 0 12px #10b981; }
</style>
</head>
<body>
  <div class="noise"></div>
  <div class="film-left"></div>
  <div class="film-right"></div>
  <div class="aperture"></div>
  <div class="beam"></div>
  <div class="content">
    <div class="badge">
      <img src="data:image/jpeg;base64,${originalLogoB64}" alt="BFI Logo" />
    </div>
    <h1 class="title">BFI <span class="capsule">Classroom</span></h1>
    <div class="meta-row">
      <p class="subtitle">Bangladesh Film Institute</p>
      <div class="pill">
        <span class="dot"></span>
        <span>classroom.bfibd.org</span>
      </div>
    </div>
  </div>
</body>
</html>
`;

// WhatsApp Light Theme Mockup Generator
function getWhatsAppLightMockupHtml(previewImgB64, label) {
  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Segoe+UI:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 680px;
    height: 520px;
    background: #efeae2;
    background-image: radial-gradient(#d5cebe 1px, transparent 1px);
    background-size: 20px 20px;
    font-family: 'Segoe UI', -apple-system, sans-serif;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .label-tag {
    font-size: 13px; font-weight: 700; color: #128c7e;
    text-transform: uppercase; letter-spacing: 0.8px;
    margin-bottom: 12px;
  }
  .wa-bubble {
    width: 440px;
    background: #d9fdd3;
    border-radius: 12px 12px 2px 12px;
    overflow: hidden;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
    padding: 4px 4px 6px 4px;
  }
  .forwarded {
    display: flex; align-items: center; gap: 6px;
    padding: 4px 8px 6px 8px;
    font-size: 12.5px; font-style: italic; color: #667781;
  }
  .card {
    background: #ffffff;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid rgba(0,0,0,0.06);
  }
  .card img {
    width: 100%;
    height: 226px;
    object-fit: cover;
    display: block;
  }
  .meta {
    padding: 10px 12px 10px 12px;
    background: #ffffff;
  }
  .meta-title { font-size: 15px; font-weight: 600; color: #111b21; margin-bottom: 4px; line-height: 1.25; }
  .meta-desc { font-size: 13px; color: #667781; line-height: 1.35; margin-bottom: 6px; }
  .meta-domain { font-size: 12px; color: #667781; }
  .footer {
    display: flex; justify-content: space-between; align-items: flex-end;
    padding: 6px 8px 2px 8px;
  }
  .url { font-size: 14.5px; color: #027eb5; text-decoration: underline; word-break: break-all; }
  .time { font-size: 11px; color: #667781; display: flex; align-items: center; gap: 4px; white-space: nowrap; margin-left: 8px; }
  .ticks { color: #53bdeb; font-size: 13px; }
</style>
</head>
<body>
  <div class="label-tag">${label}</div>
  <div class="wa-bubble">
    <div class="forwarded">
      <span>&#10558; Forwarded</span>
    </div>
    <div class="card">
      <img src="data:image/png;base64,${previewImgB64}" />
      <div class="meta">
        <div class="meta-title">BFI Classroom - Bangladesh Film Institute</div>
        <div class="meta-desc">Bangladesh Film Institute's comprehensive learning platform for aspiring filmmakers. Manage portfolios,</div>
        <div class="meta-domain">classroom.bfibd.org</div>
      </div>
    </div>
    <div class="footer">
      <span class="url">https://classroom.bfibd.org</span>
      <span class="time">5:53 PM <span class="ticks">&#10003;&#10003;</span></span>
    </div>
  </div>
</body>
</html>
`;
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  // 1. Render 1A (Electric Cyan Glow)
  const p1A = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await p1A.setContent(html1A, { waitUntil: 'networkidle' });
  await p1A.waitForTimeout(500);
  const path1A = path.join(brainDir, 'social_card_highlight_1a.png');
  await p1A.screenshot({ path: path1A });
  console.log('Saved', path1A);

  // 2. Render 1B (White & Cyan Two-Tone Crest)
  const p1B = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await p1B.setContent(html1B, { waitUntil: 'networkidle' });
  await p1B.waitForTimeout(500);
  const path1B = path.join(brainDir, 'social_card_highlight_1b.png');
  await p1B.screenshot({ path: path1B });
  console.log('Saved', path1B);

  // 3. Render 1C (Illuminated Capsule)
  const p1C = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await p1C.setContent(html1C, { waitUntil: 'networkidle' });
  await p1C.waitForTimeout(500);
  const path1C = path.join(brainDir, 'social_card_highlight_1c.png');
  await p1C.screenshot({ path: path1C });
  console.log('Saved', path1C);

  // Mockups
  const b64_1A = fs.readFileSync(path1A).toString('base64');
  const pM1A = await browser.newPage({ viewport: { width: 680, height: 520 } });
  await pM1A.setContent(getWhatsAppLightMockupHtml(b64_1A, 'Style A: Electric Neon Cyan Glow (Super Bright)'), { waitUntil: 'networkidle' });
  await pM1A.waitForTimeout(500);
  const mock1A = path.join(brainDir, 'whatsapp_mockup_highlight_1a.png');
  await pM1A.screenshot({ path: mock1A });
  console.log('Saved', mock1A);

  const b64_1B = fs.readFileSync(path1B).toString('base64');
  const pM1B = await browser.newPage({ viewport: { width: 680, height: 520 } });
  await pM1B.setContent(getWhatsAppLightMockupHtml(b64_1B, 'Style B: Luminous Sky Blue with White Highlight'), { waitUntil: 'networkidle' });
  await pM1B.waitForTimeout(500);
  const mock1B = path.join(brainDir, 'whatsapp_mockup_highlight_1b.png');
  await pM1B.screenshot({ path: mock1B });
  console.log('Saved', mock1B);

  // Comparison Board for the user
  const htmlCompareBoard = `
  <!DOCTYPE html>
  <html>
  <head>
  <meta charset="utf-8">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@700;800;900&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 1360px;
      height: 660px;
      background: #080f24;
      font-family: 'Inter', sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
      gap: 20px;
    }
    .header { text-align: center; }
    .header h2 { font-size: 26px; color: #f8fafc; font-weight: 800; }
    .header p { font-size: 15px; color: #94a3b8; margin-top: 4px; }
    .cards-row {
      display: flex; align-items: flex-start; justify-content: center; gap: 30px; width: 100%;
    }
    .col { display: flex; flex-direction: column; align-items: center; gap: 12px; }
    .tag {
      font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.8px;
      padding: 6px 18px; border-radius: 999px;
    }
    .tag-a { background: rgba(0, 240, 255, 0.2); color: #00f0ff; border: 1.5px solid #00f0ff; }
    .tag-b { background: rgba(56, 189, 248, 0.2); color: #7dd3fc; border: 1.5px solid #38bdf8; }
    .frame {
      width: 580px;
      border-radius: 14px;
      overflow: hidden;
      box-shadow: 0 15px 35px rgba(0,0,0,0.7);
      border: 1px solid rgba(255,255,255,0.15);
    }
    .frame img { width: 100%; display: block; }
    .desc { font-size: 14px; color: #cbd5e1; text-align: center; margin-top: 4px; }
  </style>
  </head>
  <body>
    <div class="header">
      <h2>Option 1 • Classroom Highlight Styles</h2>
      <p>Comparing the two best ways to make "Classroom" stand out with high contrast</p>
    </div>
    <div class="cards-row">
      <div class="col">
        <span class="tag tag-a">Style A: Electric Neon Glow</span>
        <div class="frame">
          <img src="data:image/png;base64,${b64_1A}" />
        </div>
        <div class="desc">Vibrant electric cyan with intense neon illumination — pops instantly on mobile</div>
      </div>
      <div class="col">
        <span class="tag tag-b">Style B: Luminous Two-Tone Crest</span>
        <div class="frame">
          <img src="data:image/png;base64,${b64_1B}" />
        </div>
        <div class="desc">White top-lighting with radiant sky blue gradient and ambient aura</div>
      </div>
    </div>
  </body>
  </html>
  `;
  const pBoard = await browser.newPage({ viewport: { width: 1360, height: 660 } });
  await pBoard.setContent(htmlCompareBoard, { waitUntil: 'networkidle' });
  await pBoard.waitForTimeout(500);
  const boardPath = path.join(brainDir, 'classroom_highlight_comparison.png');
  await pBoard.screenshot({ path: boardPath });
  console.log('Saved', boardPath);

  await browser.close();
  console.log('Done rendering highlight options!');
})();
