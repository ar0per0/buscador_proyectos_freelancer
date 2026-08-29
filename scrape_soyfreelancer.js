#!/usr/bin/env node

const path = require('node:path');
const { euroBudgetFromValues, euroBudgetValues, fetchEuroRates } = require('./currency');
const { writeJsonAtomicSync } = require('./storage');

const applicationId = 'JLJ22SZ55L';
// Clave pública de solo búsqueda publicada por el frontend de SoyFreelancer.
const searchApiKey = 'f2950f5942bae3beff5d942850639261';
const indexName = 'soyfreelancer.com_projects';
const endpoint = `https://${applicationId}-dsn.algolia.net/1/indexes/${indexName}/query`;
const listingUrl = 'https://www.soyfreelancer.com/trabajos-freelance';
const root = __dirname;
const dataRoot = process.env.DATA_DIR || root;
const jsonPath = path.join(dataRoot, 'soyfreelancer_jobs.json');
const pageSize = 100;

const budgetRanges = {
  2: [25, 100], 3: [101, 200], 4: [201, 300], 5: [301, 400],
  6: [401, 500], 7: [501, 700], 8: [701, 900], 9: [901, 1100],
  10: [1101, 1200], 11: [1201, 1400], 12: [1601, 1800],
  13: [1801, 2000], 14: [2001, 2500], 15: [2501, 3000],
};

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function requestPage(page, attempt = 1) {
  const params = new URLSearchParams({
    query: '', hitsPerPage: String(pageSize), page: String(page),
    filters: 'status:0 OR status:16',
  });
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Algolia-Application-Id': applicationId,
      'X-Algolia-API-Key': searchApiKey,
      'User-Agent': 'FreelancerLocalPanel/1.0',
    },
    body: JSON.stringify({ params: params.toString() }),
  });
  if ((response.status === 429 || response.status >= 500) && attempt <= 4) {
    await wait(attempt * 1000);
    return requestPage(page, attempt + 1);
  }
  if (!response.ok) throw new Error(`SoyFreelancer respondió HTTP ${response.status} en página ${page + 1}`);
  return response.json();
}

function timestampToIso(value) {
  let timestamp = Number(value?.timestamp ?? value?._seconds ?? value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  if (timestamp < 1e11) timestamp *= 1000;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function textValue(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  return value.name || value.title || value.label || '';
}

function rawBudget(hit) {
  if (Number(hit.projectType) === 2 && hit.salary) {
    const exact = Number(hit.salary.exact);
    if (exact > 0) return { minimum: exact, maximum: exact, label: `US$${exact} USD` };
    const minimum = Number(hit.salary.min);
    const maximum = Number(hit.salary.max);
    if (minimum > 0 || maximum > 0) {
      return {
        minimum: minimum > 0 ? minimum : maximum,
        maximum: maximum > 0 ? maximum : minimum,
        label: `US$${minimum || maximum} - US$${maximum || minimum} USD`,
      };
    }
  }
  const code = Number(hit.budget);
  if (code === 1 && Number(hit.specificBudget) > 0) {
    const amount = Number(hit.specificBudget);
    return { minimum: amount, maximum: amount, label: `US$${amount} USD` };
  }
  const range = budgetRanges[code];
  if (range) return { minimum: range[0], maximum: range[1], label: `US$${range[0]} - US$${range[1]} USD` };
  return { minimum: null, maximum: null, label: 'Abierto a negociación' };
}

function normalize(hit, page, rates) {
  const original = rawBudget(hit);
  const euroValues = euroBudgetValues(original.minimum, original.maximum, 'USD', rates);
  const countries = (hit.countries || []).map(item => item?.country).filter(Boolean);
  const skills = (hit.skills || []).map(textValue).filter(Boolean);
  const publishedAt = timestampToIso(hit.posted || hit.createdAt);
  return {
    source: 'SoyFreelancer',
    source_id: String(hit.objectID),
    page: page + 1,
    slug: `soyfreelancer-${hit.objectID}`,
    url: `${listingUrl}/job/${encodeURIComponent(hit.objectID)}`,
    title: hit.projectTitle || '',
    description: hit.description || '',
    author: '',
    country: countries.join(', '),
    countries,
    category: textValue(hit.category),
    subcategory: textValue(hit.subCategory),
    posted_date: publishedAt,
    published_date: publishedAt,
    published_at: publishedAt,
    proposals: hit.applications == null ? '' : `${hit.applications} postulaciones`,
    budget: original.minimum == null
      ? 'A negociar'
      : euroBudgetFromValues(original.minimum, original.maximum, 'USD', false, rates),
    budget_eur_min: euroValues.minimum,
    budget_eur_max: euroValues.maximum,
    original_budget: original.label,
    hourly: false,
    urgent: Boolean(hit.urgentJob),
    featured: Number(hit.projectType) === 1,
    verified_payment: Boolean(hit.trustedClient || Number(hit.moneySpent) > 0),
    client_rating: '',
    language: 'es',
    skills,
  };
}

async function main() {
  process.stderr.write('SoyFreelancer: consultando el índice público…\n');
  const exchangeRates = await fetchEuroRates();
  const first = await requestPage(0);
  const pageCount = Math.max(1, Number(first.nbPages || 1));
  const collected = (first.hits || []).map(hit => normalize(hit, 0, exchangeRates.rates));
  for (let page = 1; page < pageCount; page++) {
    const result = await requestPage(page);
    collected.push(...(result.hits || []).map(hit => normalize(hit, page, exchangeRates.rates)));
    await wait(200);
  }
  const unique = [...new Map(collected.map(job => [job.source_id, job])).values()];
  const document = {
    source: listingUrl,
    api: endpoint,
    scraped_at: new Date().toISOString(),
    total_reported: Number(first.nbHits || unique.length),
    pages_requested: pageCount,
    records_collected: collected.length,
    unique_records: unique.length,
    exchange_rates: { date: exchangeRates.date, source: exchangeRates.source, base: 'EUR' },
    jobs: unique,
  };
  writeJsonAtomicSync(jsonPath, document);
  process.stdout.write(`${JSON.stringify({ jsonPath, total_reported: document.total_reported, pages_requested: pageCount, records_collected: collected.length, unique_records: unique.length })}\n`);
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
