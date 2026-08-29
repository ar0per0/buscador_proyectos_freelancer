#!/usr/bin/env node

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const host = '0.0.0.0';
const port = Number(process.env.WORKANA_WEB_PORT || 8081);
const root = __dirname;
const projectRoot = path.join(root, '..');
const dataRoot = process.env.DATA_DIR || projectRoot;
const dataFile = path.join(dataRoot, 'workana_jobs.json');
const freelancerDataFile = path.join(dataRoot, 'freelancer_jobs.json');
const soyfreelancerDataFile = path.join(dataRoot, 'soyfreelancer_jobs.json');
const seenJobsFile = path.join(dataRoot, 'seen_jobs.json');
const favoriteJobsFile = path.join(dataRoot, 'favorite_jobs.json');
const searchProfilesFile = path.join(dataRoot, 'search_profiles.json');
const scrapers = {
  workana: path.join(root, '..', 'scrape_workana.js'),
  freelancer: path.join(root, '..', 'scrape_freelancer.js'),
  soyfreelancer: path.join(root, '..', 'scrape_soyfreelancer.js'),
};
const refreshState = {
  running: false,
  target: null,
  startedAt: null,
  finishedAt: null,
  message: 'Listo para actualizar',
  error: null,
};

const routes = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/favicon.png', ['favicon.png', 'image/png']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);

function sendFile(response, filePath, contentType) {
  fs.readFile(filePath, (error, body) => {
    if (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500);
      response.end('Not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(body);
  });
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

function workanaPublishedAt(job, scrapedAt) {
  if (job.published_at) return job.published_at;
  const text = String(job.published_date || job.posted_date || '')
    .replace(/^Publicado:\s*/i, '').trim().toLocaleLowerCase('es');
  const date = new Date(scrapedAt);
  if (Number.isNaN(date.getTime())) return null;
  if (text === 'hace instantes') return date.toISOString();
  if (text === 'ayer') date.setDate(date.getDate() - 1);
  else if (/hace\s+(?:casi\s+)?una\s+hora/i.test(text)) date.setHours(date.getHours() - 1);
  else if (/hace\s+(?:casi\s+)?un\s+minuto/i.test(text)) date.setMinutes(date.getMinutes() - 1);
  else {
    const match = text.match(/hace\s+(\d+)\s+(minuto|minutos|hora|horas|día|días)/i);
    if (!match) return null;
    const amount = Number(match[1]);
    const unit = match[2].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (unit.startsWith('minuto')) date.setMinutes(date.getMinutes() - amount);
    else if (unit.startsWith('hora')) date.setHours(date.getHours() - amount);
    else date.setDate(date.getDate() - amount);
  }
  return date.toISOString();
}

function jobKey(job) {
  return `${job.source}:${job.source_id || job.slug || job.url}`;
}

async function readSeenJobs() {
  try {
    const document = JSON.parse(await fs.promises.readFile(seenJobsFile, 'utf8'));
    return new Set(Array.isArray(document.keys) ? document.keys : []);
  } catch (error) {
    if (error.code === 'ENOENT') return new Set();
    throw error;
  }
}

async function readFavoriteJobs() {
  try {
    const document = JSON.parse(await fs.promises.readFile(favoriteJobsFile, 'utf8'));
    return new Set(Array.isArray(document.keys) ? document.keys : []);
  } catch (error) {
    if (error.code === 'ENOENT') return new Set();
    throw error;
  }
}

async function readSearchProfiles() {
  try {
    const document = JSON.parse(await fs.promises.readFile(searchProfilesFile, 'utf8'));
    return Array.isArray(document.profiles) ? document.profiles : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function normalizeProfileName(value) {
  return String(value || '').trim().toLocaleLowerCase('es');
}

function sanitizeSearchProfile(value) {
  const profile = value && typeof value === 'object' ? value : {};
  const name = String(profile.name || '').trim();
  if (!name || name.length > 60) throw new Error('El nombre del perfil no es válido');
  const safeText = (field, maximum = 1000) => String(profile[field] || '').slice(0, maximum);
  const safeNumber = (field, fallback, minimum, maximum) => {
    const number = Number(profile[field]);
    return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
  };
  return {
    name,
    search: safeText('search'),
    exclude: safeText('exclude'),
    source: safeText('source', 100),
    country: safeText('country', 100),
    language: safeText('language', 30),
    skill: safeText('skill', 1000),
    type: safeText('type', 30),
    sort: safeText('sort', 30) || 'newest',
    minPrice: safeNumber('minPrice', 0, 0, 1000),
    maxPrice: safeNumber('maxPrice', 1000, 0, 1000),
    date: safeNumber('date', 42, 1, 42),
    showSeen: Boolean(profile.showSeen),
    favoritesOnly: Boolean(profile.favoritesOnly),
  };
}

let searchProfilesWriteQueue = Promise.resolve();
function saveSearchProfile(response, request) {
  readJsonBody(request).then(body => {
    const profile = sanitizeSearchProfile(body.profile);
    searchProfilesWriteQueue = searchProfilesWriteQueue.catch(() => {}).then(async () => {
      const profiles = await readSearchProfiles();
      const existingIndex = profiles.findIndex(item => normalizeProfileName(item.name) === normalizeProfileName(profile.name));
      if (existingIndex >= 0) profile.name = profiles[existingIndex].name;
      if (existingIndex >= 0) profiles[existingIndex] = profile;
      else profiles.push(profile);
      profiles.sort((a, b) => a.name.localeCompare(b.name, 'es'));
      const document = { updated_at: new Date().toISOString(), profiles };
      const temporaryFile = `${searchProfilesFile}.tmp`;
      await fs.promises.writeFile(temporaryFile, `${JSON.stringify(document, null, 2)}\n`);
      await fs.promises.rename(temporaryFile, searchProfilesFile);
      return { profile, profiles, created: existingIndex < 0 };
    });
    searchProfilesWriteQueue.then(result => sendJson(response, 200, result))
      .catch(error => sendJson(response, 500, { error: error.message }));
  }).catch(error => sendJson(response, 400, { error: error.message }));
}

function deleteSearchProfile(response, request) {
  readJsonBody(request).then(body => {
    const name = String(body.name || '').trim();
    if (!name || name.length > 60) throw new Error('El nombre del perfil no es válido');
    searchProfilesWriteQueue = searchProfilesWriteQueue.catch(() => {}).then(async () => {
      const profiles = (await readSearchProfiles())
        .filter(profile => normalizeProfileName(profile.name) !== normalizeProfileName(name));
      const document = { updated_at: new Date().toISOString(), profiles };
      const temporaryFile = `${searchProfilesFile}.tmp`;
      await fs.promises.writeFile(temporaryFile, `${JSON.stringify(document, null, 2)}\n`);
      await fs.promises.rename(temporaryFile, searchProfilesFile);
      return profiles;
    });
    searchProfilesWriteQueue.then(profiles => sendJson(response, 200, { profiles }))
      .catch(error => sendJson(response, 500, { error: error.message }));
  }).catch(error => sendJson(response, 400, { error: error.message }));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => {
      body += chunk;
      if (body.length > 16 * 1024) {
        reject(new Error('Petición demasiado grande'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(new Error('JSON inválido')); }
    });
    request.on('error', reject);
  });
}

let seenWriteQueue = Promise.resolve();
function updateSeenJob(response, request) {
  readJsonBody(request).then(body => {
    if (typeof body.key !== 'string' || !body.key || body.key.length > 1000 || typeof body.seen !== 'boolean') {
      sendJson(response, 400, { error: 'Datos de visto inválidos' });
      return;
    }
    seenWriteQueue = seenWriteQueue.catch(() => {}).then(async () => {
      const seenJobs = await readSeenJobs();
      if (body.seen) seenJobs.add(body.key);
      else seenJobs.delete(body.key);
      const document = {
        updated_at: new Date().toISOString(),
        keys: [...seenJobs].sort(),
      };
      const temporaryFile = `${seenJobsFile}.tmp`;
      await fs.promises.writeFile(temporaryFile, `${JSON.stringify(document, null, 2)}\n`);
      await fs.promises.rename(temporaryFile, seenJobsFile);
      return seenJobs.size;
    });
    seenWriteQueue.then(count => sendJson(response, 200, { key: body.key, seen: body.seen, count }))
      .catch(error => sendJson(response, 500, { error: error.message }));
  }).catch(error => sendJson(response, 400, { error: error.message }));
}

let favoriteWriteQueue = Promise.resolve();
function updateFavoriteJob(response, request) {
  readJsonBody(request).then(body => {
    if (typeof body.key !== 'string' || !body.key || body.key.length > 1000 || typeof body.favorite !== 'boolean') {
      sendJson(response, 400, { error: 'Datos de favorito inválidos' });
      return;
    }
    favoriteWriteQueue = favoriteWriteQueue.catch(() => {}).then(async () => {
      const favoriteJobs = await readFavoriteJobs();
      if (body.favorite) favoriteJobs.add(body.key);
      else favoriteJobs.delete(body.key);
      const document = {
        updated_at: new Date().toISOString(),
        keys: [...favoriteJobs].sort(),
      };
      const temporaryFile = `${favoriteJobsFile}.tmp`;
      await fs.promises.writeFile(temporaryFile, `${JSON.stringify(document, null, 2)}\n`);
      await fs.promises.rename(temporaryFile, favoriteJobsFile);
      return favoriteJobs.size;
    });
    favoriteWriteQueue.then(count => sendJson(response, 200, { key: body.key, favorite: body.favorite, count }))
      .catch(error => sendJson(response, 500, { error: error.message }));
  }).catch(error => sendJson(response, 400, { error: error.message }));
}

function sendCombinedJobs(response) {
  Promise.all([
    fs.promises.readFile(dataFile, 'utf8').then(JSON.parse).catch(error => {
      if (error.code === 'ENOENT') return { jobs: [], unique_records: 0, scraped_at: null };
      throw error;
    }),
    fs.promises.readFile(freelancerDataFile, 'utf8').then(JSON.parse).catch(error => {
      if (error.code === 'ENOENT') return { jobs: [], unique_records: 0, scraped_at: null };
      throw error;
    }),
    fs.promises.readFile(soyfreelancerDataFile, 'utf8').then(JSON.parse).catch(error => {
      if (error.code === 'ENOENT') return { jobs: [], unique_records: 0, scraped_at: null };
      throw error;
    }),
    readSeenJobs(),
    readFavoriteJobs(),
  ]).then(([workana, freelancer, soyfreelancer, seenJobs, favoriteJobs]) => {
    const workanaJobs = (workana.jobs || []).map(job => ({
      ...job,
      source: job.source || 'Workana',
      source_id: job.source_id || job.slug || '',
      published_at: workanaPublishedAt(job, workana.scraped_at),
    })).map(job => ({ ...job, job_key: jobKey(job), seen: seenJobs.has(jobKey(job)), favorite: favoriteJobs.has(jobKey(job)) }));
    const freelancerJobs = (freelancer.jobs || []).map(job => ({
      ...job,
      source: 'Freelancer',
      published_at: job.published_at || job.published_date || null,
    })).map(job => ({ ...job, job_key: jobKey(job), seen: seenJobs.has(jobKey(job)), favorite: favoriteJobs.has(jobKey(job)) }));
    const soyfreelancerJobs = (soyfreelancer.jobs || []).map(job => ({
      ...job,
      source: 'SoyFreelancer',
      published_at: job.published_at || job.published_date || null,
    })).map(job => ({ ...job, job_key: jobKey(job), seen: seenJobs.has(jobKey(job)), favorite: favoriteJobs.has(jobKey(job)) }));
    const dates = [workana.scraped_at, freelancer.scraped_at, soyfreelancer.scraped_at].filter(Boolean).sort();
    sendJson(response, 200, {
      scraped_at: dates.at(-1) || null,
      unique_records: workanaJobs.length + freelancerJobs.length + soyfreelancerJobs.length,
      sources: {
        Workana: { count: workanaJobs.length, scraped_at: workana.scraped_at },
        Freelancer: { count: freelancerJobs.length, scraped_at: freelancer.scraped_at },
        SoyFreelancer: { count: soyfreelancerJobs.length, scraped_at: soyfreelancer.scraped_at },
      },
      jobs: [...workanaJobs, ...freelancerJobs, ...soyfreelancerJobs],
    });
  }).catch(error => sendJson(response, 500, { error: error.message }));
}

function startRefresh(response, target) {
  if (refreshState.running) {
    sendJson(response, 409, refreshState);
    return;
  }
  const scraperFile = scrapers[target];
  if (!scraperFile) {
    sendJson(response, 404, { error: 'Fuente desconocida' });
    return;
  }
  const sourceName = { workana: 'Workana', freelancer: 'Freelancer', soyfreelancer: 'SoyFreelancer' }[target];

  Object.assign(refreshState, {
    running: true,
    target,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    message: `Iniciando actualización de ${sourceName}…`,
    error: null,
  });

  const child = spawn(process.execPath, [scraperFile], {
    cwd: path.dirname(scraperFile),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  const timeout = setTimeout(() => {
    refreshState.message = 'La actualización superó el tiempo máximo';
    child.kill('SIGTERM');
  }, 10 * 60 * 1000);

  child.stdout.on('data', chunk => { stdout += chunk.toString(); });
  child.stderr.on('data', chunk => {
    stderr += chunk.toString();
    const lines = stderr.trim().split('\n');
    refreshState.message = lines.at(-1) || 'Extrayendo…';
  });
  child.on('error', error => {
    clearTimeout(timeout);
    Object.assign(refreshState, {
      running: false,
      target,
      finishedAt: new Date().toISOString(),
      message: 'No se pudo iniciar el scraper',
      error: error.message,
    });
  });
  child.on('close', code => {
    clearTimeout(timeout);
    let summary = null;
    try { summary = JSON.parse(stdout); } catch {}
    const finishedAt = new Date();
    const finishedParts = Object.fromEntries(new Intl.DateTimeFormat('es-ES', {
      timeZone: 'Europe/Madrid',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(finishedAt).map(part => [part.type, part.value]));
    const formattedFinishedAt = `${finishedParts.day}/${finishedParts.month}/${finishedParts.year} ${finishedParts.hour}:${finishedParts.minute}`;
    Object.assign(refreshState, {
      running: false,
      target,
      finishedAt: finishedAt.toISOString(),
      message: code === 0
        ? `${sourceName} actualizado: ${Number(summary?.unique_records).toLocaleString('es-ES')} trabajos únicos · ${formattedFinishedAt}`
        : 'La actualización terminó con errores',
      error: code === 0 ? null : (
        stderr.trim().split('\n').find(line => /Error|ENOENT|failed|timeout/i.test(line))
        || stderr.trim().split('\n').at(-1)
        || `Código de salida ${code}`
      ),
    });
  });

  sendJson(response, 202, refreshState);
}

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname;
  if (pathname === '/api/jobs') {
    if (request.method !== 'GET') return sendJson(response, 405, { error: 'Método no permitido' });
    sendCombinedJobs(response);
    return;
  }
  if (pathname === '/api/jobs/seen') {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'Método no permitido' });
    updateSeenJob(response, request);
    return;
  }
  if (pathname === '/api/jobs/favorite') {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'Método no permitido' });
    updateFavoriteJob(response, request);
    return;
  }
  if (pathname === '/api/search-profiles') {
    if (request.method !== 'GET') return sendJson(response, 405, { error: 'Método no permitido' });
    readSearchProfiles()
      .then(profiles => sendJson(response, 200, { profiles }))
      .catch(error => sendJson(response, 500, { error: error.message }));
    return;
  }
  if (pathname === '/api/search-profiles/save') {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'Método no permitido' });
    saveSearchProfile(response, request);
    return;
  }
  if (pathname === '/api/search-profiles/delete') {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'Método no permitido' });
    deleteSearchProfile(response, request);
    return;
  }
  if (pathname === '/api/refresh-status') {
    if (request.method !== 'GET') return sendJson(response, 405, { error: 'Método no permitido' });
    sendJson(response, 200, refreshState);
    return;
  }
  if (pathname.startsWith('/api/refresh/')) {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'Método no permitido' });
    startRefresh(response, pathname.slice('/api/refresh/'.length));
    return;
  }
  const route = routes.get(pathname);
  if (!route) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }
  sendFile(response, path.join(root, route[0]), route[1]);
});

server.listen(port, host, () => {
  console.log('Proyectos Freelancer iniciado correctamente.');
});
