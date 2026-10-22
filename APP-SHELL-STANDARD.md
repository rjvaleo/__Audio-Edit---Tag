# App shell standard — rail, header, guide, flags, themes

A reference implementation, taken out of the CTIO COMBO PI Dashboard and written
so a second application can be brought to the same shape. Every code block below
is real code from that app, not a sketch.

Written for two readers:

* **the same stack** — React + TypeScript + Tailwind + zustand + react-router.
  Copy the modules; they have no dependency on this app's domain.
* **any other stack** — each section ends with a **Contract** giving the data
  model and the rules with the React and the Tailwind taken out.

---

## 0. The one idea

> **Anything the reader arranges is data, held per browser, and normalised
> against what the application actually offers today.**

Every subsystem here is that sentence applied to a different surface:

| surface | the arrangement | normalised against |
|---|---|---|
| Left rail | sections, order, what is hidden | the routes the app serves now |
| Nav icons | route → icon name | the icon catalogue |
| Favourites | a list of routes | the routes that resolve |
| Feature flags | booleans | the flag keys that exist |
| Theme | one id + a token block | the themes registered now |
| Published setup | a file of the above | an allow-list, applied at both ends |

The failure this prevents is specific and it is the reason for the whole
pattern: **a stored arrangement outlives the application it describes.** A page
gets renamed, a route retires, a filter value stops matching anything — and a
naive `JSON.parse(localStorage)` hands the UI a shape that no longer means
anything. In this app that produced a blank Architecture page with no control lit
to explain it, because a stored filter selected a workstream that had been
renamed. Everything below treats stored state as *a preference, not a schema*.

**The precedence, everywhere, in this order:**

```
stored (this browser)  >  published (the shared preset)  >  built-in (the code)
```

---

## 1. The left rail

### 1.1 The data model

The nav is not a list written in JSX. It is a document:

```ts
export interface NavSection {
  id: string;
  label: string;
  /** Routes, in the order they are drawn. */
  items: string[];
}

export interface NavLayout {
  sections: NavSection[];
  /** Routes deliberately switched off. Kept so they can come back. */
  hidden: string[];
}

/** The section that holds items belonging to no heading — the top of the nav. */
export const UNSECTIONED = 'top';

let seq = 0;
export const sectionId = () => `nav-${Date.now().toString(36)}-${(seq += 1).toString(36)}`;
```

**Items are routes, not page objects.** That is the decision that makes the rest
work: the layout can hold a page without knowing what the page is, a route the
app stops serving simply drops out, and the same list can hold a board, an admin
tool and a tree without a discriminated union.

The section with an empty label is the top of the rail — its items are drawn
bare, with no heading.

### 1.2 `normalise` — the function everything else depends on

```ts
/** A section's items, with anything unknown or already placed removed. */
const clean = (items: string[] | undefined, known: Set<string>, seen: Set<string>) =>
  (items ?? []).filter((to) => {
    if (!known.has(to) || seen.has(to)) return false;
    seen.add(to);
    return true;
  });

/**
 * Make a stored nav safe to render against the routes that exist now.
 *
 * A route the app no longer serves is dropped; one it serves that the layout
 * never mentioned is appended to the last section — visible, and out of the
 * way — because a new page silently missing from the nav is how a feature
 * ships and nobody finds it.
 *
 * An empty section is kept. Unlike a roll-up block, a nav heading with nothing
 * under it is somewhere to drag things *to*, and deleting it out from under a
 * reader mid-arrangement would be the tool fighting them.
 */
export function normalise(layout: NavLayout | null, known: string[], fallback: NavLayout): NavLayout {
  const routes = new Set(known);

  // With no arrangement of its own, the built-in one is the arrangement — but
  // anything already switched off is carried over rather than dropped with it.
  const source = layout?.sections?.length
    ? layout
    : { sections: fallback.sections, hidden: [...(fallback.hidden ?? []), ...(layout?.hidden ?? [])] };

  const seen = new Set<string>();

  // Hidden is claimed **first**. Being switched off is something somebody said
  // about a page; sitting in a section is only where it happens to be, and the
  // built-in sections list every page by definition — so letting sections win
  // would mean nothing could ever be hidden from a default layout.
  const hidden = [...new Set(source.hidden ?? [])].filter((to) => routes.has(to));
  for (const to of hidden) seen.add(to);

  const sections = source.sections.map((section) => ({
    id: section.id || sectionId(),
    label: section.label ?? '',
    items: clean(section.items, routes, seen),
  }));

  const missing = known.filter((to) => !seen.has(to));
  if (missing.length) {
    const last = sections[sections.length - 1];
    if (last) last.items = [...last.items, ...missing];
    else sections.push({ id: sectionId(), label: '', items: missing });
  }
  return { sections, hidden };
}
```

Four rules are load-bearing, and each one is a bug that was actually hit:

1. **Unknown routes are dropped.** A retired page cannot leave a dead row.
2. **New routes are appended, never discarded.** A page that ships and never
   appears in anyone's nav is a page nobody finds.
3. **`hidden` is claimed before sections.** Otherwise a default layout — which
   lists every page by construction — makes hiding impossible.
4. **Empty sections survive.** They are drop targets.

### 1.3 Moving things

```ts
const withoutItem = (layout: NavLayout, to: string): NavLayout => ({
  sections: layout.sections.map((s) => ({ ...s, items: s.items.filter((x) => x !== to) })),
  hidden: layout.hidden.filter((x) => x !== to),
});

/**
 * Put an item in a section, at a position. Never leaves a copy behind.
 *
 * `index` counts against the section **as it looks now**, which is what the
 * drop indicator between two chips is pointing at. That needs saying because
 * the item is lifted out before it is put back: dragging the first chip to the
 * gap before the third would otherwise land it after the third. Omit `index`
 * to append.
 */
export function placeItem(layout: NavLayout, to: string, section: number, index?: number): NavLayout {
  if (!layout.sections[section]) return layout;
  const from = layout.sections[section].items.indexOf(to);
  const next = withoutItem(layout, to);
  const items = [...next.sections[section].items];
  const at = index === undefined ? items.length : from >= 0 && from < index ? index - 1 : index;
  items.splice(Math.max(0, Math.min(at, items.length)), 0, to);
  return { ...next, sections: next.sections.map((s, i) => (i === section ? { ...s, items } : s)) };
}

/**
 * Move an item one step up or down the nav, as it is drawn.
 *
 * The nav reads as one column, so the arrows follow the column rather than the
 * section: an item at the bottom of a group moves into the top of the group
 * below, not nowhere. Empty sections are stepped **into**, one click at a time.
 * Only the two true ends are no-ops.
 */
export function moveItem(layout: NavLayout, to: string, by: -1 | 1): NavLayout {
  const si = layout.sections.findIndex((s) => s.items.includes(to));
  if (si < 0) return layout;
  const index = layout.sections[si].items.indexOf(to);
  const target = index + by;

  if (target >= 0 && target < layout.sections[si].items.length) {
    const items = [...layout.sections[si].items];
    [items[index], items[target]] = [items[target], items[index]];
    return { ...layout, sections: layout.sections.map((s, i) => (i === si ? { ...s, items } : s)) };
  }

  const into = si + by;
  if (into < 0 || into >= layout.sections.length) return layout;
  return placeItem(layout, to, into, by === 1 ? 0 : layout.sections[into].items.length);
}

export function hideItem(layout: NavLayout, to: string): NavLayout {
  const next = withoutItem(layout, to);
  return { ...next, hidden: [...next.hidden, to] };
}

export function addSection(layout: NavLayout, label = 'New section'): NavLayout {
  return { ...layout, sections: [...layout.sections, { id: sectionId(), label, items: [] }] };
}

export function renameSection(layout: NavLayout, index: number, label: string): NavLayout {
  return { ...layout, sections: layout.sections.map((s, i) => (i === index ? { ...s, label } : s)) };
}

/**
 * Remove a section. What was in it moves to the section above, or below.
 *
 * Not hidden, and not deleted. Removing a heading is a statement about the
 * heading; the pages under it are still pages, and making somebody re-find them
 * in a switched-off tray to undo one click is a tool that punishes a mistake.
 */
export function removeSection(layout: NavLayout, index: number): NavLayout {
  const target = layout.sections[index];
  if (!target || layout.sections.length <= 1) return layout;
  const into = index > 0 ? index - 1 : 1;
  const sections = layout.sections
    .map((s, i) => (i === into ? { ...s, items: [...s.items, ...target.items] } : s))
    .filter((_, i) => i !== index);
  return { ...layout, sections };
}
```

**The drag index rule is the one that costs an afternoon if you get it wrong.**
`placeItem` reads the item's current position *before* removing it, so a drop
indicator sitting between two rows means the same thing whether the drag came
from above or below. Without the `from < index ? index - 1 : index` correction,
dragging downward within one section lands one slot too far, and only in that
direction — which reads as a flaky UI rather than an off-by-one.

### 1.4 Migrations, so a rearrangement is never undone

Three helpers exist for the specific case of *changing the app under an
arrangement somebody already made*. They are no-ops once the item has a place —
including a place in the hidden tray — so they are safe to run on every render.

```ts
/** Fold a set of routes into `hidden` — e.g. retiring per-page nav switches. */
export function hideRoutes(layout: NavLayout, routes: string[]): NavLayout {
  return routes.reduce((l, to) => (l.hidden.includes(to) ? l : hideItem(l, to)), layout);
}

/**
 * Put an item into the section whose heading best matches, or append it.
 *
 * For introducing an entry that is **replacing something that was already
 * there**, where the plain rule — append anything new to the last section — puts
 * it somewhere absurd. Matching on the heading rather than on a route, because
 * by the time this runs the route it used to hang from is already gone.
 */
export function seedItem(layout: NavLayout, to: string, matches: RegExp): NavLayout { /* … */ }

/** The same, but giving the new entry a section of its own after an anchor. */
export function seedSection(layout: NavLayout, to: string, label: string, after: RegExp): NavLayout { /* … */ }
```

Pair them with a recorded version number in the store, so a one-time repair
happens once and then never argues with what the reader did afterwards:

```ts
/** Which round of one-time nav repairs this layout has had. */
navRepairVersion: number;
```

### 1.5 The catalogue — how the settings panel knows what exists

The shell is the only place that knows which pages survive the feature flags.
The panel that arranges the nav is rendered from a different branch of the tree.
A module-level store with subscribers is enough; a context provider for two
values is more machinery than the problem.

```ts
export interface NavCatalogueEntry {
  label: string;
  /** The icon the page ships with, by name — what "Built-in" puts back. */
  builtInIcon: string | null;
}

export interface NavCatalogue {
  /** Route → label and built-in icon, for every page the nav can list. */
  routes: Map<string, NavCatalogueEntry>;
  /** The arrangement the app ships with, for Reset. */
  builtIn: NavLayout;
}

let current: NavCatalogue = { routes: new Map(), builtIn: { sections: [], hidden: [] } };
const listeners = new Set<() => void>();

/** Called by the shell each time the listed pages change. */
export function usePublishNavCatalogue(
  routes: Map<string, { label: string; Icon?: IconComponent }>,
  builtIn: NavLayout,
): void {
  useEffect(() => {
    current = {
      routes: new Map([...routes].map(([to, t]) => [to, { label: t.label, builtInIcon: nameOfIcon(t.Icon) }])),
      builtIn,
    };
    for (const listener of listeners) listener();
  }, [routes, builtIn]);
}
```

Name the reader `useNavCatalogue`, not `navCatalogue` — a hook that does not
start with `use` is a hook the linter cannot see, and `rules-of-hooks` will not
protect it.

### 1.6 Icons as part of the arrangement

Once the reader arranges the nav, the icon becomes part of the arrangement — and
the failure that follows is **duplication**, because a collapsed rail is icons
and nothing else. Two entries wearing the same glyph are two rows you cannot
tell apart.

So the picker's job is not "choose a pretty icon", it is *show me what is taken
and by whom*. Store **names**, never components: a name is comparable, storable
and testable.

```ts
/** A route's icon, by name, as somebody chose it. */
export type NavIcons = Record<string, string>;

export interface IconTarget { to: string; label: string; builtIn: string }

/**
 * The icon each page should draw, chosen over built-in.
 *
 * A stored name for a route the app no longer serves is dropped, and a name the
 * catalogue no longer offers falls back to the built-in rather than to nothing
 * — an icon that fails to resolve must never leave a hole in the nav.
 */
export function resolveIcons(stored: NavIcons | null, targets: IconTarget[], catalogue: string[]): NavIcons {
  const known = new Set(catalogue);
  const out: NavIcons = {};
  for (const target of targets) {
    const chosen = clean(stored?.[target.to]);
    out[target.to] = chosen && known.has(chosen) ? chosen : target.builtIn;
  }
  return out;
}
```

The catalogue is **hand-picked, not the whole icon set**. A picker of fifteen
hundred glyphs is a search box with no answer in it, and the point is telling
entries apart — which needs icons that are *unlike each other at 13px*, not more
of them.

```ts
export type IconComponent = ComponentType<{ size?: number | string; className?: string }>;

export const ICON_CATALOGUE: Record<string, IconComponent> = {
  Activity, AlertTriangle, Archive, BarChart3, Bookmark, BookOpen, Boxes, Bug, Building2,
  CalendarClock, CalendarRange, ChartPie, CheckCheck, ClipboardList, CloudDownload, Columns3,
  /* … about sixty, all legible at 13px … */
};
```

### 1.7 Rendering the rail

Three components and one pure function. Nothing here knows what a page is.

**Width, collapse and the drag handle.** The width is dragged rather than chosen
from preset sizes, because the labels are the constraint and only the reader can
see them.

```tsx
export const NAV_RAIL_WIDTH = 48;   // collapsed: icons only
const NAV_MIN_WIDTH = 176;
const NAV_MAX_WIDTH = 420;

function Sidebar({ children }: { children: React.ReactNode }) {
  const width = useSettings((s) => s.navWidth);
  const collapsed = useSettings((s) => s.navCollapsed);
  const setWidth = useSettings((s) => s.setNavWidth);
  const setCollapsed = useSettings((s) => s.setNavCollapsed);
  const [dragging, setDragging] = useState(false);

  const applied = collapsed ? NAV_RAIL_WIDTH : width;

  // Drag on the window, not on the divider: the pointer routinely leaves a
  // 4px strip mid-drag, and a handler bound to the strip would drop the drag
  // the moment it did. Pointer capture keeps the events coming here.
  function startDrag(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    setDragging(true);
  }
  function onDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    const next = event.clientX;
    // Dragging well below the minimum collapses rather than fighting the clamp
    // — the gesture reads as "make this go away", and the alternative is a
    // divider that sticks at 176px however hard it is pushed.
    if (next < NAV_MIN_WIDTH - 32) {
      setCollapsed(true);
      setDragging(false);
      return;
    }
    if (collapsed && next > NAV_RAIL_WIDTH + 24) setCollapsed(false);
    setWidth(next);
  }

  return (
    <>
      <aside
        style={{ width: applied }}
        className={`sticky top-0 z-40 flex h-screen shrink-0 flex-col border-r border-black/20 bg-navy ${
          dragging ? '' : 'transition-[width] duration-150'
        }`}
      >
        {children}
      </aside>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the navigation"
        aria-valuenow={applied}
        aria-valuemin={NAV_MIN_WIDTH}
        aria-valuemax={NAV_MAX_WIDTH}
        tabIndex={0}
        onPointerDown={startDrag}
        onPointerMove={onDrag}
        onPointerUp={() => setDragging(false)}
        onDoubleClick={() => setCollapsed(!collapsed)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setWidth((collapsed ? NAV_RAIL_WIDTH : width) - 16);
          if (e.key === 'ArrowRight') {
            if (collapsed) setCollapsed(false);
            else setWidth(width + 16);
          }
        }}
        title="Drag to resize · double-click to collapse"
        className={`sticky top-0 z-40 h-screen w-1 shrink-0 cursor-col-resize transition ${
          dragging ? 'bg-sky-400' : 'bg-transparent hover:bg-sky-400/50'
        } focus:bg-sky-400 focus:outline-none`}
      />
    </>
  );
}
```

Four details worth keeping:

* **Pointer capture, not a handler on the 4px strip.** Without it the drag drops
  the first time the pointer leaves the divider, which is immediately.
* **Under-drag collapses.** Fighting a clamp feels broken; collapsing is what
  the gesture meant.
* **The separator is focusable and takes arrow keys.** It is a real control.
* **The width transition is suppressed while dragging**, or the rail lags the
  pointer by 150ms.

**A folding section.**

```tsx
function SidebarSection({ label, collapsed, foldable = true, children }: {
  label: string; collapsed: boolean; foldable?: boolean; children: React.ReactNode;
}) {
  const closed = useSettings((state) => state.navSectionsClosed[label] === true) && foldable;
  const toggle = useSettings((state) => state.toggleNavSection);

  // Collapsed, the rail is a column of icons with no headings to sit under, so
  // there is nothing to indent *from*.
  if (collapsed) {
    return (<><SidebarHeading label={label} collapsed />{children}</>);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => toggle(label)}
        aria-expanded={!closed}
        title={closed ? `Show ${label}` : `Hide ${label}`}
        className="mt-2.5 mb-0.5 flex w-full items-center gap-1 rounded px-2 py-0.5 text-left transition hover:bg-white/5"
      >
        <ChevronRight size={10}
          className={`shrink-0 text-white/30 transition-transform ${closed ? '' : 'rotate-90'}`} />
        <span className="text-[9px] font-bold uppercase tracking-wider text-white/35">{label}</span>
      </button>
      {!closed && <Indented>{children}</Indented>}
    </>
  );
}

/** One wrapper rather than padding on each row, so everything a section holds
 *  lines up without each row having to know it is inside a section. */
function Indented({ children }: { children: React.ReactNode }) {
  return <div className="pl-3.5">{children}</div>;
}
```

Fold state is keyed **by heading**, and *absent means open* — a section nobody
has touched should be showing.

**Which tab is current — `tabOwnsPath`.**

```ts
/**
 * `NavLink` marks a tab active for any path beneath it, which is right until two
 * tabs are nested: `/pi` claimed `/pi/overview` as well, so opening PI Overview
 * lit up PI Board beside it and the nav showed two current pages. Rather than
 * hard-coding the exception, the rule is **longest match wins**.
 */
export function tabOwnsPath(to: string, path: string, all: string[] = navRoutes()): boolean {
  const under = (route: string) => path === route || path.startsWith(`${route}/`);
  if (!under(to)) return false;
  return !all.some((other) => other !== to && other.length > to.length && under(other));
}
```

**A row.** Note that the chosen icon is read *inside* the row, so no caller has
to know the feature exists.

```tsx
function SidebarLink({ tab, collapsed }: { tab: NavTab; collapsed: boolean }) {
  const { label, why } = tab;
  const chosen = useSettings((s) => s.navIcons[tab.to]);
  const Icon = iconByName(chosen) ?? tab.Icon;
  const active = tabOwnsPath(tab.to, useLocation().pathname);
  return (
    <NavLink
      to={tab.to}
      // The title carries the label when collapsed, because the rail shows only
      // an icon and an unlabelled icon is a guess. Expanded, it carries the
      // one-line "why" instead — the label is already on screen.
      title={collapsed ? label : why}
      className={() =>
        `flex items-center rounded-md text-[11.5px] font-medium transition ${
          collapsed ? 'justify-center px-0 py-1.5' : 'gap-2 px-2 py-1'
        } ${active ? 'bg-white/15 text-white' : 'text-white/60 hover:bg-white/10 hover:text-white/90'}`
      }
    >
      <Icon size={13} className="shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
    </NavLink>
  );
}
```

Give every page a one-line **`why`**. It is the expanded tooltip, and writing it
is a good test of whether the page should exist.

### 1.8 Assembling it in the shell

```tsx
// Nav entries the flags leave listed.
const listedTabs  = useListed(LEGACY_TABS);
const listedAdmin = useListed(ADMIN_GROUPS.flatMap((g) => g.items));

/**
 * Every page the nav can list, by route.
 *
 * Feature flags decide what is *available*: a page switched off there is not in
 * `byRoute` at all, so the layout drops it and gets it back if the flag returns.
 */
const byRoute = useMemo(() => {
  const all: NavTab[] = [
    ...PRIMARY_TABS, ...JIRA_NAV, ...TREE_TABS, ...listedTabs,
    ...listedAdmin.map((i) => ({ to: i.to, label: i.label, Icon: i.icon, why: i.blurb })),
  ];
  return new Map(all.map((t) => [t.to, t]));
}, [listedTabs, listedAdmin]);

// Handed to the settings panel so it arranges the pages that actually exist.
usePublishNavCatalogue(byRoute, BUILT_IN_NAV);

const storedNav = useSettings((state) => state.navLayout);
const navLayout = useMemo(
  () => normaliseNav(storedNav, [...byRoute.keys()], BUILT_IN_NAV),
  [storedNav, byRoute],
);
```

and the render:

```tsx
{navLayout.sections.map((section) => {
  const items = section.items.map((to) => byRoute.get(to)).filter(Boolean) as NavTab[];
  if (!items.length && !section.label) return null;
  const body = items.map((t) => <SidebarLink key={t.to} tab={t} collapsed={collapsed} />);
  // A section with no heading is the top of the nav: its pages are drawn bare.
  return section.label
    ? <SidebarSection key={section.id} label={section.label} collapsed={collapsed}>{body}</SidebarSection>
    : <Fragment key={section.id}>{body}</Fragment>;
})}
```

The built-in arrangement is a plain constant, and it is also what **Reset**
restores:

```ts
const BUILT_IN_NAV = {
  sections: [
    { id: 'top',  label: '',              items: ['/pi', '/pi/overview', '/ref', '/timeline', '/model'] },
    { id: 'jira', label: 'Jira Sources',  items: ['/jira/overview', '#projects/jira'] },
    { id: 'data', label: 'Data Sources',  items: ['/issues', '/viewer', '/data', '/docs', '/log', '/tests'] },
    { id: 'look', label: 'Look & Feel',   items: ['/admin/sources', '/admin/tags', '/admin/appearance'] },
  ],
  hidden: [],
};
```

A `#`-prefixed item is a deliberate non-route — it draws a tree in place rather
than navigating. Keeping them in the same list means the reader can move them
between sections like anything else.

### 1.9 Favourites

Favourites are the same idea one level up: the nav below is a complete map,
which is right for finding something once and wrong for the three places
somebody goes back to all day.

```tsx
{favorites.length > 0 && (
  <SidebarSection label="Favorites" collapsed={collapsed}>
    {favorites.map((f) => <FavoriteLink key={f.to} favorite={f} collapsed={collapsed} />)}
  </SidebarSection>
)}
```

Two rules: it is **absent entirely** until something is starred — an empty
"Favorites" heading is a promise the app is not keeping — and the star control
lives at the bottom of the rail as **"Add this page to Favorites"**, so starring
is a thing you do to where you are rather than a thing you configure.

### Contract — the rail without React

* **State:** `{ sections: [{ id, label, items: string[] }], hidden: string[] }`,
  plus `navWidth: number`, `navCollapsed: boolean`,
  `navSectionsClosed: Record<label, boolean>`, `navIcons: Record<route, name>`,
  `favorites: route[]`. All per browser.
* **Input from the app:** a `Map<route, { label, icon, why }>` of the pages that
  exist *after* flags are applied, and the built-in layout.
* **The one required function:** `normalise(stored, known, fallback)` with the
  four rules in §1.2. Without it the rest is unsafe.
* **Active-route rule:** longest matching prefix wins.
* **Drag rule:** read the item's current index before removing it.
* **Persist** on every mutation; never on render.

---

## 2. The top-right cluster, and the guide at the bottom left

### 2.1 The placement rule

This is the part most shells get arbitrary. One rule decides it:

> **A control belongs where the thing it produces will appear.**

| the control does this | it lives |
|---|---|
| navigates, and fills the content area | in the **left rail**, as an ordinary row |
| changes how the page you are looking at behaves | in the **top-right cluster** |
| needs the page still visible behind it while you decide | a **modal** from the cluster |
| is a document about the app | an **overlay**, opened from the rail |

Applied here, it explains three moves that otherwise look like taste:

* **Admin tools are rail rows, not a gear menu.** They open in the content area
  like any other page, so they belong with the other things that do that — and
  ordinary routes stay linkable, which a pop-up's contents are not.
* **Settings is a modal from the header, not a rail row.** The flags decide what
  the rail lists, and a control inside that rail could switch itself off from
  under you. A modal also leaves the page you are checking the flag against on
  screen behind it.
* **The guide is an overlay, not a route.** As a page it read as another section
  of the app — you could not tell whether you were looking at a window or a
  page.

### 2.2 The header

One sticky bar. Everything utility is pushed right with `ml-auto`, and every
button shares one class function so the cluster reads as a set.

```tsx
const tab = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition ${
    isActive ? 'bg-white/15 text-white' : 'text-white/60 hover:bg-white/10 hover:text-white/90'
  }`;

<header className="sticky top-0 z-30 border-b border-black/10 bg-navy">
  <div className="flex items-center gap-3 px-4 py-1.5">
    {/* Left: what this build is. Stated on the board itself, not only in the
        room — a screenshot travels further than the conversation that framed it. */}
    <span className="rounded bg-amber-400/20 px-1.5 py-px text-[8.5px] font-bold uppercase
                     tracking-wide text-amber-200">
      internal · snapshot data
    </span>

    {/* And how old each source is. "Snapshot data" says something is a
        snapshot; these say which, and when. */}
    <SourceBadges />

    <div className="ml-auto flex items-center gap-2">
      <DataVersionSwitch buttonClassName={tab({ isActive: false })} />

      {/* An <a href="mailto:"> rather than a button with a handler: the browser
          and the OS already know how to do this, and a click that has to go
          through JavaScript is one that can fail silently. */}
      <a href={FEEDBACK_MAILTO} aria-label="Report feedback or a bug"
         className={tab({ isActive: false })}><Mail size={15} /></a>

      <CoveragePicker buttonClassName={tab({ isActive: false })} />

      <button type="button" onClick={() => setFlagsOpen(true)}
              title="Settings — per-browser switches for what this app shows and how it is arranged"
              aria-label="Settings" aria-haspopup="dialog"
              className={tab({ isActive: flagsOpen })}>
        <Settings size={15} />
      </button>

      <ThemePicker theme={theme} navThemes={navThemes} onSelect={setTheme}
                   buttonClassName={tab({ isActive: false })} />
    </div>
  </div>
</header>
```

Two transferable habits:

* **`buttonClassName` as a prop.** Each picker is its own component but wears
  the shell's class, so the cluster stays visually one thing and the components
  stay portable.
* **State badges live left, controls live right.** The left of the bar says what
  you are looking at; the right changes it. Never mix the two.

**Do not put filters here.** Three rows of filter chips made this header 248px
tall on every page, including the ones the filters did nothing for. Filters
render inside the pages they act on.

### 2.3 The guide overlay, and the corner target

```tsx
const [aboutOpen, setAboutOpen] = useState(false);
const toggleAbout = () => setAboutOpen((open) => !open);

// The bookmarked route still resolves: it opens the overlay over the board and
// replaces itself in history, so the guide has exactly one presentation.
useEffect(() => {
  if (location.pathname !== '/about') return;
  setAboutOpen(true);
  navigate(aboutReturnTo, { replace: true, state: routeState?.aboutReturnState });
}, [location.pathname, aboutReturnTo, navigate]);

// Escape closes it, like every other overlay in the app.
useEffect(() => {
  if (!aboutOpen) return;
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAboutOpen(false); };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [aboutOpen]);
```

```tsx
{aboutOpen && (
  <div role="dialog" aria-modal="true" aria-label="User guide"
       className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-[2px]"
       onClick={() => setAboutOpen(false)}>
    <div
      // The sheet swallows its own clicks, so only the dark edge closes.
      onClick={(e) => e.stopPropagation()}
      // Positioned by inset rather than sized with w-full inside a padded
      // parent: that left the sheet its parent's full width and pushed the gap
      // off the right and bottom edges entirely.
      className="absolute inset-3 flex flex-col overflow-hidden rounded-xl bg-white
                 shadow-2xl ring-1 ring-black/10 sm:inset-5">

      <button type="button" onClick={() => setAboutOpen(false)} aria-label="Close the guide"
              className="absolute right-2 top-2 z-10 rounded-md bg-white/90 p-1 text-slate-400
                         shadow-sm transition hover:bg-slate-100 hover:text-slate-700">
        <X size={15} />
      </button>

      {/*
        A second close, under the cursor rather than across the screen.

        The Guide button in the rail is a toggle — but the sheet covers it, so
        the click that would close it lands on the overlay instead. This sits at
        the sheet's bottom-left corner, which is where the pointer already is
        when the guide opens: open it and close it without moving the mouse.

        The **whole corner** is the target, not the glyph. A 15px icon is a
        target you have to aim at, and the point of putting it here was that no
        aiming should be needed. The gradient says so without drawing a box.

        The one at top right stays, because that is where a reader who has
        scrolled through a long page looks for it.
      */}
      <button type="button" onClick={() => setAboutOpen(false)} aria-label="Close the guide"
              className="group absolute bottom-0 left-0 z-10 flex h-28 w-28 items-center
                         justify-center rounded-bl-xl rounded-tr-2xl bg-gradient-to-tr
                         from-slate-100 to-transparent text-slate-400 transition
                         hover:from-slate-200 hover:text-slate-700">
        <X size={22} className="transition group-hover:scale-110" />
      </button>

      <div className="min-h-0 flex-1 overflow-y-auto"><About /></div>
    </div>
  </div>
)}
```

The generalisable pieces:

1. **Open and close on the same spot.** The opener is at the rail's bottom left;
   the closer is a 112×112 corner of the sheet at the same place. Zero pointer
   travel for the round trip.
2. **The target is the corner, not the icon.** A gradient marks it without
   drawing a box around it.
3. **Two closes, not one.** The corner for someone who just opened it, the top
   right for someone who has scrolled a long document.
4. **Three ways out:** the edge, Escape, and the button. Every overlay in the
   app behaves the same way, so none of them need to be learned.
5. **`inset-3` on the sheet, not `w-full` inside padding** — otherwise the gap
   lands on two edges out of four.

### Contract — cluster and overlay

* One class function shared by every header control; pass it into each as a
  prop.
* Left of the bar = state; right = controls. Filters belong to pages.
* An overlay dialog closes on: backdrop click, `Escape`, and at least one
  explicit control. If it covers its own opener, put a second close where the
  opener was.
* A route that used to be a page keeps resolving, and redirects into the overlay
  with `replace: true`.

---

## 3. Feature flags

### 3.1 What a flag is here

**A flag is local to this browser.** That is the whole distinction, and it is
stated on the panel rather than implied by where the panel lives — everything
else in Admin is shared with everyone reading the board.

```ts
export interface FeatureFlags {
  whitePageSurfaces: boolean;
  dataGridExpandedByDefault: boolean;
  piGroupByFeatureByDefault: boolean;
  scrumEpicsCollapsedByDefault: boolean;
  showBuildSpec: boolean;
  showNonPIItems: boolean;
  showNotTestableItems: boolean;
  bypassHiddenFilters: boolean;
  ignoreRtmReqStatus: boolean;
  aboutSmoothScroll: boolean;
  dataGridManualEditLocked: boolean;
}
```

They are plain booleans on the same settings store as everything else — not a
separate system, not a provider, not a remote service. A flag that needs a
network call to resolve is a flag that can fail.

### 3.2 The listing rule

> **A flag decides what is _listed_. The route always resolves.**

```tsx
function useListed<T extends { flag?: keyof FeatureFlags }>(items: T[]): T[] {
  const settings = useSettings();
  return items.filter((item) => !item.flag || settings[item.flag]);
}
```

Attach the flag to the nav entry, not to the router:

```ts
export interface AdminEntry {
  to: string;
  label: string;
  blurb: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  /** The flag that decides whether this entry is listed. The route always stays. */
  flag?: keyof FeatureFlags;
}
```

Why: deep links from other pages keep working, and a page taken off the menu is
still reachable by anyone who bookmarked it. In this app four sections are
reachable and unlisted on purpose, each with the reason written at the constant:

```ts
/** Sections that stay reachable by route but are not listed. */
const UNLISTED = new Set(['gates', 'flags', 'appearance', 'theme-maintenance']);
```

The **one** case where a flag removes the entry *and* blanks the page is where
the page itself is the thing being hidden — listing an entry that opens a notice
saying it is hidden is the wrong half.

### 3.3 Flags that state their own reach

A switch that could do nothing looks like a switch that is broken. Where a flag
reveals data, count what it would actually reveal **in the dataset loaded right
now**, and put that number on the switch:

```tsx
function useRevealCounts(): { nonPI: number; notTestable: number; excluded: number; total: number } {
  const requirements = useApp((s) => s.requirements);
  return useMemo(() => {
    const records = requirements?.records ?? [];
    /* …count the rows each switch would bring back… */
  }, [requirements]);
}
```

These used to quote fixed numbers in their descriptions. A dataset ingested
before the test matrix existed carries no status at all, so the switch had
nothing to reveal and no total moved when it was flipped — while the description
still said 859. Counting the loaded records means an inert switch says so.

### 3.4 What each flag entry carries

```ts
const FLAGS: {
  key: keyof Flags;
  label: string;
  detail: string;
  /** When the change is not immediate, say when it lands. */
  restart?: string;
  /** Which live count to show beside it, where the flag reveals data. */
  counts?: 'nonPI' | 'notTestable' | 'excluded';
}[] = [
  { key: 'dataGridExpandedByDefault',
    label: 'Expand Data Grid tree by default',
    detail: 'Open every Requirement ID hierarchy level on the first visit to Data Grid.',
    restart: 'Applies on the next Data Grid visit.' },
  …
];
```

`restart` matters more than it looks. A switch whose effect appears two
navigations later is indistinguishable from a switch that does nothing.

### 3.5 Session locks are not preferences

One flag in that list is deliberately **not** persisted across a reload:

```ts
// Manual editing is a session safety lock, not a durable unlocked preference.
// A reload or fresh app session must always return the grid to protected mode.
dataGridManualEditLocked: true,
```

It is forced back to its safe value on load, and it is excluded from the
publishable set. Anything that protects data belongs in this category.

### Contract — flags

* Booleans on the same per-browser store as every other preference.
* `flag?: keyof Flags` on the **nav entry**; routes never gate on flags.
* Each flag ships with: label, one-line detail, optional "applies when", optional
  live count of what it would reveal.
* Session locks re-arm on load and never publish.

---

## 4. Theming

### 4.1 The idea that makes it cheap

> **Write the remap once, against custom properties. A theme is then data.**

The app uses a small, consistent Tailwind surface vocabulary — `bg-white`,
`bg-slate-50/100/200`, one accent ramp. A theme is expressed by **remapping that
vocabulary**, not by writing parallel markup. Every board, drawer, grid, popover
and settings module follows automatically, and a new theme is a token block
rather than another 120 rules.

`index.css`, in full shape:

```css
/*
 * THEMES
 *
 * A theme supplies only a token block, and applying one means writing those
 * tokens onto <html>. Light is the `:root` values below, so it needs no tokens
 * and no class; every other theme adds `.themed`, which switches these rules on.
 */

:root {
  --color-navy: #1f3864;
  --color-brand: #2e5496;
  --color-ink: #20293a;
  --color-mute: #6b7686;

  --chart-track: #e2e8f0;
  --metric-warn: #b4231c;

  --status-done-text: #1b7a3d;   --status-done-bg: #dcf0df;
  --status-progress-text: #1f5fa8; --status-progress-bg: #dde8f8;
  --status-risk-text: #9a6b00;   --status-risk-bg: #fff1c9;
  --status-blocked-text: #b4231c; --status-blocked-bg: #fbe0dc;
  --status-todo-text: #5a6472;   --status-todo-bg: #edf0f4;

  /* The selection pair. `--sel-fill` is the selected lane in the rail;
     `--sel-fill-2` is the content that lane produced — the same hue, one step
     apart, so the two read as related without reading as identical. */
  --sel: #2e5496;
  --sel-ink: #16233d;
  --sel-fill: #dbe6f7;
  --sel-fill-2: #eff4fc;
  --sel-edge: rgba(46, 84, 150, .45);
  --sel-soft: rgba(46, 84, 150, .16);
}

/* ---- surface vocabulary, shared by every non-light theme ---------------- */

.themed body            { background-color: rgb(var(--s-body)); color: var(--tx-800); }
.themed .bg-white       { background-color: var(--s-card); }
.themed .bg-slate-50    { background-color: rgb(var(--s-page)); }
.themed .bg-slate-100   { background-color: rgb(var(--s-raised)); }
.themed .bg-slate-200   { background-color: var(--s-200); }
.themed .bg-navy        { background-color: var(--s-nav); }
.themed .bg-brand       { background-color: var(--s-brand); }

.themed .text-ink       { color: var(--color-ink); }
.themed .text-slate-900 { color: var(--tx-max); }
.themed .text-slate-800 { color: var(--tx-800); }
.themed .text-slate-700 { color: var(--tx-700); }
.themed .text-slate-600 { color: var(--tx-600); }

/* Opacity variants need their own line — `bg-slate-50/95` is a different class
   from `bg-slate-50`, and Tailwind will not derive one from the other. */
.themed .bg-slate-50\/95 { background-color: rgb(var(--s-page) / .95); }
.themed .bg-slate-100\/70{ background-color: rgb(var(--s-raised) / .70); }
```

Two things about that:

* **The `rgb(var(--token) / .95)` form** is why the surface tokens are stored as
  bare channel triples (`248 250 252`) rather than hex — it is the only way one
  token serves both the solid and the translucent class.
* **Enumerate the opacity variants you actually use.** There is no wildcard.
  Grep the markup once and write those lines; a missed one shows as an unthemed
  patch on exactly one panel.

### 4.2 A theme is a small record

```ts
export type ThemeId = string;

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  blurb: string;
  /** Extra class on <html>; only the built-in dark theme needs one. */
  className: string;
  /** What the browser should assume for form controls and scrollbars. */
  colorScheme: 'light' | 'dark';
  icon: LucideIcon;
  swatch: { surface: string; accent: string; ink: string };
  /** Custom properties written onto <html>; empty for light. */
  tokens: Tokens;
  /** Light palette themes only: the same theme on white rather than tinted surfaces. */
  plainTokens?: Tokens;
  /** Built-ins come first in the picker; palettes are grouped after them. */
  group: 'base' | 'palette' | 'custom';
  /** The palette card's colours, shown as a strip in the picker. */
  source?: string[];
}
```

### 4.3 Applying one

```ts
/**
 * Put a theme on the document: the shared `themed` class turns the remapping
 * rules on, the theme's own class carries Tailwind's `dark:` variants where it
 * has them, and the tokens are written as inline custom properties.
 */
export function applyTheme(
  id: ThemeId,
  { whitePage = false, root = document.documentElement }: { whitePage?: boolean; root?: HTMLElement } = {},
): void {
  const meta = themeMeta(id);
  const tokens = whitePage && meta.plainTokens ? meta.plainTokens : meta.tokens;

  for (const t of allThemes()) if (t.className) root.classList.remove(t.className);
  root.classList.toggle('themed', meta.id !== 'light');
  if (meta.className) root.classList.add(meta.className);

  // Clear every custom property first, or a token that one theme sets and the
  // next does not survives the switch.
  for (const key of [...root.style].filter((k) => k.startsWith('--'))) {
    root.style.removeProperty(key);
  }
  for (const [key, value] of Object.entries(tokens)) root.style.setProperty(key, value);
  root.style.colorScheme = meta.colorScheme;
}
```

Driven from one effect in the shell:

```tsx
useEffect(() => {
  applyTheme(theme, { whitePage: whitePageSurfaces });
}, [theme, whitePageSurfaces]);
```

`root` is a parameter so this is testable against a detached element, and
`colorScheme` is set so native scrollbars and form controls follow.

**The clearing loop is not optional.** Without it, switching from a theme that
defines `--sel-edge` to one that does not leaves the first theme's value in
place, and you get one wrong-coloured border in a corner of the app that nobody
can reproduce.

### 4.4 The `dark` class caveat

If the markup contains Tailwind `dark:` variants, exactly one theme may carry
the literal `dark` class. Other themes fall through to the light branch — which
is what a light palette theme wants anyway.

A specificity trap comes with it. Tailwind emits `dark:` utilities as
`.dark\:x:is(.themed *)`, which outranks a plain `.dark` rule, so overrides have
to be written against `html.dark`:

```css
html.dark .dark\:bg-slate-200      { background-color: #d2d2d6; }
html.dark .dark\:border-slate-700  { border-color: #4a4a4f; }
```

Cleanest advice for a new app: **do not use `dark:` variants at all.** Express
dark as another token block. The variants exist here only because they predate
the token system.

### 4.5 Themes derived from a palette

Themes beyond the built-ins are generated: give a list of hex values, get a token
ladder. That engine has no dependency on the app and lives in its own folder,
already packaged to be lifted:

```
src/lib/theme-studio/
  README.md
  ThemeStudio.tsx   the editor component
  derive.ts         hex list -> token ladder
  styles.ts         injected at runtime, scoped under .ts-studio
  types.ts
  index.ts
```

Its README states the boundary, and this is the boundary to copy:

> It depends on **React and nothing else** — no CSS framework, no icon library,
> no state manager, and no import from the application it happens to be sitting
> in. Styles are injected at runtime from a string, scoped under `.ts-studio`, so
> there is no stylesheet to wire into a bundler and no class names that can
> collide with the host's.
>
> The component is fully controlled: it owns no palettes and persists nothing.
> Where palettes are stored — localStorage, a file, an API — is the host's
> decision, which is what makes the component portable.

```tsx
import { ThemeStudio, type StudioPalette } from './lib/theme-studio';

<ThemeStudio
  palettes={palettes}
  onChange={setPalettes}
  activeId={currentThemeId}
  applyLabel="Apply to app"
  onApply={(palette, derived) => {
    for (const [key, value] of Object.entries(derived.tokens)) {
      document.documentElement.style.setProperty(key, value);
    }
  }}
/>
```

Custom themes are held in a module variable rather than a store, because
`applyTheme` runs outside React:

```ts
let customThemes: ThemeMeta[] = [];

export function setCustomThemes(palettes: readonly { id: string; name: string; colors: string[] }[]): void {
  customThemes = orderPalettes(palettes).filter((p) => p.colors.length >= 2).map((p) => paletteTheme(p, 'custom'));
}

export function allThemes(): ThemeMeta[] { return [...THEMES, ...customThemes]; }
export function themeMeta(id: ThemeId): ThemeMeta { return allThemes().find((t) => t.id === id) ?? THEMES[0]; }
```

`themeMeta` **falls back to the first theme** rather than throwing. A stored
theme id that no longer exists is the same class of problem as a stored route
that no longer resolves, and the answer is the same: degrade, do not fail.

### 4.6 A shortlist, not a list of thirty

Once themes are generated there are too many for a header menu, so the store
keeps a promoted subset:

```ts
/**
 * Palette themes promoted into the header menu. The built-in themes are always
 * there; without this the menu would be a 30-plus item list where choosing a
 * theme means hunting, so the palettes stay in Appearance until someone puts
 * one on the shortlist.
 */
navThemes: ThemeId[];
```

### Contract — theming

* One CSS file maps your framework's surface vocabulary to custom properties,
  gated on a single `.themed` class. Enumerate the opacity variants you use.
* Surface tokens are channel triples so `rgb(var(--t) / .5)` works.
* A theme = `{ id, label, className, colorScheme, tokens }`. Applying it =
  clear all custom properties, set the class, write the tokens, set
  `color-scheme`.
* Unknown theme id → first theme, never an exception.
* Keep the derivation engine dependency-free and fully controlled.

---

## 5. Publishing a setup, so an arrangement travels

Everything above is per browser, which is right for a preference and wrong for a
**setup**. An arrangement somebody spent a week getting right does not survive
opening the app on a second machine, and no amount of pulling the repo fixes it
— git carries the code, never the browser.

### 5.1 Two mechanisms, because there are two shapes of state

```
settings store   ->  `values`, merged per setting   (appDefaults.ts)
everything else  ->  `stores`, replaced per key     (portableState.ts)
```

The settings store is a bag of independent keys, so it merges one setting at a
time. A grid view or a palette set is a whole document with no per-key merge
logic, so it travels whole, keyed by its storage name.

The published file:

```json
{
  "savedAt": "2026-08-26T16:50:28.628Z",
  "values": { "theme": "light", "navWidth": 201, "navLayout": { "sections": [ … ] } },
  "stores": { "ctio.grid.views": "…", "ctio.export.rowOrder": "…" }
}
```

### 5.2 The allow-list for settings

**An allow-list, not a deny-list** — so a setting added later is excluded until
somebody decides it should travel.

```ts
/** The settings that may be published as app defaults. */
export const SHAREABLE_KEYS = [
  'theme', 'navThemes', 'whitePageSurfaces',
  'navWidth', 'refTreeWidth', 'navCollapsed', 'navSectionsClosed',
  'favorites', 'navLayout', 'navIcons',
  'rtmHidden', 'rtmOrder', 'rtmLabelWidth', 'rtmFieldOrder',
  'overviewLayout', 'overviewStats',
  'dataGridExpandedByDefault', 'piGroupByFeatureByDefault',
  'scrumEpicsCollapsedByDefault', 'showBuildSpec',
  'showNonPIItems', 'showNotTestableItems',
  'aboutSmoothScroll', 'aboutScrollDurationMs',
] as const;

export type ShareableKey = (typeof SHAREABLE_KEYS)[number];
export type AppDefaults = Partial<Record<ShareableKey, unknown>>;

const ALLOWED = new Set<string>(SHAREABLE_KEYS);

/**
 * Take only the settings that may travel, from whatever is handed over.
 *
 * Used on both sides — the browser publishing and the server storing it — so
 * that a key added to the app cannot start leaking into a shared file just
 * because one of the two forgot to filter. `undefined` is dropped rather than
 * written, because a key present with no value would publish "unset" as an
 * answer and override nothing while looking like it did.
 */
export function shareable(values: Record<string, unknown>): AppDefaults {
  const out: AppDefaults = {};
  for (const [key, value] of Object.entries(values ?? {})) {
    if (ALLOWED.has(key) && value !== undefined) out[key as ShareableKey] = value;
  }
  return out;
}

/** Built-ins with anything published laid over them. A stored preference wins
 *  over both — that happens where settings are loaded, not here. */
export function withPublished<T extends object>(builtIn: T, published: AppDefaults | null): T {
  return { ...builtIn, ...shareable(published as Record<string, unknown>) } as T;
}
```

Two categories are excluded on purpose, and the reasons generalise:

* **Session locks.** A value that re-arms on every load would be published as a
  default that is overwritten a line later.
* **Migration markers.** A repair-version number records what has been done to
  *one* stored layout. Shipping it would tell a fresh browser that repairs had
  already run against an arrangement it has never seen.

A third is worth calling out because it is a judgement, not a mechanism: **the
coverage-package selection is deliberately not shareable.** Which data a reader
is measuring against is a question they are asking right now, and a published
preset that pinned it would decide for everyone whose browser loaded the file,
silently, on the one number people quote.

### 5.3 The allow-list for whole stores

```ts
/** Storage keys carried whole between machines. */
export const PORTABLE_KEYS: readonly string[] = [
  'ctio-rtm-view', 'ctio.architecture.view', 'ctio.model.view', 'ctio.viewer.view',
  'ctio.filters.v1', 'ctio.jira.pinnedFields', 'ctio:project-colors',
  'ctio-pi-board.custom-palettes.v1', 'ctio-pi-board.tags.v1',
  'ctio.grid.views',
  'ctio.export.rowOrder',
];

/** Prefixes carried too, for the keys that are one-per-source. */
export const PORTABLE_PREFIXES: readonly string[] = ['ctio.grid.views:'];

/** Named so the settings panel can say what stays, rather than leaving somebody
 *  to wonder why their pending edits did not follow them. */
export const LOCAL_ONLY: readonly { key: string; why: string }[] = [
  { key: 'ctio-pi-board.settings.v1', why: 'travels per setting instead, so one choice does not block the rest' },
  { key: 'ctio.edits.pending',        why: 'unsaved edits — work in flight, not a preference' },
  { key: 'ctio.scrum.status-journal', why: 'a journal is content; a reset must not be able to erase it' },
  { key: 'ctio-pi-board.recovery.log', why: 'describes this machine’s crashes' },
];

export function isPortable(key: string): boolean {
  return PORTABLE_KEYS.includes(key) || PORTABLE_PREFIXES.some((p) => key.startsWith(p));
}

export function collectPortable(storage: StorageLike): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key === null || !isPortable(key)) continue;
    const value = storage.getItem(key);
    if (value !== null) out[key] = value;
  }
  return out;
}

/**
 * Fill in where this browser has nothing. Returns what was written.
 *
 * The allow-list is re-checked here and not only at collection time: the file
 * is data, and a published file naming `edits.pending` must not be able to
 * write one.
 */
export function seedPortable(storage: StorageLike, doc: Record<string, string>): string[] {
  const written: string[] = [];
  for (const [key, value] of Object.entries(doc)) {
    if (!isPortable(key) || storage.getItem(key) !== null) continue;
    storage.setItem(key, value);
    written.push(key);
  }
  return written;
}
```

Three categories must **never** travel, and each would do real damage:

* **Work in flight** — unsaved edits. Replaying one machine's half-finished
  edits onto another is data loss wearing a feature's clothes.
* **Content** — a journal is a record of what happened, not a preference. A
  "reset to defaults" that can erase a journal is a bug.
* **This machine's diagnostics** — a recovery log would make a fresh machine
  believe it had been crashing all week.

`LOCAL_ONLY` carries a `why` per key so the settings panel can *say* what stays.

**The allow-list is applied at both ends**, because the file is data and may be
hand-edited. Filter on collect *and* on seed.

`StorageLike` is passed in rather than reached for, which keeps the module free
of the DOM and testable against a plain map:

```ts
export interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
```

### 5.4 Reading it — API first, static file second

```ts
export const APP_DEFAULTS_URL = 'api/app-defaults';        // dev-server middleware
export const APP_DEFAULTS_STATIC_URL = 'config/app-defaults.json'; // shipped in the build

export async function fetchPublished(base: string, get: typeof fetch = fetch): Promise<PublishedDoc | null> {
  for (const path of [APP_DEFAULTS_URL, APP_DEFAULTS_STATIC_URL]) {
    try {
      const response = await get(`${base}${path}`);
      // A 404 from the API is the static build; a 404 from the file is nothing
      // published. Either way, try the next source and then give up quietly.
      if (!response.ok) continue;
      const doc = await response.json();
      const values = shareable((doc?.values ?? {}) as Record<string, unknown>);
      // Both ends filter. The API already screened its copy, but the static file
      // has had no such pass and is editable by hand.
      const stores = Object.fromEntries(
        Object.entries((doc?.stores ?? {}) as Record<string, unknown>)
          .filter(([key, value]) => typeof value === 'string' && isPortable(key)),
      ) as Record<string, string>;
      if (!Object.keys(values).length && !Object.keys(stores).length) continue;
      return { values, stores };
    } catch {
      // Nothing listening, or a file that is not JSON. Try the next source.
    }
  }
  return null;
}
```

That two-source fallback is what lets the same preset work in a dev server, a
static build and a single-file offline build. Nothing published is the **ordinary
state**, not an error.

### 5.5 Boot order — the part that is easy to get wrong

A store that reads `localStorage` at import time builds its initial state the
moment it is imported. So anything meant to change what "no preference" looks
like has to be installed **before that import** — which means a dynamic import of
the app.

```tsx
async function boot() {
  // The dev server's API first, then the static file for a build with no
  // server behind it. Failure of both is ordinary — nothing published yet.
  const published = await fetchPublished(import.meta.env.BASE_URL);
  if (published) {
    installPublishedDefaults(published.values);
    // The layouts that travel whole. Seeded into storage rather than handed to
    // each store, because there are fourteen of them and they read
    // `localStorage` directly at import. One write here reaches all of them.
    seedPortable(localStorage, published.stores);
  }

  const { default: App } = await import('./App');   // <- after, deliberately

  createRoot(document.getElementById('root')!).render(
    <StrictMode><Router><App /></Router></StrictMode>,
  );
}

void boot();
```

The holder is a module of its own, for the same ordering reason — it cannot live
in the store, since importing the store to install into it is what triggers the
thing being installed into:

```ts
let published: AppDefaults | null = null;
export function installPublishedDefaults(values: AppDefaults | null): void { published = values; }
export const publishedDefaults = (): AppDefaults | null => published;
```

### 5.6 Where precedence is actually enforced

```ts
const defaults = (): SettingsValues => withPublished(BUILT_IN_DEFAULTS, publishedDefaults());

function load(): SettingsValues {
  const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>;
  const base = defaults();
  const stored = { ...base, ...raw };
  return {
    ...stored,
    // Each of these overrides `stored` from `raw` alone, to validate or migrate
    // what a browser saved. That is right — and it must still fall back to
    // `base` rather than to a hardcoded empty, or a published value is
    // discarded on exactly the browsers it exists for: the ones with nothing
    // stored.
    theme: migrateTheme(raw, base.theme),
    navThemes: Array.isArray(raw.navThemes)
      ? (raw.navThemes as ThemeId[]).filter((id) => typeof id === 'string' && id)
      : base.navThemes,
    coverageLayers: normaliseLayers(stored.coverageLayers as string[] | undefined),
    navWidth: Math.min(NAV_MAX_WIDTH, Math.max(NAV_MIN_WIDTH, Number(stored.navWidth) || base.navWidth)),
    // Session lock: always back to safe on load.
    dataGridManualEditLocked: true,
  };
}
```

**The trap in that block, spelled out.** Every validated key must fall back to
`base`, not to a literal `[]`, `{}` or `null`. Falling back to a literal
silently discards the published value on precisely the browsers the preset
exists for — the fresh ones. It is invisible in testing, because the developer's
own browser has something stored.

### 5.7 Publishing

```ts
export async function publishSetup(settings: Record<string, unknown>): Promise<PublishedSetup> {
  const res = await fetch(`${import.meta.env.BASE_URL}${APP_DEFAULTS_URL}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    // `settings` is passed in from the store rather than read from localStorage:
    // what is published should be what is on screen, including a change made a
    // moment ago and not yet written back.
    body: JSON.stringify({ values: shareable(settings), stores: collectPortable(localStorage) }),
  });
  const doc = await res.json();
  if (!res.ok) throw new Error(doc?.error ?? 'Save failed');
  return { savedAt: doc.savedAt, values: doc.values ?? {}, stores: doc.stores ?? {} };
}
```

One definition, two callers: the **App defaults** panel where publishing is the
deliberate act, and the **standalone build**, which publishes first so the file
it cuts opens into the current arrangement. That second caller is the reason the
function exists — asking people to remember the order made the correctness of
the artifact depend on a habit.

### 5.8 Saving must never take the app down

```ts
let warnedAboutStorage = false;

export function persistSettings(values: unknown): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
  } catch (error) {
    if (!warnedAboutStorage) {
      warnedAboutStorage = true;
      console.warn('[settings] could not be saved — they will apply for this session but not survive a reload.', error);
    }
  }
}
```

The quota is about 5 MB and this blob carries the nav layout, its icons,
favourites, the roll-up layout and the field order. A private window can refuse
writes outright. A throw inside a store setter travels up through the React
event handler — which, before an error boundary existed, meant a white screen
from adjusting a setting.

### Contract — publishing

* Two allow-lists: per-setting keys, and whole storage keys. Both filtered on
  write **and** on read.
* Never publish: work in flight, content, machine diagnostics, session locks,
  migration markers.
* Seeding fills in only where the browser has nothing. A deliberate reset may
  overwrite.
* Install published defaults **before** importing anything that reads storage.
* Every validated key falls back to the published base, never to a literal.
* Storage writes are wrapped and warned once.

---

## 6. Porting checklist

Roughly a day for the first four, in this order. Each step leaves the app
working.

1. **Token pass.** Pick your surface vocabulary, define `:root`, write the
   `.themed` remap, add a `light` and a `dark` theme. Nothing else changes yet.
2. **Settings store.** One store, one storage key, `persistSettings` with the
   try/catch, built-in defaults as a plain constant.
3. **Rail as data.** Add `NavLayout` + `normalise`, write your `BUILT_IN_NAV`,
   render sections from it. The rail should look identical when you finish.
4. **Arrange it.** Width drag, collapse, fold state, then the settings panel with
   `placeItem` / `moveItem` / `hideItem`.
5. **Flags.** Booleans on the store, `useListed`, `flag?` on nav entries only.
6. **Header cluster.** One shared class function, state left, controls right.
7. **Guide overlay.** Backdrop + Escape + two closes, one under the opener.
8. **Icons and favourites**, if the rail is long enough to need them.
9. **Publishing**, last — it is the only step that needs a server endpoint.

### What to keep tests on

The pure modules carry the whole risk, and they are pure precisely so they can
be tested without a DOM:

* `normalise` — dropped, appended, hidden-wins, empty-section-kept.
* `placeItem` — same-section drag in both directions.
* `moveItem` — crossing a section boundary, stepping into an empty section.
* `shareable` / `isPortable` — an excluded key cannot get through either end.
* `resolveIcons` — unknown name falls back rather than leaving a hole.
* `tabOwnsPath` — nested routes.

---

## 7. The traps, collected

Each of these cost real time here.

1. **An ElementTree/DOM-ish object that is falsy.** Not JS-specific, but the
   general form is: `a || b` where `a` is a valid-but-falsy value silently takes
   `b`. Use `!= null` checks for anything that can legitimately be empty.
2. **A stored value that no longer matches anything** narrows a view to zero with
   no control lit to explain it. This is why `normalise` exists, and why the
   filter state needed the same treatment as the nav.
3. **`[hidden]` loses to an inline `display`.** A UA rule cannot beat a style
   attribute. If you toggle `hidden`, do not also set `display` inline.
4. **A drag index read after the item is removed** shifts every list by one, and
   only in one direction.
5. **Two nav entries both marked active**, because a prefix match claims a nested
   route. Longest match wins.
6. **`window.innerWidth` is 0 before the first layout.** A default computed at
   module scope silently takes the fallback. Read it lazily, and ask
   `document.documentElement.clientWidth` as a second question.
7. **A validated setting falling back to a literal** instead of the published
   base — invisible on any machine that already has settings stored.
8. **A theme switch leaving the previous theme's tokens behind.** Clear all
   custom properties before writing the new ones.
9. **A `localStorage` write throwing** on quota or in a private window, taking a
   render down with it.
10. **A flag whose effect is deferred**, with nothing on screen saying so — it
    reads as broken. Say when it applies.
11. **A switch that reveals nothing in this dataset** while its description
    quotes a fixed number. Count what is loaded.
12. **Tailwind opacity variants are separate classes.** `bg-slate-50/95` needs
    its own remap line; it does not inherit from `bg-slate-50`.

---

## 8. File map

If you are copying, these are the files, in dependency order. Everything in the
first group is pure and has no import from the app it sits in.

```
domain/navLayout.ts        NavLayout, normalise, placeItem, moveItem, hide/seed, sections
domain/navIcons.ts         NavIcons, resolveIcons, iconUsage
domain/favorites.ts        Favorite, normaliseFavorites, toggle, move
domain/appDefaults.ts      SHAREABLE_KEYS, shareable, withPublished, isEmpty
domain/portableState.ts    PORTABLE_KEYS, LOCAL_ONLY, isPortable, collect, seed

lib/theme-studio/          palette editor + derivation engine (React only, no other deps)

features/settings/settingsStore.ts     the one store: values, actions, persist, load
features/settings/publishedDefaults.ts install/read + fetchPublished (API then static)
features/settings/publishSetup.ts      PUT the current setup
features/settings/themes.ts            ThemeMeta, THEMES, applyTheme, allThemes
features/settings/iconCatalogue.ts     the hand-picked icon set
features/settings/navCatalogue.ts      usePublishNavCatalogue / useNavCatalogue
features/settings/NavigationPanel.tsx  the arrange-the-nav UI
features/settings/FeatureFlags.tsx     the settings modal and its panels

index.css                  :root tokens + the .themed remap
main.tsx                   boot order: fetch published -> install -> seed -> import App
App.tsx                    Sidebar, SidebarSection, SidebarLink, header, guide overlay
```
