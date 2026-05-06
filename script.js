/* ============================================================
   haMMA — Hawaii Managed Marine Areas
   Copyright (c) 2026 Tyler Kueffner
   All rights reserved. Copying, modification, or distribution of this software is prohibited without the copyright holder's consent.
   
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

  const INITIAL_CHAIN_BOUNDS = L.latLngBounds([[18.9, -160.0], [22.35, -154.2]]);

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
  // ── NEW STRUCTURED RULES SCHEMA ─────────────────────────────
  // Each category has Prohibited / Allowed / Limited sub-fields.
  // Status is encoded in the field name — no parsing needed.
  // The app reads new fields first; falls back to old blob fields
  // for any area not yet migrated.
  const RULES_CATEGORIES = [
    {
      key:    'Gear',
      label:  'Gear Rules',
      fields: {
        prohibited: 'Rules_Gear_Prohibited',
        allowed:    'Rules_Gear_Allowed',
        limited:    'Rules_Gear_Limited',
      },
    },
    {
      key:    'Species',
      label:  'Species & Bag Limits',
      fields: {
        prohibited: 'Rules_Species_Prohibited',
        allowed:    'Rules_Species_Allowed',
        limited:    'Rules_Species_Limited',
      },
    },
    {
      key:    'Activities',
      label:  'Activities Rules',
      fields: {
        prohibited: 'Rules_Activities_Prohibited',
        allowed:    'Rules_Activities_Allowed',
        limited:    'Rules_Activities_Limited',
        notes:      'Rules_Activities_Notes',
      },
    },
    {
      key:    'Seasons',
      label:  'Seasons & Times',
      fields: {
        prohibited: 'Rules_Seasons_Prohibited',
        allowed:    'Rules_Seasons_Allowed',
        limited:    'Rules_Seasons_Limited',
      },
    },
    {
      key:    'Transit',
      label:  'Transit & Anchor',
      fields: {
        prohibited: 'Rules_Transit_Prohibited',
        allowed:    'Rules_Transit_Allowed',
        notes:      'Rules_Transit_Notes',
      },
    },
  ];

  // Status display config — label, colour class, rendered header
  const RULE_STATUS = {
    prohibited: { label: 'Prohibited',          cls: 'rule-status--prohibited' },
    allowed:    { label: 'Allowed',              cls: 'rule-status--allowed'    },
    limited:    { label: 'Allowed with limits',  cls: 'rule-status--limited'    },
    notes:      { label: 'Notes',                cls: 'rule-status--notes'      },
  };

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
      // Kept for legacy fallback rendering — new rendering uses RULES_CATEGORIES
      { key: 'Rules_Gear',             label: 'Gear Rules',           format: 'rule' },
      { key: 'Rules_species_size_bag', label: 'Species & Bag Limits', format: 'rule' },
      { key: 'Rules_Activities',       label: 'Activities Rules',     format: 'rule' },
      { key: 'Rules_Seasons_Times',    label: 'Seasons & Times',      format: 'rule' },
      { key: 'Rules_transit_anchor',   label: 'Transit & Anchor',     format: 'rule' },
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

  // SUMMARY_SCHEMA — driven from RULES_CATEGORIES so it stays in sync
  const SUMMARY_SCHEMA = RULES_CATEGORIES;



  // ── 2. STATE ─────────────────────────────────────────────────
  const allIslandLayers      = {};
  let activeSelectionMarker  = null;
  let activeAccordionLayer   = null;
  let activeHoverLayer       = null;
  let activeLastLatlng       = null;  // last latlng used to open the info panel
  let lastSelectionSource    = null;  // 'menu' | 'map' | null
  let _flyTimer              = null;  // pending mobile fly-to timer


  // ── 3. DOM REFERENCES ────────────────────────────────────────
  // Single DOM — no mobile/desktop duplication.
  const mapInterfaceEl  = document.querySelector('.map-interface');
  const panelsEl        = document.getElementById('panels');
  const mapSidebarEl    = document.getElementById('map-sidebar');
  const infoSidebarEl   = document.getElementById('info-sidebar');
  const islandListEl    = document.getElementById('island-list');
  const infoContentEl   = document.getElementById('info-content');
  const areaSearchEl    = document.getElementById('area-search');
  const searchClearEl   = document.getElementById('search-clear-btn');


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

  // How tall the sheet is when in its default (half) position — used for
  // fitBounds padding so the map centres above the sheet.
  function getSheetHeight() {
    return Math.round(window.innerHeight * 0.5);
  }

  function syncMobileBrowserInset() {
    if (!isMobileView()) return;
    const vv = window.visualViewport;
    const inset = vv
      ? Math.max(0, Math.round(window.innerHeight - (vv.height + vv.offsetTop)))
      : 0;
    // Apply to both panels — whichever is visible will use it
    mapSidebarEl?.style.setProperty('--browser-offset', `${inset}px`);
    infoSidebarEl?.style.setProperty('--browser-offset', `${inset}px`);
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
  // Two independent pieces of state:
  //   view     — 'list' | 'info'   (which panel is visible)
  //   expanded — true | false       (sheet at full vs half height)
  //
  // Both are stored on #panels via data-view and .is-expanded on the
  // active sidebar element. CSS does all the visual work.
  //
  // Public API: setView(v), setExpanded(bool), toggleExpanded()

  let mobileView     = 'list';
  let mobileExpanded = false;
  let activeLastBounds = null;
  let _pendingMoveendHandler = null;

  function getActivePanel() {
    return mobileView === 'info' ? infoSidebarEl : mapSidebarEl;
  }

  function setView(view) {
    if (!isMobileView()) return;
    mobileView = view;
    panelsEl.dataset.view = view;

    // Sync handle button aria-expanded on both panels
    const listHandle = document.getElementById('sheet-handle-btn');
    const infoHandle = document.getElementById('info-handle-btn');
    if (listHandle) listHandle.setAttribute('aria-expanded', String(mobileExpanded && view === 'list'));
    if (infoHandle) infoHandle.setAttribute('aria-expanded', String(mobileExpanded && view === 'info'));
  }

  function setExpanded(expanded) {
    if (!isMobileView()) return;
    mobileExpanded = expanded;
    const panel = getActivePanel();
    panel?.classList.toggle('is-expanded', expanded);

    // Sync aria-expanded on the active handle
    const handleId = mobileView === 'info' ? 'info-handle-btn' : 'sheet-handle-btn';
    const handle = document.getElementById(handleId);
    if (handle) handle.setAttribute('aria-expanded', String(expanded));
  }

  function toggleExpanded() {
    setExpanded(!mobileExpanded);
  }

  // Convenience: switch to info view at half height, then recentre map
  function openInfoView(opts = {}) {
    if (!isMobileView()) return;
    // Always start info at half height so map is visible
    infoSidebarEl?.classList.remove('is-expanded');
    mobileExpanded = false;
    setView('info');
    if (!opts.skipRecentre && activeLastBounds) {
      scheduleMobileFit(activeLastBounds);
    }
  }

  // Return to list at same expansion state
  function openListView() {
    if (!isMobileView()) return;
    mapSidebarEl?.classList.remove('is-expanded');
    mobileExpanded = false;
    setView('list');
  }

  function syncResponsiveSidebarState() {
    if (isMobileView()) {
      // Restore correct data-view and expansion on resize/orientation change
      panelsEl.dataset.view = mobileView;
      const panel = getActivePanel();
      mapSidebarEl?.classList.toggle('is-expanded', mobileExpanded && mobileView === 'list');
      infoSidebarEl?.classList.toggle('is-expanded', mobileExpanded && mobileView === 'info');
      syncMobileBrowserInset();
    } else {
      // Desktop — clear all mobile state classes
      panelsEl.dataset.view = 'list'; // reset so desktop shows both panels
      mapSidebarEl?.classList.remove('is-expanded');
      infoSidebarEl?.classList.remove('is-expanded');
      mapSidebarEl?.classList.remove('is-collapsed');
      infoSidebarEl?.classList.remove('is-offscreen');
      setMapSidebarDesktopState();
    }
    syncSidebarToggleUI();
    syncLeafletControlPosition();
    if (map) map.invalidateSize({ animate: false });
  }

  function setInitialMapExtent() {
    if (!map) return;
    if (isMobileView()) {
      map.fitBounds(INITIAL_CHAIN_BOUNDS, {
        paddingTopLeft:     [12, 30],
        paddingBottomRight: [12, getSheetHeight()],
        maxZoom: 8.3,
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

  // Desktop-only — mobile uses fitMobileVisible with paddingBottomRight.
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

  // Fit a selection into the visible map strip above the sheet.
  // Uses Leaflet's built-in paddingBottomRight — no manual projection math.
  function fitMobileVisible(bounds) {
    if (!isMobileView() || !bounds) return;
    if (_flyTimer) { clearTimeout(_flyTimer); _flyTimer = null; }
    const sheetH = getSheetHeight();
    map.fitBounds(bounds, {
      animate:            true,
      duration:           0.8,
      easeLinearity:      0.2,
      paddingTopLeft:     [16, 16],
      paddingBottomRight: [16, sheetH + 16],
      maxZoom:            16,
    });
  }

  // Schedule fit after the sheet transition settles.
  function scheduleMobileFit(bounds, delay = SHEET_TRANSITION_MS) {
    if (_flyTimer) { clearTimeout(_flyTimer); _flyTimer = null; }
    _flyTimer = setTimeout(() => {
      _flyTimer = null;
      fitMobileVisible(bounds);
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

  // Count how many loaded features overlap with a given feature.
  // Uses bounding-box intersection (fast) plus a centroid point-in-polygon
  // check to filter obvious false positives from the bbox over-count.
  // This handles large irregular polygons like West Hawai'i RFMA correctly.
  function countOverlapsForFeature(targetLayer) {
    if (!targetLayer) return 0;
    const targetBounds = targetLayer.getBounds();
    const targetCenter = targetBounds.getCenter();
    let count = 0;
    Object.values(allIslandLayers).forEach((group) => {
      group.eachLayer((layer) => {
        if (layer === targetLayer) return;
        if (!layer.getBounds) return;
        const lb = layer.getBounds();
        // Quick bbox check first
        if (!targetBounds.intersects(lb)) return;
        // Confirm with point-in-polygon in either direction:
        // does target's center fall in this layer, OR does this layer's
        // center fall in target? Catches both large-contains-small and
        // small-inside-large cases.
        const layerCenter = lb.getCenter();
        if (
          pointInFeatureGeometry(targetCenter, layer.feature) ||
          pointInFeatureGeometry(layerCenter, targetLayer.feature)
        ) {
          count++;
        }
      });
    });
    return count;
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

  // Flash a polygon by area name without any map movement or selection change.
  // Used by the source legend buttons in the summary card.
  // Auto-reverts to base style after 1.8s — doesn't affect active selection.
  function flashFeatureByName(areaName) {
    let found = false;
    Object.values(allIslandLayers).forEach((group) => {
      if (found) return;
      group.eachLayer((layer) => {
        if (found) return;
        if (getFeatureName(layer.feature.properties) !== areaName) return;
        found = true;
        if (typeof layer.setStyle !== 'function') return;
        const base = getLayerBaseStyle(layer);
        // Flash bright without touching activeAccordionLayer
        layer.setStyle({ color: '#ffe066', weight: 5, opacity: 1, fillOpacity: base.fillOpacity });
        setTimeout(() => {
          layer.setStyle({ color: '#ffd60a', weight: Math.max(base.weight + 0.8, 2.2), opacity: 1, fillOpacity: base.fillOpacity });
          setTimeout(() => {
            // Revert to base — but respect active selection if it's this layer
            if (activeAccordionLayer !== layer) {
              layer.setStyle(base);
            }
          }, 1200);
        }, 300);
      });
    });
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
    lastSelectionSource = null;

    if (activeSelectionMarker) {
      map.removeLayer(activeSelectionMarker);
      activeSelectionMarker = null;
    }

    clearAccordionSelectionHighlight();
    clearHoverHighlight();
    setActiveAreaItem(null, null);

    if (isMobileView()) {
      openListView();
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

  // Render all fields for a given tab from the schema (used by About and Laws tabs)
  function renderTab(tabKey, props) {
    return (FIELD_SCHEMA[tabKey] || [])
      .map((entry) => renderSchemaField(entry, props))
      .join('');
  }

  // ── NEW STRUCTURED RULES RENDERING ───────────────────────────
  // Renders a single status block (Prohibited / Allowed / Limited / Notes)
  function renderRuleStatusBlock(statusKey, text) {
    if (!text || !text.trim()) return '';
    const status = RULE_STATUS[statusKey];
    if (!status) return '';
    const lines = text.trim().split('\n').filter(Boolean);
    const itemsHtml = lines.map((line) => {
      // Strip leading dash if present
      const clean = line.replace(/^[-•]\s*/, '').trim();
      return clean ? `<li class="rule-item">${escapeHtml(clean)}</li>` : '';
    }).join('');
    return `
      <div class="rule-status-block ${status.cls}">
        <div class="rule-status-block__header">${status.label}</div>
        <ul class="rule-item-list">${itemsHtml}</ul>
      </div>`;
  }

  // Check if any new structured fields are populated for a category
  function categoryHasNewFields(category, props) {
    return Object.values(category.fields).some((fieldKey) => {
      const val = getVal(props, fieldKey);
      return val && val.trim();
    });
  }

  // Render one rules category (e.g. Gear Rules) for an area card
  function renderRulesCategory(category, props) {
    const blocksHtml = Object.entries(category.fields)
      .map(([statusKey, fieldKey]) => {
        const val = getVal(props, fieldKey);
        return renderRuleStatusBlock(statusKey, val);
      })
      .join('');
    if (!blocksHtml.trim()) return '';
    return `
      <div class="rules-category">
        <div class="rules-category__title">${category.label}</div>
        ${blocksHtml}
      </div>`;
  }

  // Render the full Rules tab for an area card
  function renderRulesTab(props) {
    const html = RULES_CATEGORIES
      .map((cat) => renderRulesCategory(cat, props))
      .join('');
    return html.trim()
      ? html
      : '<p class="rules-empty">No specific rules on record for this area.</p>';
  }

  // ── SUMMARY CARD — NEW STRUCTURED RENDERING ──────────────────
  // Renders one status block for a single source area within the summary
  function renderSummaryStatusBlock(statusKey, text, source) {
    if (!text || !text.trim()) return '';
    const status = RULE_STATUS[statusKey];
    if (!status) return '';
    const lines = text.trim().split('\n').filter(Boolean);
    const itemsHtml = lines.map((line) => {
      const clean = line.replace(/^[-•]\s*/, '').trim();
      return clean ? `<li class="rule-item">${escapeHtml(clean)}</li>` : '';
    }).join('');
    return `
      <div class="summary-status-entry">
        <div class="summary-status-entry__header">
          <span class="rule-status-label ${status.cls}">${status.label}</span>
          ${renderSourceChip(source)}
        </div>
        <ul class="rule-item-list">${itemsHtml}</ul>
      </div>`;
  }

  // ── SUMMARY CARD — FIELD-FIRST LAYOUT ───────────────────────
  //
  // Layout: for each category (Gear, Species, etc.) group entries by
  // status (Prohibited, Allowed, Limited, Notes). Within each status
  // group, list all sources that have content, each with their chip.
  // Transit_Notes are deduplicated — if multiple sources share the same
  // note (very common boilerplate), it is shown once.

  // Normalise a string for deduplication comparison
  function _normaliseNote(text) {
    return text.replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function buildCombinedRulesSummary(features) {
    const sources = buildSummarySources(features);

    // For each category → each status → collect { source, text } entries
    const categories = RULES_CATEGORIES.map((category) => {
      // Build a map: statusKey → [ { source, text } ]
      const statusMap = {};
      Object.keys(category.fields).forEach((sk) => { statusMap[sk] = []; });

      sources.forEach((source) => {
        const props = source.feature.properties;
        Object.entries(category.fields).forEach(([statusKey, fieldKey]) => {
          const val = (getVal(props, fieldKey) || '').trim();
          if (val) statusMap[statusKey].push({ source, text: val });
        });
      });

      // Deduplicate across ALL status types:
      // If multiple sources share identical text for the same status,
      // collapse them to a single entry showing all chips side-by-side.
      Object.keys(statusMap).forEach((sk) => {
        const entries = statusMap[sk];
        if (entries.length < 2) return;

        // Group entries by normalised text
        const groups = {};
        entries.forEach((e) => {
          const key = _normaliseNote(e.text);
          if (!groups[key]) groups[key] = { text: e.text, sources: [] };
          groups[key].sources.push(e.source);
        });

        // Rebuild: collapsed where all sources share text, expanded otherwise
        statusMap[sk] = Object.values(groups).map(({ text, sources }) =>
          sources.length === 1
            ? { source: sources[0], text }
            : { source: null, sources, text }
        );
      });

      // Only include category if at least one status has entries
      const hasContent = Object.values(statusMap).some((entries) => entries.length > 0);
      return hasContent ? { category, statusMap } : null;
    }).filter(Boolean);

    return { sources, categories };
  }

  // Render a single status group within the summary card
  // e.g. "Prohibited" header, then each source's chip + bullet list
  function renderSummaryStatusGroup(statusKey, entries) {
    if (!entries || !entries.length) return '';
    const status = RULE_STATUS[statusKey];
    if (!status) return '';

    const entriesHtml = entries.map(({ source, sources: multiSources, text }) => {
      // Chip: either a single source chip or a row of chips (deduplicated notes)
      const chipHtml = multiSources
        ? multiSources.map((s) => renderSourceChip(s)).join('')
        : renderSourceChip(source);

      const lines = text.split('\n').filter(Boolean);
      // Chips go at the END of each bullet line
      const itemsHtml = lines.map((line, idx) => {
        const clean = line.replace(/^[-•]\s*/, '').trim();
        if (!clean) return '';
        // Only attach chips to the last line — keeps multi-line entries clean
        const chipsAtEnd = idx === lines.length - 1
          ? `<span class="rule-item__chips">${chipHtml}</span>`
          : '';
        return `<li class="rule-item">${escapeHtml(clean)}${chipsAtEnd}</li>`;
      }).join('');

      return `
        <div class="summary-field-entry">
          <ul class="rule-item-list rule-item-list--chipped">${itemsHtml}</ul>
        </div>`;
    }).join('');

    return `
      <div class="summary-status-group">
        <div class="summary-status-group__header rule-status-label ${status.cls}">
          ${status.label}
        </div>
        ${entriesHtml}
      </div>`;
  }

  function buildSummaryPanel(features) {
    const summary = buildCombinedRulesSummary(features);
    const hasRules = summary.categories.length > 0;

    // Source legend: each area is a pill-button that flashes its polygon
    const legendHtml = summary.sources.map((source) => `
      <button
        class="summary-source-pill"
        type="button"
        data-flash-area="${escapeHtml(source.name)}"
        title="Tap to highlight ${escapeHtml(source.name)} on the map"
        aria-label="Highlight ${escapeHtml(source.name)} on map"
      >
        ${renderSourceChip(source)}
        <span class="summary-source-pill__name">${escapeHtml(source.name)}</span>
      </button>`).join('');

    return `
      <div class="summary-accordion__panel--inline" hidden>
        <div class="mmcard mmcard--summary overlap-summary-card">
          <div class="mmcard__body overlap-summary-intro">
            <div class="summary-card-label">Combined rules summary</div>
            <div class="summary-source-legend">
              <div class="summary-source-legend__label">Tap an area to highlight it on the map:</div>
              <div class="summary-source-pills">${legendHtml}</div>
            </div>
            ${hasRules
              ? `<div class="summary-field-stack">
                  ${summary.categories.map(({ category, statusMap }) => `
                    <div class="summary-field-block">
                      <div class="summary-section-title">${escapeHtml(category.label)}</div>
                      ${Object.entries(statusMap)
                          .map(([sk, entries]) => renderSummaryStatusGroup(sk, entries))
                          .join('')}
                    </div>`).join('')}
                </div>`
              : `<p class="summary-empty">No rules on record for these areas.</p>`}
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
            ${renderRulesTab(props)}
          </div>

          <div id="laws-${uid}" class="tab-pane field-stack" hidden>
            ${renderTab('laws', props)}
          </div>

        </div>
      </div>`;
  }

  function renderSingleAreaInfoPane(feature, overlapCount) {
    const noticeHtml = overlapCount > 0 ? `
      <div class="overlap-notice" role="status">
        <span class="overlap-notice__text">
          <strong>${overlapCount} other managed area${overlapCount === 1 ? '' : 's'} overlap${overlapCount === 1 ? 's' : ''} with this zone.</strong>
          Tap the map to see combined rules at a specific spot.
        </span>
        <button class="overlap-notice__dismiss" type="button" aria-label="Dismiss">✕</button>
      </div>` : '';
    return `
      <div class="mmpopup">
        ${noticeHtml}
        <div class="mmpopup__scroll">
          ${buildAreaCard(feature, 'area-0')}
        </div>
      </div>`;
  }

  function renderOverlapHeader(features) {
    // Intentionally empty — renderAreaSpecificSection has its own title
    return '';
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
            <span class="mmpopup__summary-trigger-pill">
              <span class="mmpopup__summary-trigger-pill-text">SEE COMBINED RULES FOR ${count} OVERLAPPING AREAS</span>
              <span class="mmpopup__summary-trigger-chevron" aria-hidden="true">▼</span>
            </span>
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
    // Update pill label to match state
    const pillText = btn.querySelector('.mmpopup__summary-trigger-pill-text');
    if (pillText) {
      const count = btn.dataset.areaCount || '';
      pillText.textContent = expand
        ? 'Hide combined rules'
        : `SEE COMBINED RULES FOR ${count} OVERLAPPING AREAS`;
    }

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

    // label shows area count — stays static; pill text handles state

  }

  function toggleSummaryAccordion(btn) {
    const isExpanded = btn.getAttribute('aria-expanded') === 'true';
    setSummaryExpanded(btn, !isExpanded);
  }



  // ── 15. INFO PANEL — OPEN / CLOSE ────────────────────────────
  // ── ABOUT PANE ───────────────────────────────────────────────

  const README_HTML = `
    <div class="about-pane">
      <div class="about-pane__hero">
        <h2 class="about-pane__title">haMMA — Hawaiʿi Managed Marine &amp; Freshwater Areas</h2>
        <p class="about-pane__tagline">A public map for fishers, divers, and ocean users in Hawaiʿi.</p>
      </div>

      <section class="about-pane__section">
        <p><em>All statewide fishing regulations still apply on top of each area’s specific rules.</em></p>
      </section>

      <section class="about-pane__section">
        <h3>Why this exists</h3>
        <p>Since the 1960s, the Hawaiʿi Division of Aquatic Resources (DAR) has established place-specific regulations for 90 different marine and freshwater areas across the state. These areas frequently overlap, and their rules are scattered across dense legal documents that are hard to find and harder to read.</p>
        <p>Someone on a boat near Miloliʻi might be simultaneously inside the West Hawaiʿi Regional Fishery Management Area, the Miloliʻi CBSFA, the Miloliʻi FRA, and one or more sub-zones — each with different rules. haMMA makes that clear at a glance.</p>
      </section>

      <section class="about-pane__section">
        <h3>How to use it</h3>
        <p><strong>Tap or click the map</strong> at any location to see every managed area at that spot and the rules that apply — including overlapping areas combined into a single summary.</p>
        <p><strong>Browse the list</strong> to find a specific area by island and name. When an area selected from the list overlaps with others, a notification tells you how many other areas share that zone.</p>
      </section>

      <section class="about-pane__section">
        <h3>How rules are shown</h3>
        <p>Each area card has three tabs: <strong>About</strong>, <strong>Rules</strong>, and <strong>Laws</strong>. Rules are organized by category — Gear, Species &amp; Bag Limits, Activities, Seasons &amp; Times, and Transit &amp; Anchor — and color-coded by status: Prohibited, Allowed, Allowed with limits, and Notes.</p>
        <p>When multiple areas overlap, a combined summary reorganizes all rules into one unified view. Source chips show which area each rule comes from. Tapping an area name flashes that polygon on the map.</p>
      </section>

      <section class="about-pane__section">
        <h3>Data &amp; accuracy</h3>
        <p>Rules are sourced from official Hawaii Administrative Rules (HAR) and Hawaii Revised Statutes (HRS) documents. This tool is for informational purposes only and may not reflect the most recent amendments. Always verify rules with DAR before entering a managed area.</p>
        <p>Links to official source documents are in the <strong>Laws</strong> tab of each area card.</p>
      </section>

      <section class="about-pane__section">
        <h3>Contact</h3>
        <p>Built by Tyler Kueffner for DAR and for Hawaiʿi’s fishers.</p>
        <p>For suggested features, data corrections, questions, or bugs: <a href="mailto:tk85@hawaii.edu" class="about-pane__link">tk85@hawaii.edu</a></p>
      </section>

      <section class="about-pane__section about-pane__section--links">
        <a href="https://dlnr.hawaii.gov/dar/" target="_blank" rel="noopener" class="about-pane__link">Division of Aquatic Resources ↗</a>
      </section>
    </div>`;

  function openAboutPane() {
    clearMapSelection({ keepInfoOpen: false });

    const desktopTitle = document.getElementById('info-banner-title');
    const mobileTitle  = document.getElementById('info-banner-title-mobile');
    if (desktopTitle) desktopTitle.textContent = 'About';
    if (mobileTitle)  mobileTitle.textContent  = 'About';

    infoContentEl.innerHTML = `
      <div class="mmpopup">
        <div class="mmpopup__scroll">${README_HTML}</div>
      </div>`;

    if (isMobileView()) {
      openInfoView();
    } else {
      infoSidebarEl.classList.add('active');
    }

    clearAccordionSelectionHighlight();
  }

  function openInfoPanel(latlng, features, options = {}) {
    activeLastLatlng  = latlng || null;
    lastSelectionSource = options.source || null;
    activeLastBounds = options.source === 'menu'
      ? getBoundsForFeatures(features)
      : null;

    const isMulti   = features.length > 1;
    const areaName  = getFeatureName(features[0].properties) || 'Area Info';
    const count = features.length;
    // For list-selected single areas, count how many other features overlap
    // so we can show the notification banner.
    let overlapCount = 0;
    if (!isMulti && options.source === 'menu') {
      // Find the Leaflet layer for this feature so we can use getBounds()
      const areaName = getFeatureName(features[0].properties);
      let targetLayer = null;
      Object.values(allIslandLayers).some((group) => {
        group.eachLayer((layer) => {
          if (!targetLayer && getFeatureName(layer.feature?.properties) === areaName) {
            targetLayer = layer;
          }
        });
        return !!targetLayer;
      });
      if (targetLayer) overlapCount = countOverlapsForFeature(targetLayer);
    }
    infoContentEl.innerHTML = isMulti
      ? renderOverlapInfoPane(features)
      : renderSingleAreaInfoPane(features[0], overlapCount);

    infoContentEl.querySelector('.mmpopup__scroll').scrollTop = 0;

    // Sync panel header titles
    const panelTitle = isMulti
      ? `${count} Area${count === 1 ? '' : 's'} Selected`
      : areaName;
    const desktopTitle = document.getElementById('info-banner-title');
    const mobileTitle  = document.getElementById('info-banner-title-mobile');
    if (desktopTitle) desktopTitle.textContent = panelTitle;
    if (mobileTitle)  mobileTitle.textContent  = panelTitle;


    if (isMobileView()) {
      openInfoView({ skipRecentre: options.source !== 'menu' });
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
    }
  }

  // FIX: removed dead `if (isMobileView())` block after the early return —
  // it could never execute. setMobileHomeState() already calls
  // setInfoSidebarState('hidden') internally.
  function closeInfoPanel() {
    if (isMobileView()) {
      openListView();
      return;
    }
    infoSidebarEl.classList.remove('active');
  }


  // ── 16. SIDEBAR — POPULATION ─────────────────────────────────
  function populateSidebar(islandName, sortedNames) {
    if (!islandListEl) return;

    const notice = islandListEl.querySelector('.loading-notice');
    if (notice) notice.remove();

    const islandId = islandName.replace(/[^a-zA-Z0-9]/g, '');
    const fragment  = document.createDocumentFragment();

    const group = document.createElement('div');
    group.className = 'island-group';

    const header = document.createElement('button');
    header.className = 'island-header';
    header.id = `header-${islandId}`;
    header.setAttribute('aria-expanded', 'false');
    header.setAttribute('aria-controls', `list-${islandId}`);
    header.addEventListener('click', () => toggleIsland(islandId));

    const headerLeft = document.createElement('div');
    headerLeft.className = 'header-left';
    const islandLabel = document.createElement('span');
    islandLabel.textContent = islandName;
    headerLeft.append(islandLabel);

    const chevron = document.createElement('span');
    chevron.className = 'chevron';
    chevron.textContent = '▼';
    chevron.setAttribute('aria-hidden', 'true');

    header.append(headerLeft, chevron);

    const list = document.createElement('div');
    list.id = `list-${islandId}`;
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
      item.dataset.area = areaName;

      item.addEventListener('click',    () => zoomToArea(islandName, areaName));
      item.addEventListener('keydown',  (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); zoomToArea(islandName, areaName); }
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

    // Mobile: single-expand — close others first
    if (isMobileView()) {
      islandListEl.querySelectorAll('.area-list.active').forEach((el) => {
        if (el !== list) el.classList.remove('active');
      });
      islandListEl.querySelectorAll('.island-header.expanded').forEach((el) => {
        if (el !== header) el.classList.remove('expanded');
      });
    }

    list.classList.toggle('active',    shouldOpen);
    header.classList.toggle('expanded', shouldOpen);
    header.setAttribute('aria-expanded', String(shouldOpen));

    if (isMobileView() && shouldOpen) {
      islandListEl.scrollTo({ top: header.offsetTop - 2, behavior: 'smooth' });
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

      // Mobile: open info panel then fit bounds in visible strip above sheet
      if (isMobileView()) {
        activeLastBounds = bounds;
        openPanel();
        flashLayerBorder(layer);
        scheduleMobileFit(bounds);
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

  function syncSearchClearVisibility() {
    const wrap = areaSearchEl?.closest('.search-input-wrapper');
    if (!wrap) return;
    wrap.classList.toggle('has-value', Boolean(areaSearchEl?.value));
  }

  function filterSidebar() {
    const term = normalizeHawaiianText(areaSearchEl?.value || '');
    let totalMatches = 0;

    islandListEl.querySelectorAll('.island-group').forEach((group) => {
      const islandLabel = group.querySelector('.header-left span')?.textContent || '';
      const islandMatch = term !== '' && normalizeHawaiianText(islandLabel).includes(term);
      let hasMatch = false;

      group.querySelectorAll('.area-item').forEach((item) => {
        const matches = term === '' || islandMatch || normalizeHawaiianText(item.textContent).includes(term);
        item.style.display = matches ? '' : 'none';
        if (matches) { hasMatch = true; totalMatches++; }
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

    let notice = islandListEl.querySelector('#search-no-results');
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'search-no-results';
      notice.className = 'loading-notice';
      notice.textContent = 'No matching areas found';
      notice.hidden = true;
      islandListEl.appendChild(notice);
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

      // Append "About this map" button at the bottom of the island list
      if (islandListEl) {
        const aboutBtn = document.createElement('button');
        aboutBtn.type = 'button';
        aboutBtn.className = 'about-map-btn';
        aboutBtn.innerHTML = '<span class="about-map-btn__icon">ℹ</span><span class="about-map-btn__label">About this map</span>';
        aboutBtn.addEventListener('click', openAboutPane);
        islandListEl.appendChild(aboutBtn);
      }

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
          islandListEl.innerHTML = '<div class="loading-notice" role="status">Loading marine areas…</div>';
          islandListEl.setAttribute('aria-busy', 'true');
          loadAllFromSingleService();
        });
      }
    }
  }


  // ── 19. EVENT WIRING ─────────────────────────────────────────

  // Search (single input)
  areaSearchEl?.addEventListener('input',  () => { syncSearchClearVisibility(); filterSidebar(); });
  searchClearEl?.addEventListener('click', clearSidebarSearch);

  // Mobile back button
  document.getElementById('sheet-back-btn')?.addEventListener('click', openListView);

  // Mobile tap-toggle handles
  document.getElementById('sheet-handle-btn')?.addEventListener('click', toggleExpanded);
  document.getElementById('info-handle-btn')?.addEventListener('click', toggleExpanded);

  // Info panel — delegated listener for all dynamic content
  infoContentEl?.addEventListener('click', (e) => {
    const tabBtn = e.target.closest('[data-tab-target]');
    if (tabBtn) { showTab(tabBtn, tabBtn.dataset.tabTarget); return; }

    const flashPill = e.target.closest('[data-flash-area]');
    if (flashPill) { flashFeatureByName(flashPill.dataset.flashArea); return; }

    const dismissBtn = e.target.closest('.overlap-notice__dismiss');
    if (dismissBtn) { dismissBtn.closest('.overlap-notice')?.remove(); return; }

    const accordionToggle = e.target.closest('[data-action="toggle-summary"]');
    if (accordionToggle) { toggleSummaryAccordion(accordionToggle); return; }

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

  // Map click — desktop only clears selection
  map.on('click', () => { if (!isMobileView()) clearMapSelection({ fromClick: true }); });

  // Resize — debounced
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
