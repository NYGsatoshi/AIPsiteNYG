(() => {
  try {
    const stored = localStorage.getItem('aipsite.ui.theme.v1');
    const theme = stored === 'dark' || stored === 'light'
      ? stored
      : matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    document.documentElement.dataset.aipTheme = theme;
    document.documentElement.dataset.aipDensity = matchMedia('(max-width: 860px), (pointer: coarse)').matches ? 'comfortable' : 'compact';
  } catch {
    // The dark and compact defaults remain in the document markup.
  }
})();
