import type { NextConfig } from "next";
const config: NextConfig = {
  images: { unoptimized: true, localPatterns: [] },
  outputFileTracingIncludes: {
    "/api/catalogue/samples/[id]": ["./assets/sample-previews/*.jpg"],
  },
};
export default config;
