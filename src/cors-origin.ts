export const DEFAULT_CORS_ORIGINS = ['https://yak-planning-poker.onrender.com'];

const parseOrigins = (value: string): string[] =>
    value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0);

export const corsOrigin = (value = process.env.CORS_ORIGIN): string | string[] => {
    const configured = parseOrigins(value ?? '');
    const origins = configured.length > 0 ? configured : DEFAULT_CORS_ORIGINS;
    return origins.length === 1 ? origins[0] : [...origins];
};
