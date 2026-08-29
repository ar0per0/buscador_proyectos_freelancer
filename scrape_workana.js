#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { budgetValuesFromText, fetchEuroRates } = require('./currency');
const { writeJsonAtomicSync } = require('./storage');

const workspace = __dirname;
const dataRoot = process.env.DATA_DIR || workspace;
const jsonPath = path.join(dataRoot, 'workana_jobs.json');
const openclawBin = process.env.OPENCLAW_BIN || '/home/prova/.npm-global/bin/openclaw';
const scrapeStartedAt = new Date();
const workanaUrl = 'https://www.workana.com/es/jobs?language=es';
let chromiumBrowser = null;
let chromiumPage = null;

function parseRelativeDate(value) {
  const text = String(value || '').replace(/^Publicado:\s*/i, '').trim().toLocaleLowerCase('es');
  const date = new Date(scrapeStartedAt);
  if (text === 'hace instantes') return date.toISOString();
  if (text === 'ayer') {
    date.setDate(date.getDate() - 1);
    return date.toISOString();
  }
  if (/hace\s+(?:casi\s+)?una\s+hora/i.test(text)) {
    date.setHours(date.getHours() - 1);
    return date.toISOString();
  }
  if (/hace\s+(?:casi\s+)?un\s+minuto/i.test(text)) {
    date.setMinutes(date.getMinutes() - 1);
    return date.toISOString();
  }
  const match = text.match(/hace\s+(\d+)\s+(minuto|minutos|hora|horas|día|días)/i);
  if (!match) return '';
  const amount = Number(match[1]);
  const unit = match[2].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (unit.startsWith('minuto')) date.setMinutes(date.getMinutes() - amount);
  else if (unit.startsWith('hora')) date.setHours(date.getHours() - amount);
  else if (unit.startsWith('dia')) date.setDate(date.getDate() - amount);
  return date.toISOString();
}

async function scrapeBatch(startPage, endPage) {
  const browserFunction = `async () => {
    const cleanHtml = (html) => {
      const doc = new DOMParser().parseFromString(html || '', 'text/html');
      return (doc.body?.textContent || '').replace(/\\s+/g, ' ').trim();
    };
    const results = [];
    for (let page = ${startPage}; page <= ${endPage}; page++) {
      const response = await fetch('/jobs?language=es&page=' + page, { credentials: 'include' });
      if (!response.ok) continue;
      const html = await response.text();
      const documentCopy = new DOMParser().parseFromString(html, 'text/html');
      const raw = documentCopy.querySelector('search')?.getAttribute(':results-initials');
      if (!raw) continue;
      const payload = JSON.parse(raw);
      for (const job of payload.results || []) {
        results.push({
          source: 'Workana',
          page,
          source_id: job.slug || '',
          slug: job.slug || '',
          url: job.slug ? 'https://www.workana.com/job/' + job.slug : '',
          title: cleanHtml(job.title),
          description: cleanHtml(job.description),
          author: job.authorName || '',
          country: cleanHtml(job.country),
          posted_date: job.postedDate || '',
          published_date: job.publishedDate || '',
          published_at: '',
          last_reply: job.lastEmployerMessage || '',
          proposals: job.totalBids || '',
          budget: job.budget || '',
          hourly: Boolean(job.isHourly),
          urgent: Boolean(job.isUrgent),
          featured: Boolean(job.isSearchFeatured),
          verified_payment: Boolean(job.hasVerifiedPaymentMethod),
          client_rating: job.rating?.value || '',
          skills: (job.skills || []).map(skill => skill.anchorText).filter(Boolean)
        });
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    return results;
  }`;

  if (chromiumPage) {
    return chromiumPage.evaluate(source => (0, eval)(`(${source})`)(), browserFunction);
  }
  const output = execFileSync(openclawBin, ['browser', 'evaluate', '--fn', browserFunction], {
    encoding: 'utf8', maxBuffer: 20 * 1024 * 1024,
  });
  return JSON.parse(output);
}

async function prepareBrowser() {
  if (process.env.CHROMIUM_PATH) {
    const puppeteer = require('puppeteer-core');
    chromiumBrowser = await puppeteer.launch({
      executablePath: process.env.CHROMIUM_PATH,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
      ],
    });
    chromiumPage = await chromiumBrowser.newPage();
    await chromiumPage.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36');
    await chromiumPage.goto(workanaUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    return;
  }
  execFileSync(openclawBin, ['browser', 'start'], { stdio: 'ignore' });
  try {
    execFileSync(openclawBin, ['browser', 'navigate', workanaUrl], { stdio: 'ignore' });
  } catch {
    execFileSync(openclawBin, ['browser', 'open', workanaUrl], { stdio: 'ignore' });
  }
}

async function main() {
  const exchangeRates = await fetchEuroRates();
  const collected = [];
  process.stderr.write('Workana: preparando el navegador…\n');
  await prepareBrowser();
  for (let start = 1; start <= 50; start += 10) {
    const end = Math.min(start + 9, 50);
    process.stderr.write(`Extrayendo páginas ${start}-${end}...\n`);
    collected.push(...await scrapeBatch(start, end));
  }

  const unique = [...new Map(collected.map(job => [job.source_id || job.slug || job.url, job])).values()]
    .map(job => {
      const euroBudget = budgetValuesFromText(job.budget, exchangeRates.rates);
      return {
        ...job,
        original_budget: job.budget,
        budget: euroBudget.label,
        budget_eur_min: euroBudget.minimum,
        budget_eur_max: euroBudget.maximum,
        published_at: parseRelativeDate(job.published_date || job.posted_date),
      };
    });
  const scrapedAt = new Date().toISOString();
  const document = {
  source: workanaUrl,
  scraped_at: scrapedAt,
  pages_requested: 50,
  records_collected: collected.length,
  unique_records: unique.length,
    exchange_rates: { date: exchangeRates.date, source: exchangeRates.source, base: 'EUR' },
    jobs: unique
  };

  writeJsonAtomicSync(jsonPath, document);

  process.stdout.write(JSON.stringify({ jsonPath, ...document, jobs: undefined }, null, 2) + '\n');
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}).finally(async () => {
  if (chromiumBrowser) await chromiumBrowser.close();
});
