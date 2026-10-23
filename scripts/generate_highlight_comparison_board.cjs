const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const brainDir = 'C:\\Users\\shahi\\.gemini\\antigravity\\brain\\22315a22-1ff8-42ae-a262-3d537beab1fd';
const b64_1A = fs.readFileSync(path.join(brainDir, 'social_card_highlight_1a.png')).toString('base64');
const b64_1C = fs.readFileSync(path.join(brainDir, 'social_card_highlight_1c.png')).toString('base64');

function getWhatsAppLightMockup(previewImgB64) {
  return `
  <div class="wa-bubble">
    <div class="forwarded"><span>&#10558; Forwarded</span></div>
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
  </div>`;
}

const htmlBoard = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@700;800;900&family=Segoe+UI:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1320px;
    height: 720px;
    background: #080f24;
    font-family: 'Inter', sans-serif;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 30px;
    gap: 22px;
  }
  .header { text-align: center; }
  .header h2 { font-size: 26px; color: #f8fafc; font-weight: 800; letter-spacing: -0.5px; }
  .header p { font-size: 15px; color: #94a3b8; margin-top: 5px; }

  .cards-row {
    display: flex;
    align-items: flex-start;
    justify-content: center;
    gap: 36px;
    width: 100%;
  }
  .col {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
  }
  .tag {
    font-size: 14px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.8px;
    padding: 6px 18px; border-radius: 999px;
  }
  .tag-a { background: rgba(0, 240, 255, 0.2); color: #00f0ff; border: 1.5px solid #00f0ff; }
  .tag-c { background: rgba(56, 189, 248, 0.2); color: #38bdf8; border: 1.5px solid #38bdf8; }

  /* WhatsApp Mockup internal styles */
  .wa-bubble {
    width: 440px;
    background: #d9fdd3;
    border-radius: 12px 12px 2px 12px;
    overflow: hidden;
    box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    padding: 4px 4px 6px 4px;
    font-family: 'Segoe UI', -apple-system, sans-serif;
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

  .explain {
    font-size: 14px;
    color: #cbd5e1;
    text-align: center;
    max-width: 440px;
    line-height: 1.4;
  }
  .explain strong { color: #f8fafc; }
</style>
</head>
<body>
  <div class="header">
    <h2>Option 1: Two Ways to Highlight "Classroom"</h2>
    <p>Both retain the large centered logo while making "Classroom" the brightest element</p>
  </div>
  <div class="cards-row">
    <div class="col">
      <span class="tag tag-a">Style A: Electric Neon Cyan</span>
      ${getWhatsAppLightMockup(b64_1A)}
      <p class="explain"><strong>Style A:</strong> "Classroom" shines in vibrant electric cyan with a neon aura. Clean, modern, and extremely visible.</p>
    </div>
    <div class="col">
      <span class="tag tag-c">Style B: Illuminated Glowing Capsule</span>
      ${getWhatsAppLightMockup(b64_1C)}
      <p class="explain"><strong>Style B:</strong> "Classroom" is enclosed in a luminous glass capsule pill with a cyan outline. Very distinctive and premium.</p>
    </div>
  </div>
</body>
</html>
`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const p = await browser.newPage({ viewport: { width: 1320, height: 720 } });
  await p.setContent(htmlBoard, { waitUntil: 'networkidle' });
  await p.waitForTimeout(500);
  const outPath = path.join(brainDir, 'classroom_highlight_styles_whatsapp.png');
  await p.screenshot({ path: outPath });
  console.log('Saved', outPath);
  await browser.close();
})();
