# Marketing assets

These are hand-written SVG illustrations for the ChatPilot AI landing page, plus two PNG renders. Vite serves everything in this folder from `/marketing/...`.

- Every SVG uses a `viewBox` and sets intrinsic `width`/`height`, so it scales cleanly. Size it with CSS (`width: 100%; height: auto;`).
- None of them load external images or fonts. Text is real SVG `<text>` set in `font-family: Inter, system-ui, sans-serif`, so if the page already loads Inter, the illustrations use it too.
- Palette: indigo `#4F46E5`, violet `#7C3AED`, slate neutrals, emerald accent `#10B981`.
- Gradient and filter IDs are prefixed per file (`hd-`, `s1-`, `fc-` and so on). You can inline several SVGs on one page without ID collisions, but `<img>` is the recommended way to use them.
- Every file is under 40 KB (the largest SVG is about 17 KB).
- "Lakeside Dental" and "yourbusiness.com" are fictional placeholder content.

## Hero

| File | Size (px) | Placement |
| --- | --- | --- |
| `hero-devices.svg` | 1200 × 860 | Landing hero, right column or full width under the headline |
| `hero-devices.png` | 2400 × 1720 (2×) | Email, social posts, decks. It has a solid `#F5F7FF` background; the SVG is transparent |

```html
<img src="/marketing/hero-devices.svg" width="1200" height="860"
     alt="ChatPilot AI chat widget answering a visitor's question on a business website, shown on desktop and mobile"
     fetchpriority="high" style="width:100%;height:auto">
```

The image shows a desktop browser with a small-business site (yourbusiness.com, "Lakeside Dental") and the chat widget open. The visitor asks "Do you offer weekend appointments?" The bot replies "Yes! We're open Saturdays 9am–2pm…" with a "Source: Contact page" chip and suggested-question chips. In front, a phone shows the same conversation full-screen, continuing into lead capture. A floating "New lead captured" toast sits beside them.

The SVG background is transparent apart from soft indigo/violet glows, so it works best on white or light-indigo sections.

## How it works (4 steps)

Each step is 480 × 320 and includes its own rounded light-indigo background card (radius 24), so it can sit directly in a step card.

| File | Recommended alt text |
| --- | --- |
| `step-1-url.svg` | Entering a website URL to generate a chatbot |
| `step-2-crawl.svg` | ChatPilot AI crawling website pages: 24 pages, 312 chunks indexed |
| `step-3-customize.svg` | Customizing the chatbot's brand color, name, lead capture and sources with a live preview |
| `step-4-install.svg` | Installing the chatbot with one script tag, marked as installed |

```html
<img src="/marketing/step-1-url.svg" width="480" height="320" loading="lazy"
     alt="Entering a website URL to generate a chatbot">
```

## Feature icon-illustrations

Each one is 240 × 160 and includes its own rounded background (radius 20). They work well at about 120–240 px wide at the top of a feature card.

| File | Feature | Recommended alt text |
| --- | --- | --- |
| `feature-crawl.svg` | Website crawling | Website pages being crawled and indexed |
| `feature-sources.svg` | Grounded answers with sources | Chat answer with cited source pages |
| `feature-leads.svg` | Lead capture | Lead capture form inside the chat |
| `feature-branding.svg` | Brand customization | Chat widget styled with custom brand colors |
| `feature-devices.svg` | Desktop and mobile preview | Chat widget on a desktop monitor and a phone |
| `feature-inbox.svg` | Conversations inbox | Inbox of visitor conversations with a lead tag |
| `feature-multilingual.svg` | Multilingual | Greetings in several languages around a globe |
| `feature-quotas.svg` | Usage controls | Usage gauge at 72% of the monthly message quota |

```html
<img src="/marketing/feature-sources.svg" width="240" height="160" loading="lazy"
     alt="Chat answer with cited source pages">
```

If a feature card already has a visible heading that says the same thing, you can use `alt=""` to mark the illustration as decorative.

## Brand

| File | Size (px) | Use |
| --- | --- | --- |
| `logo-mark.svg` | 64 × 64 | App icon or avatar: a rounded gradient square with a chat bubble, a compass "pilot" needle and an emerald spark |
| `logo-full.svg` | 240 × 64 | Mark plus the "ChatPilot AI" wordmark, for light backgrounds (nav, footer) |
| `logo-full-light.svg` | 240 × 64 | The same lockup with a white wordmark, for dark backgrounds |

```html
<a href="/" aria-label="ChatPilot AI home">
  <img src="/marketing/logo-full.svg" width="180" height="48" alt="ChatPilot AI">
</a>
```

The wordmark is live text, so its exact width depends on the font that renders it. If you need pixel-perfect lockups in third-party tools, convert the text to outlines in a design tool.

## Social / Open Graph

| File | Size (px) | Use |
| --- | --- | --- |
| `og-image.png` | 1200 × 630 | `og:image` and `twitter:image`. Use the PNG, because social crawlers don't render SVG |
| `og-image.svg` | 1200 × 630 | Editable source of the PNG |

```html
<meta property="og:image" content="https://YOUR_DOMAIN/marketing/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="ChatPilot AI: Turn your website into an AI assistant in minutes">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="https://YOUR_DOMAIN/marketing/og-image.png">
```

The card shows the logo, "ChatPilot AI", the tagline "Turn your website into an AI assistant in minutes", a supporting line, three feature pills, and a small browser-and-phone mockup with the widget open.

Note: there is an older `/og-image.svg` at the root of `public/`. That file was left untouched. `/marketing/og-image.png` is the intended replacement for social meta tags.

## Regenerating the PNGs

The PNGs were rendered with the repo's Playwright Chromium. The SVG was loaded as an `<img>` in a viewport set to the SVG's size and screenshotted: the OG image at `deviceScaleFactor` 1, and the hero at 2 on a `#F5F7FF` background. If you edit an SVG, re-render its PNG the same way.
