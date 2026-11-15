# Learnomy site kit

The plugin is the engine. This folder is what a site copies so visitors get the course pages:
`/courses/` (catalog), `/courses/<slug>` (course), `/lessons/<slug>?course=<course slug>` (lesson
and quiz), and the "Your courses" component for the site's account page.

## Copy the kit into your site

Install the Learnomy plugin first. Then, from your site's root folder, with the tag of the Learnomy
version installed on the site:

```bash
kit="$(mktemp -d)/emdash-learnomy" &&
  git clone --depth 1 --branch v0.2.0 https://github.com/wbcomdesigns/emdash-learnomy "$kit" &&
  mkdir -p src/pages src/components src/lib src/styles src/layouts &&
  cp -R "$kit/site-kit/pages/." src/pages/ &&
  cp "$kit/site-kit/components/LearnomyMyCourses.astro" src/components/ &&
  cp "$kit/site-kit/lib/learnomy.ts" "$kit/site-kit/lib/learnomy-strings.ts" src/lib/ &&
  cp "$kit/site-kit/styles/learnomy.css" src/styles/ &&
  { [ -e src/layouts/LearnomyLayout.astro ] || cp "$kit/site-kit/layouts/LearnomyLayout.astro" src/layouts/; } &&
  shared() { sed -n '1s/.*wbcom-shared: \([0-9]*\).*/\1/p' "$1" 2>/dev/null || true; } &&
  { [ "$(shared src/lib/wbcom-kit.ts)" -ge "$(shared "$kit/site-kit/lib/wbcom-kit.ts")" ] 2>/dev/null || cp "$kit/site-kit/lib/wbcom-kit.ts" src/lib/; } &&
  npx emdash seed "$kit/site-kit/seed/learnomy-seed.json" --no-content
```

- `src/lib/wbcom-kit.ts` is shared by every Wbcom plugin kit. The command copies it only when your
  site has no copy or one with a lower number on its first line (`wbcom-shared: N`), so another
  plugin's newer copy stays.
- `src/layouts/LearnomyLayout.astro` is yours once copied: it hands every Learnomy page to your
  site's `src/layouts/Base.astro`. If your layout has another name or other props, change that one
  file. Copying the kit again never replaces it.
- A page with the slug `courses` or `lessons` would be hidden by the kit pages. Rename it first.
- Restart the dev server (or deploy) after copying.

## Your courses

Put the component on your site's account page:

```astro
---
import LearnomyMyCourses from "../components/LearnomyMyCourses.astro";
---
<LearnomyMyCourses />
```

Add `/courses/` to your menu in Admin, Menus.

## Look and wording

The kit inherits your theme's font, colours, radius and light or dark scheme. Restyle it by setting
`--learnomy-*` tokens (all listed at the top of `src/styles/learnomy.css`) in your own stylesheet,
for example `.learnomy { --learnomy-brand: #0f766e; }`. Change any wording in
`src/lib/learnomy-strings.ts`. Every element carries a `data-learnomy-*` attribute for your own CSS
and scripts.

Button text uses `--learnomy-on-brand`, the colour on top of `--learnomy-brand`. The kit takes both
from your theme. Known case: the EmDash portfolio template's dark mode pairs a light purple with white
text, under AA contrast. Fix it in one line in `src/styles/theme.css`:

```css
.learnomy { --learnomy-on-brand: light-dark(#ffffff, #1e1033); }
```

## Members courses

A Members course's lesson pages carry only the lesson title in their HTML. The text is loaded in
the browser for signed-in members. Members keep out guests, not other members: any signed-in member
can read every published lesson. Members join by the owner's invite (Users, Invite user, role
Subscriber).
