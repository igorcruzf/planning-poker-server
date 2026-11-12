export const corsOrigin = (value = process.env.CORS_ORIGIN): string | string[] => {
    const origins = (value ?? '')
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0);

    if (origins.length === 0) {
        return '*';
    }
    return origins.length === 1 ? origins[0] : origins;
};
