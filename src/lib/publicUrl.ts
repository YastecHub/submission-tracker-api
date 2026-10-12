/**
 * Public URL of this API, used in Swagger and startup output.
 * Set PUBLIC_API_URL explicitly; on Heroku the app's default domain is used
 * when runtime dyno metadata is enabled (`heroku labs:enable runtime-dyno-metadata`).
 */
export function publicApiUrl(): string | undefined {
  const configured = process.env.PUBLIC_API_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');
  const herokuDomain = process.env.HEROKU_APP_DEFAULT_DOMAIN_NAME?.trim();
  if (herokuDomain) return `https://${herokuDomain}`;
  return undefined;
}
