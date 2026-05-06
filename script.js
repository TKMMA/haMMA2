/* ============================================================
   haMMA — Hawaii Managed Marine Areas
   Copyright (c) 2026 Tyler Kueffner
   All rights reserved.

   script.js  v3
   ─────────────────────────────────────────────────────────
   1.  Constants & schema
   2.  State
   3.  DOM references
   4.  Utilities
   5.  Map initialisation
   6.  Panel state machine
   7.  Mobile drag
   8.  Map geometry helpers
   9.  Map layer styles
   10. Map selection / clear
   11. HTML builders — cards, tabs, summary
   12. Info panel open / close
   13. Share
   14. Sidebar — population & interactions
   15. Data loading
   16. Event wiring
   17. Boot
   ============================================================ */

(function () {
  'use strict';

  // ── 1. CONSTANTS & SCHEMA ───────────────────────────────────
  const SERVICE_LAYER_URL =
    'https://services.arcgis.com/HQ0xoN0EzDPBOEci/ArcGIS/rest/services/TK_MMA_FEATURECLASS/FeatureServer/727';

  const ISLAND_DISPLAY_ORDER = [
    "Oʻahu", "Molokaʻi", "Maui", "Lānaʻi", "Kauaʻi", "Hawaiʻi Island", "Kahoʻolawe",
  ];

  const INITIAL_CHAIN_BOUNDS = L.latLngBounds([[18.9, -160.0], [22.35, -154.2]]);
  const PANEL_MARGIN         = 12;    // must match --panel-margin in CSS
  const TRANSITION_MS        = 360;   // must match --dur-slow in CSS (0.36s)
  const MOBILE_MQ            = window.matchMedia('(max-width: 768px)');
  const REDUCED_MOTION_MQ    = window.matchMedia('(prefers-reduced-motion: reduce)');

  const RULES_CATEGORIES = [
    {
      key: 'Gear', label: 'Gear Rules',
      fields: {
        prohibited: 'Rules_Gear_Prohibited',
        allowed:    'Rules_Gear_Allowed',
        limited:    'Rules_Gear_Limited',
      },
    },
    {
      key: 'Species', label: 'Species & Bag Limits',
      fields: {
        prohibited: 'Rules_Species_Prohibited',
        allowed:    'Rules_Species_Allowed',
        limited:    'Rules_Species_Limited',
      },
    },
    {
      key: 'Activities', label: 'Activities Rules',
      fields: {
        prohibited: 'Rules_Activities_Prohibited',
        allowed:    'Rules_Activities_Allowed',
        limited:    'Rules_Activities_Limited',
        notes:      'Rules_Activities_Notes',
      },
    },
    {
      key: 'Seasons', label: 'Seasons & Times',
      fields: {
        prohibited: 'Rules_Seasons_Prohibited',
        allowed:    'Rules_Seasons_Allowed',
        limited:    'Rules_Seasons_Limited',
      },
    },
    {
      key: 'Transit', label: 'Transit & Anchor',
      fields: {
        prohibited: 'Rules_Transit_Prohibited',
        allowed:    'Rules_Transit_Allowed',
        notes:      'Rules_Transit_Notes',
      },
    },
  ];

  const RULE_STATUS = {
    prohibited: { label: 'Prohibited:',         cls: 'rule-status--prohibited' },
    allowed:    { label: 'Allowed:',             cls: 'rule-status--allowed'    },
    limited:    { label: 'Allowed with limits:', cls: 'rule-status--limited'    },
    notes:      { label: 'Notes:',               cls: 'rule-status--notes'      },
  };

  const FIELD_SCHEMA = {
    about: [
      { keys: ['Designation_1','Designation_2','Designation_3'], label: 'Designation', format: 'join' },
      { key: 'Island',         label: 'Island' },
      { key: 'Purpose',        label: 'Purpose',          format: 'bullet' },
      { key: 'Cultural',       label: 'Cultural Info',    format: 'bullet' },
      { key: 'Fishing_Info',   label: 'Fishing Info',     format: 'bullet' },
      { key: 'Establish_Date', label: 'Date Established', format: 'date'   },
      { key: 'Location',       label: 'Location' },
      { key: 'DAR_URL',        label: 'Official DAR Page', format: 'link', linkText: 'Official DAR page ›' },
    ],
    laws: [
      { key: 'HAR_Name', label: 'HAR Name' },
      { key: 'HAR_Link', label: 'HAR Document', format: 'link', linkText: 'View HAR PDF ›' },
      { key: 'HRS_Name', label: 'HRS Name' },
      { key: 'HRS_Link', label: 'HRS Document', format: 'link', linkText: 'View HRS document ›' },
      { key: 'Law_Other_Name_1', urlKey: 'Law_Other_URL_1', label: 'Other Law Reference', format: 'textLink', linkText: 'View reference ›' },
      { key: 'Law_Other_Name_2', urlKey: 'Law_Other_URL_2', label: 'Other Law Reference', format: 'textLink', linkText: 'View reference ›' },
      { key: 'State_Fishing_Regs_Text', urlKey: 'State_Fishing_Regs_URL', label: 'Statewide Fishing Regulations', format: 'textLink', linkText: 'View statewide regulations ›' },
      { key: 'Rules_Also_Text', urlKey: 'Rules_Also_URL', label: 'Additional Rules', format: 'textLink', linkText: 'View additional rules ›' },
      { key: 'Mgmt_Auth', label: 'Management Authority', format: 'bullet' },
      { key: 'Enf_Auth',  label: 'Enforcement Authority', format: 'bullet' },
      { key: 'Penalties', label: 'Penalties', format: 'bullet' },
    ],
  };


  // ── 2. STATE ─────────────────────────────────────────────────
  const allIslandLayers       = {};
  let activeSelectionMarker   = null;
  let activeAccordionLayer    = null;
  let activeHoverLayer        = null;
  let activeLastBounds        = null;   // L.LatLngBounds of current selection
  let _flyTimer               = null;
  let _pendingMoveendHandler  = null;
  let _clickPending           = null;   // accumulates overlapping map click hits via microtask
  // Shared selection state for share link
  let sharePayload            = null;   // { type:'area'|'latlng', value:string }
  let dataLastUpdated         = null;   // filled in from ArcGIS editingInfo on load

  // ── 3. DOM REFERENCES ────────────────────────────────────────
  const panelEl        = document.getElementById('panel');
  const islandListEl   = document.getElementById('island-list');
  const infoContentEl  = document.getElementById('info-content');
  const areaSearchEl   = document.getElementById('area-search');
  const searchClearEl  = document.getElementById('search-clear-btn');
  const shareToastEl   = document.getElementById('share-toast');

  // Interaction contract: keep delegated selector strings centralized here
  // so render + event wiring evolve together safely.
  const UI_SELECTORS = {
    tabTarget: '[data-tab-target]',
    flashArea: '[data-flash-area]',
    summaryToggle: '[data-action="toggle-summary"]',
    summaryCard: '[data-summary-card]',
    summaryBody: '[data-summary-body]',
  };


  // ── 4. UTILITIES ─────────────────────────────────────────────
  function getVal(props, key) {
    const found = Object.keys(props).find((k) => k.toLowerCase() === key.toLowerCase());
    const val   = found ? props[found] : null;
    return val === 'N/A' || val === '' || val === null ? null : val;
  }

  function getFeatureName(props) {
    return (getVal(props, 'Full_name') || 'Unknown Area').trim();
  }

  // Stable feature ID for deduplication
  function featureId(f) {
    return getVal(f.properties, 'OBJECTID') ??
           getVal(f.properties, 'ObjectId') ??
           `${getFeatureName(f.properties)}|${JSON.stringify(f.geometry?.coordinates?.[0]?.[0] || '')}`;
  }

  function escapeHtml(v) {
    return String(v)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function formatDate(dateVal) {
    if (!dateVal || dateVal === 'N/A') return 'N/A';
    const d = new Date(dateVal);
    return Number.isNaN(d.getTime())
      ? escapeHtml(dateVal)
      : `${String(d.getUTCMonth()+1).padStart(2,'0')}/${String(d.getUTCDate()).padStart(2,'0')}/${d.getUTCFullYear()}`;
  }

  function getSafeUrl(value) {
    if (!value || value === 'N/A') return null;
    const raw = String(value).trim();
    if (!raw.startsWith('http://') && !raw.startsWith('https://')) return null;
    try {
      const p = new URL(raw);
      return (p.protocol === 'http:' || p.protocol === 'https:') ? p.href : null;
    } catch { return null; }
  }

  function normalizeHawaiianText(str) {
    if (!str) return '';
    return String(str).toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .replace(/[ʻ\u02BB\u02BC'''`]/g,'')
      .replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
  }

  function formatBulletsWithIndents(text) {
    if (!text || text === 'N/A') return 'N/A';
    return String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      .map((l) => `<div class="mm-bullet-container">
        <span class="mm-bullet-point">•</span>
        <span class="mm-bullet-text">${escapeHtml(l.replace(/^[•●○◦*-]\s+/,'').trim())}</span>
      </div>`).join('');
  }

  function getAreaImages(feature) {
    const props    = feature?.properties || {};
    const areaName = getFeatureName(props) || 'Managed area';
    return ['Area_Image_URL_1','Area_Image_URL_2','Area_Image_URL_3']
      .map((k) => getSafeUrl(getVal(props, k)))
      .filter(Boolean)
      .map((url) => ({ url, alt: areaName, caption: '' }));
  }


  // ── 5. MAP INITIALISATION ────────────────────────────────────
  const map = L.map('map', { zoomControl: false }).setView([20.4, -157.4], 7);

  const zoomControl = L.control
    .zoom({ position: MOBILE_MQ.matches ? 'bottomright' : 'topright' })
    .addTo(map);

  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Esri' },
  ).addTo(map);

  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Labels', pane: 'shadowPane' },
  ).addTo(map);


  // ── 6. PANEL STATE MACHINE ───────────────────────────────────
  //
  // Two orthogonal pieces of state:
  //   panelView      — 'list' | 'info'   (which content is shown)
  //   panelSnap      — 'peek'|'half'|'full'  (mobile position)
  //   panelCollapsed — bool  (desktop only: sidebar slid off-screen)
  //
  // All state lives on the #panel element as data attributes + classes.
  // JS reads/writes those; CSS does all visual output.

  const isMobile = () => MOBILE_MQ.matches;

  function getSheetHeight() {
    // Height of the sheet in its default (half) state — for fitBounds padding
    return Math.round(window.innerHeight * 0.5);
  }

  function setView(view) {
    panelEl.dataset.view = view;
  }

  function resetInfoScrollPosition() {
    if (!infoContentEl) return;
    infoContentEl.scrollTop = 0;
    const innerScroll = infoContentEl.querySelector('.mmpopup__scroll');
    if (innerScroll) innerScroll.scrollTop = 0;
  }

  function setSnap(snap) {
    if (!isMobile()) return;
    panelEl.dataset.snap = snap;
  }

  function openInfoView() {
    setView('info');
    if (isMobile()) setSnap('half');
  }

  function closeToPeek() {
    // × button: return to list and minimize panel
    setView('list');
    if (isMobile()) setSnap('peek');
    sharePayload = null;
  }

  function openListView() {
    // ← back button: return to list, keep current snap height
    setView('list');
    panelEl.classList.remove('is-dragging');
    sharePayload = null;
  }

  function collapsePanel() {
    panelEl.classList.add('is-collapsed');
    map.invalidateSize({ animate: false });
  }

  function expandPanel() {
    panelEl.classList.remove('is-collapsed');
    map.invalidateSize({ animate: false });
  }

  function syncPanelToViewport() {
    if (isMobile()) {
      panelEl.classList.remove('is-collapsed');
      if (!panelEl.dataset.snap) panelEl.dataset.snap = 'half';
    } else {
      // Desktop: ensure correct initial snap cleared
      delete panelEl.dataset.snap;
    }
    syncLeafletControlPosition();
    syncMobileBrowserInset();
    map.invalidateSize({ animate: false });
  }

  function syncMobileBrowserInset() {
    if (!isMobile()) return;
    const vv = window.visualViewport;
    const inset = vv
      ? Math.max(0, Math.round(window.innerHeight - (vv.height + vv.offsetTop)))
      : 0;
    panelEl.style.setProperty('--browser-offset', `${inset}px`);
  }

  function syncLeafletControlPosition() {
    const target = isMobile() ? 'bottomright' : 'topright';
    if (zoomControl.options.position === target) return;
    map.removeControl(zoomControl);
    zoomControl.setPosition(target);
    zoomControl.addTo(map);
  }

  function setInitialMapExtent() {
    if (!map) return;
    if (isMobile()) {
      map.fitBounds(INITIAL_CHAIN_BOUNDS, {
        paddingTopLeft:     [12, 30],
        paddingBottomRight: [12, getSheetHeight()],
        maxZoom: 8.3,
      });
      return;
    }
    map.fitBounds(INITIAL_CHAIN_BOUNDS, {
      paddingTopLeft:     [getPanelWidth() + PANEL_MARGIN + 24, 30],
      paddingBottomRight: [24, 30],
      maxZoom: 8.5,
    });
  }


  // ── 7. MOBILE DRAG ───────────────────────────────────────────
  //
  // Two-phase drag on the grip handle.
  // Phase 1 (passive): watch for clear vertical intent (>8px, not horizontal).
  // Phase 2 (active):  take control, translateY the panel in real time.
  // On release: snap to nearest of peek / half / full.
  //
  // Snap Y values (pixels from top of screen to top of panel):
  //   peek — innerHeight minus header+grip height (72px on mobile)
  //   half — 50% of innerHeight
  //   full — 8% (list) or 12% (info) of innerHeight
  //
  // snapYForState() is the single source of truth for snap positions.
  // Values must stay in sync with the CSS snap transforms in section 19.

  function snapYForState(snap, view) {
    const H  = window.innerHeight;
    const bh = 72;  // --panel-header-h (52px) + --panel-grip-h (20px) on mobile
    if (snap === 'peek') return H - bh;
    if (snap === 'half') return H * 0.5;
    if (snap === 'full') return view === 'info' ? H * 0.12 : H * 0.08;
    return H * 0.5;
  }

  const SNAPS = ['peek', 'half', 'full'];
  let _drag = null;

  function _cleanupDrag() {
    document.removeEventListener('touchmove', _passiveDragWatch, { passive: true });
    document.removeEventListener('touchmove', _activeDragMove);
    document.removeEventListener('touchend',   _dragEnd);
    document.removeEventListener('touchcancel',_dragEnd);
    panelEl.classList.remove('is-dragging');
    _drag = null;
  }

  function _passiveDragWatch(e) {
    if (!_drag) { _cleanupDrag(); return; }
    const t = (e.touches || [e])[0];
    const dy = Math.abs(t.clientY - _drag.startY);
    const dx = Math.abs(t.clientX - _drag.startX);
    if (dy < 8) return;
    if (dx > dy * 1.2) { _cleanupDrag(); return; }

    // Confirmed vertical — upgrade to active
    document.removeEventListener('touchmove', _passiveDragWatch, { passive: true });
    panelEl.classList.add('is-dragging');
    // Use known snap Y instead of computed style — more reliable at all snap positions
    const currentSnap = panelEl.dataset.snap || 'half';
    const currentView = panelEl.dataset.view  || 'list';
    _drag.baseY = snapYForState(currentSnap, currentView);
    _drag.lastY = _drag.baseY;
    _drag.lastTime = Date.now();
    document.addEventListener('touchmove', _activeDragMove, { passive: false });
  }

  function _activeDragMove(e) {
    if (!_drag) return;
    e.preventDefault();
    const t      = (e.touches || [e])[0];
    const view   = panelEl.dataset.view || 'list';
    const rawY   = _drag.baseY + (t.clientY - _drag.startY);
    const minY   = snapYForState('full', view);
    const maxY   = snapYForState('peek', view);
    const y      = Math.max(minY, Math.min(maxY, rawY));
    const now    = Date.now();
    const dt     = now - _drag.lastTime || 1;
    _drag.velocity = (y - _drag.lastY) / dt;
    _drag.lastY    = y;
    _drag.lastTime = now;
    panelEl.style.transform = `translateY(${y}px)`;
  }

  function _dragEnd() {
    if (!_drag) return;
    const wasActive = panelEl.classList.contains('is-dragging');
    const y         = _drag.lastY;
    const vel       = _drag.velocity;
    const view      = panelEl.dataset.view || 'list';
    _cleanupDrag();
    if (!wasActive) return;

    panelEl.style.transform = '';
    const projected = y + vel * 160;  // 160ms momentum projection

    // Snap to nearest
    const nearest = SNAPS
      .map((s) => ({ s, d: Math.abs(projected - snapYForState(s, view)) }))
      .sort((a, b) => a.d - b.d)[0].s;

    setSnap(nearest);
  }

  function startDrag(e) {
    if (!isMobile() || _drag) return;
    // Don't intercept taps on buttons or links
    const touch = (e.touches || [e])[0];
    const el    = document.elementFromPoint(touch.clientX, touch.clientY) || touch.target;
    if (el?.closest('button,a')) return;

    _drag = {
      startX:   touch.clientX,
      startY:   touch.clientY,
      baseY:    0, lastY: 0,
      lastTime: Date.now(), velocity: 0,
    };
    document.addEventListener('touchmove', _passiveDragWatch, { passive: true });
    document.addEventListener('touchend',   _dragEnd, { passive: false });
    document.addEventListener('touchcancel',_dragEnd, { passive: false });
  }


  // ── 8. MAP GEOMETRY HELPERS ──────────────────────────────────
  function getPanelWidth() {
    // Returns panel's actual rendered width for fitBounds padding
    if (isMobile()) return 0;
    if (panelEl.classList.contains('is-collapsed')) return 0;
    return panelEl.getBoundingClientRect().width + PANEL_MARGIN;
  }

  function fitInView(bounds, opts = {}) {
    if (!bounds) return;
    if (isMobile()) {
      if (_flyTimer) { clearTimeout(_flyTimer); _flyTimer = null; }
      const delay = opts.delay ?? TRANSITION_MS;
      _flyTimer = setTimeout(() => {
        _flyTimer = null;
        map.fitBounds(bounds, {
          animate: true, duration: 0.8, easeLinearity: 0.2,
          paddingTopLeft:     [16, 16],
          paddingBottomRight: [16, getSheetHeight() + 16],
          maxZoom: 16,
        });
      }, delay);
    } else {
      const lw = getPanelWidth();
      map.flyToBounds(bounds, {
        animate: true, duration: 0.8, easeLinearity: 0.2,
        paddingTopLeft:     [lw + 30, 30],
        paddingBottomRight: [30, 30],
        maxZoom: opts.maxZoom ?? 16,
      });
    }
  }

  function getBoundsForFeatures(features) {
    if (!features?.length) return null;
    try {
      const b = L.geoJSON({ type: 'FeatureCollection', features }).getBounds();
      return b?.isValid?.() ? b : null;
    } catch { return null; }
  }

  // Point-in-polygon — ray casting
  function pointInRing(point, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      const hit = (yi > point[1]) !== (yj > point[1]) &&
                  point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi;
      if (hit) inside = !inside;
    }
    return inside;
  }
  function pointInPolygonCoords(point, coords) {
    if (!coords?.length) return false;
    if (!pointInRing(point, coords[0])) return false;
    for (let i = 1; i < coords.length; i++) if (pointInRing(point, coords[i])) return false;
    return true;
  }
  function pointInFeatureGeometry(latlng, feature) {
    const g = feature?.geometry;
    if (!g) return false;
    const pt = [latlng.lng, latlng.lat];
    if (g.type === 'Polygon')      return pointInPolygonCoords(pt, g.coordinates);
    if (g.type === 'MultiPolygon') return g.coordinates.some((p) => pointInPolygonCoords(pt, p));
    return false;
  }

  function countOverlapsForFeature(targetLayer) {
    if (!targetLayer) return 0;
    const tb  = targetLayer.getBounds();
    const tc  = tb.getCenter();
    let count = 0;
    Object.values(allIslandLayers).forEach((group) => {
      group.eachLayer((layer) => {
        if (layer === targetLayer || !layer.getBounds) return;
        const lb = layer.getBounds();
        if (!tb.intersects(lb)) return;
        if (pointInFeatureGeometry(tc, layer.feature) ||
            pointInFeatureGeometry(lb.getCenter(), targetLayer.feature)) count++;
      });
    });
    return count;
  }


  // ── 9. MAP LAYER STYLES ──────────────────────────────────────
  function getBaseStyle(layer) {
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
      activeHoverLayer = null; return;
    }
    activeHoverLayer.setStyle(getBaseStyle(activeHoverLayer));
    activeHoverLayer = null;
  }

  function applyHoverHighlight(layer) {
    if (!layer || layer === activeAccordionLayer) return;
    if (activeHoverLayer && activeHoverLayer !== layer) clearHoverHighlight();
    const base = getBaseStyle(layer);
    layer.setStyle({ color: '#ffd60a', weight: Math.max(base.weight + 0.6, 2), opacity: 0.5, fillOpacity: base.fillOpacity });
    activeHoverLayer = layer;
  }

  function clearAccordionSelectionHighlight() {
    if (!activeAccordionLayer || typeof activeAccordionLayer.setStyle !== 'function') return;
    activeAccordionLayer.setStyle(getBaseStyle(activeAccordionLayer));
    activeAccordionLayer = null;
  }

  // Shared flash helper — brief bright yellow → sustained gold highlight
  function _applyFlashStyle(layer, base) {
    layer.setStyle({ color: '#ffe066', weight: 5, opacity: 1, fillOpacity: base.fillOpacity });
    setTimeout(() => {
      layer.setStyle({ color: '#ffd60a', weight: Math.max(base.weight + 0.8, 2.2), opacity: 1, fillOpacity: base.fillOpacity });
    }, 1200);
  }

  function flashLayerBorder(layer) {
    if (!layer || typeof layer.setStyle !== 'function') return;
    const base = getBaseStyle(layer);
    if (activeAccordionLayer && activeAccordionLayer !== layer) clearAccordionSelectionHighlight();
    clearHoverHighlight();
    activeAccordionLayer = layer;
    _applyFlashStyle(layer, base);
  }

  function flashFeatureByName(areaName) {
    let found = false;
    Object.values(allIslandLayers).forEach((group) => {
      if (found) return;
      group.eachLayer((layer) => {
        if (found || getFeatureName(layer.feature.properties) !== areaName) return;
        found = true;
        if (typeof layer.setStyle !== 'function') return;
        const base = getBaseStyle(layer);
        _applyFlashStyle(layer, base);
        setTimeout(() => {
          if (activeAccordionLayer !== layer) layer.setStyle(base);
        }, 2400);  // 1200ms flash + 1200ms gold hold
      });
    });
  }

  function updateClickMarker(latlng) {
    if (activeSelectionMarker) map.removeLayer(activeSelectionMarker);
    activeSelectionMarker = L.marker(latlng).addTo(map);
  }


  // ── 10. MAP SELECTION / CLEAR ────────────────────────────────
  function clearMapSelection() {
    if (_flyTimer) { clearTimeout(_flyTimer); _flyTimer = null; }
    if (_pendingMoveendHandler) {
      map.off('moveend', _pendingMoveendHandler);
      _pendingMoveendHandler = null;
    }
    map.stop();
    activeLastBounds = null;
    sharePayload = null;

    if (activeSelectionMarker) { map.removeLayer(activeSelectionMarker); activeSelectionMarker = null; }
    clearAccordionSelectionHighlight();
    clearHoverHighlight();
    setActiveAreaItem(null, null);
    openListView();
  }

  function setActiveAreaItem(islandName, areaName) {
    islandListEl.querySelectorAll('.area-item.active-area')
      .forEach((el) => el.classList.remove('active-area'));
    if (!islandName || !areaName) return;
    islandListEl.querySelectorAll('.area-item').forEach((el) => {
      if (el.dataset.island === islandName && el.dataset.area === areaName)
        el.classList.add('active-area');
    });
  }


  // ── 11. HTML BUILDERS ────────────────────────────────────────

  // ── Schema field rendering ───────────────────────────────────
  function renderSchemaField(entry, props) {
    const value = entry.format === 'join'
      ? (entry.keys || []).map((k) => getVal(props, k)).filter(Boolean)
      : getVal(props, entry.key);
    if (!value) return '';

    if (entry.format === 'link') {
      const url = getSafeUrl(value);
      return url ? `<a class="reg-link" href="${url}" target="_blank" rel="noopener">${entry.linkText || url}</a>` : '';
    }
    if (entry.format === 'textLink') {
      const textVal = getVal(props, entry.key);
      const url     = getSafeUrl(getVal(props, entry.urlKey));
      if (!textVal && !url) return '';
      return (textVal ? `<div class="field-block"><div class="field-block__label">${entry.label}</div><div>${escapeHtml(textVal)}</div></div>` : '')
           + (url ? `<a class="reg-link" href="${url}" target="_blank" rel="noopener">${entry.linkText || url}</a>` : '');
    }

    const display =
      entry.format === 'join'   ? value.map((v) => escapeHtml(v)).join('<br>')
    : entry.format === 'bullet' ? formatBulletsWithIndents(value)
    : entry.format === 'date'   ? formatDate(value)
    :                             escapeHtml(value);

    return `<div class="field-block"><div class="field-block__label">${entry.label}</div><div>${display}</div></div>`;
  }

  function renderTab(tabKey, props) {
    return (FIELD_SCHEMA[tabKey] || [])
      .map((entry) => renderSchemaField(entry, props)).join('');
  }

  // ── Rules rendering ──────────────────────────────────────────
  function renderRuleStatusBlock(statusKey, text) {
    if (!text?.trim()) return '';
    const status = RULE_STATUS[statusKey];
    if (!status) return '';
    const items = text.trim().split('\n').filter(Boolean)
      .map((l) => { const c = l.replace(/^[-•]\s*/,'').trim(); return c ? `<li class="rule-item">${escapeHtml(c)}</li>` : ''; })
      .join('');
    return `<div class="rule-status-block ${status.cls}">
      <div class="rule-status-block__header">${status.label}</div>
      <ul class="rule-item-list">${items}</ul>
    </div>`;
  }

  function renderRulesCategory(category, props) {
    const html = Object.entries(category.fields)
      .map(([sk, fk]) => renderRuleStatusBlock(sk, getVal(props, fk))).join('');
    return html.trim() ? `<div class="rules-category">
      <div class="rules-category__title">${category.label}</div>${html}</div>` : '';
  }

  function renderRulesTab(props) {
    const html = RULES_CATEGORIES.map((c) => renderRulesCategory(c, props)).join('');
    return html.trim() ? html : '<p class="rules-empty">No specific rules on record for this area.</p>';
  }

  // ── Source chips ─────────────────────────────────────────────
  function buildSummarySources(features) {
    return features.map((f, i) => ({
      id: i + 1, feature: f,
      name: getFeatureName(f.properties),
      className: `source-chip--${(i % 8) + 1}`,
    }));
  }

  function renderSourceChip(source) {
    return `<span class="source-chip ${source.className}"
      title="Source ${source.id}: ${escapeHtml(source.name)}"
      aria-label="Source ${source.id}: ${escapeHtml(source.name)}">
      <span class="sr-only">Source </span>${source.id}</span>`;
  }

  // ── Combined summary ─────────────────────────────────────────
  function _normaliseNote(t) { return t.replace(/\s+/g,' ').trim().toLowerCase(); }

  function buildCombinedRulesSummary(features) {
    const sources = buildSummarySources(features);
    const categories = RULES_CATEGORIES.map((category) => {
      const statusMap = {};
      Object.keys(category.fields).forEach((sk) => { statusMap[sk] = []; });

      sources.forEach((source) => {
        const props = source.feature.properties;
        Object.entries(category.fields).forEach(([sk, fk]) => {
          const val = (getVal(props, fk) || '').trim();
          if (val) statusMap[sk].push({ source, text: val });
        });
      });

      Object.keys(statusMap).forEach((sk) => {
        const entries = statusMap[sk];
        if (entries.length < 2) return;
        const groups = {};
        entries.forEach((e) => {
          const key = _normaliseNote(e.text);
          if (!groups[key]) groups[key] = { text: e.text, sources: [] };
          groups[key].sources.push(e.source);
        });
        statusMap[sk] = Object.values(groups).map(({ text, sources }) =>
          sources.length === 1 ? { source: sources[0], text } : { source: null, sources, text }
        );
      });

      const hasContent = Object.values(statusMap).some((e) => e.length > 0);
      return hasContent ? { category, statusMap } : null;
    }).filter(Boolean);

    return { sources, categories };
  }

  // UI contract for overlap-summary rendering/interaction:
  // - `.info-content` remains the only scroll owner (desktop).
  // - Overlap summary card must include:
  //     [data-summary-card] wrapper
  //     [data-action="toggle-summary"] toggle button
  //     [data-summary-body] collapsible content block
  // - Delegated click handler toggles only the nearest summary card body.
  // Keep these selectors stable when editing markup.

  function renderSummaryStatusGroup(statusKey, entries) {
    if (!entries?.length) return '';
    const status = RULE_STATUS[statusKey];
    if (!status) return '';

    const entriesHtml = entries.map(({ source, sources: multi, text }) => {
      const chipHtml = multi
        ? multi.map((s) => renderSourceChip(s)).join('')
        : renderSourceChip(source);

      const items = text.split('\n').filter(Boolean)
        .map((line) => {
          const clean = line.replace(/^[-•]\s*/,'').trim();
          return clean ? `<li class="rule-item">${escapeHtml(clean)}</li>` : '';
        }).join('');

      return `<div class="summary-field-entry"><div class="summary-entry-chips">${chipHtml}</div><ul class="rule-item-list">${items}</ul></div>`;
    }).join('');

    return `<div class="summary-status-group">
      <div class="summary-status-group__header rule-status-label ${status.cls}">${status.label}</div>
      ${entriesHtml}</div>`;
  }

  function renderSummaryHeader(areaCount) {
    return `<button class="summary-card-toggle" type="button"
              aria-expanded="true" data-action="toggle-summary">
        <span class="summary-card-label">Combined rules for ${areaCount} area${areaCount===1?'':'s'}</span>
        <svg class="btn-icon summary-card-toggle__chevron" viewBox="0 0 256 256" aria-hidden="true">
          <path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z"/>
        </svg>
      </button>`;
  }

  function renderSummaryLegend(sources) {
    const legendHtml = sources.map((s) => `
      <button class="summary-source-pill" type="button"
        data-flash-area="${escapeHtml(s.name)}"
        title="Tap to highlight ${escapeHtml(s.name)} on the map"
        aria-label="Highlight ${escapeHtml(s.name)} on map">
        ${renderSourceChip(s)}
        <span class="summary-source-pill__name">${escapeHtml(s.name)}</span>
      </button>`).join('');
    return `<div class="summary-source-legend">
          <div class="summary-source-legend__label">Tap an area to highlight it on the map:</div>
          <div class="summary-source-pills">${legendHtml}</div>
        </div>`;
  }

  function renderSummaryRules(categories) {
    if (!categories.length) return '<p class="summary-empty">No rules on record for these areas.</p>';
    return `<div class="summary-field-stack">${categories.map(({ category, statusMap }) => `
          <div class="summary-field-block">
            <div class="summary-section-title">${escapeHtml(category.label)}</div>
            ${Object.entries(statusMap).map(([sk, entries]) => renderSummaryStatusGroup(sk, entries)).join('')}
          </div>`).join('')}
        </div>`;
  }

  function buildSummaryPanel(features) {
    const summary = buildCombinedRulesSummary(features);
    return `<div class="mmcard mmcard--summary overlap-summary-card" data-summary-card>
      ${renderSummaryHeader(features.length)}
      <div class="summary-body" data-summary-body>
        ${renderSummaryLegend(summary.sources)}
        ${renderSummaryRules(summary.categories)}
      </div>
    </div>`;
  }

  function assertOverlapPaneContract() {
    if (!infoContentEl) return;
    const card = infoContentEl.querySelector('[data-summary-card]');
    if (!card) return;
    const toggle = card.querySelector(UI_SELECTORS.summaryToggle);
    const body = card.querySelector(UI_SELECTORS.summaryBody);
    if (!toggle || !body) {
      console.warn('haMMA UI contract mismatch: overlap summary card is missing required selectors.');
    }
  }

  // ── Carousel ─────────────────────────────────────────────────
  const CHEVRON_LEFT_SVG  = `<svg class="btn-icon" viewBox="0 0 256 256" aria-hidden="true"><path d="M165.66,202.34a8,8,0,0,1-11.32,11.32l-80-80a8,8,0,0,1,0-11.32l80-80a8,8,0,0,1,11.32,11.32L91.31,128Z"/></svg>`;
  const CHEVRON_RIGHT_SVG = `<svg class="btn-icon" viewBox="0 0 256 256" aria-hidden="true"><path d="M181.66,133.66l-80,80a8,8,0,0,1-11.32-11.32L164.69,128,90.34,53.66a8,8,0,0,1,11.32-11.32l80,80A8,8,0,0,1,181.66,133.66Z"/></svg>`;

  function buildCarousel(images, areaName) {
    if (!images.length) return '';
    const encoded = images.map((img) => encodeURIComponent(JSON.stringify(img))).join('|');
    const multi   = images.length > 1;
    const dots    = multi
      ? `<div class="mmcard__image-dots" aria-hidden="true">
          ${images.map((_, i) => `<span class="mmcard__image-dot${i===0?' is-active':''}"></span>`).join('')}
         </div>` : '';
    const navs = multi
      ? `<button class="mmcard__image-nav mmcard__image-prev" type="button"
           aria-label="Previous image" data-images="${encoded}" data-direction="-1">${CHEVRON_LEFT_SVG}</button>
         <button class="mmcard__image-nav mmcard__image-next" type="button"
           aria-label="Next image" data-images="${encoded}" data-direction="1">${CHEVRON_RIGHT_SVG}</button>` : '';
    return `<div class="mmcard__image-wrap" data-carousel-index="0">
      <img class="mmcard__image" src="${images[0].url}" alt="${escapeHtml(images[0].alt||areaName)}" loading="lazy">
      <div class="mmcard__image-fallback" hidden>Image unavailable</div>
      ${navs}${dots}
    </div>`;
  }

  // ── Area card ────────────────────────────────────────────────
  function buildAreaCard(feature, uid) {
    const props  = feature.properties;
    const name   = getFeatureName(props);
    const images = getAreaImages(feature);
    return `<div class="area-section mmcard">
      ${buildCarousel(images, name)}
      <div class="mmcard__body">
        <h3 class="mmcard__title">${escapeHtml(name)}</h3>
        <div class="mmtabs">
          <button type="button" data-tab-target="about-${uid}">About</button>
          <button type="button" data-tab-target="rules-${uid}" class="active">Rules</button>
          <button type="button" data-tab-target="sources-${uid}">Sources</button>
        </div>
        <div id="about-${uid}"   class="tab-pane field-stack" hidden>${renderTab('about',props)}</div>
        <div id="rules-${uid}"   class="tab-pane field-stack">${renderRulesTab(props)}</div>
        <div id="sources-${uid}" class="tab-pane field-stack" hidden>${renderTab('laws',props)}</div>
      </div>
    </div>`;
  }

  // ── Info pane HTML ────────────────────────────────────────────
  function renderSingleAreaInfoPane(feature, overlapCount) {
    const notice = overlapCount > 0 ? `
      <div class="overlap-notice" role="status">
        <strong>${overlapCount} other managed area${overlapCount===1?'':'s'} overlap${overlapCount===1?'s':''} with this zone.</strong>
        Tap the map to see combined rules at a specific spot.
      </div>` : '';
    return `<div class="mmpopup">
      <div class="mmpopup__scroll">${notice}${buildAreaCard(feature,'area-0')}</div>
    </div>`;
  }

  function renderOverlapInfoPane(features) {
    return `<div class="mmpopup">
      <div class="mmpopup__scroll">
        ${buildSummaryPanel(features)}
        <section class="area-specific-section" aria-label="Area-specific rules">
          ${features.map((f,i) => buildAreaCard(f,`area-${i}`)).join('')}
        </section>
      </div>
    </div>`;
  }

  // ── Tab switching ────────────────────────────────────────────
  function showTab(btn, tabId) {
    const card = btn.closest('.area-section');
    if (!card) return;
    card.querySelectorAll('.tab-pane').forEach((p) => { p.hidden = true; });
    card.querySelectorAll('.mmtabs button').forEach((b) => b.classList.remove('active'));
    const target = card.querySelector(`#${CSS.escape(tabId)}`);
    if (target) target.hidden = false;
    btn.classList.add('active');
  }


  // ── 12. INFO PANEL OPEN / CLOSE ──────────────────────────────
  function setPanelTitle(title) {
    const el = document.getElementById('panel-info-title');
    if (el) el.textContent = title;
  }

  function openAboutPane() {
    clearMapSelection();
    setPanelTitle('About');

    // Read content from the <template id="about-content"> in index.html
    const tmpl = document.getElementById('about-content');
    const content = tmpl
      ? tmpl.content.cloneNode(true)
      : null;

    if (content) {
      // Inject app last-updated from version.json (loaded at boot)
      const appSpan = content.querySelector('[data-app-updated]');
      if (appSpan) appSpan.textContent = window._haMMA_appVersion ?? '—';

      // Inject data last-updated from ArcGIS editingInfo
      const dataSpan = content.querySelector('[data-data-updated]');
      if (dataSpan) dataSpan.textContent = dataLastUpdated ?? '—';

      const wrapper = document.createElement('div');
      wrapper.className = 'mmpopup';
      const scroll = document.createElement('div');
      scroll.className = 'mmpopup__scroll';
      scroll.appendChild(content);
      wrapper.appendChild(scroll);
      infoContentEl.innerHTML = '';
      infoContentEl.appendChild(wrapper);
    } else {
      // Fallback if template is missing
      infoContentEl.innerHTML = '<div class="mmpopup"><div class="mmpopup__scroll"><p style="padding:16px">About content unavailable.</p></div></div>';
    }

    openInfoView();
    clearAccordionSelectionHighlight();
    sharePayload = null;
  }

  function openInfoPanel(latlng, features, options = {}) {
    activeLastBounds = options.source === 'menu' ? getBoundsForFeatures(features) : null;

    const isMulti  = features.length > 1;
    const areaName = getFeatureName(features[0].properties) || 'Area Info';
    const count    = features.length;

    let overlapCount = 0;
    if (!isMulti) {
      // Show overlap notice for both list-selection AND map-tap single hits
      let targetLayer = null;
      Object.values(allIslandLayers).some((group) => {
        group.eachLayer((layer) => {
          if (!targetLayer && getFeatureName(layer.feature?.properties) === areaName)
            targetLayer = layer;
        });
        return !!targetLayer;
      });
      if (targetLayer) overlapCount = countOverlapsForFeature(targetLayer);
    }

    infoContentEl.innerHTML = isMulti
      ? renderOverlapInfoPane(features)
      : renderSingleAreaInfoPane(features[0], overlapCount);
    if (isMulti) assertOverlapPaneContract();

    // Scroll to top
    resetInfoScrollPosition();

    // Set header title
    const title = isMulti ? `${count} Area${count===1?'':'s'} Selected` : areaName;
    setPanelTitle(title);

    // Set share payload
    if (isMulti && latlng) {
      sharePayload = { type: 'latlng', value: `${latlng.lat.toFixed(5)},${latlng.lng.toFixed(5)}` };
    } else {
      sharePayload = { type: 'area', value: encodeURIComponent(areaName) };
    }

    openInfoView();

    // Markers
    if (options.source === 'menu' && activeSelectionMarker) {
      map.removeLayer(activeSelectionMarker);
      activeSelectionMarker = null;
    }
    if (options.source === 'map' && latlng) {
      clearAccordionSelectionHighlight();
      updateClickMarker(latlng);
    }

    // Fly to bounds — only for list selections, never for map clicks
    if (options.source === 'menu' && activeLastBounds) {
      fitInView(activeLastBounds, { delay: TRANSITION_MS });
    }
  }


  // ── 13. SHARE ────────────────────────────────────────────────
  function buildShareUrl() {
    if (!sharePayload) return window.location.href.split('#')[0];
    return `${window.location.href.split('#')[0]}#${sharePayload.value}`;
  }

  function showToast(msg = 'Link copied!') {
    if (!shareToastEl) return;
    shareToastEl.textContent = msg;
    shareToastEl.removeAttribute('hidden');
    shareToastEl.classList.add('is-visible');
    setTimeout(() => {
      shareToastEl.classList.remove('is-visible');
      setTimeout(() => shareToastEl.setAttribute('hidden', ''), 300);
    }, 2200);
  }

  async function shareCurrentSelection() {
    const url = buildShareUrl();
    if (navigator.share && isMobile()) {
      try {
        await navigator.share({ title: document.title, url });
        return;
      } catch { /* user cancelled — fall through */ }
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast('Link copied!');
    } catch {
      // Clipboard unavailable — show the URL
      showToast('Copy: ' + url);
    }
  }

  // Read URL hash on boot and restore selection
  function readHashOnBoot() {
    const hash = decodeURIComponent(window.location.hash.slice(1));
    if (!hash) return;

    // Coordinates: lat,lng
    const coordMatch = hash.match(/^(-?\d+\.\d+),(-?\d+\.\d+)$/);
    if (coordMatch) {
      const latlng = L.latLng(parseFloat(coordMatch[1]), parseFloat(coordMatch[2]));
      // Wait for layers to load, then simulate map tap
      const tryClick = () => {
        const hits = [];
        Object.values(allIslandLayers).forEach((group) => {
          group.eachLayer((l) => {
            if (pointInFeatureGeometry(latlng, l.feature) &&
                !hits.some((f) => featureId(f) === featureId(l.feature)))
              hits.push(l.feature);
          });
        });
        if (hits.length) {
          openInfoPanel(latlng, hits, { source: 'map' });
          updateClickMarker(latlng);
        }
      };
      window._haMMA_onLoad = tryClick;
      return;
    }

    // Area name
    const name = decodeURIComponent(hash);
    window._haMMA_onLoad = () => {
      let found = null;
      Object.entries(allIslandLayers).some(([island, group]) => {
        group.eachLayer((layer) => {
          if (!found && getFeatureName(layer.feature.properties) === name) {
            found = { island, layer };
          }
        });
        return !!found;
      });
      if (!found) return;
      const { island, layer } = found;
      const areaName = getFeatureName(layer.feature.properties);
      setActiveAreaItem(island, areaName);
      activeLastBounds = layer.getBounds();
      openInfoPanel(layer.getBounds().getCenter(), [layer.feature], { source: 'menu' });
      flashLayerBorder(layer);
    };
  }


  // ── 14. SIDEBAR POPULATION & INTERACTIONS ────────────────────
  function populateSidebar(islandName, sortedNames) {
    if (!islandListEl) return;
    islandListEl.querySelector('.loading-notice')?.remove();

    const id   = islandName.replace(/[^a-zA-Z0-9]/g, '');
    const frag = document.createDocumentFragment();

    const group = document.createElement('div');
    group.className = 'island-group';

    const header = document.createElement('button');
    header.className = 'island-header';
    header.id        = `header-${id}`;
    header.setAttribute('aria-expanded', 'false');
    header.setAttribute('aria-controls',  `list-${id}`);
    header.addEventListener('click', () => toggleIsland(id));

    const left = document.createElement('div');
    left.className = 'header-left';

    const labelEl = document.createElement('span');
    labelEl.textContent = islandName;

    // Area count badge
    const countEl = document.createElement('span');
    countEl.className   = 'island-count';
    countEl.textContent = String(sortedNames.length);
    countEl.setAttribute('aria-hidden', 'true');

    left.append(labelEl, countEl);

    // SVG chevron — Phosphor caret-down
    const chevronNS = 'http://www.w3.org/2000/svg';
    const chevronSvg = document.createElementNS(chevronNS, 'svg');
    chevronSvg.setAttribute('viewBox', '0 0 256 256');
    chevronSvg.setAttribute('aria-hidden', 'true');
    chevronSvg.classList.add('chevron');
    const chevronPath = document.createElementNS(chevronNS, 'path');
    chevronPath.setAttribute('d', 'M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z');
    chevronSvg.appendChild(chevronPath);

    header.append(left, chevronSvg);

    const list = document.createElement('div');
    list.id = `list-${id}`;
    list.className = 'area-list';
    list.setAttribute('role', 'list');

    sortedNames.forEach((areaName) => {
      const item = document.createElement('div');
      item.className = 'area-item';
      item.textContent = areaName;
      item.tabIndex = 0;
      item.setAttribute('role', 'button');
      item.setAttribute('aria-label', `View details for ${areaName}`);
      item.dataset.island = islandName;
      item.dataset.area   = areaName;
      item.addEventListener('click',      () => zoomToArea(islandName, areaName));
      item.addEventListener('keydown',    (e) => { if (e.key==='Enter'||e.key===' '){e.preventDefault();zoomToArea(islandName,areaName);} });
      item.addEventListener('mouseenter', () => hoverArea(islandName, areaName));
      item.addEventListener('mouseleave', clearHoverHighlight);
      list.appendChild(item);
    });

    group.append(header, list);
    frag.appendChild(group);
    islandListEl.appendChild(frag);
  }

  function toggleIsland(id) {
    const list   = document.getElementById(`list-${id}`);
    const header = document.getElementById(`header-${id}`);
    if (!list || !header) return;
    const open = !list.classList.contains('active');
    // Mobile: single-expand
    if (isMobile()) {
      islandListEl.querySelectorAll('.area-list.active').forEach((el) => { if (el !== list) el.classList.remove('active'); });
      islandListEl.querySelectorAll('.island-header.expanded').forEach((el) => { if (el !== header) el.classList.remove('expanded'); });
    }
    list.classList.toggle('active', open);
    header.classList.toggle('expanded', open);
    header.setAttribute('aria-expanded', String(open));
    if (isMobile() && open) islandListEl.scrollTo({ top: header.offsetTop - 2, behavior: 'smooth' });
  }

  function zoomToArea(islandName, areaName) {
    setActiveAreaItem(islandName, areaName);
    const group = allIslandLayers[islandName];
    if (!group) return;

    group.eachLayer((layer) => {
      if (getFeatureName(layer.feature.properties) !== areaName) return;
      const bounds = layer.getBounds();
      const center = bounds.getCenter();
      map.stop();
      if (_pendingMoveendHandler) { map.off('moveend', _pendingMoveendHandler); _pendingMoveendHandler = null; }

      activeLastBounds = bounds;
      openInfoPanel(center, [layer.feature], { source: 'menu' });
      flashLayerBorder(layer);

      if (!isMobile()) {
        // Desktop: fly with panel padding, then flash
        const lw = getPanelWidth();
        const queueMoveend = (fn) => {
          _pendingMoveendHandler = () => { _pendingMoveendHandler = null; fn(); };
          map.once('moveend', _pendingMoveendHandler);
        };
        queueMoveend(() => flashLayerBorder(layer));
        map.flyToBounds(bounds, {
          animate: true, duration: 0.8, easeLinearity: 0.2,
          paddingTopLeft:     [lw + 30, 30],
          paddingBottomRight: [30, 30],
          maxZoom: 16,
        });
      }
    });
  }

  function hoverArea(islandName, areaName) {
    const group = allIslandLayers[islandName];
    if (!group) return;
    let matched = null;
    group.eachLayer((l) => { if (!matched && getFeatureName(l.feature.properties) === areaName) matched = l; });
    if (!matched || !map.getBounds().intersects(matched.getBounds())) return;
    applyHoverHighlight(matched);
  }

  function clearSidebarSearch() {
    if (!areaSearchEl) return;
    areaSearchEl.value = '';
    syncSearchClear();
    filterSidebar();
    areaSearchEl.focus();
  }

  function syncSearchClear() {
    areaSearchEl?.closest('.search-input-wrapper')
      ?.classList.toggle('has-value', Boolean(areaSearchEl?.value));
  }

  function filterSidebar() {
    const term = normalizeHawaiianText(areaSearchEl?.value || '');
    let total  = 0;
    islandListEl.querySelectorAll('.island-group').forEach((group) => {
      const islandLabel = group.querySelector('.header-left span')?.textContent || '';
      const islandMatch = term && normalizeHawaiianText(islandLabel).includes(term);
      let hasMatch = false;
      group.querySelectorAll('.area-item').forEach((item) => {
        const matches = !term || islandMatch || normalizeHawaiianText(item.textContent).includes(term);
        item.style.display = matches ? '' : 'none';
        if (matches) { hasMatch = true; total++; }
      });
      const areaList = group.querySelector('.area-list');
      const hdr      = group.querySelector('.island-header');
      if (term && hasMatch) {
        group.style.display = '';
        areaList?.classList.add('active'); hdr?.classList.add('expanded');
        hdr?.setAttribute('aria-expanded','true');
      } else if (term && !hasMatch) {
        group.style.display = 'none';
      } else {
        group.style.display = '';
        areaList?.classList.remove('active'); hdr?.classList.remove('expanded');
        hdr?.setAttribute('aria-expanded','false');
      }
    });
    let notice = islandListEl.querySelector('#search-no-results');
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'search-no-results'; notice.className = 'loading-notice';
      notice.textContent = 'No matching areas found'; notice.hidden = true;
      islandListEl.appendChild(notice);
    }
    notice.hidden = !(term && total === 0);
  }


  // ── 15. DATA LOADING ─────────────────────────────────────────
  async function loadAllFromSingleService() {
    try {
      const [metaResp, dataResp, versionResp] = await Promise.all([
        fetch(`${SERVICE_LAYER_URL}?f=json`),
        fetch(`${SERVICE_LAYER_URL}/query?where=1=1&outFields=*&f=geojson&returnGeometry=true`),
        fetch('version.json').catch(() => null),   // non-fatal if missing
      ]);

      // Read app version date (non-fatal if version.json is absent or malformed)
      if (versionResp?.ok) {
        try {
          const versionData = await versionResp.json();
          if (versionData.appLastUpdated) {
            const d = new Date(versionData.appLastUpdated + 'T00:00:00Z');
            window._haMMA_appVersion = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
          }
        } catch { /* malformed version.json — silently ignore */ }
      }

      if (!metaResp.ok || !dataResp.ok) {
        throw new Error(`Service responded with HTTP ${!metaResp.ok ? metaResp.status : dataResp.status}`);
      }

      const [metadata, geojson] = await Promise.all([metaResp.json(), dataResp.json()]);

      if (metadata.error) {
        throw new Error(`ArcGIS error ${metadata.error.code}: ${metadata.error.message}`);
      }
      if (!geojson.features) {
        throw new Error('ArcGIS returned no features array — service may be unavailable or schema changed');
      }
      
      const editDate = metadata?.editingInfo?.dataLastEditDate;
      if (editDate) dataLastUpdated = new Date(editDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

      const renderer      = metadata?.drawingInfo?.renderer;
      const globalOpacity = (100 - (metadata?.drawingInfo?.transparency || 0)) / 100;

      // Group features by island in display order
      const grouped = {};
      (geojson.features || []).forEach((f) => {
        const island = getVal(f.properties, 'Island') || 'Unknown';
        if (!grouped[island]) grouped[island] = [];
        grouped[island].push(f);
      });
      const orderedKeys = [
        ...ISLAND_DISPLAY_ORDER.filter((n) => grouped[n]),
        ...Object.keys(grouped).filter((n) => !ISLAND_DISPLAY_ORDER.includes(n)).sort(),
      ];

      orderedKeys.forEach((name) => {
        const features    = grouped[name];
        const sortedNames = features.map((f) => getFeatureName(f.properties))
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));

        const islandLayer = L.geoJSON({ type: 'FeatureCollection', features }, {
          style: (feature) => {
            const fName = getFeatureName(feature.properties).toLowerCase();
            const match = renderer?.uniqueValueInfos?.find(
              (info) => String(info.value||'').toLowerCase() === fName
            );
            if (match) {
              const c = match.symbol.color;
              return {
                fillColor:   `rgba(${c[0]},${c[1]},${c[2]},${c[3]/255})`,
                fillOpacity: globalOpacity,
                color:       `rgb(${match.symbol.outline.color.slice(0,3).join(',')})`,
                weight:      1.5,
              };
            }
            return { weight: 1.2, fillOpacity: 0.3, color: '#005a87' };
          },

          onEachFeature: (feature, layer) => {
            layer.on('mouseover', () => { if (!isMobile()) applyHoverHighlight(layer); });
            layer.on('mouseout',  () => { if (!isMobile()) clearHoverHighlight(); });

            layer.on('click', (e) => {
              L.DomEvent.stopPropagation(e);
              map.stop();
              if (_pendingMoveendHandler) { map.off('moveend', _pendingMoveendHandler); _pendingMoveendHandler = null; }

              // Accumulate all overlapping hits, then open once via microtask
              if (!_clickPending) {
                _clickPending = { latlng: e.latlng, hits: [] };
                Promise.resolve().then(() => {
                  const { latlng, hits } = _clickPending;
                  _clickPending = null;
                  if (!hits.length) { clearMapSelection(); return; }

                  if (hits.length === 1) {
                    setActiveAreaItem(getVal(hits[0].properties,'Island'), getFeatureName(hits[0].properties));
                  } else {
                    setActiveAreaItem(null, null);
                  }
                  openInfoPanel(latlng, hits, { source: 'map' });
                });
              }

              // Add this feature if not already in hits
              if (!_clickPending.hits.some((f) => featureId(f) === featureId(feature))) {
                _clickPending.hits.push(feature);
              }
              // Scan all layers for other hits at this point
              Object.values(allIslandLayers).forEach((grp) => {
                if (!map.hasLayer(grp)) return;
                grp.eachLayer((l) => {
                  if (pointInFeatureGeometry(e.latlng, l.feature) &&
                      !_clickPending.hits.some((f) => featureId(f) === featureId(l.feature))) {
                    _clickPending.hits.push(l.feature);
                  }
                });
              });
            });
          },
        }).addTo(map);

        allIslandLayers[name] = islandLayer;
        populateSidebar(name, sortedNames);
      });

      islandListEl?.removeAttribute('aria-busy');

      // About button
      const aboutBtn = document.createElement('button');
      aboutBtn.type = 'button';
      aboutBtn.className = 'about-map-btn';
      aboutBtn.innerHTML = '<span class="about-map-btn__icon">ℹ</span><span class="about-map-btn__label">About this map</span>';
      aboutBtn.addEventListener('click', openAboutPane);
      islandListEl?.appendChild(aboutBtn);

      // Run hash restore if one was queued
      window._haMMA_onLoad?.();
      window._haMMA_onLoad = null;

    } catch (err) {
      console.error('[haMMA] Load failed:', err);
      islandListEl?.removeAttribute('aria-busy');
      if (islandListEl) {
        islandListEl.innerHTML = `<div class="error-notice">
          <p>Unable to load marine areas. Please check your connection.</p>
          <button class="retry-btn" id="retry-btn" type="button">Try again</button>
        </div>`;
        document.getElementById('retry-btn')?.addEventListener('click', () => {
          islandListEl.innerHTML = '<div class="loading-notice" role="status">Loading marine areas…</div>';
          islandListEl.setAttribute('aria-busy','true');
          loadAllFromSingleService();
        });
      }
    }
  }


  // ── 16. EVENT WIRING ─────────────────────────────────────────

  // Search
  areaSearchEl?.addEventListener('input',  () => { syncSearchClear(); filterSidebar(); });
  searchClearEl?.addEventListener('click', clearSidebarSearch);

  // Panel header buttons
  document.getElementById('panel-back-btn')?.addEventListener('click', openListView);
  document.getElementById('panel-close-btn')?.addEventListener('click', closeToPeek);
  document.getElementById('panel-share-btn')?.addEventListener('click', shareCurrentSelection);
  document.getElementById('panel-collapse-btn')?.addEventListener('click', collapsePanel);
  document.getElementById('panel-reveal-btn')?.addEventListener('click', expandPanel);

  // Mobile grip drag — wire to ENTIRE panel header for large drag surface
  // The grip visual is just decorative; the whole header is the drag target.
  // Buttons inside the header are excluded by the button/a check in startDrag.
  document.getElementById('panel-header')?.addEventListener('touchstart', startDrag, { passive: true });

  // Tap header when peeked → restore to half (for users who tap rather than drag)
  document.getElementById('panel-header')?.addEventListener('click', (e) => {
    if (isMobile() && panelEl.dataset.snap === 'peek' && !e.target.closest('button,a')) {
      setSnap('half');
    }
  });

  function setSummaryBodyCollapsed(body, shouldCollapse) {
    if (!body) return;
    if (REDUCED_MOTION_MQ.matches) {
      body.classList.toggle('is-closed', shouldCollapse);
      body.style.maxHeight = shouldCollapse ? '0px' : '';
      return;
    }

    const currentHeight = `${body.scrollHeight}px`;
    body.style.maxHeight = currentHeight;

    if (shouldCollapse) {
      requestAnimationFrame(() => {
        body.classList.add('is-closed');
        body.style.maxHeight = '0px';
      });
      return;
    }

    body.classList.remove('is-closed');
    requestAnimationFrame(() => {
      body.style.maxHeight = `${body.scrollHeight}px`;
    });
    const clear = () => {
      if (!body.classList.contains('is-closed')) body.style.maxHeight = '';
      body.removeEventListener('transitionend', clear);
    };
    body.addEventListener('transitionend', clear);
  }

  function handleSummaryToggleClick(toggleBtn) {
    const isExpanded = toggleBtn.getAttribute('aria-expanded') === 'true';
    toggleBtn.setAttribute('aria-expanded', String(!isExpanded));
    const body = toggleBtn.closest(UI_SELECTORS.summaryCard)?.querySelector(UI_SELECTORS.summaryBody);
    if (body?.classList.contains('summary-body')) {
      setSummaryBodyCollapsed(body, isExpanded);
    }
    return true;
  }

  function handleSummaryFlashClick(flashPill) {
    flashFeatureByName(flashPill.dataset.flashArea);
    return true;
  }

  function handleCardTabClick(tabBtn) {
    showTab(tabBtn, tabBtn.dataset.tabTarget);
    return true;
  }

  // Info content — delegated for tabs, flash pills, notices, carousel, summary
  infoContentEl?.addEventListener('click', (e) => {
    const tabBtn = e.target.closest(UI_SELECTORS.tabTarget);
    if (tabBtn && handleCardTabClick(tabBtn)) return;

    const flashPill = e.target.closest(UI_SELECTORS.flashArea);
    if (flashPill && handleSummaryFlashClick(flashPill)) return;

    const toggleBtn = e.target.closest(UI_SELECTORS.summaryToggle);
    if (toggleBtn && handleSummaryToggleClick(toggleBtn)) return;

    const navBtn = e.target.closest('.mmcard__image-nav');
    if (navBtn) {
      const wrap = navBtn.closest('.mmcard__image-wrap');
      const img  = wrap?.querySelector('.mmcard__image');
      if (!wrap || !img) return;
      const images = (navBtn.dataset.images||'').split('|').filter(Boolean)
        .map((enc) => { try { return JSON.parse(decodeURIComponent(enc)); } catch { return null; } })
        .filter((i) => i?.url);
      if (images.length < 2) return;
      const dir  = Number(navBtn.dataset.direction || 1);
      const cur  = Number(wrap.dataset.carouselIndex || 0);
      const next = (cur + dir + images.length) % images.length;
      wrap.dataset.carouselIndex = String(next);
      img.src = images[next].url; img.alt = images[next].alt || 'Area image';
      wrap.classList.remove('is-image-failed');
      const fb = wrap.querySelector('.mmcard__image-fallback');
      if (fb) fb.hidden = true;
      wrap.querySelectorAll('.mmcard__image-dot').forEach((d, i) => d.classList.toggle('is-active', i===next));
      return;
    }
  });

  infoContentEl?.addEventListener('error', (e) => {
    const img  = e.target.closest('.mmcard__image');
    const wrap = img?.closest('.mmcard__image-wrap');
    if (!wrap) return;
    img.style.display = 'none';
    wrap.classList.add('is-image-failed');
    const fb = wrap.querySelector('.mmcard__image-fallback');
    if (fb) fb.hidden = false;
  }, true);

  // Desktop map click — clear selection if click on empty map
  map.on('click', () => { if (!isMobile()) clearMapSelection(); });

  // Resize / orientation
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { syncPanelToViewport(); }, 100);
  });
  MOBILE_MQ.addEventListener('change', syncPanelToViewport);

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncMobileBrowserInset, { passive: true });
    window.visualViewport.addEventListener('scroll', syncMobileBrowserInset, { passive: true });
  }


  // ── 17. BOOT ─────────────────────────────────────────────────
  readHashOnBoot();
  syncPanelToViewport();
  setInitialMapExtent();
  loadAllFromSingleService();

})();
