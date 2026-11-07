# Turn 5: preview renders with NO CSS at all — diagnose in the browser and fix (small turn)

Symptom (after a full reload/reopen of the preview): the React app renders and loads live on-chain data, but with zero styling — white background, default fonts, no layout. Even plain CSS in `src/index.css` (e.g. `html, body { background: rgb(var(--bg)) }`) is not applied. The "Built with Arc Studio" badge (inline styles) looks fine.

Already ruled out: the exact same files (index.html, src/main.tsx, src/index.css, tailwind.config.js, postcss.config.js, vite.config.ts, package.json) render fully styled with `vite` dev locally, and `vite build` emits a full stylesheet. Last turn you restarted Vite on 5173 and `curl localhost:5173/src/index.css` returned compiled CSS. So the source is fine; the problem is between the preview and the dev server.

Check, in order, and stop at the first real cause:
1. `ps aux | grep -i vite` and `ss -ltnp` (or netstat): is more than one Vite running, or is the preview proxying a different port than the server you restarted? Kill stale ones so exactly one dev server serves the port the preview uses.
2. Open the preview in your browser tool. In the console/network: does `/src/index.css` (the JS CSS-module) load with 200 through the preview URL? Any error (CSP blocking `<style>` injection, a failing `/@vite/client`, HMR websocket failure, a JS exception in the CSS module)? Check `document.querySelectorAll('style[data-vite-dev-id]').length` and `getComputedStyle(document.body).backgroundColor`.
3. Fix only the cause found (e.g. stale process, wrong port, a config option). Do not restyle or change app code. If injection itself is blocked, it's acceptable to add `import './index.css?inline'`-free alternatives ONLY if needed — prefer a server/config fix.
4. Verify in the browser that `getComputedStyle(document.body).backgroundColor` is `rgb(10, 11, 14)` and report the cause in one or two sentences.
