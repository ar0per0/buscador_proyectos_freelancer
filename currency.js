const ratesEndpoint = 'https://api.frankfurter.dev/v1/latest?base=EUR';

async function fetchEuroRates() {
  const response = await fetch(ratesEndpoint, {
    headers: { Accept: 'application/json', 'User-Agent': 'FreelancerLocalPanel/1.0' },
  });
  if (!response.ok) throw new Error(`No se pudieron consultar los tipos de cambio: HTTP ${response.status}`);
  const payload = await response.json();
  return {
    date: payload.date,
    source: ratesEndpoint,
    rates: { EUR: 1, ...(payload.rates || {}) },
  };
}

function toEuros(amount, currencyCode, rates) {
  const rate = Number(rates[currencyCode]);
  if (!Number.isFinite(amount) || !Number.isFinite(rate) || rate <= 0) return null;
  return Math.round(amount / rate);
}

function formatEuros(amount) {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function euroBudgetFromValues(minimum, maximum, currencyCode, hourly, rates) {
  const { minimum: convertedMinimum, maximum: convertedMaximum } = euroBudgetValues(
    minimum, maximum, currencyCode, rates,
  );
  if (convertedMinimum == null && convertedMaximum == null) return 'No indicado';
  const range = convertedMaximum == null || minimum === maximum
    ? formatEuros(convertedMinimum)
    : `${formatEuros(convertedMinimum)} - ${formatEuros(convertedMaximum)}`;
  return `${range}${hourly ? ' / hora' : ''}`;
}

function euroBudgetValues(minimum, maximum, currencyCode, rates) {
  return {
    minimum: minimum == null ? null : toEuros(Number(minimum), currencyCode, rates),
    maximum: maximum == null ? null : toEuros(Number(maximum), currencyCode, rates),
  };
}

function parseLocalizedNumber(value) {
  const text = String(value);
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(text)) {
    return Number(text.replaceAll('.', '').replace(',', '.'));
  }
  return Number(text.replace(',', '.'));
}

function convertBudgetText(text, rates) {
  return budgetValuesFromText(text, rates).label;
}

function budgetValuesFromText(text, rates) {
  const original = String(text || '').trim();
  const currencyCode = original.match(/\b[A-Z]{3}\b/)?.[0];
  if (!original || !currencyCode || !rates[currencyCode]) {
    return { label: original || 'No indicado', minimum: null, maximum: null };
  }
  const amounts = [...original.matchAll(/\d+(?:[.,]\d+)*/g)]
    .map(match => parseLocalizedNumber(match[0]))
    .filter(Number.isFinite)
    .map(amount => toEuros(amount, currencyCode, rates));
  if (!amounts.length || amounts.some(amount => amount == null)) {
    return { label: original, minimum: null, maximum: null };
  }
  const isLessThan = /^Menos de\b/i.test(original);
  const isMoreThan = /^M[aá]s de\b/i.test(original);
  const qualifier = isLessThan ? 'Menos de ' : isMoreThan ? 'Más de ' : '';
  const range = amounts.map(formatEuros).join(' - ');
  return {
    label: `${qualifier}${range}${/\/\s*hora/i.test(original) ? ' / hora' : ''}`,
    minimum: isLessThan ? 0 : amounts[0],
    maximum: isMoreThan ? null : (amounts[1] ?? amounts[0]),
  };
}

module.exports = {
  budgetValuesFromText,
  convertBudgetText,
  euroBudgetFromValues,
  euroBudgetValues,
  fetchEuroRates,
};
