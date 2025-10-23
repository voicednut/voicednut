type EnvValue = string | undefined;

const isDev = import.meta.env.DEV;

function readEnv(name: string): EnvValue {
  return import.meta.env[name as keyof ImportMetaEnv] as EnvValue;
}

export function getEnvVar(name: string, fallback?: string): string {
  const value = readEnv(name);

  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  if (typeof fallback === 'string') {
    return fallback;
  }

  if (!isDev) {
    throw new Error(`Required environment variable "${name}" is not defined.`);
  }

  console.warn(
    `Missing environment variable "${name}". ` +
      'Using empty string fallback because the app is running in development mode.'
  );
  return '';
}

export function getBooleanEnvVar(name: string, fallback = false): boolean {
  const value = readEnv(name);
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true';
  }
  return fallback;
}
