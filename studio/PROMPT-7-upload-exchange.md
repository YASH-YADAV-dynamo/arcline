# Turn 7: apply the uploaded exchange UI (keep Tailwind working)

The files attached to this turn are finished, type-checked and built locally. Copy each one into the app at the
same path. Do NOT redesign, rewrite or "improve" them.

Then delete these five files; nothing imports them any more:
src/components/landing/AssetStrip.tsx, src/components/landing/DefaultBuckets.tsx, src/components/landing/FadeIn.tsx,
src/components/landing/Features.tsx, src/components/landing/Safety.tsx

## Hard rules: the preview styling must not break
1. Do NOT edit, regenerate or reformat `tailwind.config.js`, `postcss.config.js`, `vite.config.ts`, `index.html`
   or `package.json`. Do not run `bun add` or `npm install` unless a file imports a package that is missing
   from package.json (report it rather than guessing).
2. `src/main.tsx` must keep the CSS cache-buster import `import './index.css?v=3'`. Never remove the `?v=`.
3. Do NOT restart the dev server. Vite HMR picks the files up. If it is not running at all, start it with exactly:
   `bunx vite --host 0.0.0.0 --port 5173 --strictPort` (never plain `bun run dev`, never another host or port).
4. Do not add `@apply` rules or new Tailwind plugins to `src/index.css`.

## Verify (read-only, keep it short)
- `curl -s http://localhost:5173/src/index.css?v=3 | grep -c "\.card"` must be > 0 (compiled Tailwind, not raw `@tailwind`).
- The same check against `http://169.254.0.21:5173/src/index.css?v=3`.
- `bunx tsc --noEmit -p .` has no errors.
- Report: the files copied, both CSS check counts, any tsc errors. Nothing else.
