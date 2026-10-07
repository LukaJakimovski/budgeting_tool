/** Item lists for MultiPick, shared by filters and the budget editor. */
import { repo } from '../db/repo.svelte';
import type { PickItem } from './MultiPick.svelte';

export function categoryItems(kind?: 'expense' | 'income'): PickItem[] {
  const cats = repo.categories().filter((c) => !kind || c.kind === kind);
  const out: PickItem[] = [];
  for (const r of cats.filter((c) => !c.parentId)) {
    const kids = cats.filter((c) => c.parentId === r.id);
    out.push({ id: r.id, label: r.name, icon: r.icon, hint: kids.length ? 'includes subcategories' : undefined });
    for (const k of kids) out.push({ id: k.id, label: k.name, icon: k.icon, depth: 1 });
  }
  return out;
}

export function tagItems(): PickItem[] {
  return repo.tags().map((t) => ({ id: t.id, label: '#' + t.name }));
}

export function merchantItems(): PickItem[] {
  return repo.merchants().map((m) => ({ id: m.id, label: m.name }));
}

export function paymentItems(): PickItem[] {
  return repo.paymentMethods().map((p) => ({ id: p.id, label: p.name }));
}
