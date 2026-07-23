// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// https://astro.build/config
export default defineConfig({
  site: "https://feathers-mcp.nesgarbo.com",
  integrations: [
    starlight({
      title: "feathers-mcp",
      logo: {
        src: "./src/assets/logo-mark.svg",
        replacesTitle: false,
      },
      favicon: "/favicon.svg",
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/nesgarbo/feathers-mcp" },
      ],
      head: [
        {
          tag: "meta",
          attrs: { property: "og:image", content: "https://feathers-mcp.nesgarbo.com/og.png" },
        },
        {
          tag: "meta",
          attrs: { property: "og:image:width", content: "1200" },
        },
        {
          tag: "meta",
          attrs: { property: "og:image:height", content: "630" },
        },
        {
          tag: "meta",
          attrs: { name: "twitter:image", content: "https://feathers-mcp.nesgarbo.com/og.png" },
        },
      ],
      customCss: ["./src/styles/starlight-custom.css"],
      editLink: {
        baseUrl: "https://github.com/nesgarbo/feathers-mcp/edit/main/website/",
      },
      defaultLocale: "root",
      locales: {
        root: { label: "English", lang: "en" },
        es: { label: "Español", lang: "es" },
      },
      sidebar: [
        {
          label: "Start here",
          translations: { es: "Empieza aquí" },
          items: [
            { slug: "docs" },
            { slug: "docs/why" },
            { slug: "docs/architecture" },
            { slug: "docs/quickstart" },
          ],
        },
        {
          label: "Guides",
          translations: { es: "Guías" },
          items: [
            { slug: "docs/tools" },
            { slug: "docs/sessions" },
            { slug: "docs/notifications" },
            { slug: "docs/calling-services" },
            { slug: "docs/return-values" },
          ],
        },
        {
          label: "Reference",
          translations: { es: "Referencia" },
          items: [
            { slug: "docs/options" },
            { slug: "docs/debugging" },
            { slug: "docs/upgrading" },
            { slug: "docs/license" },
          ],
        },
      ],
    }),
  ],
});
