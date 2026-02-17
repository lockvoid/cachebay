<script lang="ts">
  import { browser } from "$app/environment";
  import { createFragment } from "cachebay/svelte";
  import { useHogwartsTime, HOGWARTS_TIME_FIELDS } from "$lib/queries/hogwartsTime";

  let mounted = $state(false);

  if (browser) {
    mounted = true;
    useHogwartsTime();
  }

  const hogwartsTime = browser
    ? createFragment({ id: "HogwartsTime:1", fragment: HOGWARTS_TIME_FIELDS })
    : { data: undefined };

  const timeFormatter = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
</script>

{#if mounted && hogwartsTime.data}
  <div class="flex items-center text-xs">
    Hogwarts time: {hogwartsTime.data.time ? timeFormatter.format(new Date(hogwartsTime.data.time)) : ""}
  </div>
{/if}
