# Browser verification

Rendered evidence outranks assumptions from source code.

## Tool selection

Use the browser capability already available in the environment.

If the `agent-browser` CLI is installed:

```bash
agent-browser skills get core
```

Load the current CLI-provided workflow before commands because it matches the installed version. Use its accessibility-tree snapshots and stable element references. Do not rely on stale memorized syntax.

If it is unavailable, use the environment’s browser plugin or Playwright. Do not install a new tool unless installation is in scope.

## Verification loop

1. Start the application with the repository’s documented script.
2. Open the changed route.
3. Wait for the page to settle and inspect the console.
4. Capture a semantic snapshot and screenshot.
5. Exercise the primary flow.
6. Resize and repeat.
7. Fix defects, reload, and rerun the affected path.

## Viewports

At minimum inspect:

- narrow mobile around 375 px;
- tablet or awkward intermediate width around 768–900 px;
- desktop around 1280–1440 px.

Use the project’s supported breakpoints when known.

## What to inspect

- overflow, clipping, unexpected scrollbars;
- heading and button wrapping;
- hero and navigation height;
- image aspect ratios and layout shift;
- contrast and visible focus;
- keyboard order and escape behavior;
- hover, active, disabled, loading, empty, error, and success states;
- menus, popovers, and dialogs escaping clipping containers;
- reduced motion;
- touch-target size;
- broken links, assets, and console errors.

## Evidence discipline

Static scanners reveal suspicious patterns; they do not prove visual quality. A passing screenshot at one width does not prove responsiveness. Verify the actual user path and compare before/after screenshots when redesign judgment is central.

