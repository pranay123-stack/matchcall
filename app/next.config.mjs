/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // better-sqlite3 is a native module; keep it external to the server bundle.
  serverExternalPackages: ["better-sqlite3"],
  webpack: (config) => {
    config.externals = config.externals || [];
    // Our server modules use explicit ".js" specifiers on relative imports
    // (NodeNext style, so the same files run under tsx in scripts/keeper).
    // Teach webpack to resolve those ".js" specifiers to the ".ts" sources.
    config.resolve = config.resolve || {};
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias || {}),
      ".js": [".ts", ".tsx", ".js", ".jsx"],
    };
    return config;
  },
};

export default nextConfig;
