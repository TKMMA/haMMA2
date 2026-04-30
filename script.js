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
      { key: 'HRS_Name',  label: 'HRS Name' },
      { key: 'HRS_Link',  label: 'HRS Document', format: 'link', linkText: 'View HRS document ›' },
      { key: 'Law_Other_Name_1', urlKey: 'Law_Other_URL_1', label: 'Other Law Reference', format: 'textLink', linkText: 'View reference ›' },
      { key: 'Law_Other_Name_2', urlKey: 'Law_Other_URL_2', label: 'Other Law Reference', format: 'textLink', linkText: 'View reference ›' },
      { key: 'State_Fishing_Regs_Text', urlKey: 'State_Fishing_Regs_URL', label: 'Statewide Fishing Regulations', format: 'textLink', linkText: 'View statewide regulations ›' },
      { key: 'Rules_Also_Text', urlKey: 'Rules_Also_URL', label: 'Additional Rules', format: 'textLink', linkText: 'View additional rules ›' },
      { key: 'Mgmt_Auth', label: 'Management Authority', format: 'bullet' },
      { key: 'Enf_Auth', label: 'Enforcement Authority', format: 'bullet' },
      { key: 'Penalties', label: 'Penalties',    format: 'bullet' },
    ],
  };

  // Summary card pulls from the rules tab fields — driven by schema so it
  // stays in sync automatically if rules fields are ever added or reordered.
  const SUMMARY_SCHEMA = FIELD_SCHEMA.rules.map((f) => ({
    title:    f.label,
    fieldKey: f.key,
  }));
  const SUMMARY_GROUP_ORDER = ['prohibited', 'allowed', 'limited', 'other'];
  const SUMMARY_GROUP_LABELS = {
    prohibited: 'Prohibited',
    allowed: 'Allowed',
    limited: 'Allowed with limits',
    other: 'Other / notes',
  };



  // ── 2. STATE ─────────────────────────────────────────────────
  const allIslandLayers      = {};
  let activeSelectionMarker  = null;
  let activeAccordionLayer   = null;
  let activeHoverLayer       = null;
  let activeLastLatlng       = null;  // last latlng used to open the info panel
  let _flyTimer              = null;  // pending mobile fly-to timer


  // ── 3. DOM REFERENCES ────────────────────────────────────────
  const mapInterfaceEl = document.querySelector('.map-interface');
  const paneStageEl    = document.getElementById('pane-stage');
  const mapSidebarEl   = document.getElementById('map-sidebar');
  const infoSidebarEl  = document.getElementById('info-sidebar');
  const islandListEl   = document.getElementById('island-list');
  const infoContentEl  = document.getElementById('info-content');
  const areaSearchEl   = document.getElementById('area-search');
  const searchClearEl  = document.getElementById('search-clear-btn');


  // ── 4. UTILITIES ─────────────────────────────────────────────

  // Return a property value by case-insensitive key, or null if absent / blank / "N/A"
  function getVal(props, key) {
    const found = Object.keys(props).find((k) => k.toLowerCase() === key.toLowerCase());
    const val   = found ? props[found] : null;
    return val === 'N/A' || val === '' || val === null ? null : val;
  }

  function getFeatureName(props) {
    return (getVal(props, 'Full_Name') || getVal(props, 'Full_name') || 'Unknown Area').trim();
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
      ? escapeHtml(dateVal)
      : `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;
  }

  function getSafeUrl(value) {
    if (!value || value === 'N/A') return null;
    const raw = String(value).trim();
    if (!raw) return null;
    try {
      const parsed = new URL(raw, window.location.href);
      return (parsed.protocol === 'http:' || parsed.protocol === 'https:') ? parsed.href : null;
    } catch (_err) {
      return null;
    }
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
          <span class="mm-bullet-text">${escapeHtml(l.replace(/^[•●○◦*-]\s+/, '').trim())}</span>
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

  function buildSummarySources(features) {
    return features.map((feature, index) => ({
      id: index + 1,
      feature,
      name: getFeatureName(feature.properties),
      className: `source-chip--${(index % 8) + 1}`,
    }));
  }

  function renderSourceChip(source) {
    return `<span class="source-chip ${source.className}" title="Source ${source.id}: ${escapeHtml(source.name)}" aria-label="Source ${source.id}: ${escapeHtml(source.name)}">
      <span class="sr-only">Source </span>${source.id}
    </span>`;
  }

  function renderSourceChips(sources) {
    return sources.map((s) => renderSourceChip(s)).join('');
  }

  function splitRuleLines(text) {
    if (!text || text === 'N/A') return [];
    return normalizeRuleSegments(text)
      .replace(/([^\n])\s+(?=(?:Prohibited|Allowed(?:\s+with\s+limits|\s+with\s+limitations)?)[^:\n]*:?\s*)/gi, '$1\n')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }

  function classifyRuleLine(line) {
    const value = String(line).trim();
    const lower = value.toLowerCase();
    if (/^prohibited\b/.test(lower)) return 'prohibited';
    if (/^allowed\b.*\b(limit|limits|limitation|limitations)\b/.test(lower) || /^allowed\s+with\s+limits?\b/.test(lower)) return 'limited';
    if (/^allowed\b/.test(lower)) return 'allowed';
    return 'other';
  }

  function parseRuleField(text) {
    return splitRuleLines(text).map((line) => ({
      text: line,
      status: classifyRuleLine(line),
    }));
  }

  function normalizeRuleForMerge(text) {
    return String(text)
      .replace(/\s+/g, ' ')
      .replace(/[.]+$/g, '.')
      .trim()
      .toLowerCase();
  }

  function getAreaImages(feature) {
    const props = feature?.properties || {};
    const areaName = getFeatureName(props) || 'Managed area';
    // TODO: Replace/augment this placeholder field mapping with ArcGIS
    // attachment retrieval later. Keep returning this same normalized shape
    // so carousel/card renderers do not need to change.
    return ['Area_Image_URL_1', 'Area_Image_URL_2', 'Area_Image_URL_3']
      .map((key) => getSafeUrl(getVal(props, key)))
      .filter(Boolean)
      .map((url) => ({
        url,
        alt: areaName,
        caption: '',
      }));
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


  // ── 7. RESPONSIVE / LAYOUT HELPERS ───────────────────────────
  const isMobileView = () => MOBILE_BREAKPOINT.matches;

  function syncMobileBrowserInset() {
    if (!paneStageEl) return;
    const vv = window.visualViewport;
    const inset = vv
      ? Math.max(0, Math.round(window.innerHeight - (vv.height + vv.offsetTop)))
      : 0;
    paneStageEl.style.setProperty('--browser-offset', `${inset}px`);
  }

  function syncLeafletControlPosition() {
    const target = isMobileView() ? 'bottomright' : 'topright';
    if (zoomControl.options.position === target) return;
    map.removeControl(zoomControl);
    zoomControl.setPosition(target);
    zoomControl.addTo(map);
  }

  function setMapSidebarDesktopState() {
    if (!mapSidebarEl || isMobileView()) return;
    mapSidebarEl.classList.remove('is-collapsed');
  }

  function syncSidebarToggleUI() {
    if (isMobileView()) return;
    mapInterfaceEl?.classList.remove('sidebar-collapsed');
    mapSidebarEl?.classList.remove('is-collapsed');
  }


  // ── 8. MOBILE STATE MACHINE ──────────────────────────────────
  //
  // Single source of truth: mobileState
  //   'hidden'    — sheet peeks (only banner visible), list panel showing
  //   'list-open' — list panel open at half height
  //   'list-full' — list panel at full height
  //   'info-half' — info panel open at half height
  //   'info-full' — info panel at full height
  //
  // applyMobileState() is the ONLY place that touches mobile CSS classes.
  // Everything else just calls applyMobileState(nextState).

  let mobileState    = 'list-open';
  let lastListState  = 'list-open'; // remembered when switching to info view
  let activeLastBounds = null;      // L.LatLngBounds of current selection
  let _pendingMoveendHandler = null; // moveend handler waiting on flyToBounds

  // Snap positions as a fraction of screen height (stage Y offset)
  // These mirror the CSS custom property values in style.css
  function snapY(state) {
    const H = window.innerHeight;
    const bh = 58; // --sheet-banner-h (brand panel / info header height)
    if (state === 'hidden')    return H * 0.92 - bh;
    if (state === 'list-open') return H * 0.50 - bh;
    if (state === 'list-full') return H * 0.08;
    if (state === 'info-half') return H * 0.50 - bh;
    if (state === 'info-full') return H * 0.08;
    return H * 0.92 - bh;
  }

  // Map an info state to its matching list state (same Y height)
  function infoToListState(state) {
    if (state === 'info-full') return 'list-full';
    return 'list-open'; // info-half → list-open
  }

  function applyMobileState(nextState, opts = {}) {
    if (!isMobileView()) return;

    const prevState = mobileState;
    mobileState     = nextState;

    const stage = paneStageEl;
    const list  = mapSidebarEl;
    const info  = infoSidebarEl;
    if (!stage || !list || !info) return;

    // 'hidden' from the info drag zone means info-pane collapsed, NOT a pane switch.
    // Preserve is-info-view if we're collapsing from an info state.
    const wasInfoView = prevState === 'info-half' || prevState === 'info-full' ||
                        (prevState === 'hidden' && stage.classList.contains('is-info-view'));
    const isInfoView  = nextState === 'info-half' || nextState === 'info-full' ||
                        (nextState === 'hidden' && wasInfoView);

    // ── Remember list state when transitioning into info view ──
    if (!wasInfoView && isInfoView) {
      // Entering info: remember which list height we came from
      lastListState = (prevState === 'list-full') ? 'list-full' : 'list-open';
    }

    // ── X position ─────────────────────────────────────────────
    stage.classList.toggle('is-info-view', isInfoView);

    // ── Y position ─────────────────────────────────────────────
    // When going back to list from info, match the info panel's height
    let yState = nextState;
    if (wasInfoView && !isInfoView && nextState !== 'hidden') {
      yState = infoToListState(prevState);
      mobileState = yState; // keep state consistent
    }

    stage.classList.remove('is-hidden', 'is-open', 'is-full');
    if (yState === 'hidden') {
      stage.classList.add('is-hidden');
    } else if (yState === 'list-open' || yState === 'info-half') {
      stage.classList.add('is-open');
    } else {
      stage.classList.add('is-full');
    }

    // ── List panel ─────────────────────────────────────────────
    list.classList.toggle('is-collapsed', yState === 'hidden');

    // ── Info panel visibility ───────────────────────────────────
    // Keep the info panel active whenever we're in info-view (including
    // collapsed 'hidden' state) so the banner tab remains tappable.
    info.classList.toggle('is-offscreen', !isInfoView);
    info.classList.toggle('active',       isInfoView);

    // ── Schedule fly-to after sheet settles ─────────────────────
    const shouldRecentreInfoHalf = isInfoView && nextState === 'info-half' && !opts.skipRecentre;
    const returningFromFullToHalf = prevState === 'info-full' && nextState === 'info-half';
    if (shouldRecentreInfoHalf || returningFromFullToHalf) {
      scheduleMobileFly(activeLastBounds, activeLastLatlng);
    }
  }

  function syncResponsiveSidebarState() {
    if (!mapSidebarEl) return;

    if (isMobileView()) {
      // Re-apply current mobileState to restore correct classes
      // (called on resize / orientation change)
      applyMobileState(mobileState, { skipRecentre: true });
      syncMobileBrowserInset();
    } else {
      // Desktop — clear all mobile classes
      paneStageEl?.classList.remove('is-hidden', 'is-open', 'is-full', 'is-info-view', 'is-dragging');
      mapSidebarEl.classList.remove('is-collapsed');
      infoSidebarEl.classList.remove('is-offscreen');
      setMapSidebarDesktopState();
    }

    syncSidebarToggleUI();
    syncLeafletControlPosition();

    // Tell Leaflet about the size change so tiles aren't clipped
    // after orientation flips or window resizes.
    if (map) map.invalidateSize({ animate: false });
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


  // ── DRAG BEHAVIOUR ───────────────────────────────────────────
  // The drag zone in each banner directly controls the pane-stage Y
  // transform in real time. On release it snaps to the nearest valid
  // state using velocity projection.

  // Snap states available from each view
  const LIST_SNAPS = ['hidden', 'list-open', 'list-full'];
  const INFO_SNAPS = ['hidden', 'info-half', 'info-full'];

  let _drag = null; // active drag session

  function onBannerDragStart(e, panel) {
    if (!isMobileView() || !paneStageEl) return;
    e.preventDefault();

    const touch = (e.touches || [e])[0];

    // Read current Y from computed matrix (may be mid-transition)
    // Cancel transition first so we get the settled value
    paneStageEl.classList.add('is-dragging');
    const matrix   = new DOMMatrix(getComputedStyle(paneStageEl).transform);
    const currentY = matrix.f;
    const currentX = matrix.e;

    _drag = {
      panel,
      startY:   touch.clientY,
      baseY:    currentY,
      currentX,
      lastY:    currentY,
      lastTime: Date.now(),
      velocity: 0,
    };
  }

  function onBannerDragMove(e) {
    if (!_drag) return;
    e.preventDefault();

    const touch    = (e.touches || [e])[0];
    const deltaY   = touch.clientY - _drag.startY;
    const rawY     = _drag.baseY + deltaY;

    // Clamp between full and hidden snap positions
    const minY = snapY('list-full');  // highest (most visible)
    const maxY = snapY('hidden');     // lowest (peeking)
    const clampedY = Math.max(minY, Math.min(maxY, rawY));

    // Track velocity
    const now = Date.now();
    const dt  = now - _drag.lastTime || 1;
    _drag.velocity = (clampedY - _drag.lastY) / dt;
    _drag.lastY    = clampedY;
    _drag.lastTime = now;

    paneStageEl.style.transform = `translate(${_drag.currentX}px, ${clampedY}px)`;
  }

  function onBannerDragEnd(e) {
    if (!_drag) return;
    if (e) e.preventDefault();

    const currentY   = _drag.lastY;
    const velocity   = _drag.velocity;
    const panel      = _drag.panel;

    // Re-enable CSS transitions, clear inline transform override
    paneStageEl.classList.remove('is-dragging');
    paneStageEl.style.transform = '';

    _drag = null;

    // Project 180ms forward to honour flick momentum
    const projectedY = currentY + velocity * 180;

    // Snap to nearest valid state for this panel
    const snaps = panel === 'info' ? INFO_SNAPS : LIST_SNAPS;
    const nearest = snaps
      .map((s) => ({ state: s, dist: Math.abs(projectedY - snapY(s)) }))
      .sort((a, b) => a.dist - b.dist)[0].state;

    applyMobileState(nearest);
  }

  function wireSheetBannerDrag(zoneId, panel) {
    const zone = document.getElementById(zoneId);
    if (!zone) return;
    zone.addEventListener('touchstart',  (e) => onBannerDragStart(e, panel), { passive: false });
    zone.addEventListener('touchmove',   onBannerDragMove,  { passive: false });
    zone.addEventListener('touchend',    onBannerDragEnd,   { passive: false });
    zone.addEventListener('touchcancel', onBannerDragEnd,   { passive: false });

    // Tap on the info tab when collapsed → restore to info-half
    if (panel === 'info') {
      zone.addEventListener('click', () => {
        if (mobileState === 'hidden' && paneStageEl?.classList.contains('is-info-view')) {
          applyMobileState('info-half');
        }
      });
    }
  }


  // ── 9. ACTIVE AREA SELECTION ─────────────────────────────────
  function setActiveAreaItem(islandName, areaName) {
    document.querySelectorAll('.area-item.active-area').forEach((el) => {
      el.classList.remove('active-area');
    });

    if (!islandName || !areaName) return;

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

  // Desktop-only — mobile uses flyToMobileVisible directly without rects.
  function getVisibleMapRect(padding = 30) {
    const size = map.getSize();
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

  function getMobileVisibleMapStrip() {
    const mapRect = map.getContainer().getBoundingClientRect();
    const stageRect = paneStageEl?.getBoundingClientRect();
    const sheetTop = stageRect ? Math.max(mapRect.top, stageRect.top) : (mapRect.top + mapRect.height * 0.5);
    const sidePadding = 16;
    const topPadding = 10;
    const bottomPadding = 8;
    const left = sidePadding;
    const right = Math.max(left + 40, mapRect.width - sidePadding);
    const top = topPadding;
    const bottom = Math.max(top + 24, (sheetTop - mapRect.top) - bottomPadding);
    const width = Math.max(40, right - left);
    const height = Math.max(24, bottom - top);
    return {
      left,
      right,
      top,
      bottom,
      width,
      height,
      centerX: left + (width / 2),
      centerY: top + (height / 2),
    };
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


  // Fit and centre the selection in the visible map strip above the sheet.
  // Cancels any in-flight pending call so two selections never race.
  // bounds: L.LatLngBounds of the selected feature (for zoom-to-fit).
  // latlng: centre point to centre on (used when bounds not available).
  // Place a polygon in the visible strip above the mobile bottom sheet.
  // Approach: pick a target zoom, compute the target screen position
  // (centre of visible strip), then offset the map centre by the difference.
  function flyToMobileVisible(bounds, latlng) {
    if (!isMobileView()) return;
    if (_flyTimer) { clearTimeout(_flyTimer); _flyTimer = null; }
    const center = latlng || (bounds ? bounds.getCenter() : null);
    if (!center) return;

    const screenW = map.getSize().x;
    const screenH = map.getSize().y;
    const strip = getMobileVisibleMapStrip();
    if (!strip) return;
    const stripCenterY = strip.centerY;
    const stripCenterX = screenW / 2;

    // ── Pick a zoom that fits the polygon in the visible strip ────
    let targetZoom = map.getZoom();
    if (bounds) {
      if (mobileState === 'info-full' && strip.height < 120) {
        return;
      }
      const stripH = strip.height;
      const stripW = strip.width;
      // Use a synthetic point as padding to fit-zoom into our strip
      targetZoom = map.getBoundsZoom(
        bounds,
        false,
        L.point(Math.max(32, screenW - stripW), Math.max(32, screenH - stripH)),
      );
      // Clamp to map's zoom range (imagery has no detail past ~17–18)
      const maxZ = map.getMaxZoom?.() ?? 18;
      const minZ = map.getMinZoom?.() ?? 0;
      targetZoom = Math.max(minZ, Math.min(targetZoom, Math.min(16, maxZ)));
    }

    // ── Compute target latlng: where the map centre needs to be so       ──
    // ── that `center` ends up at (stripCenterX, stripCenterY) on screen. ──
    // Project at the target zoom (not current zoom!), then offset.
    const centerPoint    = map.project(center, targetZoom);
    const offsetX        = stripCenterX - screenW / 2;
    const offsetY       = stripCenterY - screenH / 2;
    const targetMapPoint = centerPoint.subtract(L.point(offsetX, offsetY));
    const targetLatLng   = map.unproject(targetMapPoint, targetZoom);

    map.flyTo(targetLatLng, targetZoom, {
      animate: true,
      duration: 0.8,
      easeLinearity: 0.2,
    });
  }

  // Schedule a fly-to after the sheet settles, cancelling any previous pending call.
  function scheduleMobileFly(bounds, latlng, delay = SHEET_TRANSITION_MS) {
    if (_flyTimer) { clearTimeout(_flyTimer); _flyTimer = null; }
    _flyTimer = setTimeout(() => {
      _flyTimer = null;
      flyToMobileVisible(bounds, latlng);
    }, delay);
  }

  function getBoundsForFeatures(features) {
    if (!features?.length) return null;
    try {
      const fc = { type: 'FeatureCollection', features };
      const bounds = L.geoJSON(fc).getBounds();
      return bounds?.isValid?.() ? bounds : null;
    } catch (_err) {
      return null;
    }
  }

  // Point-in-polygon using ray casting
  function pointInRing(point, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      // Parity check below makes this branch unreachable for horizontal
      // edges (yi === yj), so no divide-by-zero guard is needed.
      const intersect =
        (yi > point[1]) !== (yj > point[1]) &&
        point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi;
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


  // ── 13. MAP SELECTION / CLEAR ────────────────────────────────
  function clearMapSelection(options = {}) {
    if (_flyTimer) { clearTimeout(_flyTimer); _flyTimer = null; }
    map.stop();
    activeLastBounds = null;
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
      // Clear is-info-view so x-position snaps back to list pane
      paneStageEl?.classList.remove('is-info-view');
      applyMobileState('list-open');
    } else {
      closeInfoPanel();
    }
  }


  // ── 14. INFO PANEL — HTML BUILDERS ───────────────────────────
  // Pure functions — each returns an HTML string.
  // Field knowledge lives in FIELD_SCHEMA above; these functions are
  // generic renderers that don't need to know which fields exist.

  // Render a single field row given a schema entry and a properties object
  function renderSchemaField(entry, props) {
    // Resolve the value — 'join' format merges multiple keys
    const value = entry.format === 'join'
      ? (entry.keys || []).map((k) => getVal(props, k)).filter(Boolean)
      : getVal(props, entry.key);

    if (!value) return '';

    // 'link' format renders as a button-style anchor, no label row needed
    if (entry.format === 'link') {
      const safeUrl = getSafeUrl(value);
      if (!safeUrl) return '';
      return `<a class="reg-link" href="${safeUrl}" target="_blank" rel="noopener">${entry.linkText || safeUrl}</a>`;
    }
    if (entry.format === 'textLink') {
      const textVal = getVal(props, entry.key);
      const safeUrl = getSafeUrl(getVal(props, entry.urlKey));
      if (!textVal && !safeUrl) return '';
      const textHtml = textVal
        ? `<div class="field-block"><div class="field-block__label">${entry.label}</div><div>${escapeHtml(textVal)}</div></div>`
        : '';
      const linkHtml = safeUrl
        ? `<a class="reg-link" href="${safeUrl}" target="_blank" rel="noopener">${entry.linkText || safeUrl}</a>`
        : '';
      return `${textHtml}${linkHtml}`;
    }

    const display =
      entry.format === 'join'     ? value.map((v) => escapeHtml(v)).join('<br>')
      : entry.format === 'rule'   ? formatRuleText(value)
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

  function buildCombinedRulesSummary(features) {
    const sources = buildSummarySources(features);
    const categories = SUMMARY_SCHEMA.map((schemaRow) => {
      const grouped = {
        prohibited: new Map(),
        allowed: new Map(),
        limited: new Map(),
        other: new Map(),
      };
      sources.forEach((source) => {
        const val = getVal(source.feature.properties, schemaRow.fieldKey);
        if (!val) return;
        parseRuleField(val).forEach((parsedLine) => {
          const key = normalizeRuleForMerge(parsedLine.text);
          if (!grouped[parsedLine.status].has(key)) {
            grouped[parsedLine.status].set(key, { text: parsedLine.text, sources: [] });
          }
          const item = grouped[parsedLine.status].get(key);
          if (!item.sources.some((s) => s.id === source.id)) item.sources.push(source);
        });
      });
      const groups = SUMMARY_GROUP_ORDER.map((groupKey) => ({
        key: groupKey,
        title: SUMMARY_GROUP_LABELS[groupKey],
        rules: Array.from(grouped[groupKey].values()),
      })).filter((group) => group.rules.length > 0 || group.key !== 'other');
      return { title: schemaRow.title, groups };
    }).filter((category) => category.groups.some((group) => group.rules.length));
    return { sources, categories };
  }

  function buildSummaryPanel(features) {
    const summary = buildCombinedRulesSummary(features);
    const hasRules = summary.categories.length > 0;
    return `
      <div class="summary-accordion__panel--inline" hidden>
        <div class="mmcard mmcard--summary overlap-summary-card">
          <div class="mmcard__body overlap-summary-intro">
            <div class="summary-card-label">Combined rules summary</div>
            <p class="summary-explainer">Rules are reorganized by category and status. Source chips indicate which selected area each rule line came from.</p>
            <div class="summary-source-legend overlap-source-list">
              <div class="summary-source-legend__label">Areas included:</div>
              <ul class="summary-area-list">${summary.sources.map((source) => `<li class="summary-area-name overlap-source-item">${renderSourceChip(source)} ${escapeHtml(source.name)}</li>`).join('')}</ul>
            </div>
            ${hasRules ? `<div class="summary-field-stack">
              ${summary.categories.map((category) => `
                <div class="summary-field-block">
                  <div class="summary-section-title">${escapeHtml(category.title)}</div>
                  ${category.groups.map((group) => group.rules.length ? `
                    <div class="summary-category summary-rule-group">
                      <div class="summary-category__title">${group.title}</div>
                      <div class="summary-category__list summary-rule-list">
                        ${group.rules.map((rule) => `
                          <div class="summary-rule-item">
                            <span class="summary-rule-item__text">${escapeHtml(rule.text)}</span>
                            <span class="summary-rule-item__sources summary-rule-source-chips">${renderSourceChips(rule.sources)}</span>
                          </div>`).join('')}
                      </div>
                    </div>` : '').join('')}
                </div>`).join('')}
            </div>` : `<p class="summary-empty">No combined rule text is available for these selected areas.</p>`}
          </div>
        </div>
      </div>`;
  }

  function buildCarousel(images, areaName) {
    if (!images.length) return '';
    const carouselImages = images;
    const encodedImages = images
      .map((img) => encodeURIComponent(JSON.stringify(img)))
      .join('|');
    const multi = carouselImages.length > 1;
    const dots = multi
      ? `<div class="mmcard__image-dots" aria-hidden="true">
           ${carouselImages.map((_, i) =>
             `<span class="mmcard__image-dot${i === 0 ? ' is-active' : ''}"></span>`
           ).join('')}
         </div>`
      : '';
    const navButtons = multi
      ? `<button
           class="mmcard__image-nav mmcard__image-prev"
           type="button"
           aria-label="Previous image"
           data-images="${encodedImages}"
           data-direction="-1"
         >‹</button>
         <button
           class="mmcard__image-nav mmcard__image-next"
           type="button"
           aria-label="Next image"
           data-images="${encodedImages}"
           data-direction="1"
         >›</button>`
      : '';
    return `
      <div class="mmcard__image-wrap" data-carousel-index="0">
        <img class="mmcard__image" src="${images[0].url}" alt="${escapeHtml(images[0].alt || areaName)}" loading="lazy">
        <div class="mmcard__image-fallback" hidden>Image unavailable</div>
        ${navButtons}
        ${dots}
      </div>`;
  }

  function buildAreaCard(feature, uid) {
    const props    = feature.properties;
    const name     = getFeatureName(props);
    const images   = getAreaImages(feature);

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
            ${renderTab('rules', props)}
          </div>

          <div id="laws-${uid}" class="tab-pane field-stack" hidden>
            ${renderTab('laws', props)}
          </div>

        </div>
      </div>`;
  }

  function renderSingleAreaInfoPane(feature) {
    return `
      <div class="mmpopup">
        <div class="mmpopup__scroll">
          ${buildAreaCard(feature, 'area-0')}
        </div>
      </div>`;
  }

  function renderOverlapHeader(features) {
    const count = features.length;
    return `
      <div class="overlap-context">
        <h3 class="overlap-context__title">${count} overlapping areas selected</h3>
        <p class="overlap-context__copy">Review the combined summary first, then use the source cards below for original rule text.</p>
      </div>`;
  }

  function renderAreaSpecificSection(features) {
    return `
      <section class="overlap-areas area-specific-section" aria-label="Area-specific rules">
        <h4 class="overlap-areas__title">Area-specific rules</h4>
        <p class="overlap-areas__copy">These cards preserve the original rules for each selected area.</p>
        ${features.map((f, i) => buildAreaCard(f, `area-${i}`)).join('')}
      </section>`;
  }

  function renderOverlapInfoPane(features) {
    const count = features.length;
    return `
      <div class="mmpopup">
        <button
          class="mmpopup__summary-banner"
          type="button"
          aria-expanded="false"
          data-action="toggle-summary"
          data-area-count="${count}"
        >
          <span class="mmpopup__summary-banner__cta">
            <span class="mmpopup__summary-trigger-label">Combined rules summary</span>
            <span class="mmpopup__summary-trigger-help">Multiple regulated areas overlap here. Expand this summary to review rules reorganized by activity.</span>
            <span class="mmpopup__summary-trigger-chevron" aria-hidden="true">▼</span>
          </span>
        </button>
        <div class="mmpopup__scroll">
          ${renderOverlapHeader(features)}
          ${buildSummaryPanel(features)}
          ${renderAreaSpecificSection(features)}
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

  // Expand or collapse the summary panel.
  // Uses max-height animation so collapse is smooth (not a snap).
  function setSummaryExpanded(btn, expand) {
    if (!btn) return;
    btn.setAttribute('aria-expanded', String(expand));

    const scroll = btn.closest('.mmpopup')?.querySelector('.mmpopup__scroll');
    const panel  = scroll?.querySelector('.summary-accordion__panel--inline');
    if (!panel) return;

    if (expand) {
      // Measure natural height, animate to it, then clear max-height
      // so content can grow freely (e.g. on resize)
      panel.hidden = false;
      panel.style.maxHeight = panel.scrollHeight + 'px';
      panel.style.opacity   = '1';
      panel.style.pointerEvents = '';
      // After transition ends, release the fixed height
      const onEnd = () => {
        panel.style.maxHeight = '';
        panel.removeEventListener('transitionend', onEnd);
      };
      panel.addEventListener('transitionend', onEnd);
    } else {
      // Pin current height first so CSS transition has a start value
      panel.style.maxHeight    = panel.scrollHeight + 'px';
      panel.style.opacity      = '1';
      // Force reflow so the pinned value takes effect before we set 0
      panel.getBoundingClientRect();
      panel.style.maxHeight    = '0';
      panel.style.opacity      = '0';
      panel.style.pointerEvents = 'none';
      const onEnd = () => {
        panel.hidden = true;
        panel.removeEventListener('transitionend', onEnd);
      };
      panel.addEventListener('transitionend', onEnd);
    }

    const label = btn.querySelector('.mmpopup__summary-trigger-label');
    if (label) {
      label.textContent = expand
        ? 'Hide combined rules summary'
        : 'Combined rules summary';
    }
  }

  function toggleSummaryAccordion(btn) {
    const isExpanded = btn.getAttribute('aria-expanded') === 'true';
    setSummaryExpanded(btn, !isExpanded);
  }



  // ── 15. INFO PANEL — OPEN / CLOSE ────────────────────────────
  function openInfoPanel(latlng, features, options = {}) {
    activeLastLatlng  = latlng || null;
    activeLastBounds = getBoundsForFeatures(features);

    const isMulti   = features.length > 1;
    const areaName  = getFeatureName(features[0].properties) || 'Area Info';
    const count = features.length;
    infoContentEl.innerHTML = isMulti
      ? renderOverlapInfoPane(features)
      : renderSingleAreaInfoPane(features[0]);

    infoContentEl.querySelector('.mmpopup__scroll').scrollTop = 0;

    // Sync the panel header title (desktop) and mobile banner title
    const panelTitle = isMulti
      ? `${count} Area${count === 1 ? '' : 's'} Selected`
      : areaName;
    const desktopTitle = document.getElementById('info-banner-title');
    const mobileTitle  = document.getElementById('info-banner-title-mobile');
    if (desktopTitle) desktopTitle.textContent = panelTitle;
    if (mobileTitle)  mobileTitle.textContent  = panelTitle;

    if (isMobileView()) {
      applyMobileState('info-half');
    } else {
      infoSidebarEl.classList.add('active');
    }


    if (options.source === 'menu' && activeSelectionMarker) {
      map.removeLayer(activeSelectionMarker);
      activeSelectionMarker = null;
    }

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
      applyMobileState('list-open');
      return;
    }
    infoSidebarEl.classList.remove('active');
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

    const islandLabel = document.createElement('span');
    islandLabel.textContent = islandName;

    headerLeft.append(islandLabel);

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
      item.addEventListener('keydown',    (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault(); // stop Space from scrolling the list
          zoomToArea(islandName, areaName);
        }
      });
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


  function zoomToArea(islandName, areaName) {
    setActiveAreaItem(islandName, areaName);

    const layerGroup = allIslandLayers[islandName];
    if (!layerGroup) return;

    layerGroup.eachLayer((layer) => {
      const name = getFeatureName(layer.feature.properties);
      if (name !== areaName) return;

      const bounds      = layer.getBounds();
      const center      = bounds.getCenter();
      const openPanel   = () => openInfoPanel(center, [layer.feature], { source: 'menu' });

      map.stop();

      // ── Mobile: store bounds then open panel.
      //    applyMobileState schedules flyToMobileVisible which uses the
      //    bounds to fit AND centre the polygon in the visible strip.
      if (isMobileView()) {
        activeLastBounds = bounds;
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

      // Cancel any pending moveend from a previous selection so its
      // late-firing flash doesn't land on the wrong polygon.
      if (_pendingMoveendHandler) {
        map.off('moveend', _pendingMoveendHandler);
        _pendingMoveendHandler = null;
      }

      const queueMoveend = (fn) => {
        _pendingMoveendHandler = () => {
          _pendingMoveendHandler = null;
          fn();
        };
        map.once('moveend', _pendingMoveendHandler);
      };

      if (needsFly) {
        const leftWidth = getLeftOverlayWidth();
        if (noInfoVisible) {
          queueMoveend(() => { openPanel(); flashLayerBorder(layer); });
        } else {
          openPanel();
          queueMoveend(() => flashLayerBorder(layer));
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
          queueMoveend(() => { openPanel(); flashLayerBorder(layer); });
        } else {
          openPanel();
          queueMoveend(() => flashLayerBorder(layer));
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
      const name = getFeatureName(layer.feature.properties);
      if (name === areaName) matched = layer;
    });

    if (!matched || !map.getBounds().intersects(matched.getBounds())) return;
    applyHoverHighlight(matched);
  }

  function clearSidebarSearch() {
    if (!areaSearchEl) return;
    areaSearchEl.value = '';
    syncSearchClearVisibility();
    filterSidebar();
    areaSearchEl.focus();
  }

  // Show the clear (✕) button only when there's text to clear
  function syncSearchClearVisibility() {
    const wrap = areaSearchEl?.closest('.search-input-wrapper');
    if (!wrap) return;
    wrap.classList.toggle('has-value', Boolean(areaSearchEl.value));
  }

  function filterSidebar() {
    const term = normalizeHawaiianText(areaSearchEl?.value || '');
    let totalMatches = 0;

    document.querySelectorAll('.island-group').forEach((group) => {
      const islandLabel = group.querySelector('.header-left span')?.textContent || '';
      const islandMatch = term !== '' && normalizeHawaiianText(islandLabel).includes(term);
      let hasMatch      = false;

      group.querySelectorAll('.area-item').forEach((item) => {
        const matches = term === '' || islandMatch || normalizeHawaiianText(item.textContent).includes(term);
        item.style.display = matches ? '' : 'none';
        if (matches) {
          hasMatch = true;
          totalMatches += 1;
        }
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

    let notice = document.getElementById('search-no-results');
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'search-no-results';
      notice.className = 'loading-notice';
      notice.textContent = 'No matching areas found';
      notice.hidden = true;
      islandListEl?.appendChild(notice);
    }
    notice.hidden = !(term !== '' && totalMatches === 0);
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
          .map((f) => getFeatureName(f.properties))
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));

        const islandLayer = L.geoJSON({ type: 'FeatureCollection', features }, {
          style: (feature) => {
            const fName = (
              getFeatureName(feature.properties)
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

          onEachFeature: (feature, layer) => {
            // Hover hint on the map (desktop only — mobile has no hover state)
            layer.on('mouseover', () => {
              if (!isMobileView()) applyHoverHighlight(layer);
            });
            layer.on('mouseout', () => {
              if (!isMobileView()) clearHoverHighlight();
            });

            layer.on('click', (e) => {
              L.DomEvent.stopPropagation(e);
              map.stop();
              if (_pendingMoveendHandler) {
                map.off('moveend', _pendingMoveendHandler);
                _pendingMoveendHandler = null;
              }
              // Collect ALL features under this click point across all visible
              // layers, then open the panel once. We use a microtask so that
              // if two overlapping polygons both fire their click handler in
              // the same event (which Leaflet does), we merge them into a
              // single openInfoPanel call instead of calling it twice.
              if (!map._haMMA_clickPending) {
                map._haMMA_clickPending = { latlng: e.latlng, hits: [] };
                Promise.resolve().then(() => {
                  const { latlng, hits } = map._haMMA_clickPending;
                  map._haMMA_clickPending = null;

                  if (!hits.length) { clearMapSelection({ fromClick: true }); return; }

                  if (hits.length === 1) {
                    setActiveAreaItem(
                      getVal(hits[0].properties, 'Island'),
                      getFeatureName(hits[0].properties),
                    );
                    if (isMobileView()) {
                      try { activeLastBounds = L.geoJSON(hits[0]).getBounds(); }
                      catch (_) { activeLastBounds = null; }
                    }
                  } else {
                    setActiveAreaItem(null, null);
                    activeLastBounds = null;
                  }
                  openInfoPanel(latlng, hits, { source: 'map' });
                  if (!isMobileView() && activeLastBounds) {
                    const leftWidth = getLeftOverlayWidth();
                    map.fitBounds(activeLastBounds, {
                      animate: true,
                      duration: 0.7,
                      paddingTopLeft: [Math.max(24, leftWidth + 24), 24],
                      paddingBottomRight: [24, 24],
                      maxZoom: 14,
                    });
                  }
                });
              }

              // Always include the clicked feature first. Some polygons with
              // complex geometries can fail custom point-in-polygon checks.
              const clickedId = getVal(feature.properties, 'OBJECTID') ??
                getVal(feature.properties, 'ObjectId') ??
                `${getFeatureName(feature.properties)}|${JSON.stringify(feature.geometry?.coordinates?.[0]?.[0] || '')}`;
              if (!map._haMMA_clickPending.hits.some((f) => {
                const existingId = getVal(f.properties, 'OBJECTID') ??
                  getVal(f.properties, 'ObjectId') ??
                  `${getFeatureName(f.properties)}|${JSON.stringify(f.geometry?.coordinates?.[0]?.[0] || '')}`;
                return existingId === clickedId;
              })) {
                map._haMMA_clickPending.hits.push(feature);
              }

              // Accumulate hits for this click point
              Object.values(allIslandLayers).forEach((group) => {
                if (!map.hasLayer(group)) return;
                group.eachLayer((l) => {
                  if (pointInFeatureGeometry(e.latlng, l.feature)) {
                    // Avoid duplicates if this feature was already added
                    const id = getVal(l.feature.properties, 'OBJECTID') ??
                      getVal(l.feature.properties, 'ObjectId') ??
                      `${getFeatureName(l.feature.properties)}|${JSON.stringify(l.feature.geometry?.coordinates?.[0]?.[0] || '')}`;
                    if (!map._haMMA_clickPending.hits.some((f) => {
                      const existingId = getVal(f.properties, 'OBJECTID') ??
                        getVal(f.properties, 'ObjectId') ??
                        `${getFeatureName(f.properties)}|${JSON.stringify(f.geometry?.coordinates?.[0]?.[0] || '')}`;
                      return existingId === id;
                    })) {
                      map._haMMA_clickPending.hits.push(l.feature);
                    }
                  }
                });
              });
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
  areaSearchEl?.addEventListener('input',  () => { syncSearchClearVisibility(); filterSidebar(); });
  searchClearEl?.addEventListener('click', clearSidebarSearch);

  // Mobile banner buttons
  document.getElementById('info-back-btn')?.addEventListener('click', () => {
    // Slide back to list at the same height the info panel was at
    applyMobileState(infoToListState(mobileState));
  });

  // Wire drag zones to the state machine.
  // List side: the brand panel itself is the drag surface.
  // Info side: the info-mobile-header contains the drag zone.
  // Wire drag zones — the protruding tab is the touch target for both panels.
  wireSheetBannerDrag('list-drag-zone', 'list');
  wireSheetBannerDrag('info-drag-zone', 'info');

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

    // Image carousel nav buttons (prev or next)
    const navBtn = e.target.closest('.mmcard__image-nav');
    if (navBtn) {
      const wrap = navBtn.closest('.mmcard__image-wrap');
      const img  = wrap?.querySelector('.mmcard__image');
      if (!wrap || !img) return;

      const images = (navBtn.dataset.images || '')
        .split('|')
        .filter(Boolean)
        .map((encoded) => {
          try { return JSON.parse(decodeURIComponent(encoded)); }
          catch (_err) { return null; }
        })
        .filter((img) => img?.url);
      if (images.length < 2) return;

      const direction = Number(navBtn.dataset.direction || 1);
      const cur  = Number(wrap.dataset.carouselIndex || 0);
      const next = (cur + direction + images.length) % images.length;
      wrap.dataset.carouselIndex = String(next);
      img.src = images[next].url;
      img.alt = images[next].alt || 'Area image';
      wrap.classList.remove('is-image-failed');
      const fallback = wrap.querySelector('.mmcard__image-fallback');
      if (fallback) fallback.hidden = true;

      // Sync dot indicators
      wrap.querySelectorAll('.mmcard__image-dot').forEach((dot, i) => {
        dot.classList.toggle('is-active', i === next);
      });
    }
  });

  infoContentEl?.addEventListener('error', (e) => {
    const imageEl = e.target.closest('.mmcard__image');
    if (!imageEl) return;
    const wrap = imageEl.closest('.mmcard__image-wrap');
    if (!wrap) return;
    imageEl.style.display = 'none';
    wrap.classList.add('is-image-failed');
    const fallback = wrap.querySelector('.mmcard__image-fallback');
    if (fallback) fallback.hidden = false;
  }, true);

  // Map events
  map.on('click',     () => { if (!isMobileView()) clearMapSelection({ fromClick: true }); });
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

})();
