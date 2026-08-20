const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function getValidatedTithelyGivingUrl(configuration: {
  tithely_giving_url?: unknown;
  tithely_embed_config?: unknown;
}): string | null {
  const embed = configuration.tithely_embed_config;
  if (
    typeof configuration.tithely_giving_url !== 'string' ||
    !embed ||
    typeof embed !== 'object' ||
    Array.isArray(embed)
  ) {
    return null;
  }

  try {
    const url = new URL(configuration.tithely_giving_url);
    const ids = url.searchParams.getAll('formId');
    const embedId = (embed as Record<string, unknown>).formId;
    if (
      url.protocol !== 'https:' ||
      url.origin !== 'https://give.tithe.ly' ||
      url.pathname !== '/' ||
      url.username ||
      url.password ||
      url.hash ||
      ids.length !== 1 ||
      !UUID_PATTERN.test(ids[0]) ||
      typeof embedId !== 'string' ||
      ids[0].toLowerCase() !== embedId.toLowerCase()
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}
