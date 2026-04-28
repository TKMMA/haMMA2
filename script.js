/* ============================================================
   haMMA — Hawaii Managed Marine Areas
   script.js  |  Full refactor

   Sections
   ─────────────────────────────────────────────────────────────
   1.  Constants
   2.  State
   3.  DOM references
   4.  Utilities — data helpers, text formatting
   5.  Map initialisation
   6.  Compact mode
   7.  Responsive / layout helpers
   8.  Sheet banners
   9.  Active area selection
   10. Map geometry & viewport helpers
   11. Map layer styles — hover, selection, flash
   12. Info hint
   13. Map selection / clear
   14. Info panel — HTML builders
   15. Info panel — open / close
   16. Sidebar — population
   17. Sidebar — interactions
   18. Data loading
   19. Event wiring
   20. Boot
   ============================================================ */

(function () {
  'use strict';


  // ── 1. CONSTANTS ────────────────────────────────────────────
  const SERVICE_LAYER_URL =
    'https://services.arcgis.com/HQ0xoN0EzDPBOEci/ArcGIS/rest/services/TK_MMA_FEATURECLASS/FeatureServer/727';

  const ISLAND_DISPLAY_ORDER = [
    "Oʻahu", "Molokaʻi", "Maui", "Lānaʻi", "Kauaʻi", "Hawaiʻi Island", "Kahoʻolawe",
  ];

  const INITIAL_CHAIN_BOUNDS = L.latLngBounds([[18.9, -160.55], [22.35, -154.75]]);

  const FALLBACK_REGS_URL =
    'https://dlnr.hawaii.gov/dar/fishing/fishing-regulations/';

  // Must match --duration-slow in style.css (400ms) + small buffer
  const SHEET_TRANSITION_MS = 420;

  const MOBILE_BREAKPOINT = window.matchMedia('(max-width: 768px)');

  // ── FIELD SCHEMA ─────────────────────────────────────────────
  // Single source of truth for every field that appears in the info panel.
  // To add, remove, or re-label a field: edit this config only — no need to
  // touch the rendering functions below.
  //
  // format values:
  //   'plain'   — escaped text (default)
  //   'bullet'  — multi-line bulleted list
  //   'date'    — formatted MM/DD/YYYY
  //   'rule'    — rule text with Allowed/Prohibited callouts
  //   'link'    — renders as a .reg-link button; requires linkText
  //   'join'    — joins multiple keys with <br>; requires keys[]
  const FIELD_SCHEMA = {
    about: [
      {
        keys:   ['Designation_1', 'Designation_2', 'Designation_3'],
        label:  'Designation',
        format: 'join',
      },
      { key: 'Island',         label: 'Island' },
      { key: 'Purpose',        label: 'Purpose',           format: 'bullet' },
      { key: 'Cultural',       label: 'Cultural Info',     format: 'bullet' },
      { key: 'Fishing_Info',   label: 'Fishing Info',      format: 'bullet' },
      { key: 'Establish_Date', label: 'Date Established',  format: 'date'   },
      { key: 'Location',       label: 'Location' },
      { key: 'DAR_URL',        label: 'Official DAR Page', format: 'link',  linkText: 'Official DAR page ›' },
    ],
    rules: [
      { key: 'Rules_Gear',             label: 'Gear Rules',           format: 'rule' },
      { key: 'Rules_Species_Size_Bag', label: 'Species & Bag Limits', format: 'rule' },
      { key: 'Rules_Activities',       label: 'Activities Rules',     format: 'rule' },
      { key: 'Rules_Seasons_Times',    label: 'Seasons & Times',      format: 'rule' },
      { key: 'Rules_Transit_Anchor',   label: 'Transit & Anchor',     format: 'rule' },
    ],
    laws: [
      { key: 'HAR_Name',  label: 'HAR Name' },
      { key: 'HAR_Link',  label: 'HAR Document', format: 'link', linkText: 'View HAR PDF ›' },
      { key: 'Penalties', label: 'Penalties',    format: 'bullet' },
    ],
  };

  // Summary card pulls from the rules tab fields — driven by schema so it
  // stays in sync automatically if rules fields are ever added or reordered.
  const SUMMARY_SCHEMA = FIELD_SCHEMA.rules.map((f) => ({
    title:    f.label,
    fieldKey: f.key,
  }));



  // ── 2. STATE ─────────────────────────────────────────────────
  const allIslandLayers      = {};
  let activeSelectionMarker  = null;
  let activeAccordionLayer   = null;
  let activeHoverLayer       = null;
  let activeAreaSelection    = null; // eslint-disable-line no-unused-vars
  let infoHintEl             = null;
  let infoHintTimer          = null;
  let mobileInfoHideTimer    = null;
  let hasEverSelected        = false;
  let isCompactMode          = false; // eslint-disable-line no-unused-vars
  let activeLastLatlng       = null;  // last latlng used to open the info panel


  // ── 3. DOM REFERENCES ────────────────────────────────────────
  const mapInterfaceEl = document.querySelector('.map-interface');
  const paneStageEl    = document.getElementById('pane-stage');
  const mapSidebarEl   = document.getElementById('map-sidebar');
  const infoSidebarEl  = document.getElementById('info-sidebar');
  const islandListEl   = document.getElementById('island-list');
  const infoContentEl  = document.getElementById('info-content');
  const areaSearchEl   = document.getElementById('area-search');
  const searchClearEl  = document.getElementById('search-clear-btn');
  const closeInfoBtnEl = document.getElementById('close-info-btn');
  const brandPanelEl   = document.getElementById('brand-panel');


  // ── 4. UTILITIES ─────────────────────────────────────────────

  // Return a property value by case-insensitive key, or null if absent / blank / "N/A"
  function getVal(props, key) {
    const found = Object.keys(props).find((k) => k.toLowerCase() === key.toLowerCase());
    const val   = found ? props[found] : null;
    return val === 'N/A' || val === '' || val === null ? null : val;
  }

  // Safely escape user-/API-supplied text before injecting into HTML
  function escapeHtml(value) {
    return String(value)
      .replace(/&/g,  '&amp;')
      .replace(/</g,  '&lt;')
      .replace(/>/g,  '&gt;')
      .replace(/"/g,  '&quot;')
      .replace(/'/g,  '&#39;');
  }

  function formatDate(dateVal) {
    if (!dateVal || dateVal === 'N/A') return 'N/A';
    const d = new Date(dateVal);
    return Number.isNaN(d.getTime())
      ? dateVal
      : `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
  }


  // Normalise Hawaiian diacritics + okina variants for fuzzy search matching
  function normalizeHawaiianText(str) {
    if (!str) return '';
    return String(str)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[ʻ\u02BB\u02BC'''`]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function formatBulletsWithIndents(text) {
    if (!text || text === 'N/A') return 'N/A';
    return String(text)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => `
        <div class="mm-bullet-container">
          <span class="mm-bullet-point">•</span>
          <span class="mm-bullet-text">${l.replace(/^[•●○◦*-]\s+/, '').trim()}</span>
        </div>`)
      .join('');
  }

  function normalizeRuleSegments(text) {
    return String(text)
      .replace(/\r\n?/g, '\n')
      .replace(/\s+-\s+/g, '\n- ');
  }

  function formatRuleBody(text) {
    return normalizeRuleSegments(text)
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => `<div class="rule-line${s.startsWith('-') ? ' rule-line--dash' : ''}">${escapeHtml(s)}</div>`)
      .join('');
  }

  function formatRuleText(text) {
    if (!text || text === 'N/A') return 'N/A';
    const lines = String(text)
      .replace(/\r\n?/g, '\n')
      .replace(/([^\n])\s+(?=(?:Allowed|Prohibited)[^:\n]*:\s*)/gi, '$1\n')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    return lines.map((line) => {
      const match = line.match(/^(?:[-•]\s*)?(Prohibited[^:]*:|Allowed[^:]*:)(.*)$/i);
      if (!match) return formatRuleBody(line);

      const [, label, body] = match;
      const type    = /^prohibited/i.test(label) ? 'prohibited' : 'allowed';
      const bodyHtml = body.trim()
        ? `<div class="rule-callout__body">${formatRuleBody(body)}</div>`
        : '';

      return `
        <div class="rule-callout rule-callout--${type}">
          <span class="rule-callout__label rule-callout__label--${type}">${escapeHtml(label.trim())}</span>
          ${bodyHtml}
        </div>`;
    }).join('');
  }


  // ── 5. MAP INITIALISATION ────────────────────────────────────
  const map = L.map('map', { zoomControl: false }).setView([20.4, -157.4], 7);

  const zoomControl = L.control
    .zoom({ position: MOBILE_BREAKPOINT.matches ? 'bottomright' : 'topright' })
    .addTo(map);

  // Satellite imagery base layer
  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Esri' },
  ).addTo(map);

  // Place name labels on top
  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Labels', pane: 'shadowPane' },
  ).addTo(map);


  // ── 6. COMPACT MODE ──────────────────────────────────────────
  // Collapse the brand panel when the user interacts with the map or search.
  // FIX: original setCompactMode() ignored its argument and always set false.
  function setCompactMode(val) {
    isCompactMode = Boolean(val);
    brandPanelEl?.classList.toggle('compact', isCompactMode);
  }


  // ── 7. RESPONSIVE / LAYOUT HELPERS ───────────────────────────
  const isMobileView = () => MOBILE_BREAKPOINT.matches;

  function syncMobileBrowserInset() {
    if (!paneStageEl) return;
    if (!isMobileView()) {
      paneStageEl.style.setProperty('--browser-offset', '0px');
      return;
    }
    const vv = window.visualViewport;
    if (!vv) {
      paneStageEl.style.setProperty('--browser-offset', '0px');
      return;
    }
    const inset = Math.max(0, Math.round(window.innerHeight - (vv.height + vv.offsetTop)));
    paneStageEl.style.setProperty('--browser-offset', `${inset}px`);
  }

  // Switch the pane stage between list and info views (mobile slide)
  function setMobilePaneStage(stage = 'list') {
    if (!isMobileView() || !paneStageEl) return;
    paneStageEl.classList.toggle('is-info-view', stage === 'info');
  }

  function setMobileInfoPaneVisibility(isVisible) {
    if (!infoSidebarEl || !isMobileView()) return;
    infoSidebarEl.classList.toggle('mobile-hidden', !isVisible);
  }

  function setMobileVerticalState(isMinimized) {
    if (!isMobileView() || !paneStageEl) return;
    paneStageEl.classList.toggle('is-minimized', Boolean(isMinimized));
  }

  // Cycle the info pane through: half → full → dismissed
  // Called by the resize button in the info panel header
  function cycleInfoPaneState() {
    if (!isMobileView() || !paneStageEl) return;

    if (paneStageEl.classList.contains('is-expanded')) {
      // Full → Half
      paneStageEl.classList.remove('is-expanded');
      updateInfoResizeBtn();
      // Re-centre in the now-smaller visible strip
      if (activeLastLatlng) {
        setTimeout(() => flyToMobileVisibleCenter(activeLastLatlng), SHEET_TRANSITION_MS);
      }
    } else if (!paneStageEl.classList.contains('is-minimized')) {
      // Half → Dismissed
      clearMapSelection();
    }
  }

  // Expand the info pane from half to full
  function expandInfoPane() {
    if (!isMobileView() || !paneStageEl) return;
    paneStageEl.classList.add('is-expanded');
    updateInfoResizeBtn();
  }

  function toggleMobileStageMinimized() {
    if (!isMobileView() || !paneStageEl) return false;
    paneStageEl.classList.toggle('is-minimized');
    return paneStageEl.classList.contains('is-minimized');
  }

  // Return the pane stage to the default "peek" state
  function setMobileHomeState(options = {}) {
    if (!isMobileView() || !paneStageEl) return;

    setMobilePaneStage('list');
    setMapSidebarMobileState('minimized');
    setMobileVerticalState(true);

    const hideInfo = () => {
      setInfoSidebarState('hidden');
      setMobileInfoPaneVisibility(false);
    };

    if (options.hideInfoAfterTransition) {
      if (mobileInfoHideTimer) clearTimeout(mobileInfoHideTimer);
      mobileInfoHideTimer = setTimeout(() => {
        hideInfo();
        mobileInfoHideTimer = null;
      }, 400);
    } else {
      hideInfo();
    }
  }

  function setInfoSidebarState(state = 'hidden') {
    if (!infoSidebarEl) return;
    const nextState = isMobileView() && state === 'expanded' ? 'open' : state;
    infoSidebarEl.dataset.mobileState = nextState;
    infoSidebarEl.classList.toggle('active',        state !== 'hidden');
    infoSidebarEl.classList.toggle('is-active-pane', nextState === 'open');

    if (nextState === 'open') {
      setMobileInfoPaneVisibility(true);
      setMobileVerticalState(false);
    } else if (nextState === 'hidden') {
      setMobileInfoPaneVisibility(false);
    }

    if (isMobileView()) updateInfoBannerTitle();
  }

  function setMapSidebarMobileState(state = 'minimized') {
    if (!mapSidebarEl || !isMobileView()) return;
    mapSidebarEl.dataset.mobileState = state;
    mapSidebarEl.classList.toggle('collapsed',      state !== 'open');
    mapSidebarEl.classList.toggle('is-active-pane', state === 'open');
    setMobileVerticalState(state !== 'open');
    updateMapSidebarBanner();
  }

  function setMapSidebarDesktopState() {
    if (!mapSidebarEl || isMobileView()) return;
    mapSidebarEl.classList.remove('collapsed');
  }

  // FIX: was unconditional — removed 'collapsed' from the sidebar on mobile,
  // immediately undoing the state set by setMapSidebarMobileState() above it.
  function syncSidebarToggleUI() {
    if (isMobileView()) return;
    mapInterfaceEl?.classList.remove('sidebar-collapsed');
    mapSidebarEl?.classList.remove('collapsed');
  }

  function syncLeafletControlPosition() {
    const target = isMobileView() ? 'bottomright' : 'topright';
    if (zoomControl.options.position === target) return;
    map.removeControl(zoomControl);
    zoomControl.setPosition(target);
    zoomControl.addTo(map);
  }

  // Single entry point for all responsive sidebar state changes.
  // FIX: original code called setMobileHomeState() twice more after this
  // (once inline + once in window.onload), causing triple-init on mobile
  // and racing state. This is now the only initialization path.
  function syncResponsiveSidebarState() {
    if (!mapSidebarEl) return;

    if (isMobileView()) {
      const listState = mapSidebarEl.dataset.mobileState === 'open' ? 'open' : 'minimized';
      setMapSidebarMobileState(listState);

      if (infoSidebarEl.classList.contains('active')) {
        const infoState = infoSidebarEl.dataset.mobileState === 'open' ? 'open' : 'minimized';
        setInfoSidebarState(infoState);
        setMobilePaneStage('info');
      } else {
        setInfoSidebarState('hidden');
        setMobileInfoPaneVisibility(false);
        setMobilePaneStage('list');
        setMobileVerticalState(listState !== 'open');
      }

      updateMapSidebarBanner();
      updateInfoBannerTitle();
    } else {
      paneStageEl?.classList.remove('is-info-view', 'is-minimized');
      mapSidebarEl.dataset.mobileState  = 'desktop';
      infoSidebarEl.dataset.mobileState = infoSidebarEl.classList.contains('active')
        ? 'expanded'
        : 'hidden';
      setMapSidebarDesktopState();
    }

    syncSidebarToggleUI();
    syncLeafletControlPosition();
    syncMobileBrowserInset();
  }

  function setInitialMapExtent() {
    if (!map) return;
    if (isMobileView()) {
      map.fitBounds(INITIAL_CHAIN_BOUNDS, {
        paddingTopLeft:     [12, 70],
        paddingBottomRight: [12, 30],
        maxZoom: 8.5,
      });
      return;
    }
    const left = getLeftOverlayWidth();
    map.fitBounds(INITIAL_CHAIN_BOUNDS, {
      paddingTopLeft:     [Math.max(24, Math.round(left) + 24), 30],
      paddingBottomRight: [24, 30],
      maxZoom: 8.5,
    });
  }


  // ── 8. SHEET BANNERS ─────────────────────────────────────────
  // Lazily creates (or updates) the mobile drag-handle banner
  // at the top of each sidebar panel.
  function ensureSidebarBanner(sidebarEl, options = {}) {
    if (!sidebarEl) return null;

    let banner = sidebarEl.querySelector('.sheet-banner');
    if (!banner) {
      banner            = document.createElement('div');
      banner.className  = 'sheet-banner';

      const handle      = document.createElement('button');
      handle.type       = 'button';
      handle.className  = 'sheet-handle';

      const title       = document.createElement('span');
      title.className   = 'sheet-banner-title';

      const action      = document.createElement('button');
      action.type       = 'button';
      action.className  = 'sheet-banner-action';

      const rightAction = document.createElement('button');
      rightAction.type      = 'button';
      rightAction.className = 'sheet-banner-right-action';

      banner.append(action, title, rightAction, handle);
      sidebarEl.prepend(banner);
    }

    const handleEl      = banner.querySelector('.sheet-handle');
    const titleEl       = banner.querySelector('.sheet-banner-title');
    const actionEl      = banner.querySelector('.sheet-banner-action');
    const rightActionEl = banner.querySelector('.sheet-banner-right-action');

    titleEl.textContent = options.title || '';

    if (options.handleLabel) handleEl.setAttribute('aria-label', options.handleLabel);
    handleEl.classList.toggle('is-expanded', Boolean(options.expanded));
    handleEl.style.display = options.showHandle === false ? 'none' : 'inline-flex';
    handleEl.onclick       = (e) => e.stopPropagation();

    if (options.actionText) {
      actionEl.textContent   = options.actionText;
      actionEl.style.display = 'inline-flex';
      actionEl.onclick = (e) => { e.stopPropagation(); options.onAction?.(); };
      if (options.actionLabel) actionEl.setAttribute('aria-label', options.actionLabel);
    } else {
      actionEl.style.display = 'none';
      actionEl.onclick = null;
    }

    if (options.rightActionText) {
      rightActionEl.textContent   = options.rightActionText;
      rightActionEl.style.display = 'inline-flex';
      rightActionEl.onclick = (e) => { e.stopPropagation(); options.onRightAction?.(); };
      if (options.rightActionLabel) rightActionEl.setAttribute('aria-label', options.rightActionLabel);
    } else {
      rightActionEl.style.display = 'none';
      rightActionEl.onclick = null;
    }

    actionEl.style.gridColumn      = options.actionGridColumn      || '1';
    titleEl.style.gridColumn       = options.titleGridColumn       || '2';
    rightActionEl.style.gridColumn = options.rightActionGridColumn || '3';
    handleEl.style.gridColumn      = options.handleGridColumn      || '3';

    banner.onclick = options.onToggle ? () => options.onToggle() : null;

    return banner;
  }

  function updateMapSidebarBanner() {
    if (!isMobileView()) return;
    const isOpen = mapSidebarEl?.dataset.mobileState === 'open';

    ensureSidebarBanner(mapSidebarEl, {
      title:       'Areas List',
      handleLabel: isOpen ? 'Collapse areas list' : 'Expand areas list',
      expanded:    isOpen,
      onToggle: () => {
        const minimized = toggleMobileStageMinimized();
        mapSidebarEl.dataset.mobileState = minimized ? 'minimized' : 'open';
        mapSidebarEl.classList.toggle('collapsed', minimized);
        updateMapSidebarBanner();
      },
      actionGridColumn: '1',
      titleGridColumn:  '2',
      handleGridColumn: '3',
    });
  }

  // Update the resize button label to reflect the current sheet state
  function updateInfoResizeBtn() {
    const btn = document.getElementById('info-resize-btn');
    if (!btn || !isMobileView()) return;

    const isExpanded = paneStageEl?.classList.contains('is-expanded');
    const icon  = btn.querySelector('.info-resize-btn__icon');
    const label = btn.querySelector('.info-resize-btn__label');

    if (isExpanded) {
      if (icon)  icon.textContent  = '↓';
      if (label) label.textContent = 'Less map';
    } else {
      if (icon)  icon.textContent  = '↑';
      if (label) label.textContent = 'More info';
    }
  }

  // Ensure the resize button exists inside the info sidebar
  function ensureInfoResizeBtn() {
    if (!isMobileView() || !infoSidebarEl) return;
    if (document.getElementById('info-resize-btn')) return;

    const btn       = document.createElement('button');
    btn.id          = 'info-resize-btn';
    btn.className   = 'info-resize-btn';
    btn.type        = 'button';
    btn.setAttribute('aria-label', 'Expand info panel');
    btn.innerHTML   = `<span class="info-resize-btn__icon" aria-hidden="true">↑</span><span class="info-resize-btn__label">More info</span>`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isExpanded = paneStageEl?.classList.contains('is-expanded');
      if (isExpanded) {
        cycleInfoPaneState(); // full → half
      } else {
        expandInfoPane();     // half → full
      }
    });

    infoSidebarEl.appendChild(btn);
  }

  function updateInfoBannerTitle() {
    if (!isMobileView()) return;
    const isOpen = infoSidebarEl?.dataset.mobileState === 'open';

    ensureSidebarBanner(infoSidebarEl, {
      title:       'Area Info',
      handleLabel: 'Area info',
      expanded:    isOpen,
      showHandle:  false,
      onToggle: () => {
        if (infoSidebarEl.dataset.mobileState === 'hidden') return;
        const minimized = toggleMobileStageMinimized();
        infoSidebarEl.dataset.mobileState = minimized ? 'minimized' : 'open';
        updateInfoBannerTitle();
      },
      actionText:  '← Back to list',
      actionLabel: 'Back to areas list',
      onAction: () => {
        if (!isMobileView()) return;
        setMobileVerticalState(false);
        setMapSidebarMobileState('open');
        setMobilePaneStage('list');
        setTimeout(() => setInfoSidebarState('hidden'), 420);
      },
      rightActionText:  '✕',
      rightActionLabel: 'Close area info',
      onRightAction: () => clearMapSelection(),
      actionGridColumn:      '1',
      titleGridColumn:       '2',
      rightActionGridColumn: '3',
      handleGridColumn:      '3',
    });
  }


  // ── 9. ACTIVE AREA SELECTION ─────────────────────────────────
  function setActiveAreaItem(islandName, areaName) {
    activeAreaSelection = islandName && areaName ? { islandName, areaName } : null;

    document.querySelectorAll('.area-item.active-area').forEach((el) => {
      el.classList.remove('active-area');
    });

    if (!activeAreaSelection) return;

    document.querySelectorAll('.area-item').forEach((el) => {
      if (el.dataset.island === islandName && el.dataset.area === areaName) {
        el.classList.add('active-area');
      }
    });
  }


  // ── 10. MAP GEOMETRY & VIEWPORT HELPERS ──────────────────────
  function getLeftOverlayWidth() {
    if (isMobileView()) return 0;
    const mapRect     = map.getContainer().getBoundingClientRect();
    const sidebarRect = mapSidebarEl?.getBoundingClientRect();
    const infoRect    = infoSidebarEl?.classList.contains('active')
      ? infoSidebarEl.getBoundingClientRect()
      : null;
    const rightEdges = [sidebarRect?.right, infoRect?.right].filter(Boolean);
    if (!rightEdges.length) return 0;
    return Math.max(0, Math.max(...rightEdges) - mapRect.left);
  }

  function getVisibleMapRect(padding = 30) {
    const size = map.getSize();

    if (isMobileView()) {
      const brandBottom = brandPanelEl?.getBoundingClientRect().bottom || 0;
      const mapTop      = map.getContainer().getBoundingClientRect().top;
      const topInset    = Math.max(padding, Math.ceil(brandBottom - mapTop) + 10);

      const overlayHeights = [mapSidebarEl, infoSidebarEl]
        .filter((el) => el && (el === mapSidebarEl || el.classList.contains('active')))
        .map((el) => {
          const rect = el.getBoundingClientRect();
          return Math.max(0, map.getContainer().getBoundingClientRect().bottom - rect.top);
        });

      const bottomInset = Math.max(...overlayHeights, Math.round(size.y * 0.35));
      return {
        left:    padding,
        right:   size.x - padding,
        top:     topInset,
        bottom:  Math.max(topInset + 20, size.y - bottomInset),
        centerX: size.x / 2,
      };
    }

    const leftOverlayWidth = getLeftOverlayWidth();
    return {
      left:    leftOverlayWidth + padding,
      right:   size.x - padding,
      top:     padding,
      bottom:  size.y - padding,
      centerX: leftOverlayWidth + (size.x - leftOverlayWidth) / 2,
    };
  }

  function getTargetFitZoom(bounds) {
    if (isMobileView()) {
      const rect = getVisibleMapRect();
      const padX = Math.max(30, map.getSize().x - (rect.right - rect.left));
      const padY = Math.max(30, map.getSize().y - (rect.bottom - rect.top));
      return map.getBoundsZoom(bounds, false, L.point(padX, padY));
    }
    return map.getBoundsZoom(bounds, false, L.point(getLeftOverlayWidth() + 30, 30));
  }

  function featureFitsVisibleArea(bounds, padding = 30) {
    const rect = getVisibleMapRect(padding);
    const nw   = map.latLngToContainerPoint(bounds.getNorthWest());
    const se   = map.latLngToContainerPoint(bounds.getSouthEast());
    return (
      Math.min(nw.x, se.x) >= rect.left  &&
      Math.max(nw.x, se.x) <= rect.right &&
      Math.min(nw.y, se.y) >= rect.top   &&
      Math.max(nw.y, se.y) <= rect.bottom
    );
  }

  function featureIsCenteredInVisibleArea(bounds, tolerancePx = 6) {
    const rect           = getVisibleMapRect();
    const center         = map.latLngToContainerPoint(bounds.getCenter());
    const visibleCenterY = map.getSize().y / 2;
    return (
      Math.abs(center.x - rect.centerX)  <= tolerancePx &&
      Math.abs(center.y - visibleCenterY) <= tolerancePx
    );
  }

  function flySelectionIntoVisibleArea(latlng, duration = 1.0) {
    if (!latlng) return;
    const rect   = getVisibleMapRect();
    const point  = map.latLngToContainerPoint(latlng);
    const delta  = Math.round(rect.centerX - point.x);
    if (Math.abs(delta) < 2) return;
    const target = map.containerPointToLatLng(L.point(point.x + delta, point.y));
    map.flyTo(target, map.getZoom(), { animate: true, duration, easeLinearity: 0.2 });
  }


  // Pan so that latlng sits at the centre of the visible map strip above
  // the mobile bottom sheet. Called after the sheet animation settles.
  // Corrects both X and Y — unlike flySelectionIntoVisibleArea which is
  // desktop-only and only corrects X (no vertical overlay on desktop).
  function flyToMobileVisibleCenter(latlng, duration = 0.6) {
    if (!latlng || !isMobileView()) return;

    const rect           = getVisibleMapRect();
    const visibleCenterX = rect.centerX;
    const visibleCenterY = rect.top + (rect.bottom - rect.top) / 2;

    const point  = map.latLngToContainerPoint(latlng);
    const deltaX = Math.round(visibleCenterX - point.x);
    const deltaY = Math.round(visibleCenterY - point.y);

    // Already centred — skip to avoid unnecessary map movement
    if (Math.abs(deltaX) < 4 && Math.abs(deltaY) < 4) return;

    const targetPoint  = L.point(point.x + deltaX, point.y + deltaY);
    const targetLatLng = map.containerPointToLatLng(targetPoint);
    map.flyTo(targetLatLng, map.getZoom(), { animate: true, duration, easeLinearity: 0.25 });
  }

  // Point-in-polygon using ray casting
  function pointInRing(point, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      const intersect =
        (yi > point[1]) !== (yj > point[1]) &&
        point[0] < ((xj - xi) * (point[1] - yi)) / ((yj - yi) || 1e-12) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function pointInPolygonCoords(point, coords) {
    if (!coords?.length) return false;
    if (!pointInRing(point, coords[0])) return false;
    for (let i = 1; i < coords.length; i++) {
      if (pointInRing(point, coords[i])) return false;
    }
    return true;
  }

  function pointInFeatureGeometry(latlng, feature) {
    const geom = feature?.geometry;
    if (!geom) return false;
    const point = [latlng.lng, latlng.lat];
    if (geom.type === 'Polygon')
      return pointInPolygonCoords(point, geom.coordinates);
    if (geom.type === 'MultiPolygon')
      return geom.coordinates.some((p) => pointInPolygonCoords(point, p));
    return false;
  }


  // ── 11. MAP LAYER STYLES ─────────────────────────────────────
  // Cache a layer's original style so we can restore it after highlight
  function getLayerBaseStyle(layer) {
    if (!layer.__baseStyle) {
      layer.__baseStyle = {
        color:       layer.options.color       ?? '#005a87',
        weight:      layer.options.weight      ?? 1.2,
        fillOpacity: layer.options.fillOpacity ?? 0.3,
        opacity:     layer.options.opacity     ?? 1,
      };
    }
    return layer.__baseStyle;
  }

  function clearHoverHighlight() {
    if (!activeHoverLayer || activeHoverLayer === activeAccordionLayer) {
      activeHoverLayer = null;
      return;
    }
    activeHoverLayer.setStyle(getLayerBaseStyle(activeHoverLayer));
    activeHoverLayer = null;
  }

  function applyHoverHighlight(layer) {
    if (!layer || layer === activeAccordionLayer) return;
    if (activeHoverLayer && activeHoverLayer !== layer) clearHoverHighlight();
    const base = getLayerBaseStyle(layer);
    layer.setStyle({
      color:       '#ffd60a',
      weight:      Math.max(base.weight + 0.6, 2),
      opacity:     0.5,
      fillOpacity: base.fillOpacity,
    });
    activeHoverLayer = layer;
  }

  function clearAccordionSelectionHighlight() {
    if (!activeAccordionLayer || typeof activeAccordionLayer.setStyle !== 'function') return;
    activeAccordionLayer.setStyle(getLayerBaseStyle(activeAccordionLayer));
    activeAccordionLayer = null;
  }

  // Flash bright yellow on click, then settle to a softer persistent highlight
  function flashLayerBorder(layer) {
    if (!layer || typeof layer.setStyle !== 'function') return;
    const base = getLayerBaseStyle(layer);
    if (activeAccordionLayer && activeAccordionLayer !== layer) clearAccordionSelectionHighlight();
    clearHoverHighlight();
    activeAccordionLayer = layer;

    layer.setStyle({ color: '#ffe066', weight: 5, opacity: 1, fillOpacity: base.fillOpacity });
    setTimeout(() => {
      layer.setStyle({
        color:       '#ffd60a',
        weight:      Math.max(base.weight + 0.8, 2.2),
        opacity:     1,
        fillOpacity: base.fillOpacity,
      });
    }, 1200);
  }

  function updateClickMarker(latlng) {
    if (activeSelectionMarker) map.removeLayer(activeSelectionMarker);
    activeSelectionMarker = L.marker(latlng).addTo(map);
  }


  // ── 12. INFO HINT ────────────────────────────────────────────
  function ensureInfoHint() {
    if (infoHintEl) return infoHintEl;
    if (!mapInterfaceEl) return null;

    const el       = document.createElement('div');
    el.id          = 'info-empty-hint';
    el.className   = 'info-empty-hint';
    el.setAttribute('role',      'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML   = `
      <span>Click a shape on the map or an item in the list to see area details.</span>
      <button class="hint-dismiss" id="hint-dismiss-btn" aria-label="Dismiss hint">✕</button>
    `;
    mapInterfaceEl.appendChild(el);
    el.querySelector('#hint-dismiss-btn').addEventListener('click', hideInfoHint);

    infoHintEl = el;
    return el;
  }

  function showInfoHint() {
    const el = ensureInfoHint();
    if (!el) return;
    if (infoHintTimer) clearTimeout(infoHintTimer);
    el.classList.add('active');
    infoHintTimer = setTimeout(() => {
      el.classList.remove('active');
      infoHintTimer = null;
    }, 8000);
  }

  function hideInfoHint() {
    const el = ensureInfoHint();
    if (!el) return;
    if (infoHintTimer) { clearTimeout(infoHintTimer); infoHintTimer = null; }
    el.classList.remove('active');
  }


  // ── 13. MAP SELECTION / CLEAR ────────────────────────────────
  function clearMapSelection(options = {}) {
    const hadSelection = Boolean(
      activeSelectionMarker ||
      activeAccordionLayer  ||
      infoSidebarEl?.classList.contains('active'),
    );

    if (activeSelectionMarker) {
      map.removeLayer(activeSelectionMarker);
      activeSelectionMarker = null;
    }

    clearAccordionSelectionHighlight();
    clearHoverHighlight();
    setActiveAreaItem(null, null);

    if (isMobileView()) {
      paneStageEl?.classList.remove('is-info-view', 'is-expanded');
      paneStageEl?.classList.add('is-minimized');
      setMobileHomeState({ hideInfoAfterTransition: true });
    } else {
      closeInfoPanel();
    }

    if (options.fromClick && hadSelection && hasEverSelected) showInfoHint();
  }


  // ── 14. INFO PANEL — HTML BUILDERS ───────────────────────────
  // Pure functions — each returns an HTML string.
  // Field knowledge lives in FIELD_SCHEMA above; these functions are
  // generic renderers that don't need to know which fields exist.

  // Render a single field row given a schema entry and a properties object
  function renderSchemaField(entry, props) {
    // Resolve the value — 'join' format merges multiple keys
    const value = entry.format === 'join'
      ? (entry.keys || []).map((k) => getVal(props, k)).filter(Boolean).join('<br>')
      : getVal(props, entry.key);

    if (!value) return '';

    // 'link' format renders as a button-style anchor, no label row needed
    if (entry.format === 'link') {
      return `<a class="reg-link" href="${escapeHtml(value)}" target="_blank" rel="noopener">${entry.linkText || value}</a>`;
    }

    const display =
      entry.format === 'rule'   ? formatRuleText(value)
      : entry.format === 'bullet' ? formatBulletsWithIndents(value)
      : entry.format === 'date'   ? formatDate(value)
      :                             escapeHtml(value);

    return `
      <div class="field-block">
        <div class="field-block__label">${entry.label}</div>
        <div>${display}</div>
      </div>`;
  }

  // Render all fields for a given tab from the schema
  function renderTab(tabKey, props) {
    return (FIELD_SCHEMA[tabKey] || [])
      .map((entry) => renderSchemaField(entry, props))
      .join('');
  }

  function buildAreaNamesList(features) {
    return features.map((f) => `
      <div class="mm-bullet-container">
        <span class="mm-bullet-point">•</span>
        <span class="mm-bullet-text">${escapeHtml(
          getVal(f.properties, 'Full_name') ||
          getVal(f.properties, 'Full_Name') ||
          'Unknown Area',
        )}</span>
      </div>`).join('');
  }

  // Summary card block — driven by SUMMARY_SCHEMA so it stays in sync
  // with the rules tab automatically
  function buildSummaryBlock(title, fieldKey, features) {
    const items = features
      .map((f) => ({
        name: getVal(f.properties, 'Full_name') || getVal(f.properties, 'Full_Name'),
        val:  getVal(f.properties, fieldKey),
      }))
      .filter((i) => i.val);

    if (!items.length) return '';

    return `
      <div class="summary-field-block">
        <div class="summary-section-title">${title}</div>
        ${items.map((item) => `
          <div class="area-label">${escapeHtml(item.name)}:</div>
          <div class="rule-rich-text">${formatRuleText(item.val)}</div>
        `).join('')}
      </div>`;
  }

  // Build just the collapsible panel content — the trigger button now lives
  // in the mmpopup header so it's always visible regardless of scroll position.
  function buildSummaryPanel(features) {
    const stateRegsUrl =
      getVal(features[0].properties, 'State_Fishing_Regs_URL') || FALLBACK_REGS_URL;

    return `
      <div class="summary-accordion__panel--inline" hidden>
        <div class="area-section mmcard mmcard--summary" style="border-top-left-radius:0;border-top-right-radius:0;margin-bottom:0;">
          <div class="mmcard__body">
            <h3 class="mmcard__title">Fishing Rules Summary</h3>
            <span class="mmcard__subtitle-label">Managed areas at this location:</span>
            <div class="mmcard__subtitle">${buildAreaNamesList(features)}</div>
            <div class="mm-statewide-notice">
              Reminder: All
              <a href="${escapeHtml(stateRegsUrl)}" target="_blank" rel="noopener">Statewide Fishing Regulations</a>
              still apply here.
            </div>
            <div class="mmtabs">
              <button class="active" type="button">CONSOLIDATED RULES</button>
            </div>
            <div class="tab-pane summary-field-stack">
              ${SUMMARY_SCHEMA.map((s) => buildSummaryBlock(s.title, s.fieldKey, features)).join('')}
            </div>
          </div>
        </div>
      </div>`;
  }

  function buildCarousel(images, areaName) {
    if (!images.length) return '';
    const encodedImages = images.map((u) => encodeURIComponent(u)).join('|');
    return `
      <div class="mmcard__image-wrap" data-carousel-index="0">
        <img class="mmcard__image" src="${escapeHtml(images[0])}" alt="${escapeHtml(areaName)}">
        ${images.length > 1
          ? `<button
               class="mmcard__image-next"
               type="button"
               aria-label="Next image"
               data-images="${encodedImages}"
             >›</button>`
          : ''}
      </div>`;
  }

  function buildAreaCard(feature, uid) {
    const props    = feature.properties;
    const name     = getVal(props, 'Full_name') || getVal(props, 'Full_Name') || 'Unknown Area';
    const stateUrl = getVal(props, 'State_Fishing_Regs_URL') || FALLBACK_REGS_URL;
    const images   = [
      getVal(props, 'Area_Image_URL_1'),
      getVal(props, 'Area_Image_URL_2'),
      getVal(props, 'Area_Image_URL_3'),
    ].filter(Boolean);

    return `
      <div class="area-section mmcard">
        ${buildCarousel(images, name)}
        <div class="mmcard__body">
          <h3 class="mmcard__title">${escapeHtml(name)}</h3>

          <div class="mmtabs">
            <button type="button" data-tab-target="about-${uid}">ABOUT</button>
            <button type="button" data-tab-target="rules-${uid}" class="active">RULES</button>
            <button type="button" data-tab-target="laws-${uid}">LAWS</button>
          </div>

          <div id="about-${uid}" class="tab-pane field-stack" hidden>
            ${renderTab('about', props)}
          </div>

          <div id="rules-${uid}" class="tab-pane field-stack">
            <div class="mm-statewide-notice">
              Reminder: All
              <a href="${escapeHtml(stateUrl)}" target="_blank" rel="noopener">Statewide Fishing Regulations</a>
              still apply here.
            </div>
            ${renderTab('rules', props)}
          </div>

          <div id="laws-${uid}" class="tab-pane field-stack" hidden>
            ${renderTab('laws', props)}
          </div>

        </div>
      </div>`;
  }

  // Switch which tab pane is visible within an area card
  function showTab(btn, tabId) {
    const section = btn.closest('.area-section');
    if (!section) return;
    section.querySelectorAll('.tab-pane').forEach((p) => { p.hidden = true; });
    btn.parentElement.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
    const target = section.querySelector(`#${CSS.escape(tabId)}`);
    if (target) target.hidden = false;
    btn.classList.add('active');
  }

  function toggleSummaryAccordion(btn) {
    // btn is the .mmpopup__header--toggle button
    const isExpanded = btn.getAttribute('aria-expanded') === 'true';
    const nextState  = !isExpanded;
    btn.setAttribute('aria-expanded', String(nextState));

    // Find the inline panel — first sibling inside .mmpopup__scroll
    const scroll = btn.closest('.mmpopup')?.querySelector('.mmpopup__scroll');
    const panel  = scroll?.querySelector('.summary-accordion__panel--inline');
    if (panel) panel.hidden = !nextState;

    // Update label text
    const label = btn.querySelector('.mmpopup__summary-trigger-label');
    if (label) {
      label.textContent = nextState
        ? 'Hide consolidated fishing rules'
        : 'See consolidated fishing rules summary';
    }
  }

  // No-op kept for compatibility — panel is now always accessible via header
  function collapseSummaryAccordion() {}


  // ── 15. INFO PANEL — OPEN / CLOSE ────────────────────────────
  function openInfoPanel(latlng, features, options = {}) {
    // Store for re-centring after resize
    activeLastLatlng = latlng || null;

    const isMulti     = features.length > 1;
    const headerTitle = isMulti ? `${features.length} Areas Selected` : '1 Area Selected';
    const cardsHtml   = features.map((f, i) => buildAreaCard(f, `area-${i}`)).join('');
    const dividerHtml = isMulti
      ? '<div class="section-divider">Detailed area information below</div>'
      : '';

    // Multi-area: header becomes the summary accordion trigger.
    // Single area: plain centred label as before.
    const headerHtml = isMulti
      ? `<button
           class="mmpopup__header--toggle"
           type="button"
           aria-expanded="false"
           data-action="toggle-summary"
         >
           <div class="mmpopup__header-row">
             <span class="mmpopup__header-title">${headerTitle}</span>
           </div>
           <div class="mmpopup__summary-trigger">
             <span class="mmpopup__summary-trigger-label">See consolidated fishing rules summary</span>
             <span class="mmpopup__summary-trigger-chevron" aria-hidden="true">▼</span>
           </div>
         </button>`
      : `<div class="mmpopup__header-inner">
           <span class="mmpopup__header-title">${headerTitle}</span>
         </div>`;

    // Summary panel is now just the card content (no outer accordion wrapper)
    // — the trigger lives in the header above
    const summaryPanelHtml = isMulti ? buildSummaryPanel(features) : '';

    infoContentEl.innerHTML = `
      <div class="mmpopup">
        <div class="mmpopup__header">${headerHtml}</div>
        <div class="mmpopup__scroll">
          ${summaryPanelHtml}
          ${dividerHtml}
          ${cardsHtml}
        </div>
      </div>`;

    const scrollEl = infoContentEl.querySelector('.mmpopup__scroll');
    if (scrollEl) scrollEl.scrollTop = 0;

    updateInfoBannerTitle();

    if (isMobileView()) {
      // Reset to half state whenever a new panel opens
      paneStageEl?.classList.remove('is-minimized', 'is-expanded');
      paneStageEl?.classList.add('is-info-view');
      setMobileInfoPaneVisibility(true);
      setMapSidebarMobileState('open');
      setInfoSidebarState('open');
      setMobilePaneStage('info');
      ensureInfoResizeBtn();
      updateInfoResizeBtn();

      // After sheet settles, centre feature in the visible strip above
      if (latlng) {
        setTimeout(() => flyToMobileVisibleCenter(latlng), SHEET_TRANSITION_MS);
      }
    } else {
      setInfoSidebarState('expanded');
    }

    hasEverSelected = true;
    hideInfoHint();

    if (options.source === 'map' && latlng) {
      clearAccordionSelectionHighlight();
      updateClickMarker(latlng);
    }
  }

  // FIX: removed dead `if (isMobileView())` block after the early return —
  // it could never execute. setMobileHomeState() already calls
  // setInfoSidebarState('hidden') internally.
  function closeInfoPanel() {
    if (isMobileView()) {
      setMobileHomeState({ hideInfoAfterTransition: true });
      return;
    }
    setInfoSidebarState('hidden');
  }


  // ── 16. SIDEBAR — POPULATION ─────────────────────────────────
  // Receives pre-sorted names so it doesn't need to re-sort on every render.
  function populateSidebar(islandName, sortedNames) {
    if (!islandListEl) return;

    const notice = document.getElementById('loading-notice');
    if (notice) notice.remove();

    const islandId = islandName.replace(/[^a-zA-Z0-9]/g, '');
    const fragment = document.createDocumentFragment();

    const group       = document.createElement('div');
    group.className   = 'island-group';

    // <button> instead of <div> — keyboard-reachable by default
    const header      = document.createElement('button');
    header.className  = 'island-header';
    header.id         = `header-${islandId}`;
    header.setAttribute('aria-expanded', 'false');
    header.setAttribute('aria-controls',  `list-${islandId}`);
    header.addEventListener('click', () => toggleIsland(islandId));

    const headerLeft      = document.createElement('div');
    headerLeft.className  = 'header-left';

    const checkbox    = document.createElement('input');
    checkbox.type     = 'checkbox';
    checkbox.checked  = true;
    checkbox.setAttribute('aria-label', `Show ${islandName} on map`);
    checkbox.addEventListener('click', (e) => toggleLayerVisibility(e, islandName));

    const islandLabel = document.createElement('span');
    islandLabel.textContent = islandName;

    headerLeft.append(checkbox, islandLabel);

    const chevron     = document.createElement('span');
    chevron.className = 'chevron';
    chevron.textContent = '▼';
    chevron.setAttribute('aria-hidden', 'true');

    header.append(headerLeft, chevron);

    const list      = document.createElement('div');
    list.id         = `list-${islandId}`;
    list.className  = 'area-list';
    list.setAttribute('role', 'list');

    sortedNames.forEach((areaName) => {
      const item        = document.createElement('div');
      item.className    = 'area-item';
      item.textContent  = areaName;
      item.tabIndex     = 0;
      item.setAttribute('role',       'button');
      item.setAttribute('aria-label', `View details for ${areaName}`);
      item.dataset.island = islandName;
      item.dataset.area   = areaName;

      item.addEventListener('click',      () => zoomToArea(islandName, areaName));
      item.addEventListener('keydown',    (e) => { if (e.key === 'Enter') zoomToArea(islandName, areaName); });
      item.addEventListener('mouseenter', () => hoverArea(islandName, areaName));
      item.addEventListener('mouseleave', clearHoverHighlight);

      list.appendChild(item);
    });

    group.append(header, list);
    fragment.appendChild(group);
    islandListEl.appendChild(fragment);
  }


  // ── 17. SIDEBAR — INTERACTIONS ───────────────────────────────
  function toggleIsland(id) {
    const list   = document.getElementById(`list-${id}`);
    const header = document.getElementById(`header-${id}`);
    if (!list || !header) return;

    const shouldOpen = !list.classList.contains('active');

    // On mobile: enforce single-expand (close others before opening)
    if (isMobileView()) {
      document.querySelectorAll('.area-list.active').forEach((el) => {
        if (el.id !== `list-${id}`) el.classList.remove('active');
      });
      document.querySelectorAll('.island-header.expanded').forEach((el) => {
        if (el.id !== `header-${id}`) el.classList.remove('expanded');
      });
    }

    list.classList.toggle('active',   shouldOpen);
    header.classList.toggle('expanded', shouldOpen);
    header.setAttribute('aria-expanded', String(shouldOpen));

    if (isMobileView() && shouldOpen) {
      islandListEl?.scrollTo({ top: header.offsetTop - 2, behavior: 'smooth' });
    }
  }

  function toggleLayerVisibility(event, islandName) {
    event.stopPropagation();
    const layer = allIslandLayers[islandName];
    if (!layer) return;
    if (event.target.checked) map.addLayer(layer);
    else map.removeLayer(layer);
  }

  function zoomToArea(islandName, areaName) {
    setCompactMode(true);
    setActiveAreaItem(islandName, areaName);

    const layerGroup = allIslandLayers[islandName];
    if (!layerGroup) return;

    layerGroup.eachLayer((layer) => {
      const name =
        getVal(layer.feature.properties, 'Full_Name') ||
        getVal(layer.feature.properties, 'Full_name');
      if (name !== areaName) return;

      const bounds      = layer.getBounds();
      const center      = bounds.getCenter();
      const openPanel   = () => openInfoPanel(center, [layer.feature], { source: 'menu' });

      map.stop();

      // ── Mobile: open the panel immediately (sheet opens, then
      //    openInfoPanel's setTimeout centres the polygon in the visible
      //    strip above the settled sheet). No desktop-style flyToBounds.
      if (isMobileView()) {
        openPanel();
        flashLayerBorder(layer);
        return;
      }

      // ── Desktop: existing fly logic, accounting for sidebar overlay
      const alreadyFits     = featureFitsVisibleArea(bounds);
      const alreadyCentered = featureIsCenteredInVisibleArea(bounds);
      const targetFitZoom   = getTargetFitZoom(bounds);
      const needsFly        = !alreadyFits || map.getZoom() < targetFitZoom - 0.05;
      const noInfoVisible   = !infoSidebarEl.classList.contains('active');

      if (needsFly) {
        const leftWidth = getLeftOverlayWidth();
        if (noInfoVisible) {
          map.once('moveend', () => { openPanel(); flashLayerBorder(layer); });
        } else {
          openPanel();
          map.once('moveend', () => flashLayerBorder(layer));
        }
        map.flyToBounds(bounds, {
          animate:            true,
          duration:           2.0,
          easeLinearity:      0.2,
          paddingTopLeft:     [leftWidth + 30, 30],
          paddingBottomRight: [30, 30],
        });
      } else if (!alreadyCentered) {
        if (noInfoVisible) {
          map.once('moveend', () => { openPanel(); flashLayerBorder(layer); });
        } else {
          openPanel();
          map.once('moveend', () => flashLayerBorder(layer));
        }
        flySelectionIntoVisibleArea(bounds.getCenter(), 1.0);
      } else {
        openPanel();
        flashLayerBorder(layer);
      }
    });
  }

  function hoverArea(islandName, areaName) {
    const layerGroup = allIslandLayers[islandName];
    if (!layerGroup) return;

    let matched = null;
    layerGroup.eachLayer((layer) => {
      if (matched) return;
      const name =
        getVal(layer.feature.properties, 'Full_Name') ||
        getVal(layer.feature.properties, 'Full_name');
      if (name === areaName) matched = layer;
    });

    if (!matched || !map.getBounds().intersects(matched.getBounds())) return;
    applyHoverHighlight(matched);
  }

  function clearSidebarSearch() {
    if (!areaSearchEl) return;
    areaSearchEl.value = '';
    filterSidebar();
    areaSearchEl.focus();
  }

  function filterSidebar() {
    const term = normalizeHawaiianText(areaSearchEl?.value || '');

    document.querySelectorAll('.island-group').forEach((group) => {
      const islandLabel = group.querySelector('.header-left span')?.textContent || '';
      const islandMatch = term !== '' && normalizeHawaiianText(islandLabel).includes(term);
      let hasMatch      = false;

      group.querySelectorAll('.area-item').forEach((item) => {
        const matches = term === '' || islandMatch || normalizeHawaiianText(item.textContent).includes(term);
        item.style.display = matches ? '' : 'none';
        if (matches) hasMatch = true;
      });

      const list   = group.querySelector('.area-list');
      const header = group.querySelector('.island-header');

      if (term !== '' && hasMatch) {
        group.style.display = '';
        list?.classList.add('active');
        header?.classList.add('expanded');
        header?.setAttribute('aria-expanded', 'true');
      } else if (term !== '' && !hasMatch) {
        group.style.display = 'none';
      } else {
        group.style.display = '';
        list?.classList.remove('active');
        header?.classList.remove('expanded');
        header?.setAttribute('aria-expanded', 'false');
      }
    });
  }


  // ── 18. DATA LOADING ─────────────────────────────────────────
  function splitFeaturesByIsland(features) {
    const grouped = {};
    features.forEach((f) => {
      const island = getVal(f.properties, 'Island') || 'Unknown';
      if (!grouped[island]) grouped[island] = [];
      grouped[island].push(f);
    });

    const orderedKeys = [
      ...ISLAND_DISPLAY_ORDER.filter((n) => grouped[n]),
      ...Object.keys(grouped)
        .filter((n) => !ISLAND_DISPLAY_ORDER.includes(n))
        .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })),
    ];

    return orderedKeys.map((name) => ({ name, features: grouped[name] }));
  }

  async function loadAllFromSingleService() {
    try {
      // Fetch metadata and GeoJSON in parallel
      const [metaResp, dataResp] = await Promise.all([
        fetch(`${SERVICE_LAYER_URL}?f=json`),
        fetch(`${SERVICE_LAYER_URL}/query?where=1=1&outFields=*&f=geojson&returnGeometry=true`),
      ]);

      const [metadata, geojson] = await Promise.all([
        metaResp.json(),
        dataResp.json(),
      ]);

      const renderer      = metadata?.drawingInfo?.renderer;
      const globalOpacity = (100 - (metadata?.drawingInfo?.transparency || 0)) / 100;
      const grouped       = splitFeaturesByIsland(geojson.features || []);

      grouped.forEach(({ name, features }) => {
        // Sort area names once at load time — populateSidebar uses them directly
        const sortedNames = features
          .map((f) => getVal(f.properties, 'Full_Name') || getVal(f.properties, 'Full_name') || 'Unknown')
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));

        const islandLayer = L.geoJSON({ type: 'FeatureCollection', features }, {
          style: (feature) => {
            const fName = (
              getVal(feature.properties, 'Full_Name') ||
              getVal(feature.properties, 'Full_name') ||
              ''
            ).toLowerCase();

            const match = renderer?.uniqueValueInfos?.find(
              (info) => String(info.value || '').toLowerCase() === fName,
            );

            if (match) {
              const c = match.symbol.color;
              return {
                fillColor:   `rgba(${c[0]},${c[1]},${c[2]},${c[3] / 255})`,
                fillOpacity: globalOpacity,
                color:       `rgb(${match.symbol.outline.color.slice(0, 3).join(',')})`,
                weight:      1.5,
              };
            }

            return { weight: 1.2, fillOpacity: 0.3, color: '#005a87' };
          },

          onEachFeature: (_feature, layer) => {
            layer.on('click', (e) => {
              L.DomEvent.stopPropagation(e);
              setCompactMode(true);

              const hits = [];
              Object.values(allIslandLayers).forEach((group) => {
                if (!map.hasLayer(group)) return;
                group.eachLayer((l) => {
                  if (pointInFeatureGeometry(e.latlng, l.feature)) hits.push(l.feature);
                });
              });

              if (hits.length) {
                if (hits.length === 1) {
                  setActiveAreaItem(
                    getVal(hits[0].properties, 'Island'),
                    getVal(hits[0].properties, 'Full_Name') || getVal(hits[0].properties, 'Full_name'),
                  );
                } else {
                  setActiveAreaItem(null, null);
                }
                openInfoPanel(e.latlng, hits, { source: 'map' });
              } else {
                clearMapSelection({ fromClick: true });
              }
            });
          },
        }).addTo(map);

        allIslandLayers[name] = islandLayer;
        populateSidebar(name, sortedNames);
      });

      // Signal to screen readers that the list is ready
      islandListEl?.removeAttribute('aria-busy');

    } catch (err) {
      console.error('[haMMA] Failed to load service data:', err);
      islandListEl?.removeAttribute('aria-busy');

      if (islandListEl) {
        islandListEl.innerHTML = `
          <div class="error-notice">
            <p>Unable to load marine areas. Please check your connection.</p>
            <button class="retry-btn" type="button" id="retry-load-btn">Try again</button>
          </div>`;
        document.getElementById('retry-load-btn')?.addEventListener('click', () => {
          islandListEl.innerHTML =
            '<div class="loading-notice" role="status">Loading marine areas…</div>';
          islandListEl.setAttribute('aria-busy', 'true');
          loadAllFromSingleService();
        });
      }
    }
  }


  // ── 19. EVENT WIRING ─────────────────────────────────────────

  // Search
  areaSearchEl?.addEventListener('input',  filterSidebar);
  areaSearchEl?.addEventListener('focus',  () => setCompactMode(true));
  searchClearEl?.addEventListener('click', clearSidebarSearch);

  // Desktop close button
  closeInfoBtnEl?.addEventListener('click', clearMapSelection);

  // Info panel — single delegated listener for all dynamic content:
  // tab buttons, summary accordion toggle, and image carousel
  infoContentEl?.addEventListener('click', (e) => {
    // Tab switching
    const tabBtn = e.target.closest('[data-tab-target]');
    if (tabBtn) {
      showTab(tabBtn, tabBtn.dataset.tabTarget);
      return;
    }

    // Summary accordion
    const accordionToggle = e.target.closest('[data-action="toggle-summary"]');
    if (accordionToggle) {
      toggleSummaryAccordion(accordionToggle);
      return;
    }

    // Image carousel next button
    const nextBtn = e.target.closest('.mmcard__image-next');
    if (nextBtn) {
      const wrap = nextBtn.closest('.mmcard__image-wrap');
      const img  = wrap?.querySelector('.mmcard__image');
      if (!wrap || !img) return;

      const urls = (nextBtn.dataset.images || '')
        .split('|')
        .filter(Boolean)
        .map(decodeURIComponent);
      if (urls.length < 2) return;

      const next = (Number(wrap.dataset.carouselIndex || 0) + 1) % urls.length;
      wrap.dataset.carouselIndex = String(next);
      img.src = urls[next];
    }
  });

  // Map events
  map.on('click',     () => clearMapSelection({ fromClick: true }));
  map.on('movestart', () => setCompactMode(true));

  // Resize — debounced so syncResponsiveSidebarState isn't called on every pixel
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(syncResponsiveSidebarState, 100);
  });

  MOBILE_BREAKPOINT.addEventListener('change', syncResponsiveSidebarState);

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncMobileBrowserInset, { passive: true });
    window.visualViewport.addEventListener('scroll', syncMobileBrowserInset, { passive: true });
  }


  // ── 20. BOOT ─────────────────────────────────────────────────
  // FIX: original code also called setMobileHomeState() inline and inside
  // window.onload, causing triple-initialization on mobile. A single call to
  // syncResponsiveSidebarState() is the correct and complete setup path.
  syncResponsiveSidebarState();
  setInitialMapExtent();
  loadAllFromSingleService();
  showInfoHint();

})();
