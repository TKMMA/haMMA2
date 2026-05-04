# haMMA — Hawaiʻi Marine & Freshwater Managed Areas (BETA) v.5.1.26

An interactive public map that helps residents, visitors, fishers, divers, and ocean users understand which managed marine and freshwater area rules apply at any location in Hawaiʻi.

All Statewide fishing regulations still apply on top of each area's specific rules

---

## Why this exists

Since the 1960s, the Hawaiʻi Division of Aquatic Resources (DAR) has established place-specific regulations for a total of 90 different marine and freshwater areas across the state — Marine Life Conservation Districts, Fish Replenishment Areas, Community-Based Subsistence Fishing Areas, Public Fishing Areas (freshwater), and more. These areas frequently overlap, and their rules are scattered across dense legal documents that are hard to find and harder to read.

Someone on a boat near Miloliʻi (South Kona, Hawaiʻi Island) might be simultaneously inside the West Hawaiʻi Regional Fishery Management Area, the Miloliʻi CBSFA, the Miloliʻi FRA, and one or more of its multiple sub-zones — each with different rules for gear, species, bag limits, seasons, and activities. The existing government map tools are difficult to use in the field, especially on a phone.

haMMA replaces that experience with something fast, clear, and built for real people in real places.

This map was build by Tyler Kueffner for DAR and for Hawaiʻi's fishers.

For suggested features, data corrections, questions, or bugs in this map, email: tk85@hawaii.edu

---

## Core experience

### Tap the map, get your rules

The primary interaction is simple: tap or click anywhere on the map. The app identifies every managed area at that location — including overlapping polygons — and shows the applicable rules immediately.

On mobile, a panel slides up from the bottom. On desktop, it opens in a sidebar. Either way, you're reading rules within a second or two of tapping.

### Browse by island and area name

A searchable list organizes all 90+ areas by island. Tap any area name to fly to it on the map and open its rules card. When an area selected from the list overlaps with other managed areas, a notification banner tells you how many other areas share that zone and invites you to tap the map for the full combined view.

---

## Area information — three tabs

Each area card has three tabs:

- **About** — designation type, island, purpose, establishment date, and location description
- **Rules** — the area's fishing and activity rules, organized by category and status
- **Laws** — links to the official HAR and HRS legal documents the rules are sourced from

---

## How rules are displayed

Rules are organized into five categories:

- **Gear Rules** — what fishing equipment is allowed, prohibited, or restricted
- **Species & Bag Limits** — which species are protected, bag limits, and size requirements
- **Activities Rules** — fish feeding, anchoring, removing geological features, and other actions
- **Seasons & Times** — closed seasons, time-of-day restrictions, and seasonal windows
- **Transit & Anchor** — rules for vessels passing through with otherwise-restricted gear

Within each category, rules are color-coded by status:

- 🔴 **Prohibited** — unlawful activities and gear
- ✅ **Allowed** — explicitly permitted gear or activities
- ⚠️ **Allowed with limits** — permitted under specific conditions: size limits, bag limits, seasonal windows, gear restrictions
- 📋 **Notes** — context that modifies how other rules apply (transit exemptions, permit conditions)

Rule text is written in plain English, not legal prose.

---

## Overlapping areas — the combined summary

This is the most distinctive feature of the app. Because managed areas frequently overlap, showing only one area's rules is not enough.

When multiple areas are selected, the app shows:

### Combined rules summary

A single card that reorganizes rules from all selected areas into one unified view. Rules are grouped by category and status — all Prohibited gear rules from all areas appear together, all Species limits together, and so on.

**Source chips** — small colored numbered circles — appear at the end of each rule line, indicating which area that rule comes from. A legend at the top of the summary lists all included areas with their chip numbers.

**Flash on map** — tapping any area name in the legend flashes that polygon on the map with a brief yellow highlight, so you can see exactly where it is without moving the map or changing the selection.

**Deduplication** — when multiple areas share identical rule text (such as the standard transit note that appears in every CBSFA), the app collapses them into a single entry with all relevant source chips grouped together, rather than repeating the same line multiple times.

### Area-specific cards

Below the summary, individual cards for each selected area preserve the original rule text in full. These are the source of truth — the summary is an organizational aid, not a replacement.

---

## Mobile experience

The app is designed to be used on a phone in the field.

- **Bottom sheet** — the rules panel slides up as a bottom sheet with snap positions: peeking, half-height, and full-height
- **Drag to resize** — drag the banner at the top of the panel to adjust how much map is visible. The drag system uses a two-phase approach: before a clear vertical gesture is confirmed, scrolling within the panel is never blocked. Only once a deliberate upward or downward drag is detected does the sheet respond.
- **Back to list** — the back button in the panel header returns to the areas list
- **Multi-area banner** — when multiple areas are selected, a "SEE COMBINED RULES FOR N OVERLAPPING AREAS" button appears directly below the header, giving you one-tap access to the combined summary
- **Overlap notification** — when a single area is selected from the list, a notification banner appears if other managed areas share that zone. It reads "N other managed areas overlap at this zone — tap the map to see combined rules at a specific spot." Dismissible with a tap.
- **No accidental map movement** — tapping the map never triggers an unwanted fly-to animation. The map stays where you left it.

---

## Desktop experience

- **Split panel layout** — the areas list sits in a narrower left panel, the info panel opens to its right, leaving the majority of the screen as map
- **Click any polygon** — the info panel opens immediately without moving the map
- **Searchable list** — organized by island, filterable by area name

---

## Data and rules

Rules are sourced directly from Hawaii Administrative Rules (HAR) and Hawaii Revised Statutes (HRS) documents published by the State of Hawaiʻi. A custom extraction pipeline fetches each source PDF directly from government servers, interprets the legal text using Claude AI, and organizes it into a consistent 16-field schema across five categories: gear, species, activities, seasons, and transit rules. Each field is status-typed (Prohibited / Allowed / Allowed with limits / Notes) so the app can render rules clearly without any text parsing at runtime.

Rule text is written in plain English and Hawaiian species names use correct diacritical markings (ʻokina and kahakō) even when the source documents do not.

The data layer is a hosted ArcGIS Online feature service maintained by the project team. Each of the 90+ features includes structured rule fields, links to official legal documents, and photos where available.

---

## Important note

haMMA is an informational tool. Rule text is based on official sources but may not reflect recent amendments or administrative updates. Always verify rules against official agency resources before entering a managed area. When in doubt, contact the Division of Aquatic Resources.

Links to official HAR and HRS documents are available in the **Laws** tab of each area card.

---

## Technical stack

- **Leaflet.js** — map rendering and polygon interaction
- **ArcGIS Online** — hosted feature service for area geometries and attributes
- **Vanilla JS / CSS** — no frontend framework; single-file architecture
- **Esri World Imagery** — satellite basemap with reference labels overlay

---

## Project

Built as a public service to replace the existing government ArcGIS map viewer with a faster, clearer, mobile-friendly experience for the people who actually use these waters.
