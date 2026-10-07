# Extending Tally

Tally has three extension points designed so bigger features — like a future
RuneScape-style gamification layer — can be added **without changing the
core**:

| Extension point | File | What it gives you |
|---|---|---|
| Domain events | `app/src/lib/modules/events.ts` | Be told when things happen (purchase added, budget crossed, sync finished…) |
| Dashboard widgets | `app/src/widgets/registry.ts` | Add cards to Home with their own settings form |
| Styles | `app/src/lib/theme/registry.ts` | Add looks (colours, fonts, textures, ornaments) |
| Modules | `app/src/lib/modules/registry.ts` | Bundle all of the above behind an on/off switch in *Settings → Modules*, with synced state |

## Events

```ts
import { on } from '$lib/modules/events';

const stop = on('transaction:created', ({ tx, budgets }) => {
  // budgets: the state of every budget this purchase counts towards
});
```

Available events (`TallyEvents` in `events.ts` — add more there, they're
fully typed):

| Event | Payload |
|---|---|
| `transaction:created` | `{ tx, budgets }` — a new entry saved on this device |
| `transaction:updated` | `{ tx, previous }` |
| `transaction:deleted` | `{ tx }` |
| `budget:threshold` | `{ state, crossed: 'warn' \| 'over' }` — a local change pushed a budget over its warning level or limit |
| `doc:saved` | `{ doc, previous, origin: 'local' \| 'remote' }` — any document, including ones arriving by sync |
| `sync:completed` | `{ pulled, pushed }` |
| `backup:created` | `{ kind, at }` |
| `app:ready` | `{}` |

Events fire on the device where the action happened (`origin: 'remote'` marks
synced arrivals), so a module can avoid awarding the same thing twice.

## Widgets

A widget is a Svelte component receiving `{ config, size }`, plus a definition:

```ts
import { registerWidget } from '../widgets/registry';
import NoSpendStreak from './NoSpendStreak.svelte';

registerWidget({
  type: 'noSpendStreak',
  name: 'No-spend streak',
  description: 'Days in a row without a purchase in chosen categories.',
  icon: 'sparkles',
  defaultSize: 'half',
  defaultConfig: { filter: { categoryIds: ['cat_treats'] } },
  fields: [{ key: 'filter', label: 'Count purchases in', kind: 'filter' }],
  component: NoSpendStreak,
});
```

`fields` declares the widget's settings; the dashboard renders the form for you.
Field kinds: `range`, `number`, `select`, `text`, `budgets`, `merchants`,
`filter`. Read data through `repo` (reactive) and the helpers in
`lib/analysis.ts`, `lib/core/ledger.ts` and `lib/core/budgets.ts`.

## Modules

A module bundles behaviour, widgets and styles, and can be switched on/off per
user. Its state is stored in a synced setting (`setting:module:<id>`), so it
follows the user across devices and is included in backups and exports.

```ts
// app/src/modules/quests/index.ts
import { defineModule } from '$lib/modules/registry';
import QuestLog from './QuestLog.svelte';
import scape from './style';

interface QuestState { xp: Record<string, number>; streak: number; lastDay: string | null }

export default defineModule({
  id: 'quests',
  name: 'Quests & skills',
  description: 'Earn XP in Thrift, Discipline and Bookkeeping for staying under budget.',
  setup(api) {
    api.registerStyle(scape);
    api.registerWidget({ type: 'questLog', name: 'Quest log', description: 'Your skills and quests', icon: 'sparkles',
      defaultSize: 'full', defaultConfig: {}, fields: [], component: QuestLog });

    const offs = [
      api.on('transaction:created', async () => {
        const s = api.getState<QuestState>({ xp: {}, streak: 0, lastDay: null });
        s.xp.bookkeeping = (s.xp.bookkeeping ?? 0) + 10;       // logging is rewarded
        await api.setState(s);
      }),
      api.on('budget:threshold', ({ crossed }) => {
        if (crossed === 'over') api.toast('A budget was breached — Discipline XP lost!');
      }),
    ];
    return () => offs.forEach((off) => off());             // called when switched off
  },
});
```

Then import it once from `app/src/main.ts` (e.g. `import './modules/quests';`).
It shows up in *Settings → Modules*; enabling it calls `setup`, disabling it
calls the returned cleanup.

Ideas that fit this design without core changes: skill levels per category
(XP for days under budget), quests ("no takeout for 7 days"), achievements,
streaks, a themed style with pixel borders and parchment textures, a
loot-drop animation on saving.

### Guidelines

* Derive rewards from data where possible (e.g. compute a streak from
  transactions) rather than accumulating counters, so it stays correct across
  devices, edits and restores.
* Keep module state small; it syncs as one document.
* Never block saving a purchase — event handlers run after the save.

## Other places to extend

* **Bank import presets:** `lib/importers.ts` (`CIBC_PRESET`, `guessMapping`).
* **Export formats:** `lib/exporters.ts`.
* **Default categories:** `lib/core/defaults.ts` (keep ids stable).
* **Chart types:** `lib/charts/` — small, dependency-free SVG components.
