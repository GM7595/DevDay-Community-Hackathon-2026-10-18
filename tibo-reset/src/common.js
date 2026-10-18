export class AppError extends Error {}

export function iso(value, label = 'date') {
  if (!(value instanceof Date) && (typeof value !== 'string' || !value.trim())) {
    throw new AppError(`Invalid ${label}.`);
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new AppError(`Invalid ${label}.`);
  return date.toISOString();
}

export function integer(value, label, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new AppError(`${label} must be an integer from ${min} to ${max}.`);
  }
  return number;
}

export function handle(value) {
  const name = String(value).replace(/^@/, '');
  if (!/^[a-zA-Z0-9_]{1,15}$/.test(name)) throw new AppError('Invalid X username.');
  return name;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
