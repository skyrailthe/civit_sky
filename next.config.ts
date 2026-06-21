import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      // Civitai превью и изображения моделей
      { protocol: "https", hostname: "image.civitai.com" },
      { protocol: "https", hostname: "civitai.com" },
    ],
  },
};

export default nextConfig;
