import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // lo dejamos vacío a propósito; si luego necesitas flags, se añaden aquí
};

export default withNextIntl(nextConfig);
