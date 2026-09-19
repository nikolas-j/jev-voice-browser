// Screenshot the running dashboard: npx tsx scripts/screenshot.ts out.png
import "dotenv/config";
import { chromium } from "playwright";

const out = process.argv[2] ?? "dashboard.png";
const b = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || undefined });
const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
await p.goto(`http://localhost:${process.env.PORT ?? 3000}`);
await p.waitForTimeout(1500);
await p.screenshot({ path: out });
await b.close();
console.log(`wrote ${out}`);
