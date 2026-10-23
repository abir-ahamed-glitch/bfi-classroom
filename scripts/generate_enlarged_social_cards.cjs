const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const brainDir = 'C:\\Users\\shahi\\.gemini\\antigravity\\brain\\22315a22-1ff8-42ae-a262-3d537beab1fd';
const transparentLogoB64 = fs.readFileSync('public/bfi-logo-transparent.png').toString('base64');
const originalLogoB64 = fs.readFileSync('public/bfi-logo.jpg').toString('base64');

// High-definition SVG noise filter
const noiseSvg = `data:image/svg+xml,%3Csvg viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.22'/%3E%3C/svg%3E`;

// Film strip SVG pattern
const filmStripSvg = `data:image/svg+xml,%3Csvg width='70' height='630' viewBox='0 0 70 630' xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='70' height='630' fill='none'/%3E%3Cpath d='M10 0h14v630H10zM46 0h14v630H46z' fill='%23ffffff' fill-opacity='0.04'/%3E${Array.from({length: 21}).map((_, i) => `%3Crect x='12' y='${i*30 + 6}' width='10' height='17' rx='3' fill='%23ffffff' fill-opacity='0.09'/%3E%3Crect x='48' y='${i*30 + 6}' width='10' height='17' rx='3' fill='%23ffffff' fill-opacity='0.09'/%3E`).join('')}%3C/svg%3E`;

// Camera aperture circle SVG
const apertureSvg = `data:image/svg+xml,%3Csvg width='600' height='600' viewBox='0 0 600 600' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='300' cy='300' r='270' fill='none' stroke='%2338bdf8' stroke-width='2' stroke-opacity='0.08' stroke-dasharray='10 14'/%3E%3Ccircle cx='300' cy='300' r='210' fill='none' stroke='%2338bdf8' stroke-width='1.5' stroke-opacity='0.06'/%3E%3Ccircle cx='300' cy='300' r='285' fill='none' stroke='%23ffffff' stroke-width='1' stroke-opacity='0.04'/%3E%3C/svg%3E`;

// ── OPTION 1: Max-Impact Centered (40% Larger Badge & Big Typography) ──
const htmlOption1 = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@700;800;900&family=Inter:wght@500;600;700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1200px;
    height: 630px;
    overflow: hidden;
    background-color: #01040d;
    background-image: radial-gradient(ellipse at 50% 40%, #0a2952 0%, #04162e 45%, #020a17 75%, #01040d 100%);
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
  .film-left { position: absolute; left: 0; top: 0; bottom: 0; width: 70px; background-image: url("${filmStripSvg}"); z-index: 2; }
  .film-right { position: absolute; right: 0; top: 0; bottom: 0; width: 70px; background-image: url("${filmStripSvg}"); transform: scaleX(-1); z-index: 2; }
  .aperture { position: absolute; left: -120px; bottom: -120px; width: 600px; height: 600px; background-image: url("${apertureSvg}"); background-size: contain; z-index: 2; }

  .glow {
    position: absolute;
    width: 640px; height: 640px; border-radius: 50%;
    background: radial-gradient(circle, rgba(14, 165, 233, 0.28) 0%, rgba(37, 99, 235, 0.15) 50%, transparent 72%);
    filter: blur(40px);
    z-index: 2;
  }
  .content {
    position: relative; z-index: 10;
    display: flex; flex-direction: column; align-items: center; text-align: center;
    max-width: 1040px;
  }
  .badge {
    width: 240px;
    height: 240px;
    border-radius: 52px;
    background: linear-gradient(135deg, #0284c7 0%, #2563eb 50%, #4f46e5 100%);
    display: flex; align-items: center; justify-content: center;
    padding: 16px;
    box-shadow: 
      0 25px 60px -10px rgba(37, 99, 235, 0.85),
      0 0 0 2px rgba(255, 255, 255, 0.3),
      inset 0 2px 0 rgba(255, 255, 255, 0.5);
    margin-bottom: 20px;
  }
  .badge img {
    width: 100%; height: 100%; object-fit: contain;
    mix-blend-mode: multiply; display: block;
  }
  .title {
    font-family: 'Outfit', sans-serif;
    font-size: 76px; font-weight: 900; letter-spacing: -1px;
    line-height: 1.05; color: #ffffff;
    display: flex; align-items: center; gap: 18px;
    margin-bottom: 12px;
    text-shadow: 0 4px 25px rgba(0,0,0,0.8);
  }
  .title span {
    background: linear-gradient(135deg, #38bdf8 0%, #60a5fa 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .subtitle {
    font-size: 28px; font-weight: 600; color: #cbd5e1;
    letter-spacing: 0.2px; margin-bottom: 18px;
    text-shadow: 0 2px 10px rgba(0,0,0,0.7);
  }
  .pill {
    display: inline-flex; align-items: center; gap: 12px;
    background: rgba(15, 23, 42, 0.85);
    border: 1.5px solid rgba(56, 189, 248, 0.4);
    padding: 10px 28px; border-radius: 999px;
    font-size: 19px; font-weight: 700; color: #38bdf8;
    backdrop-filter: blur(14px);
    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
  }
  .pill .dot { width: 10px; height: 10px; border-radius: 50%; background: #10b981; box-shadow: 0 0 12px #10b981; }
</style>
</head>
<body>
  <div class="noise"></div>
  <div class="film-left"></div>
  <div class="film-right"></div>
  <div class="aperture"></div>
  <div class="glow"></div>
  <div class="content">
    <div class="badge">
      <img src="data:image/jpeg;base64,${originalLogoB64}" alt="BFI Logo" />
    </div>
    <h1 class="title">BFI <span>Classroom</span></h1>
    <p class="subtitle">Bangladesh Film Institute • Digital Learning Hub</p>
    <div class="pill">
      <span class="dot"></span>
      <span>classroom.bfibd.org</span>
    </div>
  </div>
</body>
</html>
`;

// ── OPTION 2: Ultra-Bold Frame-Filling (Massive 280px Badge & 86px Title) ──
const htmlOption2 = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@800;900&family=Inter:wght@600;700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1200px;
    height: 630px;
    overflow: hidden;
    background-color: #01040d;
    background-image: radial-gradient(ellipse at 50% 38%, #0d366a 0%, #061e3d 42%, #020b1c 75%, #01040d 100%);
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
  .film-left { position: absolute; left: 0; top: 0; bottom: 0; width: 65px; background-image: url("${filmStripSvg}"); z-index: 2; }
  .film-right { position: absolute; right: 0; top: 0; bottom: 0; width: 65px; background-image: url("${filmStripSvg}"); transform: scaleX(-1); z-index: 2; }

  .glow {
    position: absolute;
    width: 720px; height: 720px; border-radius: 50%;
    background: radial-gradient(circle, rgba(14, 165, 233, 0.35) 0%, rgba(37, 99, 235, 0.18) 50%, transparent 72%);
    filter: blur(45px);
    z-index: 2;
  }
  .content {
    position: relative; z-index: 10;
    display: flex; flex-direction: column; align-items: center; text-align: center;
    max-width: 1060px;
  }
  .badge {
    width: 270px;
    height: 270px;
    border-radius: 58px;
    background: linear-gradient(135deg, #0284c7 0%, #2563eb 50%, #4338ca 100%);
    display: flex; align-items: center; justify-content: center;
    padding: 16px;
    box-shadow: 
      0 30px 70px -10px rgba(37, 99, 235, 0.9),
      0 0 0 2.5px rgba(255, 255, 255, 0.35),
      inset 0 2px 0 rgba(255, 255, 255, 0.55);
    margin-bottom: 18px;
  }
  .badge img {
    width: 100%; height: 100%; object-fit: contain;
    mix-blend-mode: multiply; display: block;
  }
  .title {
    font-family: 'Outfit', sans-serif;
    font-size: 84px; font-weight: 900; letter-spacing: -1.2px;
    line-height: 1.05; color: #ffffff;
    display: flex; align-items: center; gap: 20px;
    margin-bottom: 12px;
    text-shadow: 0 4px 28px rgba(0,0,0,0.85);
  }
  .title span {
    background: linear-gradient(135deg, #38bdf8 0%, #60a5fa 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .subtitle {
    font-size: 32px; font-weight: 700; color: #e2e8f0;
    letter-spacing: 0.2px;
    text-shadow: 0 2px 12px rgba(0,0,0,0.8);
  }
</style>
</head>
<body>
  <div class="noise"></div>
  <div class="film-left"></div>
  <div class="film-right"></div>
  <div class="glow"></div>
  <div class="content">
    <div class="badge">
      <img src="data:image/jpeg;base64,${originalLogoB64}" alt="BFI Logo" />
    </div>
    <h1 class="title">BFI <span>Classroom</span></h1>
    <p class="subtitle">Bangladesh Film Institute • Digital Learning Hub</p>
  </div>
</body>
</html>
`;

// ── OPTION 3: Landscape Studio Split (Badge Left + Big Typography Right) ──
const htmlOption3 = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@700;800;900&family=Inter:wght@500;600;700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1200px;
    height: 630px;
    overflow: hidden;
    background-color: #01040d;
    background-image: radial-gradient(ellipse at 32% 50%, #0d366a 0%, #051a37 45%, #020b1a 80%, #01040d 100%);
    font-family: 'Inter', sans-serif;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 80px;
  }
  .noise {
    position: absolute; inset: 0;
    background-image: url("${noiseSvg}");
    background-size: 256px 256px;
    mix-blend-mode: overlay;
    opacity: 0.95;
    z-index: 1;
  }
  .film-left { position: absolute; left: 0; top: 0; bottom: 0; width: 65px; background-image: url("${filmStripSvg}"); z-index: 2; }
  .film-right { position: absolute; right: 0; top: 0; bottom: 0; width: 65px; background-image: url("${filmStripSvg}"); transform: scaleX(-1); z-index: 2; }

  .glow {
    position: absolute;
    left: 100px; top: 50%; transform: translateY(-50%);
    width: 550px; height: 550px; border-radius: 50%;
    background: radial-gradient(circle, rgba(14, 165, 233, 0.32) 0%, rgba(37, 99, 235, 0.16) 50%, transparent 72%);
    filter: blur(45px);
    z-index: 2;
  }
  .container {
    position: relative; z-index: 10;
    display: flex;
    align-items: center;
    gap: 60px;
    width: 100%;
    max-width: 1040px;
  }
  .badge-col {
    flex-shrink: 0;
  }
  .badge {
    width: 290px;
    height: 290px;
    border-radius: 64px;
    background: linear-gradient(135deg, #0284c7 0%, #2563eb 50%, #4338ca 100%);
    display: flex; align-items: center; justify-content: center;
    padding: 20px;
    box-shadow: 
      0 30px 70px -10px rgba(37, 99, 235, 0.9),
      0 0 0 2.5px rgba(255, 255, 255, 0.35),
      inset 0 2px 0 rgba(255, 255, 255, 0.55);
  }
  .badge img {
    width: 100%; height: 100%; object-fit: contain;
    mix-blend-mode: multiply; display: block;
  }
  .info-col {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }
  .org-tag {
    font-size: 17px;
    font-weight: 700;
    color: #38bdf8;
    text-transform: uppercase;
    letter-spacing: 2px;
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .org-tag .line { width: 24px; height: 2px; background: #38bdf8; }
  .title {
    font-family: 'Outfit', sans-serif;
    font-size: 78px; font-weight: 900; letter-spacing: -1.2px;
    line-height: 1.05; color: #ffffff;
    margin-bottom: 14px;
    text-shadow: 0 4px 28px rgba(0,0,0,0.85);
  }
  .title span {
    background: linear-gradient(135deg, #38bdf8 0%, #60a5fa 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .subtitle {
    font-size: 24px; font-weight: 600; color: #cbd5e1;
    line-height: 1.35; margin-bottom: 22px;
  }
  .pill {
    display: inline-flex; align-items: center; gap: 12px;
    background: rgba(15, 23, 42, 0.85);
    border: 1.5px solid rgba(56, 189, 248, 0.4);
    padding: 10px 24px; border-radius: 999px;
    font-size: 18px; font-weight: 700; color: #38bdf8;
    backdrop-filter: blur(14px);
    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
  }
  .pill .dot { width: 10px; height: 10px; border-radius: 50%; background: #10b981; box-shadow: 0 0 12px #10b981; }
</style>
</head>
<body>
  <div class="noise"></div>
  <div class="film-left"></div>
  <div class="film-right"></div>
  <div class="glow"></div>
  <div class="container">
    <div class="badge-col">
      <div class="badge">
        <img src="data:image/jpeg;base64,${originalLogoB64}" alt="BFI Logo" />
      </div>
    </div>
    <div class="info-col">
      <div class="org-tag"><span class="line"></span> BANGLADESH FILM INSTITUTE</div>
      <h1 class="title">BFI <span>Classroom</span></h1>
      <p class="subtitle">Comprehensive Digital Learning Platform & Creative Hub for Filmmakers</p>
      <div class="pill">
        <span class="dot"></span>
        <span>classroom.bfibd.org</span>
      </div>
    </div>
  </div>
</body>
</html>
`;

// WhatsApp Light Theme Mockup Generator (Matches User's WhatsApp Screenshot)
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

  // 1. Render Option 1 (Max-Impact Centered)
  const p1 = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await p1.setContent(htmlOption1, { waitUntil: 'networkidle' });
  await p1.waitForTimeout(500);
  const path1 = path.join(brainDir, 'social_card_enlarged_opt1.png');
  await p1.screenshot({ path: path1 });
  console.log('Saved', path1);

  // 2. Render Option 2 (Ultra-Bold Full Frame)
  const p2 = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await p2.setContent(htmlOption2, { waitUntil: 'networkidle' });
  await p2.waitForTimeout(500);
  const path2 = path.join(brainDir, 'social_card_enlarged_opt2.png');
  await p2.screenshot({ path: path2 });
  console.log('Saved', path2);

  // 3. Render Option 3 (Landscape Studio Split)
  const p3 = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await p3.setContent(htmlOption3, { waitUntil: 'networkidle' });
  await p3.waitForTimeout(500);
  const path3 = path.join(brainDir, 'social_card_enlarged_opt3.png');
  await p3.screenshot({ path: path3 });
  console.log('Saved', path3);

  // 4. WhatsApp Mockups (Matching user's real screenshot)
  const b64_1 = fs.readFileSync(path1).toString('base64');
  const pMock1 = await browser.newPage({ viewport: { width: 680, height: 520 } });
  await pMock1.setContent(getWhatsAppLightMockupHtml(b64_1, 'Variation 1: Max-Impact Centered (240px Badge + 76px Title)'), { waitUntil: 'networkidle' });
  await pMock1.waitForTimeout(500);
  const mockPath1 = path.join(brainDir, 'whatsapp_enlarged_mockup_opt1.png');
  await pMock1.screenshot({ path: mockPath1 });
  console.log('Saved', mockPath1);

  const b64_2 = fs.readFileSync(path2).toString('base64');
  const pMock2 = await browser.newPage({ viewport: { width: 680, height: 520 } });
  await pMock2.setContent(getWhatsAppLightMockupHtml(b64_2, 'Variation 2: Ultra-Bold Full Frame (270px Badge + 84px Title)'), { waitUntil: 'networkidle' });
  await pMock2.waitForTimeout(500);
  const mockPath2 = path.join(brainDir, 'whatsapp_enlarged_mockup_opt2.png');
  await pMock2.screenshot({ path: mockPath2 });
  console.log('Saved', mockPath2);

  const b64_3 = fs.readFileSync(path3).toString('base64');
  const pMock3 = await browser.newPage({ viewport: { width: 680, height: 520 } });
  await pMock3.setContent(getWhatsAppLightMockupHtml(b64_3, 'Variation 3: Studio Landscape Split (290px Badge Left + Big Text Right)'), { waitUntil: 'networkidle' });
  await pMock3.waitForTimeout(500);
  const mockPath3 = path.join(brainDir, 'whatsapp_enlarged_mockup_opt3.png');
  await pMock3.screenshot({ path: mockPath3 });
  console.log('Saved', mockPath3);

  await browser.close();
  console.log('All enlarged variations rendered successfully!');
})();
