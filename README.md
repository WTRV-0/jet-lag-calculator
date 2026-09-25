# Meridian · Jet Lag Planner

A free, personalised jet lag planner. It's a static site (plain HTML, CSS and JavaScript, no build step) hosted on GitHub Pages.

Enter your route, flight times and usual sleep schedule. You get a day-by-day plan covering:

- **Before you fly:** shift bed and wake times about 1 hour a day, with timed light and melatonin.
- **In the air:** when to sleep on the plane (destination night) and when to stay awake.
- **After you land:** exact windows to **seek** and **avoid** bright light, bedtimes, a caffeine cut-off, nap rules and optional melatonin. It continues until your body clock catches up.
- **The trip home:** a return plan built from wherever your body clock is on the day you fly back.

## What makes it different

| | |
|---|---|
| **Goal modes** | Fully adjust · Stay on home time (short trips) · Meet halfway · Be sharp for an event (it compares strategies by your body-clock time at the event) |
| **The 8+ zone flip** | For big eastward trips it keeps early-morning light off at first, and goes the long way round (later) only when 9+ h would remain to shift on landing |
| **Real daylight** | Light windows are checked against computed sunrise and sunset at your location. You're told when you need a light box and when you need sunglasses |
| **Flight plan** | In-flight sleep and wake windows lined up with destination night |
| **"Right now" panel** | Open it mid-trip to see what to do at this moment and what's next |
| **Take it with you** | Calendar export (.ics) with reminders, a share link (the whole trip is in the URL), print/PDF, and offline use as an installable web app |
| **Private** | Everything is computed in the browser. No accounts, no tracking |

## The model (CDC / AASM aligned)

- Pre-trip shift of 1 h/day for up to 3 days; body clock then moves about **1 h/day earlier** or **1.5 h/day later** (CDC Yellow Book).
- The body-temperature low is placed **3 h before habitual wake** (CDC: 2–4 h). Light after it shifts the clock earlier, light before it later; light windows are the waking hours nearest that point, checked against sunrise/sunset.
- Eastward trips shift earlier, avoiding early-morning light at first on 8+ zone trips. If 9+ h would still need advancing on landing (little or no prep), the plan shifts later instead (AASM review; Burgess protocol).
- Stays of **2 days or less** keep home time (CDC; AASM). "Meet halfway" is available only when chosen and is not guideline-based.
- Melatonin (optional): eastward, 30–60 min before destination bedtime from arrival night for up to 5 nights, 0.5–1 mg usually enough, never above 5 mg (Cochrane; CDC). Westward 5+ h: no bedtime dose; 0.5 mg only if awake in the second half of the night (CDC; Roach & Sargent).
- Caffeine fine for daytime alertness, none within 6 h of bed; naps 20–30 min (CDC).

Full references are listed at the bottom of the site. The logic lives in [`js/engine.js`](js/engine.js), a pure module with no DOM.

## Project layout

```
index.html              page shell and content
css/styles.css          design tokens (light and dark), layout, print styles
js/engine.js            circadian plan generator
js/tz.js                DST-aware time-zone helpers (Intl only)
js/sun.js               sunrise/sunset calculation
js/cities.js            ~300 cities with time zones, coordinates and airport codes
js/ics.js               calendar export
js/ui.js                form, rendering, share link, "right now" panel
sw.js, manifest.webmanifest   offline support / installable app
tests/engine.test.mjs   engine tests
```

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
node tests/engine.test.mjs
```

## Deploy

Push to GitHub, then go to **Settings → Pages → Deploy from a branch → `main` / root**. The `.nojekyll` file makes Pages serve the files exactly as they are.

## Disclaimer

For general information only, not medical advice. Melatonin is a dietary supplement and isn't FDA-regulated, so the actual content can differ from the label. Talk to your doctor before using it.
