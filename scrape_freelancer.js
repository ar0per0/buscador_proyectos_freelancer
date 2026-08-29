#!/usr/bin/env node

const path = require('node:path');
const { euroBudgetFromValues, euroBudgetValues, fetchEuroRates } = require('./currency');
const { writeJsonAtomicSync } = require('./storage');

const root = __dirname;
const dataRoot = process.env.DATA_DIR || root;
const jsonPath = path.join(dataRoot, 'freelancer_jobs.json');
const endpoint = 'https://www.freelancer.com/api/projects/0.1/projects/active/';
const pageSize = 100;

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function requestPage(offset, attempt = 1) {
  const url = new URL(endpoint);
  url.searchParams.set('limit', String(pageSize));
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('compact', 'true');
  url.searchParams.set('full_description', 'true');
  url.searchParams.set('job_details', 'true');
  url.searchParams.set('upgrade_details', 'true');

  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'WorkanaJobsDashboard/1.0' },
  });
  if (response.status === 429 && attempt <= 4) {
    const retrySeconds = Number(response.headers.get('retry-after') || 5);
    await wait(retrySeconds * 1000);
    return requestPage(offset, attempt + 1);
  }
  if (!response.ok) throw new Error(`Freelancer API respondió HTTP ${response.status} en offset ${offset}`);
  const payload = await response.json();
  if (payload.status !== 'success') throw new Error(payload.message || 'Respuesta inválida de Freelancer API');
  return payload.result;
}

function budgetLabel(project) {
  const minimum = project.budget?.minimum;
  const maximum = project.budget?.maximum;
  const code = project.currency?.code || '';
  const sign = project.currency?.sign || '';
  if (minimum == null && maximum == null) return 'No indicado';
  const range = minimum === maximum || maximum == null ? `${minimum}` : `${minimum} - ${maximum}`;
  return `${sign}${range} ${code}${project.type === 'hourly' ? ' / hora' : ''}`.trim();
}

function normalize(project, page, rates) {
  const timestamp = project.submitdate || project.time_submitted;
  const isoDate = timestamp ? new Date(timestamp * 1000).toISOString() : '';
  const currencyCode = project.currency?.code || 'EUR';
  const euroValues = euroBudgetValues(
    project.budget?.minimum, project.budget?.maximum, currencyCode, rates,
  );
  return {
    source: 'Freelancer',
    source_id: String(project.id),
    page,
    slug: `freelancer-${project.id}`,
    url: `https://www.freelancer.es/projects/${project.seo_url}`,
    title: project.title || '',
    description: project.description || project.preview_description || '',
    author: '',
    country: project.location?.country?.name || project.location?.country?.code || '',
    posted_date: isoDate,
    published_date: isoDate,
    published_at: isoDate,
    last_reply: '',
    proposals: project.bid_stats?.bid_count == null ? '' : `${project.bid_stats.bid_count} propuestas`,
    budget: euroBudgetFromValues(
      project.budget?.minimum,
      project.budget?.maximum,
      currencyCode,
      project.type === 'hourly',
      rates,
    ),
    budget_eur_min: euroValues.minimum,
    budget_eur_max: euroValues.maximum,
    original_budget: budgetLabel(project),
    hourly: project.type === 'hourly',
    urgent: Boolean(project.urgent || project.upgrades?.urgent),
    featured: Boolean(project.featured || project.upgrades?.featured),
    verified_payment: false,
    client_rating: '',
    language: project.language || '',
    skills: (project.jobs || []).map(job => job.name).filter(Boolean),
  };
}

async function main() {
  process.stderr.write('Freelancer: consultando el total de proyectos…\n');
  const exchangeRates = await fetchEuroRates();
  const first = await requestPage(0);
  const total = Number(first.total_count || first.projects?.length || 0);
  const collected = (first.projects || []).map(project => normalize(project, 1, exchangeRates.rates));
  // The public endpoint repeats the offset=4900 page for offsets >= 5000.
  const accessibleCap = Math.min(total, 5000);
  const pageCount = Math.ceil(accessibleCap / pageSize);

  for (let page = 2; page <= pageCount; page++) {
    const result = await requestPage((page - 1) * pageSize);
    collected.push(...(result.projects || []).map(project => normalize(project, page, exchangeRates.rates)));
    if (page % 10 === 0 || page === pageCount) {
      process.stderr.write(`Freelancer: páginas ${page}/${pageCount}…\n`);
    }
    await wait(320);
  }

  const unique = [...new Map(collected.map(job => [job.source_id, job])).values()];
  const document = {
    source: 'https://www.freelancer.es/jobs',
    api: endpoint,
    scraped_at: new Date().toISOString(),
    total_reported: total,
    api_accessible_cap: accessibleCap,
    pages_requested: pageCount,
    records_collected: collected.length,
    unique_records: unique.length,
    exchange_rates: { date: exchangeRates.date, source: exchangeRates.source, base: 'EUR' },
    jobs: unique,
  };
  writeJsonAtomicSync(jsonPath, document);

  process.stdout.write(JSON.stringify({
    jsonPath, total_reported: total, api_accessible_cap: accessibleCap, pages_requested: pageCount,
    records_collected: collected.length, unique_records: unique.length,
  }) + '\n');
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
