<script lang="ts">
  import { repo } from '$lib/db/repo.svelte';
  import { router } from '$lib/ui/router.svelte';
  import BudgetCard from '$lib/ui/BudgetCard.svelte';
  import { evaluateBudget } from '$lib/core/budgets';
  import type { WidgetProps } from './registry';

  let { config }: WidgetProps = $props();
  const ids = $derived((config.budgetIds as string[]) ?? []);
  const states = $derived.by(() => {
    const lookup = repo.lookup();
    const allocs = repo.allocations();
    const prefs = repo.calendar();
    return repo
      .list('budget')
      .filter((b) => !b.archived && (!ids.length || ids.includes(b.id)))
      .sort((a, b) => a.order - b.order)
      .map((b) => evaluateBudget(b, allocs, lookup, prefs));
  });
</script>

<div class="card-title">{(config.label as string) || 'Budgets'}</div>
{#if states.length}
  <div class="list">
    {#each states as s (s.budget.id)}
      <BudgetCard state={s} compact onclick={() => router.go('/budgets')} />
    {/each}
  </div>
{:else}
  <p class="muted small">No budgets yet. <a href="#/budgets">Set one up</a> — e.g. a weekly food limit.</p>
{/if}
