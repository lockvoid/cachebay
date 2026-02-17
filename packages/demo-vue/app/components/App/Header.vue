<script setup lang="ts">
  import nprogress from "nprogress";

  const spellsPagination = useSpellsPagination();

  const spellsActivity = useSpellsActivity();

  watch(spellsActivity, () => {
    if (spellsActivity.isFetching) {
      nprogress.start();
    } else {
      nprogress.done();
    }
  });
</script>

<template>
  <div class="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white p-4">
    <NuxtLink to="/" class="z-10 flex-shrink-0">
      <AppLogo />
    </NuxtLink>

    <div class="absolute left-1/2 hidden w-full max-w-md -translate-x-1/2 transform md:block">
      <div class="relative flex gap-2">
        <UiSearchInput v-model="spellsPagination.filter.query" placeholder="Search spells..." />

        <select v-model="spellsPagination.filter.sort" class="select-inline absolute top-1/2 right-3 -translate-y-1/2">
          <option value="CREATE_DATE_DESC">
            Create Date
          </option>

          <option value="NAME_ASC">
            Name
          </option>
        </select>
      </div>
    </div>

    <div class="relative flex-1 md:hidden">
      <div class="flex gap-2">
        <UiSearchInput v-model="spellsPagination.filter.query" placeholder="Search..." class="flex-1" />

        <select v-model="spellsPagination.filter.sort" class="select flex-shrink-0 text-xs">
          <option value="CREATE_DATE_DESC">
            Date
          </option>
          <option value="NAME_ASC">
            A-Z
          </option>
          <option value="NAME_DESC">
            Z-A
          </option>
        </select>
      </div>

      <span v-if="spellsActivity.isFetching" class="absolute top-1/2 right-0 -translate-y-1/2 transform text-xs text-gray-500">
        Loading…
      </span>
    </div>

    <div class="ml-auto flex items-center gap-2">
      <NuxtLink to="/spells/new" class="button-primary px-3 py-2">
        + New spell
      </NuxtLink>

      <AppSettings />
    </div>
  </div>
</template>
