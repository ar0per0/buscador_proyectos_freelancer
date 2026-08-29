const state = { jobs: [], filtered: [], page: 1, pageSize: 16, priceRangeMax: 0, detailJob: null, searchProfiles: [], languageOptions: [], skillOptions: [], selectedSkills: [] };
const elements = Object.fromEntries([
  'totalJobs', 'workanaCount', 'freelancerCount', 'soyfreelancerCount', 'freelancerUpdated', 'workanaUpdated', 'soyfreelancerUpdated',
  'searchInput', 'excludeInput', 'sourceFilter', 'countryFilter', 'countryOptions', 'countryHint', 'languageFilter', 'languageOptions', 'skillFilter', 'skillOptions', 'selectedSkills', 'minPriceFilter', 'maxPriceFilter', 'minPriceValue', 'maxPriceValue', 'priceRangeTrack', 'typeFilter', 'dateFilter', 'dateFilterValue', 'dateRangeTrack', 'sortOrder', 'showSeenFilter', 'favoritesOnlyFilter',
  'profileName', 'profileSelect', 'saveProfile', 'deleteProfile', 'profileStatus',
  'filterToggle', 'filtersContent', 'advancedFiltersIndicator', 'clearFilters', 'loading', 'error', 'jobGrid', 'pagination', 'previousPage',
  'nextPage', 'pageInfo', 'resultsSummary', 'jobDialog', 'closeDialog', 'dialogContent', 'dialogExternalLink', 'dialogSeenToggle', 'dialogFavoriteToggle',
  'refreshWorkana', 'refreshFreelancer', 'refreshSoyfreelancer', 'refreshStatus'
].map(id => [id, document.getElementById(id)]));

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
})[character]);
const normalizeText = value => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('es');

function readSearchProfiles() {
  return [...state.searchProfiles];
}

function renderSearchProfiles(selectedName = '') {
  const profiles = readSearchProfiles().sort((a, b) => a.name.localeCompare(b.name, 'es'));
  elements.profileSelect.innerHTML = '<option value="">Selecciona un perfil…</option>'
    + profiles.map(profile => `<option value="${escapeHtml(profile.name)}">${escapeHtml(profile.name)}</option>`).join('');
  elements.profileSelect.value = profiles.some(profile => profile.name === selectedName) ? selectedName : '';
  const hasSelection = Boolean(elements.profileSelect.value);
  elements.deleteProfile.disabled = !hasSelection;
}

async function loadSearchProfiles() {
  try {
    const response = await fetch('/api/search-profiles', { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Error HTTP ${response.status}`);
    state.searchProfiles = Array.isArray(result.profiles) ? result.profiles : [];
    renderSearchProfiles();
  } catch (error) {
    elements.profileStatus.textContent = `No se pudieron cargar los perfiles: ${error.message}`;
  }
}

function currentSearchProfile(name) {
  return {
    name,
    search: elements.searchInput.value,
    exclude: elements.excludeInput.value,
    source: elements.sourceFilter.value,
    country: elements.countryFilter.value,
    language: elements.languageFilter.value,
    skill: state.selectedSkills.join(', '),
    type: elements.typeFilter.value,
    sort: elements.sortOrder.value,
    minPrice: Number(elements.minPriceFilter.value),
    maxPrice: Number(elements.maxPriceFilter.value),
    date: Number(elements.dateFilter.value),
    showSeen: elements.showSeenFilter.checked,
    favoritesOnly: elements.favoritesOnlyFilter.checked,
  };
}

function applySearchProfile(profile) {
  elements.searchInput.value = profile.search || '';
  elements.excludeInput.value = profile.exclude || '';
  elements.sourceFilter.value = profile.source || '';
  populateCountries();
  elements.countryFilter.value = profile.country || '';
  elements.languageFilter.value = profile.language || '';
  state.selectedSkills = String(profile.skill || '').split(',').map(value => value.trim()).filter(Boolean);
  elements.skillFilter.value = '';
  renderSelectedSkills();
  updateSkillSuggestions();
  elements.typeFilter.value = profile.type || '';
  elements.sortOrder.value = profile.sort || 'newest';
  elements.minPriceFilter.value = String(Math.max(0, Math.min(priceSliderSteps, Number(profile.minPrice) || 0)));
  elements.maxPriceFilter.value = String(Math.max(0, Math.min(priceSliderSteps, Number.isFinite(Number(profile.maxPrice)) ? Number(profile.maxPrice) : priceSliderSteps)));
  elements.dateFilter.value = String(Math.max(1, Math.min(dateAnyValue, Number(profile.date) || dateAnyValue)));
  elements.showSeenFilter.checked = Boolean(profile.showSeen);
  elements.favoritesOnlyFilter.checked = Boolean(profile.favoritesOnly);
  updatePriceRange();
  updateDateRange();
  applyFilters();
}

function formatDate(value) {
  if (!value) return 'Fecha desconocida';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Fecha desconocida';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}

function renderSourceMeta(sources) {
  const sourceToElement = {
    Freelancer: elements.freelancerUpdated,
    Workana: elements.workanaUpdated,
    SoyFreelancer: elements.soyfreelancerUpdated,
  };
  for (const [sourceName, target] of Object.entries(sourceToElement)) {
    const updatedAt = sources?.[sourceName]?.scraped_at;
    target.textContent = updatedAt ? `Actualizado ${formatDate(updatedAt)}` : 'Sin actualizar';
  }
}

function populateCountries() {
  const selectedSource = elements.sourceFilter.value;
  const relevantJobs = selectedSource
    ? state.jobs.filter(job => job.source === selectedSource)
    : state.jobs;
  const countries = [...new Set(relevantJobs.flatMap(job => jobCountries(job)))]
    .sort((a, b) => a.localeCompare(b, 'es'));
  elements.countryOptions.innerHTML = countries.map(country =>
    `<option value="${escapeHtml(country)}"></option>`
  ).join('');
  const freelancerSelected = selectedSource === 'Freelancer';
  elements.countryFilter.disabled = freelancerSelected;
  elements.countryHint.textContent = freelancerSelected
    ? 'Freelancer no facilita el país del cliente en su API pública.'
    : selectedSource === ''
      ? 'Workana y SoyFreelancer publican países; Freelancer no facilita este dato.'
      : '';
}

function jobCountries(job) {
  if (Array.isArray(job.countries) && job.countries.length) return job.countries.filter(Boolean);
  return job.country ? [job.country] : [];
}

function populateSources() {
  const sources = [...new Set(state.jobs.map(job => job.source).filter(Boolean))].sort();
  elements.sourceFilter.innerHTML = '<option value="">Todas las plataformas</option>'
    + sources.map(source => `<option value="${escapeHtml(source)}">${escapeHtml(source)}</option>`).join('');
}

function populateLanguages() {
  const displayNames = typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames(['es'], { type: 'language' })
    : null;
  state.languageOptions = [...new Set(state.jobs.map(job => job.language).filter(Boolean))]
    .map(code => ({
      code,
      name: displayNames?.of(code) || code.toLocaleUpperCase('es'),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  elements.languageOptions.innerHTML = state.languageOptions.map(language =>
    `<option value="${escapeHtml(language.name)}" label="${escapeHtml(language.code.toLocaleUpperCase('es'))}"></option>`
  ).join('');
}

function populateSkills() {
  const skillsByNormalizedName = new Map();
  for (const skill of state.jobs.flatMap(job => Array.isArray(job.skills) ? job.skills : [])) {
    const name = String(skill || '').trim();
    if (name && !skillsByNormalizedName.has(normalizeText(name))) {
      skillsByNormalizedName.set(normalizeText(name), name);
    }
  }
  state.skillOptions = [...skillsByNormalizedName.values()].sort((a, b) => a.localeCompare(b, 'es'));
  updateSkillSuggestions();
}

function updateSkillSuggestions() {
  const selected = new Set(state.selectedSkills.map(normalizeText));
  elements.skillOptions.innerHTML = state.skillOptions
    .filter(skill => !selected.has(normalizeText(skill)))
    .map(skill =>
    `<option value="${escapeHtml(skill)}"></option>`
  ).join('');
}

function renderSelectedSkills() {
  elements.selectedSkills.innerHTML = state.selectedSkills.map((skill, index) => `
    <span class="selected-skill">
      <span>${escapeHtml(skill)}</span>
      <button class="remove-skill" type="button" data-skill-index="${index}" aria-label="Quitar ${escapeHtml(skill)}">×</button>
    </span>
  `).join('');
}

function addSelectedSkill(value) {
  const entered = String(value || '').trim().replace(/,$/, '').trim();
  if (!entered) return false;
  const canonical = state.skillOptions.find(skill => normalizeText(skill) === normalizeText(entered)) || entered;
  if (!state.selectedSkills.some(skill => normalizeText(skill) === normalizeText(canonical))) {
    state.selectedSkills.push(canonical);
  }
  elements.skillFilter.value = '';
  renderSelectedSkills();
  updateSkillSuggestions();
  applyFilters();
  return true;
}

const priceSliderSteps = 1000;
const priceFormatter = new Intl.NumberFormat('es-ES', {
  style: 'currency', currency: 'EUR', maximumFractionDigits: 0,
});

function sliderPositionToPrice(position) {
  if (!state.priceRangeMax) return 0;
  const ratio = Number(position) / priceSliderSteps;
  return Math.round(Math.expm1(ratio * Math.log1p(state.priceRangeMax)));
}

function updatePriceRange(changedElement = null) {
  let minimumPosition = Number(elements.minPriceFilter.value);
  let maximumPosition = Number(elements.maxPriceFilter.value);
  if (minimumPosition > maximumPosition) {
    if (changedElement === elements.minPriceFilter) maximumPosition = minimumPosition;
    else minimumPosition = maximumPosition;
    elements.minPriceFilter.value = String(minimumPosition);
    elements.maxPriceFilter.value = String(maximumPosition);
  }
  elements.minPriceValue.textContent = priceFormatter.format(sliderPositionToPrice(minimumPosition));
  elements.maxPriceValue.textContent = maximumPosition === priceSliderSteps
    ? `${priceFormatter.format(state.priceRangeMax)}+`
    : priceFormatter.format(sliderPositionToPrice(maximumPosition));
  elements.priceRangeTrack.style.setProperty('--range-start', `${minimumPosition / 10}%`);
  elements.priceRangeTrack.style.setProperty('--range-end', `${maximumPosition / 10}%`);
}

function initializePriceRange() {
  state.priceRangeMax = 10000;
  elements.minPriceFilter.value = '0';
  elements.maxPriceFilter.value = String(priceSliderSteps);
  updatePriceRange();
}

const dateAnyValue = 42;
function datePositionToHours(position) {
  if (position <= 12) return position * 2;
  if (position < dateAnyValue) return (position - 11) * 24;
  return 0;
}

function updateDateRange() {
  const value = Number(elements.dateFilter.value);
  const hours = datePositionToHours(value);
  const label = value === dateAnyValue
    ? 'Cualquier fecha'
    : hours <= 24
      ? `Últimas ${hours} horas`
      : `Últimos ${hours / 24} días`;
  elements.dateFilterValue.textContent = label;
  elements.dateFilter.setAttribute('aria-valuetext', label);
  elements.dateRangeTrack.style.setProperty('--date-progress', `${((value - 1) / (dateAnyValue - 1)) * 100}%`);
}

function applyFilters() {
  const query = normalizeText(elements.searchInput.value.trim());
  const excludedQueries = elements.excludeInput.value.split(',')
    .map(value => normalizeText(value.trim()))
    .filter(Boolean);
  const source = elements.sourceFilter.value;
  const country = normalizeText(elements.countryFilter.value.trim());
  const language = normalizeText(elements.languageFilter.value.trim());
  const skills = state.selectedSkills.map(normalizeText);
  const minimumPosition = Number(elements.minPriceFilter.value);
  const maximumPosition = Number(elements.maxPriceFilter.value);
  const minimumPrice = minimumPosition === 0 ? null : sliderPositionToPrice(minimumPosition);
  const maximumPrice = maximumPosition === priceSliderSteps ? null : sliderPositionToPrice(maximumPosition);
  const type = elements.typeFilter.value;
  const dateValue = Number(elements.dateFilter.value);
  const hours = datePositionToHours(dateValue);
  const cutoff = hours ? Date.now() - hours * 60 * 60 * 1000 : 0;
  const showSeen = elements.showSeenFilter.checked;
  const favoritesOnly = elements.favoritesOnlyFilter.checked;
  state.filtered = state.jobs.filter(job => {
    const haystack = normalizeText([job.title, job.description, job.author, job.country, job.category, job.subcategory, ...jobCountries(job), ...(job.skills || [])]
      .join(' '));
    const jobMinimum = Number(job.budget_eur_min);
    const jobMaximum = job.budget_eur_max == null ? Infinity : Number(job.budget_eur_max);
    const hasNumericBudget = Number.isFinite(jobMinimum) && !Number.isNaN(jobMaximum);
    return (!query || haystack.includes(query))
      && !excludedQueries.some(excludedQuery => haystack.includes(excludedQuery))
      && (!source || job.source === source)
      && (!country || jobCountries(job).some(value => normalizeText(value).includes(country)))
      && (!language || (() => {
        const option = state.languageOptions.find(item => item.code === job.language);
        return normalizeText(job.language).includes(language) || normalizeText(option?.name).includes(language);
      })())
      && skills.every(skill => (job.skills || []).some(value => normalizeText(value).includes(skill)))
      && (minimumPrice == null || (hasNumericBudget && jobMaximum >= minimumPrice))
      && (maximumPrice == null || (hasNumericBudget && jobMinimum <= maximumPrice))
      && (!type || (type === 'hourly') === Boolean(job.hourly))
      && (!cutoff || new Date(job.published_at || job.published_date).getTime() >= cutoff)
      && (!favoritesOnly || job.favorite)
      && (showSeen || !job.seen);
  });
  const collator = new Intl.Collator('es');
  const order = elements.sortOrder.value;
  state.filtered.sort((a, b) => {
    if (order === 'title') return collator.compare(a.title, b.title);
    if (order === 'country') {
      if (!a.country && b.country) return 1;
      if (a.country && !b.country) return -1;
      return collator.compare(a.country, b.country);
    }
    if (order === 'rating') return Number(b.client_rating || 0) - Number(a.client_rating || 0);
    if (order === 'price-desc' || order === 'price-asc') {
      const priceOf = job => Number(job.budget_eur_max ?? job.budget_eur_min ?? 0);
      const difference = priceOf(a) - priceOf(b);
      return order === 'price-asc' ? difference : -difference;
    }
    const aDate = new Date(a.published_at || a.published_date).getTime() || 0;
    const bDate = new Date(b.published_at || b.published_date).getTime() || 0;
    return order === 'oldest' ? aDate - bDate : bDate - aDate;
  });
  state.page = 1;
  updateAdvancedFiltersIndicator();
  render();
}

function updateAdvancedFiltersIndicator() {
  const activeCount = [
    Boolean(elements.excludeInput.value.trim()),
    Boolean(elements.sourceFilter.value),
    Boolean(elements.countryFilter.value.trim()),
    Boolean(elements.languageFilter.value.trim()),
    state.selectedSkills.length,
    Number(elements.minPriceFilter.value) > 0 || Number(elements.maxPriceFilter.value) < priceSliderSteps,
    Boolean(elements.typeFilter.value),
    Number(elements.dateFilter.value) < dateAnyValue,
    elements.sortOrder.value !== 'newest',
  ].filter(Boolean).reduce((total, value) => total + (typeof value === 'number' ? value : 1), 0);
  elements.advancedFiltersIndicator.hidden = activeCount === 0;
  if (!activeCount) return;
  const label = `${activeCount} avanzados`;
  elements.advancedFiltersIndicator.textContent = label;
  elements.advancedFiltersIndicator.setAttribute('aria-label', `${activeCount} filtros avanzados activos. Abrir buscador y filtros.`);
}

function renderCard(job, index) {
  const skills = (job.skills || []).slice(0, 5);
  const badges = [
    job.verified_payment ? '<span class="badge">✓ Pago verificado</span>' : '',
    job.urgent ? '<span class="badge warm">Urgente</span>' : '',
    job.featured ? '<span class="badge warm">Destacado</span>' : ''
  ].join('');
  return `<article class="job-card${job.seen ? ' seen' : ''}">
    <div class="card-top">
      <span><b>${escapeHtml(job.source || 'Otra fuente')}</b> · ${escapeHtml(job.country || 'Sin país')}</span>
      <span class="card-flags">
        <button class="favorite-toggle${job.favorite ? ' is-favorite' : ''}" type="button" data-favorite-index="${index}" aria-label="${job.favorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}" aria-pressed="${job.favorite ? 'true' : 'false'}"><span aria-hidden="true">${job.favorite ? '★' : '☆'}</span></button>
        <label class="seen-toggle"><input type="checkbox" data-seen-index="${index}" ${job.seen ? 'checked' : ''}> Visto</label>
      </span>
      <span>${escapeHtml(formatDate(job.published_at || job.published_date))}</span>
    </div>
    <h2>${escapeHtml(job.title)}</h2>
    <p class="description">${escapeHtml(job.description || 'Sin descripción')}</p>
    <div class="skills">${skills.map(skill => `<button class="skill clickable-skill" type="button" data-filter-skill="${escapeHtml(skill)}" title="Añadir ${escapeHtml(skill)} al buscador">${escapeHtml(skill)}</button>`).join('')}${badges}</div>
    <div class="card-footer">
      <div><small>Presupuesto</small><div class="budget">${escapeHtml(job.budget || 'No indicado')}</div></div>
      <div class="card-actions">
        <button class="details" data-job-index="${index}">Detalles</button>
        <a class="external" href="${escapeHtml(job.url)}" target="_blank" rel="noopener noreferrer">Abrir ↗</a>
      </div>
    </div>
  </article>`;
}

function renderPageButtons(pageCount) {
  const pages = pageCount <= 7
    ? Array.from({ length: pageCount }, (_, index) => index + 1)
    : [...new Set([1, 2, state.page - 2, state.page - 1, state.page, state.page + 1, state.page + 2, pageCount - 1, pageCount]
      .filter(page => page >= 1 && page <= pageCount))].sort((a, b) => a - b);
  elements.pageInfo.replaceChildren();
  let previousPage = 0;
  for (const page of pages) {
    if (previousPage && page > previousPage + 1) {
      const gap = document.createElement('span');
      gap.className = 'page-gap';
      gap.textContent = '…';
      elements.pageInfo.append(gap);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary page-button';
    button.dataset.page = String(page);
    button.textContent = String(page);
    button.disabled = page === state.page;
    if (page === state.page) button.setAttribute('aria-current', 'page');
    elements.pageInfo.append(button);
    previousPage = page;
  }
}

function render() {
  const pageCount = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
  state.page = Math.min(state.page, pageCount);
  const start = (state.page - 1) * state.pageSize;
  const jobs = state.filtered.slice(start, start + state.pageSize);
  const hasActiveFilters = Boolean(
    elements.searchInput.value.trim()
    || elements.excludeInput.value.trim()
    || elements.sourceFilter.value
    || elements.countryFilter.value
    || elements.languageFilter.value
    || state.selectedSkills.length
    || Number(elements.minPriceFilter.value) > 0
    || Number(elements.maxPriceFilter.value) < priceSliderSteps
    || elements.typeFilter.value
    || Number(elements.dateFilter.value) < dateAnyValue
    || elements.favoritesOnlyFilter.checked
    || elements.showSeenFilter.checked
  );
  const resultLabel = state.filtered.length === 1 ? 'resultado encontrado' : 'resultados encontrados';
  elements.resultsSummary.textContent = hasActiveFilters
    ? `${state.filtered.length.toLocaleString('es')} ${resultLabel}`
    : `${state.filtered.length.toLocaleString('es')} trabajos disponibles`;
  elements.jobGrid.innerHTML = jobs.length
    ? jobs.map((job, offset) => renderCard(job, start + offset)).join('')
    : '<div class="state">No hay trabajos que coincidan con los filtros.</div>';
  elements.pagination.hidden = state.filtered.length <= state.pageSize;
  elements.previousPage.disabled = state.page === 1;
  elements.nextPage.disabled = state.page === pageCount;
  renderPageButtons(pageCount);
}

function showDetails(job) {
  state.detailJob = job;
  elements.dialogContent.innerHTML = `
    <p class="eyebrow">${escapeHtml(job.country || 'Sin país')}</p>
    <h2 class="dialog-title">${escapeHtml(job.title)}</h2>
    <div class="skills">${(job.skills || []).map(skill => `<button class="skill clickable-skill" type="button" data-filter-skill="${escapeHtml(skill)}" title="Añadir ${escapeHtml(skill)} al buscador">${escapeHtml(skill)}</button>`).join('')}</div>
    <div class="detail-list">
      <div><small>Presupuesto</small><strong>${escapeHtml(job.budget || 'No indicado')}</strong></div>
      <div><small>Propuestas</small><strong>${escapeHtml(job.proposals || 'No indicado')}</strong></div>
      <div><small>Publicado</small><strong>${escapeHtml(formatDate(job.published_at || job.published_date))}</strong></div>
    </div>
    <p class="dialog-description">${escapeHtml(job.description || 'Sin descripción')}</p>`;
  elements.dialogExternalLink.href = job.url || '#';
  elements.dialogExternalLink.textContent = `Ver anuncio en ${job.source || 'la plataforma'} ↗`;
  elements.dialogExternalLink.hidden = !job.url;
  elements.dialogSeenToggle.checked = Boolean(job.seen);
  elements.dialogSeenToggle.disabled = false;
  elements.dialogFavoriteToggle.classList.toggle('is-favorite', Boolean(job.favorite));
  elements.dialogFavoriteToggle.setAttribute('aria-pressed', String(Boolean(job.favorite)));
  elements.dialogFavoriteToggle.setAttribute('aria-label', job.favorite ? 'Quitar de favoritos' : 'Añadir a favoritos');
  elements.dialogFavoriteToggle.querySelector('span').textContent = job.favorite ? '★' : '☆';
  elements.dialogFavoriteToggle.disabled = false;
  elements.jobDialog.showModal();
}

async function setJobSeen(job, nextSeen, input) {
  input.disabled = true;
  try {
    const response = await fetch('/api/jobs/seen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: job.job_key, seen: nextSeen }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Error HTTP ${response.status}`);
    job.seen = nextSeen;
    if (state.detailJob === job) elements.dialogSeenToggle.checked = nextSeen;
    applyFilters();
  } catch (error) {
    input.checked = !nextSeen;
    if (state.detailJob === job) elements.dialogSeenToggle.checked = !nextSeen;
    elements.refreshStatus.textContent = `No se pudo guardar como visto: ${error.message}`;
  } finally {
    input.disabled = false;
  }
}

async function setJobFavorite(job, nextFavorite, button) {
  button.disabled = true;
  try {
    const response = await fetch('/api/jobs/favorite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: job.job_key, favorite: nextFavorite }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Error HTTP ${response.status}`);
    job.favorite = nextFavorite;
    if (state.detailJob === job) {
      elements.dialogFavoriteToggle.classList.toggle('is-favorite', nextFavorite);
      elements.dialogFavoriteToggle.setAttribute('aria-pressed', String(nextFavorite));
      elements.dialogFavoriteToggle.setAttribute('aria-label', nextFavorite ? 'Quitar de favoritos' : 'Añadir a favoritos');
      elements.dialogFavoriteToggle.querySelector('span').textContent = nextFavorite ? '★' : '☆';
    }
    applyFilters();
  } catch (error) {
    elements.refreshStatus.textContent = `No se pudo guardar el favorito: ${error.message}`;
  } finally {
    button.disabled = false;
  }
}

async function load() {
  try {
    const response = await fetch('/api/jobs', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Error HTTP ${response.status}`);
    const data = await response.json();
    state.jobs = data.jobs || [];
    state.filtered = [...state.jobs];
    elements.totalJobs.textContent = state.jobs.length.toLocaleString('es');
    elements.workanaCount.textContent = (data.sources?.Workana?.count || 0).toLocaleString('es');
    elements.freelancerCount.textContent = (data.sources?.Freelancer?.count || 0).toLocaleString('es');
    elements.soyfreelancerCount.textContent = (data.sources?.SoyFreelancer?.count || 0).toLocaleString('es');
    renderSourceMeta(data.sources);
    populateSources();
    populateCountries();
    populateLanguages();
    populateSkills();
    initializePriceRange();
    updateDateRange();
    elements.loading.hidden = true;
    applyFilters();
  } catch (error) {
    elements.loading.hidden = true;
    elements.error.hidden = false;
    elements.error.textContent = `No se pudieron cargar los registros: ${error.message}`;
  }
}

let refreshPoller;
const refreshButtons = [elements.refreshWorkana, elements.refreshFreelancer, elements.refreshSoyfreelancer];
function setRefreshButtons(running, target = null) {
  const buttonTargets = new Map([
    [elements.refreshWorkana, 'workana'],
    [elements.refreshFreelancer, 'freelancer'],
    [elements.refreshSoyfreelancer, 'soyfreelancer'],
  ]);
  refreshButtons.forEach(button => {
    const isUpdating = running && buttonTargets.get(button) === target;
    const label = button.querySelector('span:last-child');
    button.disabled = running;
    button.classList.toggle('is-updating', isUpdating);
    if (isUpdating) {
      if (!button.dataset.previousLabel) button.dataset.previousLabel = label.textContent;
      label.textContent = 'Actualizando…';
    } else if (!running && button.dataset.previousLabel) {
      label.textContent = button.dataset.previousLabel;
      delete button.dataset.previousLabel;
    }
  });
}

async function checkRefreshStatus() {
  const response = await fetch('/api/refresh-status', { cache: 'no-store' });
  const status = await response.json();
  setRefreshButtons(status.running, status.target);
  if (status.running) {
    elements.refreshStatus.textContent = status.message || '';
    clearTimeout(refreshPoller);
    refreshPoller = setTimeout(checkRefreshStatus, 1500);
  } else if (status.finishedAt && !status.error) {
    await load();
    elements.refreshStatus.textContent = '';
  } else if (status.error) {
    elements.refreshStatus.textContent = status.message || status.error;
  } else {
    elements.refreshStatus.textContent = '';
  }
}

async function refreshScraping(target) {
  setRefreshButtons(true, target);
  elements.refreshStatus.textContent = 'Solicitando actualización…';
  try {
    const response = await fetch(`/api/refresh/${target}`, { method: 'POST' });
    const status = await response.json();
    if (!response.ok && response.status !== 409) throw new Error(status.error || `Error HTTP ${response.status}`);
    elements.refreshStatus.textContent = status.message;
    clearTimeout(refreshPoller);
    refreshPoller = setTimeout(checkRefreshStatus, 1000);
  } catch (error) {
    setRefreshButtons(false);
    elements.refreshStatus.textContent = `Error: ${error.message}`;
  }
}

let debounceTimer;
elements.searchInput.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(applyFilters, 180);
});
elements.excludeInput.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(applyFilters, 180);
});
elements.sourceFilter.addEventListener('change', () => {
  elements.countryFilter.value = '';
  populateCountries();
  applyFilters();
});
[elements.typeFilter, elements.sortOrder, elements.showSeenFilter, elements.favoritesOnlyFilter]
  .forEach(element => element.addEventListener('change', applyFilters));
[elements.countryFilter, elements.languageFilter].forEach(element => {
  element.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(applyFilters, 180);
  });
  element.addEventListener('change', applyFilters);
});
elements.skillFilter.addEventListener('change', () => {
  const option = state.skillOptions.find(skill => normalizeText(skill) === normalizeText(elements.skillFilter.value));
  if (option) addSelectedSkill(option);
});
elements.skillFilter.addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ',') {
    event.preventDefault();
    addSelectedSkill(elements.skillFilter.value);
  }
});
elements.selectedSkills.addEventListener('click', event => {
  const button = event.target.closest('[data-skill-index]');
  if (!button) return;
  state.selectedSkills.splice(Number(button.dataset.skillIndex), 1);
  renderSelectedSkills();
  updateSkillSuggestions();
  applyFilters();
});
[elements.minPriceFilter, elements.maxPriceFilter].forEach(element => {
  element.addEventListener('input', () => {
    updatePriceRange(element);
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(applyFilters, 180);
  });
});
elements.dateFilter.addEventListener('input', () => {
  updateDateRange();
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(applyFilters, 120);
});
elements.profileSelect.addEventListener('change', () => {
  const profile = readSearchProfiles().find(item => item.name === elements.profileSelect.value);
  elements.deleteProfile.disabled = !profile;
  if (!profile) {
    elements.profileStatus.textContent = '';
    return;
  }
  applySearchProfile(profile);
  elements.profileName.value = profile.name;
  elements.profileStatus.textContent = `Perfil «${profile.name}» aplicado.`;
});
elements.saveProfile.addEventListener('click', async () => {
  const name = elements.profileName.value.trim();
  if (!name) {
    elements.profileStatus.textContent = 'Escribe un nombre para guardar el perfil.';
    elements.profileName.focus();
    return;
  }
  elements.saveProfile.disabled = true;
  try {
    const profiles = readSearchProfiles();
    const existingIndex = profiles.findIndex(profile => normalizeText(profile.name) === normalizeText(name));
    const profile = currentSearchProfile(existingIndex >= 0 ? profiles[existingIndex].name : name);
    const response = await fetch('/api/search-profiles/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Error HTTP ${response.status}`);
    state.searchProfiles = Array.isArray(result.profiles) ? result.profiles : [];
    renderSearchProfiles(result.profile.name);
    elements.profileName.value = result.profile.name;
    elements.profileStatus.textContent = result.created
      ? `Perfil «${result.profile.name}» guardado.`
      : `Perfil «${result.profile.name}» actualizado.`;
  } catch (error) {
    elements.profileStatus.textContent = `No se pudo guardar el perfil: ${error.message}`;
  } finally {
    elements.saveProfile.disabled = false;
  }
});
elements.deleteProfile.addEventListener('click', async () => {
  const selectedName = elements.profileSelect.value;
  if (!selectedName) return;
  elements.deleteProfile.disabled = true;
  try {
    const response = await fetch('/api/search-profiles/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: selectedName }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Error HTTP ${response.status}`);
    state.searchProfiles = Array.isArray(result.profiles) ? result.profiles : [];
    renderSearchProfiles();
    if (elements.profileName.value === selectedName) elements.profileName.value = '';
    elements.profileStatus.textContent = `Perfil «${selectedName}» eliminado.`;
  } catch (error) {
    elements.profileStatus.textContent = `No se pudo eliminar el perfil: ${error.message}`;
    elements.deleteProfile.disabled = false;
  }
});
elements.profileName.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    elements.saveProfile.click();
  }
});
elements.clearFilters.addEventListener('click', () => {
  elements.searchInput.value = '';
  elements.excludeInput.value = '';
  elements.sourceFilter.value = '';
  elements.countryFilter.value = '';
  elements.languageFilter.value = '';
  state.selectedSkills = [];
  elements.skillFilter.value = '';
  renderSelectedSkills();
  updateSkillSuggestions();
  elements.minPriceFilter.value = '0';
  elements.maxPriceFilter.value = String(priceSliderSteps);
  elements.typeFilter.value = '';
  elements.dateFilter.value = String(dateAnyValue);
  elements.sortOrder.value = 'newest';
  elements.showSeenFilter.checked = false;
  elements.favoritesOnlyFilter.checked = false;
  updatePriceRange();
  updateDateRange();
  populateCountries();
  applyFilters();
});
elements.filterToggle.addEventListener('click', () => {
  const collapsed = elements.filterToggle.getAttribute('aria-expanded') === 'true';
  elements.filterToggle.setAttribute('aria-expanded', String(!collapsed));
  elements.filterToggle.classList.toggle('is-collapsed', collapsed);
  elements.filtersContent.hidden = collapsed;
});
elements.advancedFiltersIndicator.addEventListener('click', () => {
  if (elements.filterToggle.getAttribute('aria-expanded') !== 'true') elements.filterToggle.click();
  elements.filtersContent.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});
elements.previousPage.addEventListener('click', () => { state.page--; render(); window.scrollTo({ top: 320, behavior: 'smooth' }); });
elements.nextPage.addEventListener('click', () => { state.page++; render(); window.scrollTo({ top: 320, behavior: 'smooth' }); });
elements.pageInfo.addEventListener('click', event => {
  const button = event.target.closest('[data-page]');
  if (!button) return;
  state.page = Number(button.dataset.page);
  render();
  window.scrollTo({ top: 320, behavior: 'smooth' });
});
elements.jobGrid.addEventListener('click', event => {
  const skillButton = event.target.closest('[data-filter-skill]');
  if (skillButton) {
    addSelectedSkill(skillButton.dataset.filterSkill);
    return;
  }
  const favoriteButton = event.target.closest('[data-favorite-index]');
  if (favoriteButton) {
    const job = state.filtered[Number(favoriteButton.dataset.favoriteIndex)];
    setJobFavorite(job, !job.favorite, favoriteButton);
    return;
  }
  const button = event.target.closest('[data-job-index]');
  if (button) showDetails(state.filtered[Number(button.dataset.jobIndex)]);
});
elements.dialogContent.addEventListener('click', event => {
  const skillButton = event.target.closest('[data-filter-skill]');
  if (skillButton) addSelectedSkill(skillButton.dataset.filterSkill);
});
elements.jobGrid.addEventListener('change', async event => {
  const input = event.target.closest('[data-seen-index]');
  if (!input) return;
  const job = state.filtered[Number(input.dataset.seenIndex)];
  setJobSeen(job, input.checked, input);
});
elements.dialogSeenToggle.addEventListener('change', event => {
  if (state.detailJob) setJobSeen(state.detailJob, event.target.checked, event.target);
});
elements.dialogFavoriteToggle.addEventListener('click', event => {
  if (state.detailJob) setJobFavorite(state.detailJob, !state.detailJob.favorite, event.currentTarget);
});
elements.closeDialog.addEventListener('click', () => elements.jobDialog.close());
elements.jobDialog.addEventListener('click', event => {
  if (event.target === elements.jobDialog) elements.jobDialog.close();
});
elements.jobDialog.addEventListener('close', () => { state.detailJob = null; });
elements.refreshWorkana.addEventListener('click', () => refreshScraping('workana'));
elements.refreshFreelancer.addEventListener('click', () => refreshScraping('freelancer'));
elements.refreshSoyfreelancer.addEventListener('click', () => refreshScraping('soyfreelancer'));

loadSearchProfiles();
load();
checkRefreshStatus().catch(() => {});
