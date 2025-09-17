/** @type {import('next').NextConfig} */
const nextConfig = {
  // StrictMode double-mount causes WalletConnect "Init() called 2 times" in dev.
  // Turn off if you want quiet logs. Flip back to true if you prefer strict checks.
  reactStrictMode: false,

  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'gateway.pinata.cloud' },
      { protocol: 'https', hostname: '**.mypinata.cloud' },
      { protocol: 'https', hostname: 'ipfs.io' },
      { protocol: 'https', hostname: '**.ipfs.dweb.link' },
    ],
    // set NEXT_IMAGE_UNOPT=1 in .env.local to bypass optimization in dev
    unoptimized: process.env.NEXT_IMAGE_UNOPT === '1',
  },

  webpack: (config, { isServer }) => {
    // Ignore optional Node-only deps that WalletConnect -> pino tries to require
    config.resolve.alias = {
      ...config.resolve.alias,
      'pino-pretty': false,
      'pino-abstract-transport': false,
      'pino-std-serializers': false,
      lokijs: false,
      encoding: false,
    };

    // Extra safety: stub Node core modules on the client if any lib reaches for them
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        os: false,
        crypto: false,
        stream: false,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
