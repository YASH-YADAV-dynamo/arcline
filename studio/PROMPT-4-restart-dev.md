# Turn 4: restart dev server (styles not applied in preview) — tiny turn, no code changes

The preview renders unstyled text. `src/index.css`, `tailwind.config.js` (CSS-variable colors like `bg-panel`, `text-ink`, `border-line`) and `postcss.config.js` are correct: a production `vite build` of these exact files emits a full ~28 KB stylesheet. The running dev server most likely started before `tailwind.config.js` was replaced, so Tailwind's `@apply bg-panel` etc. fail and the whole stylesheet is dropped.

Do exactly this and stop:
1. Stop the running Vite dev server. Delete `node_modules/.vite`.
2. Start the dev server again (same command/port as the preview uses).
3. Verify: `curl -s "http://localhost:<port>/src/index.css"` returns compiled CSS containing `.card` and `--panel`, with no PostCSS/Tailwind error. If there IS an error, fix only that error with the smallest edit and repeat.
4. Report the verification output (first ~5 lines). Do not change any other files.
