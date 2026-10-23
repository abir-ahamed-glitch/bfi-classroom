const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const brainDir = 'C:\\Users\\shahi\\.gemini\\antigravity\\brain\\22315a22-1ff8-42ae-a262-3d537beab1fd';
const originalLogoB64 = fs.readFileSync('public/bfi-logo.jpg').toString('base64');

// High-definition SVG noise filter
const noiseSvg = `data:image/svg+xml,%3Csvg viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.22'/%3E%3C/svg%3E`;

// Film strip SVG pattern
const filmStripSvg = `data:image/svg+xml,%3Csvg width='55' height='630' viewBox='0 0 55 630' xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='55' height='630' fill='none'/%3E%3Cpath d='M8 0h10v630H8zM37 0h10v630H37z' fill='%23ffffff' fill-opacity='0.04'/%3E${Array.from({length: 21}).map((_, i) => `%3Crect x='10' y='${i*30 + 6}' width='8' height='16' rx='3' fill='%23ffffff' fill-opacity='0.08'/%3E%3Crect x='39' y='${i*30 + 6}' width='8' height='16' rx='3' fill='%23ffffff' fill-opacity='0.08'/%3E`).join('')}%3C/svg%3E`;

// Camera aperture circle SVG
const apertureSvg = `data:image/svg+xml,%3Csvg width='700' height='700' viewBox='0 0 700 700' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='350' cy='350' r='320' fill='none' stroke='%2338bdf8' stroke-width='2' stroke-opacity='0.08' stroke-dasharray='12 16'/%3E%3Ccircle cx='350' cy='350' r='250' fill='none' stroke='%2338bdf8' stroke-width='1.5' stroke-opacity='0.06'/%3E%3Ccircle cx='350' cy='350' r='335' fill='none' stroke='%23ffffff' stroke-width='1' stroke-opacity='0.04'/%3E%3C/svg%3E`;

// ══════════════════════════════════════════════════════════════════════
// OPTION A (ENLARGED CENTERED HERO) - 310px Badge + 100px Vibrant Title
// ══════════════════════════════════════════════════════════════════════
const htmlOptionA = `
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

  /* Ambient cinematic beam across the center */
  .beam {
    position: absolute;
    width: 1000px; height: 320px;
    background: radial-gradient(ellipse, rgba(14, 165, 233, 0.3) 0%, rgba(37, 99, 235, 0.12) 50%, transparent 75%);
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
  .title span {
    background: linear-gradient(135deg, #38bdf8 0%, #7dd3fc 45%, #ffffff 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
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
    <h1 class="title">BFI <span>Classroom</span></h1>
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

// ══════════════════════════════════════════════════════════════════════
// OPTION B (CINEMATIC STUDIO SPLIT) - 370px Giant Badge + Studio Typography
// ══════════════════════════════════════════════════════════════════════
const htmlOptionB = `
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
    background-image: radial-gradient(ellipse at 35% 50%, #0e4082 0%, #062248 48%, #020c1d 80%, #01040d 100%);
    font-family: 'Inter', sans-serif;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 65px;
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

  .glow {
    position: absolute;
    left: 80px; top: 50%; transform: translateY(-50%);
    width: 680px; height: 680px; border-radius: 50%;
    background: radial-gradient(circle, rgba(14, 165, 233, 0.45) 0%, rgba(37, 99, 235, 0.22) 50%, transparent 72%);
    filter: blur(52px);
    z-index: 2;
  }
  .container {
    position: relative; z-index: 10;
    display: flex;
    align-items: center;
    gap: 55px;
    width: 100%;
    max-width: 1070px;
  }
  .badge-col {
    flex-shrink: 0;
  }
  .badge {
    width: 370px;
    height: 370px;
    border-radius: 80px;
    background: linear-gradient(135deg, #0284c7 0%, #2563eb 50%, #4338ca 100%);
    display: flex; align-items: center; justify-content: center;
    padding: 24px;
    box-shadow: 
      0 40px 90px -10px rgba(37, 99, 235, 0.95),
      0 0 0 3.5px rgba(255, 255, 255, 0.4),
      inset 0 3px 0 rgba(255, 255, 255, 0.6);
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
    font-size: 21px;
    font-weight: 800;
    color: #38bdf8;
    text-transform: uppercase;
    letter-spacing: 2.5px;
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .org-tag .bar { width: 36px; height: 3px; background: #38bdf8; border-radius: 2px; }
  .title {
    font-family: 'Outfit', sans-serif;
    font-size: 96px; font-weight: 900; letter-spacing: -1.8px;
    line-height: 1.0; color: #ffffff;
    margin-bottom: 14px;
    text-shadow: 0 5px 35px rgba(0,0,0,0.9);
  }
  .title span {
    background: linear-gradient(135deg, #38bdf8 0%, #7dd3fc 45%, #ffffff 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .subtitle {
    font-size: 29px; font-weight: 600; color: #cbd5e1;
    line-height: 1.35; margin-bottom: 24px;
    text-shadow: 0 2px 10px rgba(0,0,0,0.7);
  }
  .pill {
    display: inline-flex; align-items: center; gap: 14px;
    background: rgba(15, 23, 42, 0.9);
    border: 1.5px solid rgba(56, 189, 248, 0.5);
    padding: 12px 32px; border-radius: 999px;
    font-size: 22px; font-weight: 700; color: #38bdf8;
    backdrop-filter: blur(14px);
    box-shadow: 0 10px 30px rgba(0,0,0,0.6);
  }
  .pill .dot { width: 11px; height: 11px; border-radius: 50%; background: #10b981; box-shadow: 0 0 14px #10b981; }
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
      <div class="org-tag"><span class="bar"></span> BANGLADESH FILM INSTITUTE</div>
      <h1 class="title">BFI <span>Classroom</span></h1>
      <p class="subtitle">Official Digital Learning Platform & Creative Hub for Filmmakers</p>
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

  // 1. Render Option A (Enlarged Centered)
  const pA = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await pA.setContent(htmlOptionA, { waitUntil: 'networkidle' });
  await pA.waitForTimeout(500);
  const pathA = path.join(brainDir, 'social_card_enlarged_centered.png');
  await pA.screenshot({ path: pathA });
  console.log('Saved', pathA);

  // 2. Render Option B (Cinematic Studio Split)
  const pB = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await pB.setContent(htmlOptionB, { waitUntil: 'networkidle' });
  await pB.waitForTimeout(500);
  const pathB = path.join(brainDir, 'social_card_enlarged_split.png');
  await pB.screenshot({ path: pathB });
  console.log('Saved', pathB);

  // 3. Render WhatsApp Mockup for Option A
  const b64_A = fs.readFileSync(pathA).toString('base64');
  const pMockA = await browser.newPage({ viewport: { width: 680, height: 520 } });
  await pMockA.setContent(getWhatsAppLightMockupHtml(b64_A, 'Option 1: Enlarged Centered (300px Badge + 100px Title)'), { waitUntil: 'networkidle' });
  await pMockA.waitForTimeout(500);
  const mockPathA = path.join(brainDir, 'whatsapp_mockup_enlarged_centered.png');
  await pMockA.screenshot({ path: mockPathA });
  console.log('Saved', mockPathA);

  // 4. Render WhatsApp Mockup for Option B
  const b64_B = fs.readFileSync(pathB).toString('base64');
  const pMockB = await browser.newPage({ viewport: { width: 680, height: 520 } });
  await pMockB.setContent(getWhatsAppLightMockupHtml(b64_B, 'Option 2: Cinematic Studio Split (370px Giant Badge + Edge-to-Edge Typography)'), { waitUntil: 'networkidle' });
  await pMockB.waitForTimeout(500);
  const mockPathB = path.join(brainDir, 'whatsapp_mockup_enlarged_split.png');
  await pMockB.screenshot({ path: mockPathB });
  console.log('Saved', mockPathB);

  // 5. Create 3-Way Direct Comparison Banner
  const userShotB64 = fs.readFileSync('C:/Users/shahi/.gemini/antigravity/brain/22315a22-1ff8-42ae-a262-3d537beab1fd/.user_uploaded/media_1792757553585_5ba12e6e.png').toString('base64');
  const htmlCompare = `
  <!DOCTYPE html>
  <html>
  <head>
  <meta charset="utf-8">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@600;700;800;900&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 1400px;
      height: 680px;
      background: #0b1329;
      font-family: 'Inter', sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 30px;
      gap: 24px;
    }
    .header {
      text-align: center;
    }
    .header h2 {
      font-size: 26px; color: #f8fafc; font-weight: 800; letter-spacing: -0.5px;
    }
    .header p {
      font-size: 15px; color: #94a3b8; margin-top: 5px;
    }
    .cards-row {
      display: flex;
      align-items: flex-start;
      justify-content: center;
      gap: 28px;
      width: 100%;
    }
    .col {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
    }
    .tag {
      font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.8px;
      padding: 6px 16px; border-radius: 999px;
    }
    .tag-before { background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); }
    .tag-opt1 { background: rgba(14, 165, 233, 0.2); color: #38bdf8; border: 1px solid rgba(14, 165, 233, 0.4); }
    .tag-opt2 { background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4); }
    
    .frame {
      width: 420px;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 12px 30px rgba(0,0,0,0.6);
      border: 1px solid rgba(255,255,255,0.12);
    }
    .frame img {
      width: 100%; display: block;
    }
    .specs {
      font-size: 12.5px; color: #94a3b8; text-align: center; line-height: 1.4;
    }
    .specs strong { color: #f1f5f9; }
  </style>
  </head>
  <body>
    <div class="header">
      <h2>BFI Classroom • WhatsApp Preview Scale Optimization</h2>
      <p>Comparing your current test against the two enlarged, space-filling designs</p>
    </div>
    <div class="cards-row">
      <div class="col">
        <span class="tag tag-before">Current (Too Much Space)</span>
        <div class="frame">
          <img src="data:image/png;base64,${userShotB64}" />
        </div>
        <div class="specs">Badge: <strong>175px</strong> • Title: <strong>58px</strong><br/>Large empty margins on sides</div>
      </div>
      <div class="col">
        <span class="tag tag-opt1">Option 1: Enlarged Centered</span>
        <div class="frame">
          <img src="data:image/png;base64,${b64_A}" />
        </div>
        <div class="specs">Badge: <strong>300px (+71%)</strong> • Title: <strong>100px (+72%)</strong><br/>Massive center focal point</div>
      </div>
      <div class="col">
        <span class="tag tag-opt2">Option 2: Cinematic Studio Split</span>
        <div class="frame">
          <img src="data:image/png;base64,${b64_B}" />
        </div>
        <div class="specs">Badge: <strong>370px (+111%)</strong> • Title: <strong>96px</strong><br/>100% width filled • Zero dead space</div>
      </div>
    </div>
  </body>
  </html>
  `;
  const pComp = await browser.newPage({ viewport: { width: 1400, height: 680 } });
  await pComp.setContent(htmlCompare, { waitUntil: 'networkidle' });
  await pComp.waitForTimeout(500);
  const compPath = path.join(brainDir, 'direct_comparison_showcase.png');
  await pComp.screenshot({ path: compPath });
  console.log('Saved', compPath);

  await browser.close();
  console.log('All finalized comparisons rendered!');
})();
