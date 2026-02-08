/**
 * Initialization module - DOM ready check and widget initialization
 */
export const init = String.raw`
  /* ===== 10. INIT ===== */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWidget);
  } else {
    initWidget();
  }
`;
